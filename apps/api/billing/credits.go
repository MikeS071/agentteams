package billing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
)

const centsPerDollar = 100

var ErrInsufficientCredits = errors.New("insufficient credits")

type CreditService struct {
	db *sql.DB
}

func NewCreditService(db *sql.DB) *CreditService {
	return &CreditService{db: db}
}

type modelPricing struct {
	inputPerMillionCents  int
	outputPerMillionCents int
	markupPct             int
}

func (s *CreditService) DeductTokens(ctx context.Context, tenantID string, model string, tokensIn, tokensOut int) error {
	tenantID = strings.TrimSpace(tenantID)
	model = strings.TrimSpace(model)
	if tenantID == "" {
		return errors.New("tenant id is required")
	}
	if model == "" {
		return errors.New("model is required")
	}
	if tokensIn < 0 || tokensOut < 0 {
		return errors.New("token counts cannot be negative")
	}

	pricing, err := s.readModelPricing(ctx, model)
	if err != nil {
		return err
	}

	baseCostCents, totalCostCents := calculateCostCents(pricing, tokensIn, tokensOut)
	if totalCostCents <= 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO credits (tenant_id, balance_cents, free_credit_used, updated_at)
		 VALUES ($1, 0, false, NOW())
		 ON CONFLICT (tenant_id) DO NOTHING`,
		tenantID,
	); err != nil {
		return fmt.Errorf("ensure credits row: %w", err)
	}

	var balanceCents int
	if err := tx.QueryRowContext(
		ctx,
		`SELECT balance_cents
		   FROM credits
		  WHERE tenant_id = $1
		  FOR UPDATE`,
		tenantID,
	).Scan(&balanceCents); err != nil {
		return fmt.Errorf("read balance: %w", err)
	}

	if balanceCents < totalCostCents {
		return ErrInsufficientCredits
	}

	if _, err := tx.ExecContext(
		ctx,
		`UPDATE credits
		    SET balance_cents = balance_cents - $1,
		        updated_at = NOW()
		  WHERE tenant_id = $2`,
		totalCostCents,
		tenantID,
	); err != nil {
		return fmt.Errorf("deduct credits: %w", err)
	}

	marginCents := totalCostCents - baseCostCents
	if marginCents < 0 {
		marginCents = 0
	}

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO usage_logs (tenant_id, model, input_tokens, output_tokens, cost_cents, margin_cents, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
		tenantID, model, tokensIn, tokensOut, totalCostCents, marginCents,
	); err != nil {
		return fmt.Errorf("insert usage log: %w", err)
	}

	reason := fmt.Sprintf("usage:%s", model)
	description := fmt.Sprintf("Token usage charge (%d in, %d out)", tokensIn, tokensOut)
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO credit_transactions (tenant_id, amount_cents, reason, type, description, created_at)
		 VALUES ($1, $2, $3, $4, $5, NOW())`,
		tenantID, -totalCostCents, reason, "deduct", description,
	); err != nil {
		return fmt.Errorf("insert credit transaction: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	return nil
}

func (s *CreditService) GetBalance(ctx context.Context, tenantID string) (float64, error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return 0, errors.New("tenant id is required")
	}

	var balanceCents int
	err := s.db.QueryRowContext(ctx, `SELECT balance_cents FROM credits WHERE tenant_id = $1`, tenantID).Scan(&balanceCents)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("get balance: %w", err)
	}

	return float64(balanceCents) / centsPerDollar, nil
}

func (s *CreditService) AddCredits(ctx context.Context, tenantID string, amount float64, reason string) error {
	tenantID = strings.TrimSpace(tenantID)
	reason = strings.TrimSpace(reason)
	if tenantID == "" {
		return errors.New("tenant id is required")
	}
	if reason == "" {
		reason = "credit_adjustment"
	}

	amountCents := dollarsToCents(amount)
	if amountCents <= 0 {
		return errors.New("amount must be greater than zero")
	}

	txType := inferTransactionType(reason)
	description := humanReadableDescription(reason, txType)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	if txType == "purchase" {
		var alreadyApplied bool
		if err := tx.QueryRowContext(
			ctx,
			`SELECT EXISTS (
				SELECT 1
				  FROM credit_transactions
				 WHERE tenant_id = $1
				   AND type = 'purchase'
				   AND reason = $2
			)`,
			tenantID,
			reason,
		).Scan(&alreadyApplied); err != nil {
			return fmt.Errorf("check purchase idempotency: %w", err)
		}
		if alreadyApplied {
			return nil
		}
	}

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO credits (tenant_id, balance_cents, free_credit_used, updated_at)
		 VALUES ($1, $2, false, NOW())
		 ON CONFLICT (tenant_id)
		 DO UPDATE SET balance_cents = credits.balance_cents + EXCLUDED.balance_cents,
		               updated_at = NOW()`,
		tenantID, amountCents,
	); err != nil {
		return fmt.Errorf("add credits: %w", err)
	}

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO credit_transactions (tenant_id, amount_cents, reason, type, description, created_at)
		 VALUES ($1, $2, $3, $4, $5, NOW())`,
		tenantID, amountCents, reason, txType, description,
	); err != nil {
		return fmt.Errorf("insert credit transaction: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	return nil
}

func (s *CreditService) readModelPricing(ctx context.Context, model string) (modelPricing, error) {
	var pricing modelPricing
	err := s.db.QueryRowContext(
		ctx,
		`SELECT provider_cost_input_per_m, provider_cost_output_per_m, markup_pct
		   FROM models
		  WHERE id = $1 AND enabled = true`,
		model,
	).Scan(&pricing.inputPerMillionCents, &pricing.outputPerMillionCents, &pricing.markupPct)
	if errors.Is(err, sql.ErrNoRows) {
		return modelPricing{}, fmt.Errorf("model not found or disabled: %s", model)
	}
	if err != nil {
		return modelPricing{}, fmt.Errorf("lookup model pricing: %w", err)
	}
	return pricing, nil
}

func calculateCostCents(pricing modelPricing, tokensIn, tokensOut int) (int, int) {
	if tokensIn == 0 && tokensOut == 0 {
		return 0, 0
	}

	rawBase := (float64(tokensIn)*float64(pricing.inputPerMillionCents) +
		float64(tokensOut)*float64(pricing.outputPerMillionCents)) / 1_000_000.0

	rawTotal := rawBase * (1 + float64(pricing.markupPct)/100.0)
	totalCents := int(math.Ceil(rawTotal))
	if totalCents < 1 {
		totalCents = 1
	}

	baseCents := int(math.Ceil(rawBase))
	if baseCents < 0 {
		baseCents = 0
	}

	return baseCents, totalCents
}

func inferTransactionType(reason string) string {
	normalized := strings.ToLower(strings.TrimSpace(reason))
	switch {
	case strings.Contains(normalized, "purchase"), strings.Contains(normalized, "stripe"):
		return "purchase"
	case strings.Contains(normalized, "deduct"), strings.Contains(normalized, "usage"):
		return "deduct"
	case strings.Contains(normalized, "grant"), strings.Contains(normalized, "signup"), strings.Contains(normalized, "free"):
		return "grant"
	default:
		return "grant"
	}
}

func humanReadableDescription(reason string, txType string) string {
	switch txType {
	case "purchase":
		return "Purchased credits"
	case "grant":
		return "Credits granted"
	case "deduct":
		return "Credits deducted"
	default:
		return reason
	}
}

func dollarsToCents(amount float64) int {
	return int(math.Round(amount * centsPerDollar))
}
