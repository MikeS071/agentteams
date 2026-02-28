package llmproxy

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/agentteams/api/orchestrator"
)

// PauseTenant sets the tenant status to paused and stops the tenant container.
func PauseTenant(db *sql.DB, orch orchestrator.TenantOrchestrator, tenantID string) error {
	if db == nil {
		return fmt.Errorf("database is not configured")
	}

	ctx := context.Background()
	res, err := db.ExecContext(ctx, `UPDATE tenants SET status = 'paused' WHERE id = $1`, tenantID)
	if err != nil {
		return fmt.Errorf("update tenant status to paused: %w", err)
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		return fmt.Errorf("tenant not found")
	}
	if orch == nil {
		return fmt.Errorf("tenant orchestrator is not configured")
	}

	if err := orch.StopTenant(ctx, tenantID); err != nil {
		return fmt.Errorf("stop tenant container: %w", err)
	}

	return nil
}

// ResumeTenant sets the tenant status to active and starts the tenant container.
func ResumeTenant(db *sql.DB, orch orchestrator.TenantOrchestrator, tenantID string) error {
	if db == nil {
		return fmt.Errorf("database is not configured")
	}
	if orch == nil {
		return fmt.Errorf("tenant orchestrator is not configured")
	}

	ctx := context.Background()
	res, err := db.ExecContext(ctx, `UPDATE tenants SET status = 'active' WHERE id = $1`, tenantID)
	if err != nil {
		return fmt.Errorf("update tenant status to active: %w", err)
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		return fmt.Errorf("tenant not found")
	}

	if err := orch.StartTenant(ctx, tenantID); err != nil {
		return fmt.Errorf("start tenant container: %w", err)
	}

	return nil
}
