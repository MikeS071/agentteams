package llmproxy

import (
	"database/sql"
	"fmt"
	"log/slog"
)

// CheckCredits returns the tenant's balance in cents. Returns error on DB failure.
func CheckCredits(db *sql.DB, tenantID string) (int, error) {
	var balance int
	err := db.QueryRow(`SELECT balance_cents FROM credits WHERE tenant_id = $1`, tenantID).Scan(&balance)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return balance, err
}

// BillUsage records a usage log and deducts credits.
// costCents is the total cost including markup.
func BillUsage(db *sql.DB, tenantID string, modelID string, inputTokens, outputTokens, costCents int) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	// Insert usage log
	_, err = tx.Exec(
		`INSERT INTO usage_logs (tenant_id, model, input_tokens, output_tokens, cost_cents, margin_cents) VALUES ($1, $2, $3, $4, $5, $6)`,
		tenantID, modelID, inputTokens, outputTokens, costCents, 0,
	)
	if err != nil {
		return fmt.Errorf("insert usage_log: %w", err)
	}

	// Deduct from credits
	_, err = tx.Exec(
		`UPDATE credits SET balance_cents = balance_cents - $1, updated_at = NOW() WHERE tenant_id = $2`,
		costCents, tenantID,
	)
	if err != nil {
		return fmt.Errorf("deduct credits: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	slog.Info("billed usage", "tenant", tenantID, "model", modelID, "input", inputTokens, "output", outputTokens, "cost_cents", costCents)
	return nil
}

// CalcCostCents calculates the cost in cents given token counts and model pricing.
func CalcCostCents(m *Model, inputTokens, outputTokens int) int {
	// Cost = (input_tokens * input_per_m / 1_000_000 + output_tokens * output_per_m / 1_000_000) * (1 + markup/100)
	// All in cents. Use int64 to avoid overflow.
	inputCost := int64(inputTokens) * int64(m.ProviderCostInputM)
	outputCost := int64(outputTokens) * int64(m.ProviderCostOutputM)
	baseCost := (inputCost + outputCost) / 1_000_000
	totalCost := baseCost * int64(100+m.MarkupPct) / 100
	if totalCost < 1 && (inputTokens > 0 || outputTokens > 0) {
		totalCost = 1 // minimum 1 cent
	}
	return int(totalCost)
}
