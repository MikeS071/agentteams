package routes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/agentsquads/api/middleware"
	"github.com/agentsquads/api/orchestrator"
	"github.com/google/uuid"
)

// AdminHandler serves platform-admin-only APIs.
type AdminHandler struct {
	DB   *sql.DB
	Orch orchestrator.TenantOrchestrator
}

func NewAdminHandler(db *sql.DB, orch orchestrator.TenantOrchestrator) *AdminHandler {
	return &AdminHandler{DB: db, Orch: orch}
}

func (h *AdminHandler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/tenants", h.handleListTenants)
	mux.HandleFunc("GET /api/admin/tenants/{id}", h.handleGetTenant)
	mux.HandleFunc("POST /api/admin/tenants/{id}/credits", h.handleAdjustCredits)
	mux.HandleFunc("POST /api/admin/tenants/{id}/suspend", h.handleSuspendTenant)
	mux.HandleFunc("POST /api/admin/tenants/{id}/resume", h.handleResumeTenant)

	mux.HandleFunc("GET /api/admin/stats", h.handlePlatformStats)

	mux.HandleFunc("GET /api/admin/models", h.handleListModels)
	mux.HandleFunc("PUT /api/admin/models/{id}", h.handleUpdateModel)
	mux.HandleFunc("POST /api/admin/models", h.handleCreateModel)
}

func (h *AdminHandler) handleListTenants(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}

	rows, err := h.DB.QueryContext(r.Context(), `
		SELECT
			t.id,
			t.user_id,
			t.status,
			t.container_id,
			t.created_at,
			u.email,
			COALESCE(c.balance_cents, 0) AS balance_cents,
			COALESCE(uag.total_input_tokens, 0) AS total_input_tokens,
			COALESCE(uag.total_output_tokens, 0) AS total_output_tokens,
			COALESCE(uag.total_revenue_cents, 0) AS total_revenue_cents,
			COALESCE(uag.tokens_24h, 0) AS tokens_24h
		FROM tenants t
		LEFT JOIN users u ON u.id = t.user_id
		LEFT JOIN credits c ON c.tenant_id = t.id
		LEFT JOIN (
			SELECT
				tenant_id,
				SUM(input_tokens) AS total_input_tokens,
				SUM(output_tokens) AS total_output_tokens,
				SUM(cost_cents + margin_cents) AS total_revenue_cents,
				SUM(CASE WHEN created_at >= NOW() - INTERVAL '1 day' THEN input_tokens + output_tokens ELSE 0 END) AS tokens_24h
			FROM usage_logs
			GROUP BY tenant_id
		) uag ON uag.tenant_id = t.id
		ORDER BY t.created_at DESC
	`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query tenants")
		return
	}
	defer rows.Close()

	tenants := make([]map[string]any, 0)
	for rows.Next() {
		var (
			tenantID          string
			userID            string
			status            string
			containerID       sql.NullString
			createdAt         time.Time
			email             sql.NullString
			balanceCents      int64
			totalInputTokens  int64
			totalOutputTokens int64
			totalRevenueCents int64
			tokens24h         int64
		)

		if err := rows.Scan(
			&tenantID,
			&userID,
			&status,
			&containerID,
			&createdAt,
			&email,
			&balanceCents,
			&totalInputTokens,
			&totalOutputTokens,
			&totalRevenueCents,
			&tokens24h,
		); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to scan tenant")
			return
		}

		tenants = append(tenants, map[string]any{
			"id":                    tenantID,
			"user_id":               userID,
			"email":                 nullString(email),
			"status":                status,
			"container_id":          nullString(containerID),
			"container":             h.tenantContainerSnapshot(r.Context(), tenantID, containerID),
			"credits_balance_cents": balanceCents,
			"usage": map[string]any{
				"total_input_tokens":  totalInputTokens,
				"total_output_tokens": totalOutputTokens,
				"total_tokens":        totalInputTokens + totalOutputTokens,
				"total_revenue_cents": totalRevenueCents,
				"tokens_24h":          tokens24h,
			},
			"created_at": createdAt,
		})
	}

	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed while reading tenants")
		return
	}

	h.logAdminAction(r.Context(), "admin.tenants.list", "", map[string]any{"count": len(tenants)})
	writeJSON(w, http.StatusOK, map[string]any{"tenants": tenants})
}

func (h *AdminHandler) handleGetTenant(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}

	tenantID := strings.TrimSpace(r.PathValue("id"))
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing tenant id")
		return
	}

	var (
		userID       string
		status       string
		containerID  sql.NullString
		createdAt    time.Time
		email        sql.NullString
		balanceCents int64
	)

	err := h.DB.QueryRowContext(r.Context(), `
		SELECT
			t.user_id,
			t.status,
			t.container_id,
			t.created_at,
			u.email,
			COALESCE(c.balance_cents, 0) AS balance_cents
		FROM tenants t
		LEFT JOIN users u ON u.id = t.user_id
		LEFT JOIN credits c ON c.tenant_id = t.id
		WHERE t.id = $1
	`, tenantID).Scan(
		&userID,
		&status,
		&containerID,
		&createdAt,
		&email,
		&balanceCents,
	)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "tenant not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load tenant")
		return
	}

	var (
		totalInputTokens  int64
		totalOutputTokens int64
		totalRevenueCents int64
		tokensToday       int64
		tokensWeek        int64
		tokensMonth       int64
	)
	if err := h.DB.QueryRowContext(r.Context(), `
		SELECT
			COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
			COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
			COALESCE(SUM(cost_cents + margin_cents), 0) AS total_revenue_cents,
			COALESCE(SUM(CASE WHEN created_at >= DATE_TRUNC('day', NOW()) THEN input_tokens + output_tokens ELSE 0 END), 0) AS tokens_today,
			COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN input_tokens + output_tokens ELSE 0 END), 0) AS tokens_week,
			COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN input_tokens + output_tokens ELSE 0 END), 0) AS tokens_month
		FROM usage_logs
		WHERE tenant_id = $1
	`, tenantID).Scan(
		&totalInputTokens,
		&totalOutputTokens,
		&totalRevenueCents,
		&tokensToday,
		&tokensWeek,
		&tokensMonth,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load tenant usage")
		return
	}

	usageByModelRows, err := h.DB.QueryContext(r.Context(), `
		SELECT
			model,
			COALESCE(SUM(input_tokens), 0) AS input_tokens,
			COALESCE(SUM(output_tokens), 0) AS output_tokens,
			COALESCE(SUM(cost_cents + margin_cents), 0) AS revenue_cents,
			MAX(created_at) AS last_used_at
		FROM usage_logs
		WHERE tenant_id = $1
		GROUP BY model
		ORDER BY COALESCE(SUM(input_tokens + output_tokens), 0) DESC
	`, tenantID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load tenant usage by model")
		return
	}
	defer usageByModelRows.Close()

	usageByModel := make([]map[string]any, 0)
	for usageByModelRows.Next() {
		var (
			model        string
			inputTokens  int64
			outputTokens int64
			revenueCents int64
			lastUsedAt   sql.NullTime
		)
		if err := usageByModelRows.Scan(&model, &inputTokens, &outputTokens, &revenueCents, &lastUsedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read tenant usage by model")
			return
		}

		usageByModel = append(usageByModel, map[string]any{
			"model":         model,
			"input_tokens":  inputTokens,
			"output_tokens": outputTokens,
			"total_tokens":  inputTokens + outputTokens,
			"revenue_cents": revenueCents,
			"last_used_at":  nullTime(lastUsedAt),
		})
	}
	if err := usageByModelRows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed while reading usage by model")
		return
	}

	policyRows, err := h.DB.QueryContext(r.Context(), `
		SELECT feature, enabled
		FROM tenant_policies
		WHERE tenant_id = $1
		ORDER BY feature ASC
	`, tenantID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load tenant policies")
		return
	}
	defer policyRows.Close()

	policies := make([]map[string]any, 0)
	for policyRows.Next() {
		var feature string
		var enabled bool
		if err := policyRows.Scan(&feature, &enabled); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read tenant policies")
			return
		}
		policies = append(policies, map[string]any{"feature": feature, "enabled": enabled})
	}
	if err := policyRows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed while reading tenant policies")
		return
	}

	channelRows, err := h.DB.QueryContext(r.Context(), `
		SELECT channel, channel_user_id, muted, linked_at
		FROM tenant_channels
		WHERE tenant_id = $1
		ORDER BY linked_at DESC
	`, tenantID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load tenant channels")
		return
	}
	defer channelRows.Close()

	channels := make([]map[string]any, 0)
	for channelRows.Next() {
		var (
			channel     string
			channelUser string
			muted       bool
			linkedAt    time.Time
		)
		if err := channelRows.Scan(&channel, &channelUser, &muted, &linkedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read tenant channels")
			return
		}
		channels = append(channels, map[string]any{
			"channel":         channel,
			"channel_user_id": channelUser,
			"muted":           muted,
			"linked_at":       linkedAt,
		})
	}
	if err := channelRows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed while reading tenant channels")
		return
	}

	h.logAdminAction(r.Context(), "admin.tenants.get", tenantID, nil)
	writeJSON(w, http.StatusOK, map[string]any{
		"tenant": map[string]any{
			"id":                    tenantID,
			"user_id":               userID,
			"email":                 nullString(email),
			"status":                status,
			"container_id":          nullString(containerID),
			"container":             h.tenantContainerSnapshot(r.Context(), tenantID, containerID),
			"credits_balance_cents": balanceCents,
			"created_at":            createdAt,
			"config": map[string]any{
				"policies": policies,
				"channels": channels,
			},
			"usage": map[string]any{
				"total_input_tokens":  totalInputTokens,
				"total_output_tokens": totalOutputTokens,
				"total_tokens":        totalInputTokens + totalOutputTokens,
				"total_revenue_cents": totalRevenueCents,
				"tokens_today":        tokensToday,
				"tokens_week":         tokensWeek,
				"tokens_month":        tokensMonth,
				"by_model":            usageByModel,
			},
		},
	})
}

func (h *AdminHandler) handleAdjustCredits(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}

	tenantID := strings.TrimSpace(r.PathValue("id"))
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing tenant id")
		return
	}

	var req struct {
		Amount int64  `json:"amount"`
		Reason string `json:"reason"`
	}
	if err := decodeJSONStrict(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	req.Reason = strings.TrimSpace(req.Reason)
	if req.Amount == 0 {
		writeError(w, http.StatusBadRequest, "amount must be non-zero")
		return
	}
	if req.Reason == "" {
		writeError(w, http.StatusBadRequest, "reason is required")
		return
	}

	tx, err := h.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback()

	var tenantExists bool
	if err := tx.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM tenants WHERE id = $1)`, tenantID).Scan(&tenantExists); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to verify tenant")
		return
	}
	if !tenantExists {
		writeError(w, http.StatusNotFound, "tenant not found")
		return
	}

	if _, err := tx.ExecContext(r.Context(), `
		INSERT INTO credits (tenant_id, balance_cents, free_credit_used, updated_at)
		VALUES ($1, 0, false, NOW())
		ON CONFLICT (tenant_id) DO NOTHING
	`, tenantID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to ensure tenant credits")
		return
	}

	var balanceCents int64
	if err := tx.QueryRowContext(r.Context(), `
		UPDATE credits
		SET balance_cents = balance_cents + $2,
		    updated_at = NOW()
		WHERE tenant_id = $1
		RETURNING balance_cents
	`, tenantID, req.Amount).Scan(&balanceCents); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update credits")
		return
	}

	adminIdentity, _ := middleware.AdminFromContext(r.Context())
	var adminUserID any
	if parsedUUID, err := uuid.Parse(strings.TrimSpace(adminIdentity.ID)); err == nil {
		adminUserID = parsedUUID.String()
	}

	if _, err := tx.ExecContext(r.Context(), `
		INSERT INTO credit_transactions (tenant_id, amount_cents, reason, admin_user_id)
		VALUES ($1, $2, $3, $4)
	`, tenantID, req.Amount, req.Reason, adminUserID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record credit transaction")
		return
	}

	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit credit update")
		return
	}

	h.logAdminAction(r.Context(), "admin.tenants.credits", tenantID, map[string]any{
		"amount": req.Amount,
		"reason": req.Reason,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"tenant_id":     tenantID,
		"amount":        req.Amount,
		"reason":        req.Reason,
		"balance_cents": balanceCents,
		"updated_at":    time.Now().UTC(),
	})
}

func (h *AdminHandler) handleSuspendTenant(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	if h.Orch == nil {
		writeError(w, http.StatusServiceUnavailable, "orchestrator is not configured")
		return
	}

	tenantID := strings.TrimSpace(r.PathValue("id"))
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing tenant id")
		return
	}

	var exists bool
	if err := h.DB.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM tenants WHERE id = $1)`, tenantID).Scan(&exists); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to verify tenant")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "tenant not found")
		return
	}

	stopErr := h.Orch.Stop(r.Context(), tenantID)
	if stopErr != nil && !isNoContainerError(stopErr) {
		writeError(w, http.StatusInternalServerError, "failed to stop tenant container")
		return
	}

	if _, err := h.DB.ExecContext(r.Context(), `UPDATE tenants SET status = 'suspended' WHERE id = $1`, tenantID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to suspend tenant")
		return
	}

	details := map[string]any{}
	if stopErr != nil {
		details["container_stop_note"] = stopErr.Error()
	}
	h.logAdminAction(r.Context(), "admin.tenants.suspend", tenantID, details)

	writeJSON(w, http.StatusOK, map[string]any{
		"tenant_id": tenantID,
		"status":    "suspended",
	})
}

func (h *AdminHandler) handleResumeTenant(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	if h.Orch == nil {
		writeError(w, http.StatusServiceUnavailable, "orchestrator is not configured")
		return
	}

	tenantID := strings.TrimSpace(r.PathValue("id"))
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "missing tenant id")
		return
	}

	var exists bool
	if err := h.DB.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM tenants WHERE id = $1)`, tenantID).Scan(&exists); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to verify tenant")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "tenant not found")
		return
	}

	restartMode := "start"
	if err := h.Orch.Start(r.Context(), tenantID); err != nil {
		if !isNoContainerError(err) {
			writeError(w, http.StatusInternalServerError, "failed to start tenant container")
			return
		}
		if _, createErr := h.Orch.Create(r.Context(), tenantID); createErr != nil {
			writeError(w, http.StatusInternalServerError, "failed to recreate tenant container")
			return
		}
		restartMode = "create"
	}

	if _, err := h.DB.ExecContext(r.Context(), `UPDATE tenants SET status = 'active' WHERE id = $1`, tenantID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to resume tenant")
		return
	}

	h.logAdminAction(r.Context(), "admin.tenants.resume", tenantID, map[string]any{
		"restart_mode": restartMode,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"tenant_id":    tenantID,
		"status":       "active",
		"restart_mode": restartMode,
	})
}

func (h *AdminHandler) handlePlatformStats(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}

	var (
		totalTenants         int64
		activeTenants        int64
		provisionedContainer int64
	)

	if err := h.DB.QueryRowContext(r.Context(), `
		SELECT
			COUNT(*) AS total_tenants,
			COUNT(*) FILTER (WHERE status = 'active') AS active_tenants,
			COUNT(*) FILTER (WHERE container_id IS NOT NULL) AS provisioned_containers
		FROM tenants
	`).Scan(&totalTenants, &activeTenants, &provisionedContainer); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query tenant counts")
		return
	}

	activeContainers := provisionedContainer
	if h.Orch != nil {
		activeContainers = 0
		rows, err := h.DB.QueryContext(r.Context(), `SELECT id FROM tenants WHERE container_id IS NOT NULL`)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to query container tenants")
			return
		}
		defer rows.Close()

		for rows.Next() {
			var tenantID string
			if err := rows.Scan(&tenantID); err != nil {
				writeError(w, http.StatusInternalServerError, "failed to read container tenant")
				return
			}
			status, err := h.Orch.Status(r.Context(), tenantID)
			if err != nil {
				continue
			}
			if status != nil && status.Running {
				activeContainers++
			}
		}
		if err := rows.Err(); err != nil {
			writeError(w, http.StatusInternalServerError, "failed while reading container tenants")
			return
		}
	}

	var (
		tokensToday       int64
		tokensWeek        int64
		tokensMonth       int64
		revenueTodayCents int64
		revenueWeekCents  int64
		revenueMonthCents int64
	)
	if err := h.DB.QueryRowContext(r.Context(), `
		SELECT
			COALESCE(SUM(CASE WHEN created_at >= DATE_TRUNC('day', NOW()) THEN input_tokens + output_tokens ELSE 0 END), 0) AS tokens_today,
			COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN input_tokens + output_tokens ELSE 0 END), 0) AS tokens_week,
			COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN input_tokens + output_tokens ELSE 0 END), 0) AS tokens_month,
			COALESCE(SUM(CASE WHEN created_at >= DATE_TRUNC('day', NOW()) THEN cost_cents + margin_cents ELSE 0 END), 0) AS revenue_today_cents,
			COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN cost_cents + margin_cents ELSE 0 END), 0) AS revenue_week_cents,
			COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN cost_cents + margin_cents ELSE 0 END), 0) AS revenue_month_cents
		FROM usage_logs
	`).Scan(&tokensToday, &tokensWeek, &tokensMonth, &revenueTodayCents, &revenueWeekCents, &revenueMonthCents); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query usage aggregates")
		return
	}

	h.logAdminAction(r.Context(), "admin.stats.get", "", nil)
	writeJSON(w, http.StatusOK, map[string]any{
		"total_tenants":     totalTenants,
		"active_tenants":    activeTenants,
		"active_containers": activeContainers,
		"tokens": map[string]int64{
			"today": tokensToday,
			"week":  tokensWeek,
			"month": tokensMonth,
		},
		"revenue_estimate_cents": map[string]int64{
			"today": revenueTodayCents,
			"week":  revenueWeekCents,
			"month": revenueMonthCents,
		},
	})
}

func (h *AdminHandler) handleListModels(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}

	cfg, err := h.resolveModelTableConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	query := fmt.Sprintf(`
		SELECT
			m.id,
			m.name,
			m.provider,
			%s AS cost_per_1k_input,
			%s AS cost_per_1k_output,
			%s AS markup_pct,
			%s AS enabled
		FROM %s m
		ORDER BY m.provider ASC, m.name ASC
	`, cfg.costInputSelectExpr("m"), cfg.costOutputSelectExpr("m"), cfg.markupSelectExpr("m"), cfg.enabledSelectExpr("m"), cfg.TableName)

	rows, err := h.DB.QueryContext(r.Context(), query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query models")
		return
	}
	defer rows.Close()

	models := make([]map[string]any, 0)
	for rows.Next() {
		var (
			id              string
			name            string
			provider        string
			costInputPer1K  float64
			costOutputPer1K float64
			markupPct       float64
			enabled         bool
		)
		if err := rows.Scan(&id, &name, &provider, &costInputPer1K, &costOutputPer1K, &markupPct, &enabled); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to scan model")
			return
		}

		models = append(models, map[string]any{
			"id":                 id,
			"name":               name,
			"provider":           provider,
			"cost_per_1k_input":  costInputPer1K,
			"cost_per_1k_output": costOutputPer1K,
			"markup_pct":         markupPct,
			"enabled":            enabled,
		})
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed while reading models")
		return
	}

	h.logAdminAction(r.Context(), "admin.models.list", "", map[string]any{"count": len(models), "table": cfg.TableName})
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

func (h *AdminHandler) handleUpdateModel(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}

	modelID := strings.TrimSpace(r.PathValue("id"))
	if modelID == "" {
		writeError(w, http.StatusBadRequest, "missing model id")
		return
	}

	var req struct {
		CostPer1KInput  *float64 `json:"cost_per_1k_input"`
		CostPer1KOutput *float64 `json:"cost_per_1k_output"`
		MarkupPct       *float64 `json:"markup_pct"`
	}
	if err := decodeJSONStrict(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if req.CostPer1KInput == nil || req.CostPer1KOutput == nil || req.MarkupPct == nil {
		writeError(w, http.StatusBadRequest, "cost_per_1k_input, cost_per_1k_output, and markup_pct are required")
		return
	}
	if *req.CostPer1KInput < 0 || *req.CostPer1KOutput < 0 {
		writeError(w, http.StatusBadRequest, "model costs must be >= 0")
		return
	}
	if *req.MarkupPct < 0 || *req.MarkupPct > 1000 {
		writeError(w, http.StatusBadRequest, "markup_pct must be between 0 and 1000")
		return
	}

	cfg, err := h.resolveModelTableConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	setClauses := make([]string, 0, 3)
	args := make([]any, 0, 4)
	args = append(args, modelID)
	argIndex := 2

	if cfg.CostPer1KInputCol != "" {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", cfg.CostPer1KInputCol, argIndex))
		args = append(args, *req.CostPer1KInput)
		argIndex++
	} else if cfg.InputPerMCol != "" {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", cfg.InputPerMCol, argIndex))
		args = append(args, int64(math.Round(*req.CostPer1KInput*1000.0)))
		argIndex++
	}

	if cfg.CostPer1KOutputCol != "" {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", cfg.CostPer1KOutputCol, argIndex))
		args = append(args, *req.CostPer1KOutput)
		argIndex++
	} else if cfg.OutputPerMCol != "" {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", cfg.OutputPerMCol, argIndex))
		args = append(args, int64(math.Round(*req.CostPer1KOutput*1000.0)))
		argIndex++
	}

	if cfg.HasMarkupPct {
		setClauses = append(setClauses, fmt.Sprintf("markup_pct = $%d", argIndex))
		args = append(args, *req.MarkupPct)
	}

	if len(setClauses) == 0 {
		writeError(w, http.StatusInternalServerError, "no model pricing columns are available")
		return
	}

	query := fmt.Sprintf(`UPDATE %s SET %s WHERE id = $1`, cfg.TableName, strings.Join(setClauses, ", "))

	res, err := h.DB.ExecContext(r.Context(), query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update model")
		return
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to verify model update")
		return
	}
	if rowsAffected == 0 {
		writeError(w, http.StatusNotFound, "model not found")
		return
	}

	model, err := h.getModelByID(r.Context(), cfg, modelID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load updated model")
		return
	}

	h.logAdminAction(r.Context(), "admin.models.update", modelID, map[string]any{
		"cost_per_1k_input":  *req.CostPer1KInput,
		"cost_per_1k_output": *req.CostPer1KOutput,
		"markup_pct":         *req.MarkupPct,
		"table":              cfg.TableName,
	})
	writeJSON(w, http.StatusOK, map[string]any{"model": model})
}

func (h *AdminHandler) handleCreateModel(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}

	var req struct {
		ID              string   `json:"id"`
		Name            string   `json:"name"`
		Provider        string   `json:"provider"`
		CostPer1KInput  *float64 `json:"cost_per_1k_input"`
		CostPer1KOutput *float64 `json:"cost_per_1k_output"`
		MarkupPct       *float64 `json:"markup_pct"`
		Enabled         *bool    `json:"enabled"`
	}
	if err := decodeJSONStrict(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	req.ID = strings.TrimSpace(req.ID)
	req.Name = strings.TrimSpace(req.Name)
	req.Provider = strings.TrimSpace(strings.ToLower(req.Provider))
	if req.ID == "" || req.Name == "" || req.Provider == "" {
		writeError(w, http.StatusBadRequest, "id, name, and provider are required")
		return
	}
	if req.CostPer1KInput == nil || req.CostPer1KOutput == nil {
		writeError(w, http.StatusBadRequest, "cost_per_1k_input and cost_per_1k_output are required")
		return
	}
	if *req.CostPer1KInput < 0 || *req.CostPer1KOutput < 0 {
		writeError(w, http.StatusBadRequest, "model costs must be >= 0")
		return
	}

	markup := 30.0
	if req.MarkupPct != nil {
		markup = *req.MarkupPct
	}
	if markup < 0 || markup > 1000 {
		writeError(w, http.StatusBadRequest, "markup_pct must be between 0 and 1000")
		return
	}

	cfg, err := h.resolveModelTableConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	columns := []string{"id", "name", "provider"}
	values := []any{req.ID, req.Name, req.Provider}
	placeholders := []string{"$1", "$2", "$3"}
	next := 4

	if cfg.CostPer1KInputCol != "" {
		columns = append(columns, cfg.CostPer1KInputCol)
		values = append(values, *req.CostPer1KInput)
		placeholders = append(placeholders, fmt.Sprintf("$%d", next))
		next++
	} else if cfg.InputPerMCol != "" {
		columns = append(columns, cfg.InputPerMCol)
		values = append(values, int64(math.Round(*req.CostPer1KInput*1000.0)))
		placeholders = append(placeholders, fmt.Sprintf("$%d", next))
		next++
	}

	if cfg.CostPer1KOutputCol != "" {
		columns = append(columns, cfg.CostPer1KOutputCol)
		values = append(values, *req.CostPer1KOutput)
		placeholders = append(placeholders, fmt.Sprintf("$%d", next))
		next++
	} else if cfg.OutputPerMCol != "" {
		columns = append(columns, cfg.OutputPerMCol)
		values = append(values, int64(math.Round(*req.CostPer1KOutput*1000.0)))
		placeholders = append(placeholders, fmt.Sprintf("$%d", next))
		next++
	}

	if cfg.HasMarkupPct {
		columns = append(columns, "markup_pct")
		values = append(values, markup)
		placeholders = append(placeholders, fmt.Sprintf("$%d", next))
		next++
	}

	if cfg.HasEnabled {
		enabled := true
		if req.Enabled != nil {
			enabled = *req.Enabled
		}
		columns = append(columns, "enabled")
		values = append(values, enabled)
		placeholders = append(placeholders, fmt.Sprintf("$%d", next))
	}

	if len(columns) < 5 {
		writeError(w, http.StatusInternalServerError, "no model pricing columns are available")
		return
	}

	query := fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s)`, cfg.TableName, strings.Join(columns, ", "), strings.Join(placeholders, ", "))
	if _, err := h.DB.ExecContext(r.Context(), query, values...); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate key") {
			writeError(w, http.StatusConflict, "model id already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create model")
		return
	}

	model, err := h.getModelByID(r.Context(), cfg, req.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load created model")
		return
	}

	h.logAdminAction(r.Context(), "admin.models.create", req.ID, map[string]any{
		"provider":           req.Provider,
		"cost_per_1k_input":  *req.CostPer1KInput,
		"cost_per_1k_output": *req.CostPer1KOutput,
		"markup_pct":         markup,
		"table":              cfg.TableName,
	})
	writeJSON(w, http.StatusCreated, map[string]any{"model": model})
}

func (h *AdminHandler) tenantContainerSnapshot(ctx context.Context, tenantID string, containerID sql.NullString) map[string]any {
	if !containerID.Valid || strings.TrimSpace(containerID.String) == "" {
		return map[string]any{"state": "not_provisioned"}
	}
	if h.Orch == nil {
		return map[string]any{
			"id":    containerID.String,
			"state": "unknown",
			"error": "orchestrator is not configured",
		}
	}

	status, err := h.Orch.Status(ctx, tenantID)
	if err != nil {
		return map[string]any{
			"id":    containerID.String,
			"state": "unknown",
			"error": err.Error(),
		}
	}

	startedAt := any(nil)
	if status != nil && !status.StartedAt.IsZero() {
		startedAt = status.StartedAt
	}

	if status == nil {
		return map[string]any{
			"id":    containerID.String,
			"state": "unknown",
		}
	}

	state := "stopped"
	if status.Running {
		state = "running"
	}

	return map[string]any{
		"id":         containerID.String,
		"state":      state,
		"running":    status.Running,
		"health":     status.Health,
		"started_at": startedAt,
		"memory_mb":  status.MemoryMB,
		"cpu_pct":    status.CPUPct,
	}
}

func (h *AdminHandler) getModelByID(ctx context.Context, cfg modelTableConfig, id string) (map[string]any, error) {
	query := fmt.Sprintf(`
		SELECT
			m.id,
			m.name,
			m.provider,
			%s AS cost_per_1k_input,
			%s AS cost_per_1k_output,
			%s AS markup_pct,
			%s AS enabled
		FROM %s m
		WHERE m.id = $1
	`, cfg.costInputSelectExpr("m"), cfg.costOutputSelectExpr("m"), cfg.markupSelectExpr("m"), cfg.enabledSelectExpr("m"), cfg.TableName)

	var (
		modelID         string
		name            string
		provider        string
		costInputPer1K  float64
		costOutputPer1K float64
		markupPct       float64
		enabled         bool
	)
	if err := h.DB.QueryRowContext(ctx, query, id).Scan(
		&modelID,
		&name,
		&provider,
		&costInputPer1K,
		&costOutputPer1K,
		&markupPct,
		&enabled,
	); err != nil {
		return nil, err
	}

	return map[string]any{
		"id":                 modelID,
		"name":               name,
		"provider":           provider,
		"cost_per_1k_input":  costInputPer1K,
		"cost_per_1k_output": costOutputPer1K,
		"markup_pct":         markupPct,
		"enabled":            enabled,
	}, nil
}

type modelTableConfig struct {
	TableName          string
	InputPerMCol       string
	OutputPerMCol      string
	CostPer1KInputCol  string
	CostPer1KOutputCol string
	HasMarkupPct       bool
	HasEnabled         bool
}

func (h *AdminHandler) resolveModelTableConfig(ctx context.Context) (modelTableConfig, error) {
	rows, err := h.DB.QueryContext(ctx, `
		SELECT table_name, column_name
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name IN ('llm_models', 'models')
	`)
	if err != nil {
		return modelTableConfig{}, fmt.Errorf("failed to inspect model tables: %w", err)
	}
	defer rows.Close()

	tableColumns := map[string]map[string]struct{}{}
	for rows.Next() {
		var tableName string
		var columnName string
		if err := rows.Scan(&tableName, &columnName); err != nil {
			return modelTableConfig{}, fmt.Errorf("failed to scan model table metadata: %w", err)
		}
		if _, ok := tableColumns[tableName]; !ok {
			tableColumns[tableName] = map[string]struct{}{}
		}
		tableColumns[tableName][columnName] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return modelTableConfig{}, fmt.Errorf("failed while reading model table metadata: %w", err)
	}

	tableName := ""
	if _, ok := tableColumns["llm_models"]; ok {
		tableName = "llm_models"
	} else if _, ok := tableColumns["models"]; ok {
		tableName = "models"
	}
	if tableName == "" {
		return modelTableConfig{}, errors.New("no model table found")
	}

	cfg := modelTableConfig{TableName: tableName}
	columns := tableColumns[tableName]
	columnNames := make([]string, 0, len(columns))
	for column := range columns {
		columnNames = append(columnNames, column)
	}
	sort.Strings(columnNames)

	for _, column := range columnNames {
		switch column {
		case "provider_cost_input_per_m":
			cfg.InputPerMCol = column
		case "provider_cost_output_per_m":
			cfg.OutputPerMCol = column
		case "cost_per_1k_input", "provider_cost_input_per_1k", "provider_cost_input_per_1k_tokens", "input_cost_per_1k_tokens":
			cfg.CostPer1KInputCol = column
		case "cost_per_1k_output", "provider_cost_output_per_1k", "provider_cost_output_per_1k_tokens", "output_cost_per_1k_tokens":
			cfg.CostPer1KOutputCol = column
		case "provider_cost_per_1k_tokens":
			if cfg.CostPer1KInputCol == "" {
				cfg.CostPer1KInputCol = column
			}
			if cfg.CostPer1KOutputCol == "" {
				cfg.CostPer1KOutputCol = column
			}
		case "markup_pct":
			cfg.HasMarkupPct = true
		case "enabled":
			cfg.HasEnabled = true
		}
	}

	if cfg.CostPer1KInputCol == "" && cfg.InputPerMCol == "" {
		return modelTableConfig{}, errors.New("model input cost column is missing")
	}
	if cfg.CostPer1KOutputCol == "" && cfg.OutputPerMCol == "" {
		return modelTableConfig{}, errors.New("model output cost column is missing")
	}

	return cfg, nil
}

func (cfg modelTableConfig) costInputSelectExpr(alias string) string {
	if cfg.CostPer1KInputCol != "" {
		return fmt.Sprintf("COALESCE(%s.%s::double precision, 0)", alias, cfg.CostPer1KInputCol)
	}
	return fmt.Sprintf("COALESCE(%s.%s::double precision / 1000.0, 0)", alias, cfg.InputPerMCol)
}

func (cfg modelTableConfig) costOutputSelectExpr(alias string) string {
	if cfg.CostPer1KOutputCol != "" {
		return fmt.Sprintf("COALESCE(%s.%s::double precision, 0)", alias, cfg.CostPer1KOutputCol)
	}
	return fmt.Sprintf("COALESCE(%s.%s::double precision / 1000.0, 0)", alias, cfg.OutputPerMCol)
}

func (cfg modelTableConfig) markupSelectExpr(alias string) string {
	if cfg.HasMarkupPct {
		return fmt.Sprintf("COALESCE(%s.markup_pct::double precision, 0)", alias)
	}
	return "0::double precision"
}

func (cfg modelTableConfig) enabledSelectExpr(alias string) string {
	if cfg.HasEnabled {
		return fmt.Sprintf("COALESCE(%s.enabled, true)", alias)
	}
	return "true"
}

func (h *AdminHandler) logAdminAction(ctx context.Context, action, targetID string, details map[string]any) {
	if h.DB == nil {
		return
	}

	adminIdentity, _ := middleware.AdminFromContext(ctx)
	adminID := strings.TrimSpace(adminIdentity.ID)
	if adminID == "" {
		adminID = strings.TrimSpace(adminIdentity.Email)
	}
	if adminID == "" {
		adminID = "unknown"
	}

	if details == nil {
		details = map[string]any{}
	}
	payload, err := json.Marshal(details)
	if err != nil {
		payload = []byte("{}")
	}

	_, err = h.DB.ExecContext(ctx, `
		INSERT INTO admin_audit_log (admin_id, action, target_id, details)
		VALUES ($1, $2, $3, $4::jsonb)
	`, adminID, action, emptyToNil(targetID), string(payload))
	if err != nil {
		slog.Error("failed to write admin audit log", "action", action, "target_id", targetID, "err", err)
	}
}

func decodeJSONStrict(r *http.Request, dest any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func nullString(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	trimmed := strings.TrimSpace(value.String)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func nullTime(value sql.NullTime) any {
	if !value.Valid {
		return nil
	}
	return value.Time
}

func emptyToNil(value string) any {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func isNoContainerError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "no container") || strings.Contains(msg, "not found")
}
