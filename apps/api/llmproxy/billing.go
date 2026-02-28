package llmproxy

import (
	"context"
	"database/sql"

	"github.com/agentteams/api/billing"
)

var ErrInsufficientCredits = billing.ErrInsufficientCredits

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
func BillUsage(db *sql.DB, tenantID string, modelID string, inputTokens, outputTokens int) error {
	service := billing.NewCreditService(db)
	return service.DeductTokens(context.Background(), tenantID, modelID, inputTokens, outputTokens)
}
