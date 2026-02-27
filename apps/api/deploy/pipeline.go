package deploy

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	stepReadTokens       = "read_tokens"
	stepSupabaseProject  = "create_supabase_project"
	stepRunMigrations    = "run_db_migrations"
	stepVercelDeploy     = "deploy_vercel"
	stepConfigureDomain  = "configure_custom_domain"
	stepStoreMetadata    = "store_metadata"
	statusIdle           = "idle"
	statusRunning        = "running"
	statusFailed         = "failed"
	statusSucceeded      = "succeeded"
	defaultSupabaseURL   = "https://api.supabase.com"
	defaultVercelBaseURL = "https://api.vercel.com"
)

type stepState struct {
	Status    string `json:"status"`
	Message   string `json:"message,omitempty"`
	UpdatedAt string `json:"updated_at"`
}

type statusResponse struct {
	TenantID             string               `json:"tenant_id"`
	Status               string               `json:"status"`
	CurrentStep          string               `json:"current_step,omitempty"`
	Steps                map[string]stepState `json:"steps"`
	VercelProjectID      string               `json:"vercel_project_id,omitempty"`
	VercelDeploymentID   string               `json:"vercel_deployment_id,omitempty"`
	VercelDeploymentURL  string               `json:"vercel_deployment_url,omitempty"`
	VercelProjectURL     string               `json:"vercel_project_url,omitempty"`
	SupabaseProjectID    string               `json:"supabase_project_id,omitempty"`
	SupabaseProjectURL   string               `json:"supabase_project_url,omitempty"`
	CustomDomain         string               `json:"custom_domain,omitempty"`
	CustomDomainVerified bool                 `json:"custom_domain_verified"`
	LastError            string               `json:"last_error,omitempty"`
	StartedAt            string               `json:"started_at,omitempty"`
	FinishedAt           string               `json:"finished_at,omitempty"`
	UpdatedAt            string               `json:"updated_at,omitempty"`
}

type existingMetadata struct {
	supabaseProjectID    string
	supabaseProjectURL   string
	vercelProjectID      string
	vercelProjectURL     string
	vercelDeploymentID   string
	vercelDeploymentURL  string
	customDomain         string
	customDomainVerified bool
}

type connections struct {
	vercelToken   string
	supabaseToken string
}

type Pipeline struct {
	db     *sql.DB
	client *http.Client
}

func NewPipeline(db *sql.DB) *Pipeline {
	return &Pipeline{
		db:     db,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (p *Pipeline) Mount(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/deploy/start", p.handleStart)
	mux.HandleFunc("GET /api/deploy/status/{tenantId}", p.handleStatus)
}

func (p *Pipeline) handleStart(w http.ResponseWriter, r *http.Request) {
	if p.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return
	}

	var req struct {
		TenantID     string `json:"tenant_id"`
		TenantIDAlt  string `json:"tenantId"`
		CustomDomain string `json:"custom_domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	tenantID := strings.TrimSpace(req.TenantID)
	if tenantID == "" {
		tenantID = strings.TrimSpace(req.TenantIDAlt)
	}
	if tenantID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing tenant_id"})
		return
	}

	var exists bool
	if err := p.db.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM tenants WHERE id = $1)`, tenantID).Scan(&exists); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to validate tenant"})
		return
	}
	if !exists {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "tenant not found"})
		return
	}

	curStatus, err := p.currentStatus(r.Context(), tenantID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load deployment status"})
		return
	}
	if curStatus == statusRunning {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "deployment already running"})
		return
	}

	customDomain := strings.TrimSpace(req.CustomDomain)
	if err := p.markRunStart(r.Context(), tenantID, customDomain); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to initialize deployment"})
		return
	}

	go func() {
		if err := p.DeployTenant(context.Background(), tenantID, customDomain); err != nil {
			slog.Error("tenant deploy failed", "tenant", tenantID, "err", err)
		}
	}()

	writeJSON(w, http.StatusAccepted, map[string]string{
		"tenant_id": tenantID,
		"status":    statusRunning,
	})
}

func (p *Pipeline) handleStatus(w http.ResponseWriter, r *http.Request) {
	tenantID := strings.TrimSpace(r.PathValue("tenantId"))
	if tenantID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing tenant id"})
		return
	}

	out, err := p.GetStatus(r.Context(), tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "deployment status not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load deployment status"})
		return
	}

	writeJSON(w, http.StatusOK, out)
}

func (p *Pipeline) DeployTenant(ctx context.Context, tenantID, customDomain string) error {
	runStep := func(step, message string, fn func() error) error {
		slog.Info("deploy step started", "tenant", tenantID, "step", step, "message", message)
		if err := p.updateStep(ctx, tenantID, step, statusRunning, message); err != nil {
			return err
		}
		err := fn()
		if err != nil {
			_ = p.updateStep(ctx, tenantID, step, statusFailed, err.Error())
			slog.Error("deploy step failed", "tenant", tenantID, "step", step, "err", err)
			return err
		}
		if err := p.updateStep(ctx, tenantID, step, statusSucceeded, "completed"); err != nil {
			return err
		}
		slog.Info("deploy step completed", "tenant", tenantID, "step", step)
		return nil
	}

	var conn connections
	if err := runStep(stepReadTokens, "reading deployment tokens", func() error {
		resolved, err := p.readConnections(ctx, tenantID)
		if err != nil {
			return err
		}
		conn = resolved
		return nil
	}); err != nil {
		_ = p.finishRun(ctx, tenantID, statusFailed, err.Error())
		return err
	}

	meta, err := p.loadMetadata(ctx, tenantID)
	if err != nil {
		_ = p.finishRun(ctx, tenantID, statusFailed, err.Error())
		return err
	}

	if strings.TrimSpace(customDomain) == "" {
		customDomain = meta.customDomain
	}

	if err := runStep(stepSupabaseProject, "ensuring Supabase project", func() error {
		if meta.supabaseProjectID != "" {
			slog.Info("using existing Supabase project", "tenant", tenantID, "project_id", meta.supabaseProjectID)
			return nil
		}

		projectID, projectURL, createErr := p.ensureSupabaseProject(ctx, conn.supabaseToken, tenantID)
		if createErr != nil {
			return createErr
		}
		meta.supabaseProjectID = projectID
		meta.supabaseProjectURL = projectURL
		return p.saveMetadata(ctx, tenantID, meta)
	}); err != nil {
		_ = p.finishRun(ctx, tenantID, statusFailed, err.Error())
		return err
	}

	if err := runStep(stepRunMigrations, "running database migrations", func() error {
		if meta.supabaseProjectID == "" {
			return fmt.Errorf("supabase project id is missing")
		}
		return p.runSupabaseMigrations(ctx, conn.supabaseToken, meta.supabaseProjectID)
	}); err != nil {
		_ = p.finishRun(ctx, tenantID, statusFailed, err.Error())
		return err
	}

	if err := runStep(stepVercelDeploy, "deploying app to Vercel", func() error {
		projectID := meta.vercelProjectID
		projectURL := meta.vercelProjectURL
		if projectID == "" {
			id, url, createErr := p.ensureVercelProject(ctx, conn.vercelToken, tenantID)
			if createErr != nil {
				return createErr
			}
			projectID = id
			projectURL = url
		}

		envVars := map[string]string{
			"NEXT_PUBLIC_SUPABASE_URL": meta.supabaseProjectURL,
		}
		if err := p.upsertVercelEnvVars(ctx, conn.vercelToken, projectID, envVars); err != nil {
			return err
		}

		deploymentID, deploymentURL, deployErr := p.triggerVercelDeploy(ctx, conn.vercelToken, projectID, tenantID)
		if deployErr != nil {
			return deployErr
		}

		meta.vercelProjectID = projectID
		meta.vercelProjectURL = projectURL
		meta.vercelDeploymentID = deploymentID
		meta.vercelDeploymentURL = deploymentURL
		return p.saveMetadata(ctx, tenantID, meta)
	}); err != nil {
		_ = p.finishRun(ctx, tenantID, statusFailed, err.Error())
		return err
	}

	if err := runStep(stepConfigureDomain, "configuring custom domain", func() error {
		if customDomain == "" {
			slog.Info("custom domain not provided, skipping", "tenant", tenantID)
			return nil
		}
		if meta.vercelProjectID == "" {
			return fmt.Errorf("vercel project id is missing")
		}
		verified, err := p.configureCustomDomain(ctx, conn.vercelToken, meta.vercelProjectID, customDomain)
		if err != nil {
			return err
		}
		meta.customDomain = customDomain
		meta.customDomainVerified = verified
		return p.saveMetadata(ctx, tenantID, meta)
	}); err != nil {
		_ = p.finishRun(ctx, tenantID, statusFailed, err.Error())
		return err
	}

	if err := runStep(stepStoreMetadata, "storing deployment metadata", func() error {
		return p.saveMetadata(ctx, tenantID, meta)
	}); err != nil {
		_ = p.finishRun(ctx, tenantID, statusFailed, err.Error())
		return err
	}

	if err := p.finishRun(ctx, tenantID, statusSucceeded, ""); err != nil {
		return err
	}
	return nil
}

func (p *Pipeline) currentStatus(ctx context.Context, tenantID string) (string, error) {
	var status string
	err := p.db.QueryRowContext(ctx, `SELECT COALESCE(status, $2) FROM tenant_deployments WHERE tenant_id = $1`, tenantID, statusIdle).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return statusIdle, nil
	}
	return status, err
}

func (p *Pipeline) markRunStart(ctx context.Context, tenantID, customDomain string) error {
	_, err := p.db.ExecContext(ctx, `
		INSERT INTO tenant_deployments (
			tenant_id, status, current_step, started_at, finished_at, last_error, custom_domain, updated_at
		)
		VALUES ($1, $2, NULL, NOW(), NULL, NULL, NULLIF($3, ''), NOW())
		ON CONFLICT (tenant_id)
		DO UPDATE SET
			status = EXCLUDED.status,
			current_step = NULL,
			started_at = NOW(),
			finished_at = NULL,
			last_error = NULL,
			custom_domain = COALESCE(NULLIF(EXCLUDED.custom_domain, ''), tenant_deployments.custom_domain),
			updated_at = NOW()`,
		tenantID,
		statusRunning,
		customDomain,
	)
	return err
}

func (p *Pipeline) updateStep(ctx context.Context, tenantID, step, status, message string) error {
	_, err := p.db.ExecContext(ctx, `
		INSERT INTO tenant_deployments (tenant_id, status, current_step, steps, started_at, updated_at)
		VALUES (
			$1,
			$2,
			$3,
			jsonb_build_object(
				$3,
				jsonb_build_object(
					'status', $2,
					'message', $4,
					'updated_at', NOW()
				)
			),
			NOW(),
			NOW()
		)
		ON CONFLICT (tenant_id)
		DO UPDATE SET
			status = $2,
			current_step = CASE WHEN $2 = $5 THEN NULL ELSE $3 END,
			steps = COALESCE(tenant_deployments.steps, '{}'::jsonb) || jsonb_build_object(
				$3,
				jsonb_build_object(
					'status', $2,
					'message', $4,
					'updated_at', NOW()
				)
			),
			updated_at = NOW()`,
		tenantID,
		status,
		step,
		message,
		statusSucceeded,
	)
	return err
}

func (p *Pipeline) finishRun(ctx context.Context, tenantID, status, lastError string) error {
	_, err := p.db.ExecContext(ctx, `
		UPDATE tenant_deployments
		SET status = $2,
			current_step = NULL,
			last_error = NULLIF($3, ''),
			finished_at = CASE WHEN $2 IN ($4, $5) THEN NOW() ELSE finished_at END,
			updated_at = NOW()
		WHERE tenant_id = $1`,
		tenantID,
		status,
		lastError,
		statusFailed,
		statusSucceeded,
	)
	return err
}

func (p *Pipeline) GetStatus(ctx context.Context, tenantID string) (*statusResponse, error) {
	const query = `
		SELECT
			tenant_id,
			status,
			COALESCE(current_step, ''),
			COALESCE(steps, '{}'::jsonb),
			COALESCE(vercel_project_id, ''),
			COALESCE(vercel_deployment_id, ''),
			COALESCE(vercel_deployment_url, ''),
			COALESCE(vercel_project_url, ''),
			COALESCE(supabase_project_id, ''),
			COALESCE(supabase_project_url, ''),
			COALESCE(custom_domain, ''),
			COALESCE(custom_domain_verified, FALSE),
			COALESCE(last_error, ''),
			started_at,
			finished_at,
			updated_at
		FROM tenant_deployments
		WHERE tenant_id = $1`

	var (
		out                statusResponse
		currentStep        string
		stepsRaw           []byte
		startedAt          sql.NullTime
		finishedAt         sql.NullTime
		updatedAt          sql.NullTime
		customDomainVerify bool
	)

	err := p.db.QueryRowContext(ctx, query, tenantID).Scan(
		&out.TenantID,
		&out.Status,
		&currentStep,
		&stepsRaw,
		&out.VercelProjectID,
		&out.VercelDeploymentID,
		&out.VercelDeploymentURL,
		&out.VercelProjectURL,
		&out.SupabaseProjectID,
		&out.SupabaseProjectURL,
		&out.CustomDomain,
		&customDomainVerify,
		&out.LastError,
		&startedAt,
		&finishedAt,
		&updatedAt,
	)
	if err != nil {
		return nil, err
	}
	out.CustomDomainVerified = customDomainVerify
	if currentStep != "" {
		out.CurrentStep = currentStep
	}

	steps := make(map[string]stepState)
	if len(stepsRaw) > 0 {
		if err := json.Unmarshal(stepsRaw, &steps); err != nil {
			return nil, fmt.Errorf("failed to decode steps: %w", err)
		}
	}
	out.Steps = steps
	if startedAt.Valid {
		out.StartedAt = startedAt.Time.UTC().Format(time.RFC3339)
	}
	if finishedAt.Valid {
		out.FinishedAt = finishedAt.Time.UTC().Format(time.RFC3339)
	}
	if updatedAt.Valid {
		out.UpdatedAt = updatedAt.Time.UTC().Format(time.RFC3339)
	}
	return &out, nil
}

func (p *Pipeline) readConnections(ctx context.Context, tenantID string) (connections, error) {
	rows, err := p.db.QueryContext(ctx, `
		SELECT provider, access_token_encrypted
		FROM deploy_connections
		WHERE tenant_id = $1 AND provider IN ('vercel', 'supabase')`, tenantID)
	if err != nil {
		return connections{}, err
	}
	defer rows.Close()

	var out connections
	for rows.Next() {
		var provider, encrypted string
		if err := rows.Scan(&provider, &encrypted); err != nil {
			return connections{}, err
		}
		token, err := decryptToken(encrypted)
		if err != nil {
			return connections{}, fmt.Errorf("failed to decrypt %s token: %w", provider, err)
		}
		switch provider {
		case "vercel":
			out.vercelToken = token
		case "supabase":
			out.supabaseToken = token
		}
	}
	if err := rows.Err(); err != nil {
		return connections{}, err
	}

	if out.vercelToken == "" || out.supabaseToken == "" {
		return connections{}, fmt.Errorf("both vercel and supabase must be connected before deploy")
	}

	return out, nil
}

func (p *Pipeline) loadMetadata(ctx context.Context, tenantID string) (existingMetadata, error) {
	var out existingMetadata
	err := p.db.QueryRowContext(ctx, `
		SELECT
			COALESCE(supabase_project_id, ''),
			COALESCE(supabase_project_url, ''),
			COALESCE(vercel_project_id, ''),
			COALESCE(vercel_project_url, ''),
			COALESCE(vercel_deployment_id, ''),
			COALESCE(vercel_deployment_url, ''),
			COALESCE(custom_domain, ''),
			COALESCE(custom_domain_verified, FALSE)
		FROM tenant_deployments
		WHERE tenant_id = $1`, tenantID).Scan(
		&out.supabaseProjectID,
		&out.supabaseProjectURL,
		&out.vercelProjectID,
		&out.vercelProjectURL,
		&out.vercelDeploymentID,
		&out.vercelDeploymentURL,
		&out.customDomain,
		&out.customDomainVerified,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return existingMetadata{}, nil
	}
	return out, err
}

func (p *Pipeline) saveMetadata(ctx context.Context, tenantID string, meta existingMetadata) error {
	_, err := p.db.ExecContext(ctx, `
		INSERT INTO tenant_deployments (
			tenant_id,
			status,
			supabase_project_id,
			supabase_project_url,
			vercel_project_id,
			vercel_project_url,
			vercel_deployment_id,
			vercel_deployment_url,
			custom_domain,
			custom_domain_verified,
			updated_at
		)
		VALUES ($1, COALESCE((SELECT status FROM tenant_deployments WHERE tenant_id = $1), $2), $3, $4, $5, $6, $7, $8, NULLIF($9, ''), $10, NOW())
		ON CONFLICT (tenant_id)
		DO UPDATE SET
			supabase_project_id = EXCLUDED.supabase_project_id,
			supabase_project_url = EXCLUDED.supabase_project_url,
			vercel_project_id = EXCLUDED.vercel_project_id,
			vercel_project_url = EXCLUDED.vercel_project_url,
			vercel_deployment_id = EXCLUDED.vercel_deployment_id,
			vercel_deployment_url = EXCLUDED.vercel_deployment_url,
			custom_domain = EXCLUDED.custom_domain,
			custom_domain_verified = EXCLUDED.custom_domain_verified,
			updated_at = NOW()`,
		tenantID,
		statusRunning,
		meta.supabaseProjectID,
		meta.supabaseProjectURL,
		meta.vercelProjectID,
		meta.vercelProjectURL,
		meta.vercelDeploymentID,
		meta.vercelDeploymentURL,
		meta.customDomain,
		meta.customDomainVerified,
	)
	return err
}

func (p *Pipeline) ensureSupabaseProject(ctx context.Context, token, tenantID string) (string, string, error) {
	name := projectName("agentteams", tenantID)
	projects, err := p.listSupabaseProjects(ctx, token)
	if err == nil {
		for _, prj := range projects {
			if strings.EqualFold(prj.Name, name) {
				return prj.ID, prj.DashboardURL, nil
			}
		}
	}

	orgID, err := p.firstSupabaseOrgID(ctx, token)
	if err != nil {
		return "", "", err
	}

	payload := map[string]any{
		"name":            name,
		"organization_id": orgID,
		"region":          envOrDefault("SUPABASE_REGION", "us-east-1"),
		"plan":            envOrDefault("SUPABASE_PLAN", "free"),
	}

	var response struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		DashboardURL  string `json:"dashboard_url"`
		Organization  string `json:"organization_id"`
		ProjectRef    string `json:"project_ref"`
		Database      any    `json:"database"`
		SupabaseURL   string `json:"supabase_url"`
		APIURL        string `json:"api_url"`
		DetailsPage   string `json:"details_page"`
		ProjectStatus string `json:"status"`
	}

	if err := p.doJSON(ctx, http.MethodPost, defaultSupabaseURL+"/v1/projects", token, payload, &response); err != nil {
		return "", "", err
	}

	projectURL := response.SupabaseURL
	if projectURL == "" {
		projectURL = response.APIURL
	}
	if projectURL == "" && response.ID != "" {
		projectURL = fmt.Sprintf("https://%s.supabase.co", response.ID)
	}
	if response.ID == "" {
		return "", "", fmt.Errorf("supabase API did not return project id")
	}
	return response.ID, projectURL, nil
}

type supabaseProject struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	DashboardURL string `json:"dashboard_url"`
	APIURL       string `json:"api_url"`
	SupabaseURL  string `json:"supabase_url"`
}

func (p *Pipeline) listSupabaseProjects(ctx context.Context, token string) ([]supabaseProject, error) {
	var out []supabaseProject
	if err := p.doJSON(ctx, http.MethodGet, defaultSupabaseURL+"/v1/projects", token, nil, &out); err != nil {
		return nil, err
	}
	for i := range out {
		if out[i].DashboardURL == "" {
			out[i].DashboardURL = firstNonEmpty(out[i].SupabaseURL, out[i].APIURL)
		}
	}
	return out, nil
}

func (p *Pipeline) firstSupabaseOrgID(ctx context.Context, token string) (string, error) {
	var orgs []struct {
		ID string `json:"id"`
	}
	if err := p.doJSON(ctx, http.MethodGet, defaultSupabaseURL+"/v1/organizations", token, nil, &orgs); err != nil {
		return "", err
	}
	if len(orgs) == 0 || orgs[0].ID == "" {
		return "", fmt.Errorf("no Supabase organization available")
	}
	return orgs[0].ID, nil
}

func (p *Pipeline) runSupabaseMigrations(ctx context.Context, token, projectID string) error {
	sqlText := strings.TrimSpace(os.Getenv("SUPABASE_TENANT_MIGRATIONS_SQL"))
	if sqlText == "" {
		sqlText = "CREATE TABLE IF NOT EXISTS agentteams_bootstrap(id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW());"
	}

	payload := map[string]any{"query": sqlText}
	url := fmt.Sprintf("%s/v1/projects/%s/database/query", defaultSupabaseURL, projectID)
	if err := p.doJSON(ctx, http.MethodPost, url, token, payload, nil); err != nil {
		return fmt.Errorf("failed to run Supabase migrations: %w", err)
	}
	return nil
}

func (p *Pipeline) ensureVercelProject(ctx context.Context, token, tenantID string) (string, string, error) {
	name := projectName("agentteams", tenantID)
	payload := map[string]any{
		"name":      name,
		"framework": "nextjs",
	}

	var created struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}

	err := p.doJSON(ctx, http.MethodPost, defaultVercelBaseURL+"/v10/projects", token, payload, &created)
	if err != nil {
		var existing struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		getURL := fmt.Sprintf("%s/v9/projects/%s", defaultVercelBaseURL, name)
		if getErr := p.doJSON(ctx, http.MethodGet, getURL, token, nil, &existing); getErr != nil {
			return "", "", err
		}
		created = existing
	}

	if created.ID == "" {
		return "", "", fmt.Errorf("vercel API did not return project id")
	}

	projectURL := fmt.Sprintf("https://vercel.com/dashboard/projects/%s", created.Name)
	return created.ID, projectURL, nil
}

func (p *Pipeline) upsertVercelEnvVars(ctx context.Context, token, projectID string, envVars map[string]string) error {
	for key, value := range envVars {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}

		payload := map[string]any{
			"key":    key,
			"value":  value,
			"type":   "encrypted",
			"target": []string{"production", "preview", "development"},
		}
		url := fmt.Sprintf("%s/v10/projects/%s/env", defaultVercelBaseURL, projectID)
		if err := p.doJSON(ctx, http.MethodPost, url, token, payload, nil); err != nil {
			slog.Warn("failed to set vercel env var", "project_id", projectID, "key", key, "err", err)
		}
	}
	return nil
}

func (p *Pipeline) triggerVercelDeploy(ctx context.Context, token, projectID, tenantID string) (string, string, error) {
	name := projectName("agentteams", tenantID)
	payload := map[string]any{
		"name":    name,
		"project": projectID,
		"target":  "production",
	}

	var response struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}

	if err := p.doJSON(ctx, http.MethodPost, defaultVercelBaseURL+"/v13/deployments", token, payload, &response); err != nil {
		return "", "", err
	}
	if response.ID == "" {
		return "", "", fmt.Errorf("vercel API did not return deployment id")
	}

	deploymentURL := response.URL
	if deploymentURL != "" && !strings.HasPrefix(deploymentURL, "http") {
		deploymentURL = "https://" + deploymentURL
	}
	return response.ID, deploymentURL, nil
}

func (p *Pipeline) configureCustomDomain(ctx context.Context, token, projectID, customDomain string) (bool, error) {
	payload := map[string]any{"name": customDomain}
	url := fmt.Sprintf("%s/v10/projects/%s/domains", defaultVercelBaseURL, projectID)
	var response struct {
		Verified bool `json:"verified"`
	}

	if err := p.doJSON(ctx, http.MethodPost, url, token, payload, &response); err != nil {
		if !strings.Contains(strings.ToLower(err.Error()), "already") {
			return false, err
		}
		return false, nil
	}
	return response.Verified, nil
}

func (p *Pipeline) doJSON(ctx context.Context, method, url, bearerToken string, requestBody any, out any) error {
	var body io.Reader
	if requestBody != nil {
		b, err := json.Marshal(requestBody)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+bearerToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		trimmed := strings.TrimSpace(string(responseBody))
		if trimmed == "" {
			trimmed = resp.Status
		}
		return fmt.Errorf("%s %s failed: %s", method, url, trimmed)
	}

	if out == nil || len(responseBody) == 0 {
		return nil
	}
	if err := json.Unmarshal(responseBody, out); err != nil {
		return fmt.Errorf("failed to decode JSON response: %w", err)
	}
	return nil
}

func projectName(prefix, tenantID string) string {
	tenantPart := strings.ReplaceAll(strings.ToLower(tenantID), "-", "")
	if len(tenantPart) > 10 {
		tenantPart = tenantPart[:10]
	}
	return fmt.Sprintf("%s-%s", prefix, tenantPart)
}

func envOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func decryptToken(payload string) (string, error) {
	keyHex := strings.TrimSpace(os.Getenv("ENCRYPTION_KEY"))
	if keyHex == "" {
		return "", fmt.Errorf("ENCRYPTION_KEY is not set")
	}
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return "", fmt.Errorf("invalid ENCRYPTION_KEY hex: %w", err)
	}
	if len(key) != 32 {
		return "", fmt.Errorf("ENCRYPTION_KEY must be 32 bytes")
	}

	parts := strings.Split(payload, ":")
	if len(parts) != 3 {
		return "", fmt.Errorf("invalid encrypted payload format")
	}

	iv, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return "", fmt.Errorf("invalid IV encoding: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("invalid ciphertext encoding: %w", err)
	}
	tag, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return "", fmt.Errorf("invalid auth tag encoding: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(iv) != gcm.NonceSize() {
		return "", fmt.Errorf("invalid nonce size")
	}

	encrypted := make([]byte, 0, len(ciphertext)+len(tag))
	encrypted = append(encrypted, ciphertext...)
	encrypted = append(encrypted, tag...)

	plaintext, err := gcm.Open(nil, iv, encrypted, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
