package routes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/agentteams/api/billing"
)

const (
	defaultUsagePageSize = 20
	maxUsagePageSize     = 100
)

type BillingRoutes struct {
	db      *sql.DB
	credits *billing.CreditService
	stripe  *billing.StripeService
}

func MountBillingRoutes(mux *http.ServeMux, db *sql.DB, credits *billing.CreditService, stripe *billing.StripeService) {
	routes := &BillingRoutes{
		db:      db,
		credits: credits,
		stripe:  stripe,
	}

	mux.HandleFunc("GET /api/billing/balance", routes.handleGetBalance)
	mux.HandleFunc("GET /api/billing/usage", routes.handleGetUsage)
	mux.HandleFunc("POST /api/billing/checkout", routes.handleCheckout)
	mux.HandleFunc("POST /api/billing/webhook", routes.handleWebhook)
}

func (r *BillingRoutes) handleGetBalance(w http.ResponseWriter, req *http.Request) {
	tenantID := requestTenantID(req)
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing X-Tenant-ID header")
		return
	}

	balanceUSD, err := r.credits.GetBalance(req.Context(), tenantID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load balance")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"tenant_id":     tenantID,
		"balance_usd":   balanceUSD,
		"balance_cents": int(balanceUSD * 100),
	})
}

func (r *BillingRoutes) handleGetUsage(w http.ResponseWriter, req *http.Request) {
	tenantID := requestTenantID(req)
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing X-Tenant-ID header")
		return
	}

	query := req.URL.Query()
	page := parseIntOrDefault(query.Get("page"), 1)
	if page < 1 {
		page = 1
	}

	pageSize := parseIntOrDefault(query.Get("page_size"), defaultUsagePageSize)
	if pageSize < 1 {
		pageSize = defaultUsagePageSize
	}
	if pageSize > maxUsagePageSize {
		pageSize = maxUsagePageSize
	}

	model := strings.TrimSpace(query.Get("model"))
	startAt, err := parseDateFilter(query, "start_date")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	endAt, err := parseDateFilter(query, "end_date")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	items, total, err := r.queryUsage(req.Context(), tenantID, model, startAt, endAt, page, pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load usage")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items": items,
		"pagination": map[string]any{
			"page":      page,
			"page_size": pageSize,
			"total":     total,
		},
	})
}

func (r *BillingRoutes) handleCheckout(w http.ResponseWriter, req *http.Request) {
	tenantID := requestTenantID(req)
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing X-Tenant-ID header")
		return
	}

	var payload struct {
		AmountUSD  int    `json:"amount_usd"`
		Amount     int    `json:"amount"`
		SuccessURL string `json:"success_url"`
		CancelURL  string `json:"cancel_url"`
	}
	if err := decodeJSONStrict(req, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	amountUSD := payload.AmountUSD
	if amountUSD <= 0 {
		amountUSD = payload.Amount
	}

	successURL, cancelURL, err := checkoutURLs(payload.SuccessURL, payload.CancelURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	session, err := r.stripe.CreateCheckoutSession(req.Context(), tenantID, amountUSD, successURL, cancelURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"session_id": session.ID,
		"url":        session.URL,
	})
}

func (r *BillingRoutes) handleWebhook(w http.ResponseWriter, req *http.Request) {
	signature := req.Header.Get("Stripe-Signature")
	body, err := io.ReadAll(req.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read webhook payload")
		return
	}

	result, err := r.stripe.HandleWebhook(req.Context(), body, signature)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, billing.ErrInvalidWebhookSignature) {
			status = http.StatusBadRequest
		}
		writeError(w, status, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

type usageRow struct {
	ID           string    `json:"id"`
	Model        string    `json:"model"`
	InputTokens  int       `json:"tokens_in"`
	OutputTokens int       `json:"tokens_out"`
	CostCents    int       `json:"cost_cents"`
	CostUSD      float64   `json:"cost_usd"`
	CreatedAt    time.Time `json:"timestamp"`
}

func (r *BillingRoutes) queryUsage(
	ctx context.Context,
	tenantID string,
	model string,
	startAt *time.Time,
	endAt *time.Time,
	page int,
	pageSize int,
) ([]usageRow, int, error) {
	where := []string{"tenant_id = $1"}
	args := []any{tenantID}
	argPos := 2

	if model != "" {
		where = append(where, fmt.Sprintf("model = $%d", argPos))
		args = append(args, model)
		argPos++
	}
	if startAt != nil {
		where = append(where, fmt.Sprintf("created_at >= $%d", argPos))
		args = append(args, *startAt)
		argPos++
	}
	if endAt != nil {
		where = append(where, fmt.Sprintf("created_at <= $%d", argPos))
		args = append(args, *endAt)
		argPos++
	}

	whereClause := strings.Join(where, " AND ")
	countQuery := "SELECT COUNT(*) FROM usage_logs WHERE " + whereClause

	var total int
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count usage rows: %w", err)
	}

	offset := (page - 1) * pageSize
	args = append(args, pageSize, offset)
	dataQuery := fmt.Sprintf(
		`SELECT id, model, input_tokens, output_tokens, cost_cents, created_at
		   FROM usage_logs
		  WHERE %s
		  ORDER BY created_at DESC
		  LIMIT $%d OFFSET $%d`,
		whereClause, argPos, argPos+1,
	)

	rows, err := r.db.QueryContext(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("query usage rows: %w", err)
	}
	defer rows.Close()

	items := make([]usageRow, 0, pageSize)
	for rows.Next() {
		var item usageRow
		if err := rows.Scan(&item.ID, &item.Model, &item.InputTokens, &item.OutputTokens, &item.CostCents, &item.CreatedAt); err != nil {
			return nil, 0, fmt.Errorf("scan usage row: %w", err)
		}
		item.CostUSD = float64(item.CostCents) / 100
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate usage rows: %w", err)
	}

	return items, total, nil
}

func checkoutURLs(successURL string, cancelURL string) (string, string, error) {
	success := strings.TrimSpace(successURL)
	cancel := strings.TrimSpace(cancelURL)

	if success != "" && cancel != "" {
		if err := validateAbsoluteURL(success); err != nil {
			return "", "", fmt.Errorf("invalid success_url: %w", err)
		}
		if err := validateAbsoluteURL(cancel); err != nil {
			return "", "", fmt.Errorf("invalid cancel_url: %w", err)
		}
		return success, cancel, nil
	}

	webOrigin := strings.TrimSpace(os.Getenv("WEB_ORIGIN"))
	if webOrigin == "" {
		return "", "", errors.New("missing success_url/cancel_url and WEB_ORIGIN is not set")
	}
	if err := validateAbsoluteURL(webOrigin); err != nil {
		return "", "", fmt.Errorf("invalid WEB_ORIGIN: %w", err)
	}

	origin := strings.TrimRight(webOrigin, "/")
	return origin + "/dashboard/billing?status=success", origin + "/dashboard/billing?status=cancelled", nil
}

func validateAbsoluteURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil {
		return err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return errors.New("must be an absolute URL")
	}
	return nil
}

func requestTenantID(r *http.Request) string {
	tenantID := strings.TrimSpace(r.Header.Get("X-Tenant-ID"))
	if tenantID == "" {
		tenantID = strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	}
	return tenantID
}

func parseIntOrDefault(raw string, fallback int) int {
	value := strings.TrimSpace(raw)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func parseDateFilter(values url.Values, key string) (*time.Time, error) {
	raw := strings.TrimSpace(values.Get(key))
	if raw == "" {
		return nil, nil
	}

	layouts := []string{time.RFC3339, "2006-01-02"}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return &parsed, nil
		}
	}

	return nil, fmt.Errorf("invalid %s; expected RFC3339 or YYYY-MM-DD", key)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func decodeJSONStrict(req *http.Request, destination any) error {
	decoder := json.NewDecoder(req.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}
