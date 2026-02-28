package routes

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
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	maxDeployRequestBodyBytes int64 = 2 << 20
)

type DeployHandler struct {
	db         *sql.DB
	httpClient *http.Client
}

type deployRunResponse struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	Status   string `json:"status"`
}

type vercelDeployRequest struct {
	TenantID      string            `json:"tenant_id"`
	ProjectName   string            `json:"project_name"`
	RepoURL       string            `json:"repo_url"`
	Framework     string            `json:"framework"`
	RootDirectory string            `json:"root_directory"`
	TeamID        string            `json:"team_id"`
	Token         string            `json:"token"`
	Branch        string            `json:"branch"`
	Files         []vercelDeployFile `json:"files"`
	Env           map[string]string `json:"env"`
}

type vercelDeployFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type supabaseDeployRequest struct {
	TenantID    string   `json:"tenant_id"`
	ProjectName string   `json:"project_name"`
	OrgID       string   `json:"org_id"`
	Region      string   `json:"region"`
	DBPassword  string   `json:"db_password"`
	Token       string   `json:"token"`
	Migrations  []string `json:"migrations"`
}

type deploymentStatusResponse struct {
	ID          string           `json:"id"`
	TenantID    string           `json:"tenant_id"`
	Provider    string           `json:"provider"`
	TargetName  string           `json:"target_name"`
	Status      string           `json:"status"`
	ExternalID  string           `json:"external_id,omitempty"`
	Error       string           `json:"error,omitempty"`
	Logs        []deploymentLog  `json:"logs"`
	CreatedAt   time.Time        `json:"created_at"`
	UpdatedAt   time.Time        `json:"updated_at"`
}

type deploymentLog struct {
	Timestamp string `json:"timestamp"`
	Message   string `json:"message"`
}

func NewDeployHandler(db *sql.DB) *DeployHandler {
	return &DeployHandler{
		db: db,
		httpClient: &http.Client{
			Timeout: 45 * time.Second,
		},
	}
}

func (h *DeployHandler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/deploy/vercel", h.handleDeployVercel)
	mux.HandleFunc("POST /api/deploy/supabase", h.handleDeploySupabase)
	mux.HandleFunc("GET /api/deploy/status/{id}", h.handleDeployStatus)
}

func (h *DeployHandler) handleDeployVercel(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxDeployRequestBodyBytes)

	var req vercelDeployRequest
	if err := decodeJSONStrict(r, &req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	req.TenantID = strings.TrimSpace(req.TenantID)
	req.ProjectName = sanitizeProjectName(req.ProjectName)
	req.RepoURL = strings.TrimSpace(req.RepoURL)
	req.Framework = strings.TrimSpace(req.Framework)
	req.RootDirectory = strings.TrimSpace(req.RootDirectory)
	req.TeamID = strings.TrimSpace(req.TeamID)
	req.Token = strings.TrimSpace(req.Token)
	req.Branch = strings.TrimSpace(req.Branch)
	if req.Branch == "" {
		req.Branch = "main"
	}

	if req.TenantID == "" || req.ProjectName == "" {
		writeAPIError(w, http.StatusBadRequest, "tenant_id and project_name are required")
		return
	}
	if req.RepoURL == "" && len(req.Files) == 0 {
		writeAPIError(w, http.StatusBadRequest, "repo_url or files is required")
		return
	}
	for _, f := range req.Files {
		if strings.TrimSpace(f.Path) == "" {
			writeAPIError(w, http.StatusBadRequest, "file path is required")
			return
		}
	}

	runID, err := h.createDeployRun(r.Context(), req.TenantID, "vercel", req.ProjectName)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to create deployment run")
		return
	}

	go h.runVercelDeployment(runID, req)
	writeJSON(w, http.StatusAccepted, deployRunResponse{
		ID:       runID,
		Provider: "vercel",
		Status:   "queued",
	})
}

func (h *DeployHandler) handleDeploySupabase(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxDeployRequestBodyBytes)

	var req supabaseDeployRequest
	if err := decodeJSONStrict(r, &req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	req.TenantID = strings.TrimSpace(req.TenantID)
	req.ProjectName = sanitizeProjectName(req.ProjectName)
	req.OrgID = strings.TrimSpace(req.OrgID)
	req.Region = strings.TrimSpace(req.Region)
	req.DBPassword = strings.TrimSpace(req.DBPassword)
	req.Token = strings.TrimSpace(req.Token)

	if req.TenantID == "" || req.ProjectName == "" || req.OrgID == "" || req.DBPassword == "" {
		writeAPIError(w, http.StatusBadRequest, "tenant_id, project_name, org_id, and db_password are required")
		return
	}

	runID, err := h.createDeployRun(r.Context(), req.TenantID, "supabase", req.ProjectName)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to create deployment run")
		return
	}

	go h.runSupabaseDeployment(runID, req)
	writeJSON(w, http.StatusAccepted, deployRunResponse{
		ID:       runID,
		Provider: "supabase",
		Status:   "queued",
	})
}

func (h *DeployHandler) handleDeployStatus(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}

	runID := strings.TrimSpace(r.PathValue("id"))
	if runID == "" {
		writeAPIError(w, http.StatusBadRequest, "missing deployment id")
		return
	}

	tenantID := strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	query := `
		SELECT id, tenant_id, provider, target_name, status, external_id, logs, error_message, created_at, updated_at
		FROM deployment_runs
		WHERE id = $1
	`
	args := []any{runID}
	if tenantID != "" {
		query += " AND tenant_id = $2"
		args = append(args, tenantID)
	}

	var res deploymentStatusResponse
	var logsRaw []byte
	err := h.db.QueryRowContext(r.Context(), query, args...).Scan(
		&res.ID,
		&res.TenantID,
		&res.Provider,
		&res.TargetName,
		&res.Status,
		&res.ExternalID,
		&logsRaw,
		&res.Error,
		&res.CreatedAt,
		&res.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeAPIError(w, http.StatusNotFound, "deployment not found")
			return
		}
		writeAPIError(w, http.StatusInternalServerError, "failed to load deployment status")
		return
	}

	if len(logsRaw) > 0 {
		_ = json.Unmarshal(logsRaw, &res.Logs)
	}
	if res.Logs == nil {
		res.Logs = []deploymentLog{}
	}

	writeJSON(w, http.StatusOK, res)
}

func (h *DeployHandler) runVercelDeployment(runID string, req vercelDeployRequest) {
	_ = h.updateDeployRun(runID, "running", "", "")
	h.appendDeployLog(runID, "Starting Vercel deployment")

	token := strings.TrimSpace(req.Token)
	if token == "" {
		var err error
		token, err = h.getStoredToken(req.TenantID, "vercel")
		if err != nil {
			h.failDeployRun(runID, fmt.Sprintf("failed to load Vercel token: %v", err))
			return
		}
	}

	if err := h.verifyVercelToken(token); err != nil {
		h.failDeployRun(runID, fmt.Sprintf("invalid Vercel token: %v", err))
		return
	}
	h.appendDeployLog(runID, "Vercel token verified")

	projectBody := map[string]any{
		"name": req.ProjectName,
	}
	if req.Framework != "" {
		projectBody["framework"] = req.Framework
	}
	if req.RootDirectory != "" {
		projectBody["rootDirectory"] = req.RootDirectory
	}
	if repo, repoType := parseRepo(req.RepoURL); repo != "" {
		projectBody["gitRepository"] = map[string]any{
			"type": repoType,
			"repo": repo,
		}
	}

	createProjectURL := "https://api.vercel.com/v10/projects"
	if req.TeamID != "" {
		createProjectURL += "?teamId=" + url.QueryEscape(req.TeamID)
	}

	projectResp, statusCode, err := h.doJSONRequest(http.MethodPost, createProjectURL, token, projectBody)
	if err != nil {
		h.failDeployRun(runID, fmt.Sprintf("create Vercel project request failed: %v", err))
		return
	}
	if statusCode >= http.StatusBadRequest {
		if !strings.Contains(strings.ToLower(string(projectResp)), "already exists") {
			h.failDeployRun(runID, fmt.Sprintf("create Vercel project failed (%d): %s", statusCode, trimBody(projectResp)))
			return
		}
		h.appendDeployLog(runID, "Vercel project already exists; continuing")
	} else {
		h.appendDeployLog(runID, "Vercel project created")
	}

	deployBody := map[string]any{
		"name":    req.ProjectName,
		"project": req.ProjectName,
	}
	if len(req.Env) > 0 {
		env := make([]map[string]string, 0, len(req.Env))
		for k, v := range req.Env {
			env = append(env, map[string]string{
				"key":   k,
				"value": v,
				"target": "production",
			})
		}
		deployBody["env"] = env
	}
	if repo, repoType := parseRepo(req.RepoURL); repo != "" {
		deployBody["gitSource"] = map[string]any{
			"type": repoType,
			"repo": repo,
			"ref":  req.Branch,
		}
	}
	if len(req.Files) > 0 {
		files := make([]map[string]string, 0, len(req.Files))
		for _, f := range req.Files {
			files = append(files, map[string]string{
				"file": f.Path,
				"data": f.Content,
			})
		}
		deployBody["files"] = files
	}

	deployURL := "https://api.vercel.com/v13/deployments"
	if req.TeamID != "" {
		deployURL += "?teamId=" + url.QueryEscape(req.TeamID)
	}

	deployRespBody, deployStatus, err := h.doJSONRequest(http.MethodPost, deployURL, token, deployBody)
	if err != nil {
		h.failDeployRun(runID, fmt.Sprintf("create Vercel deployment request failed: %v", err))
		return
	}
	if deployStatus >= http.StatusBadRequest {
		h.failDeployRun(runID, fmt.Sprintf("create Vercel deployment failed (%d): %s", deployStatus, trimBody(deployRespBody)))
		return
	}

	var deployResp struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	_ = json.Unmarshal(deployRespBody, &deployResp)
	externalID := strings.TrimSpace(deployResp.ID)
	if externalID == "" {
		externalID = strings.TrimSpace(deployResp.URL)
	}

	h.appendDeployLog(runID, "Vercel build triggered")
	_ = h.updateDeployRun(runID, "succeeded", externalID, "")
}

func (h *DeployHandler) runSupabaseDeployment(runID string, req supabaseDeployRequest) {
	_ = h.updateDeployRun(runID, "running", "", "")
	h.appendDeployLog(runID, "Starting Supabase provisioning")

	token := strings.TrimSpace(req.Token)
	if token == "" {
		var err error
		token, err = h.getStoredToken(req.TenantID, "supabase")
		if err != nil {
			h.failDeployRun(runID, fmt.Sprintf("failed to load Supabase token: %v", err))
			return
		}
	}

	if err := h.verifySupabaseToken(token); err != nil {
		h.failDeployRun(runID, fmt.Sprintf("invalid Supabase token: %v", err))
		return
	}
	h.appendDeployLog(runID, "Supabase token verified")

	createBody := map[string]any{
		"name":            req.ProjectName,
		"organization_id": req.OrgID,
		"db_pass":         req.DBPassword,
	}
	if req.Region != "" {
		createBody["region"] = req.Region
	}

	projectRespBody, statusCode, err := h.doJSONRequest(
		http.MethodPost,
		"https://api.supabase.com/v1/projects",
		token,
		createBody,
	)
	if err != nil {
		h.failDeployRun(runID, fmt.Sprintf("create Supabase project request failed: %v", err))
		return
	}
	if statusCode >= http.StatusBadRequest {
		h.failDeployRun(runID, fmt.Sprintf("create Supabase project failed (%d): %s", statusCode, trimBody(projectRespBody)))
		return
	}

	var projectResp struct {
		ID                string `json:"id"`
		Reference         string `json:"reference"`
		ProjectRef        string `json:"project_ref"`
	}
	_ = json.Unmarshal(projectRespBody, &projectResp)

	projectRef := strings.TrimSpace(projectResp.Reference)
	if projectRef == "" {
		projectRef = strings.TrimSpace(projectResp.ProjectRef)
	}
	if projectRef == "" {
		projectRef = strings.TrimSpace(projectResp.ID)
	}
	h.appendDeployLog(runID, "Supabase project created")

	if len(req.Migrations) == 0 {
		h.appendDeployLog(runID, "No migrations provided")
		_ = h.updateDeployRun(runID, "succeeded", projectRef, "")
		return
	}

	for i, migration := range req.Migrations {
		sqlText := strings.TrimSpace(migration)
		if sqlText == "" {
			continue
		}
		h.appendDeployLog(runID, fmt.Sprintf("Running migration %d", i+1))

		queryURL := fmt.Sprintf("https://api.supabase.com/v1/projects/%s/database/query", url.PathEscape(projectRef))
		migrationRespBody, migrationStatus, reqErr := h.doJSONRequest(
			http.MethodPost,
			queryURL,
			token,
			map[string]string{"query": sqlText},
		)
		if reqErr != nil {
			h.failDeployRun(runID, fmt.Sprintf("migration %d request failed: %v", i+1, reqErr))
			return
		}
		if migrationStatus >= http.StatusBadRequest {
			h.failDeployRun(runID, fmt.Sprintf("migration %d failed (%d): %s", i+1, migrationStatus, trimBody(migrationRespBody)))
			return
		}
	}

	h.appendDeployLog(runID, "Supabase migrations completed")
	_ = h.updateDeployRun(runID, "succeeded", projectRef, "")
}

func (h *DeployHandler) verifyVercelToken(token string) error {
	body, statusCode, err := h.doJSONRequest(http.MethodGet, "https://api.vercel.com/v2/user", token, nil)
	if err != nil {
		return err
	}
	if statusCode >= http.StatusBadRequest {
		return fmt.Errorf("status %d: %s", statusCode, trimBody(body))
	}
	return nil
}

func (h *DeployHandler) verifySupabaseToken(token string) error {
	body, statusCode, err := h.doJSONRequest(http.MethodGet, "https://api.supabase.com/v1/organizations", token, nil)
	if err != nil {
		return err
	}
	if statusCode >= http.StatusBadRequest {
		return fmt.Errorf("status %d: %s", statusCode, trimBody(body))
	}
	return nil
}

func (h *DeployHandler) doJSONRequest(method, endpoint, bearerToken string, payload any) ([]byte, int, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, 0, err
		}
		body = bytes.NewReader(encoded)
	}

	req, err := http.NewRequest(method, endpoint, body)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+bearerToken)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, 0, err
	}
	return respBody, resp.StatusCode, nil
}

func (h *DeployHandler) createDeployRun(ctx context.Context, tenantID, provider, targetName string) (string, error) {
	var runID string
	err := h.db.QueryRowContext(ctx, `
		INSERT INTO deployment_runs (tenant_id, provider, target_name, status)
		VALUES ($1, $2, $3, 'queued')
		RETURNING id
	`, tenantID, provider, targetName).Scan(&runID)
	return runID, err
}

func (h *DeployHandler) appendDeployLog(runID, message string) {
	msg := strings.TrimSpace(message)
	if msg == "" {
		return
	}
	_, _ = h.db.Exec(`
		UPDATE deployment_runs
		SET logs = COALESCE(logs, '[]'::jsonb) || jsonb_build_array(
			jsonb_build_object(
				'timestamp', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
				'message', $2
			)
		),
		updated_at = NOW()
		WHERE id = $1
	`, runID, msg)
}

func (h *DeployHandler) updateDeployRun(runID, status, externalID, errorMessage string) error {
	_, err := h.db.Exec(`
		UPDATE deployment_runs
		SET status = $2,
		    external_id = CASE WHEN $3 <> '' THEN $3 ELSE external_id END,
		    error_message = CASE WHEN $4 <> '' THEN $4 ELSE NULL END,
		    updated_at = NOW()
		WHERE id = $1
	`, runID, status, externalID, errorMessage)
	return err
}

func (h *DeployHandler) failDeployRun(runID, message string) {
	trimmed := strings.TrimSpace(message)
	h.appendDeployLog(runID, trimmed)
	_ = h.updateDeployRun(runID, "failed", "", trimmed)
}

func (h *DeployHandler) getStoredToken(tenantID, provider string) (string, error) {
	var encrypted string
	err := h.db.QueryRow(`
		SELECT access_token_encrypted
		FROM deploy_connections
		WHERE tenant_id = $1 AND provider = $2
	`, tenantID, provider).Scan(&encrypted)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("no %s token found for tenant", provider)
		}
		return "", err
	}

	keyHex := strings.TrimSpace(os.Getenv("ENCRYPTION_KEY"))
	if keyHex == "" {
		return "", errors.New("ENCRYPTION_KEY is not configured")
	}
	key, err := hex.DecodeString(keyHex)
	if err != nil || len(key) != 32 {
		return "", errors.New("ENCRYPTION_KEY must be a 32-byte hex string")
	}

	plaintext, err := decryptToken(encrypted, key)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(plaintext), nil
}

func decryptToken(payload string, key []byte) (string, error) {
	parts := strings.Split(payload, ":")
	if len(parts) != 3 {
		return "", errors.New("invalid encrypted payload format")
	}

	iv, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return "", err
	}
	ciphertext, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	tag, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	raw := append(ciphertext, tag...)
	plaintext, err := aead.Open(nil, iv, raw, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func parseRepo(repoURL string) (string, string) {
	raw := strings.TrimSpace(repoURL)
	if raw == "" {
		return "", ""
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return "", ""
	}

	host := strings.ToLower(parsed.Hostname())
	path := strings.Trim(parsed.Path, "/")
	if strings.HasSuffix(path, ".git") {
		path = strings.TrimSuffix(path, ".git")
	}

	switch {
	case strings.Contains(host, "github"):
		return path, "github"
	case strings.Contains(host, "gitlab"):
		return path, "gitlab"
	case strings.Contains(host, "bitbucket"):
		return path, "bitbucket"
	default:
		return path, "github"
	}
}

func sanitizeProjectName(name string) string {
	trimmed := strings.TrimSpace(strings.ToLower(name))
	if trimmed == "" {
		return ""
	}
	builder := strings.Builder{}
	prevDash := false
	for _, ch := range trimmed {
		valid := (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')
		if valid {
			builder.WriteRune(ch)
			prevDash = false
			continue
		}
		if !prevDash {
			builder.WriteRune('-')
			prevDash = true
		}
	}
	out := strings.Trim(builder.String(), "-")
	if out == "" {
		return ""
	}
	if len(out) > 100 {
		return out[:100]
	}
	return out
}

func trimBody(body []byte) string {
	s := strings.TrimSpace(string(body))
	if len(s) > 700 {
		return s[:700] + "..."
	}
	return s
}

