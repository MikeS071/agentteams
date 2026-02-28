package routes

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/docker/docker/client"
)

const (
	openFangTenantPort = 4200
	tenantIDHeader     = "X-Tenant-ID"
)

type contextKey string

const (
	openFangBaseURLContextKey contextKey = "openfang_base_url"
	openFangHTTPClientKey     contextKey = "openfang_http_client"
)

var (
	errMissingTenantID     = errors.New("missing tenant id")
	errTenantNotFound      = errors.New("tenant not found")
	errTenantNoContainer   = errors.New("tenant container is not provisioned")
	errTenantNotRunning    = errors.New("tenant container is not running")
	errTenantNoContainerIP = errors.New("tenant container has no routable IP")
)

type usageStats struct {
	TotalTokens int64      `json:"total_tokens"`
	LastActive  *time.Time `json:"last_active,omitempty"`
}

// HandsHandler mounts tenant-aware OpenFang hand management proxy routes.
type HandsHandler struct {
	db         *sql.DB
	docker     *client.Client
	httpClient *http.Client
}

func NewHandsHandler(db *sql.DB) *HandsHandler {
	h := &HandsHandler{
		db: db,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
	if db == nil {
		return h
	}

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		slog.Error("hands proxy docker client init failed", "err", err)
		return h
	}
	h.docker = cli
	return h
}

func MountHands(mux *http.ServeMux, db *sql.DB) {
	NewHandsHandler(db).Mount(mux)
}

func (h *HandsHandler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/hands", h.handleListHands)
	mux.HandleFunc("GET /api/hands/{id}", h.handleGetHand)
	mux.HandleFunc("PUT /api/hands/{id}", h.handleUpdateHand)
	mux.HandleFunc("POST /api/hands/{id}/enable", h.handleEnableHand)
	mux.HandleFunc("POST /api/hands/{id}/disable", h.handleDisableHand)
	mux.HandleFunc("GET /api/hands/{id}/history", h.handleHandHistory)
}

func (h *HandsHandler) handleListHands(w http.ResponseWriter, r *http.Request) {
	proxyReq, tenantID, tenantPort, err := h.prepareProxyRequest(r)
	if err != nil {
		writeResolutionError(w, err)
		return
	}

	status, headers, body, err := requestOpenFang(proxyReq, tenantPort, "/v1/hands")
	if err != nil {
		writeProxyRequestError(w, err)
		return
	}
	if status < 200 || status >= 300 {
		writeRawUpstreamResponse(w, status, headers, body)
		return
	}

	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeRawUpstreamResponse(w, status, headers, body)
		return
	}

	usageByHand, tenantUsage, usageErr := h.loadUsageStats(r.Context(), tenantID)
	if usageErr != nil {
		slog.Warn("hands usage enrichment failed", "tenant", tenantID, "err", usageErr)
	}
	customizations, customErr := h.loadCustomizations(r.Context(), tenantID)
	if customErr != nil {
		slog.Warn("hands customization enrichment failed", "tenant", tenantID, "err", customErr)
	}

	enriched := enrichHandsCollection(payload, usageByHand, tenantUsage, customizations)
	writeJSONWithUpstreamHeaders(w, status, headers, enriched)
}

func (h *HandsHandler) handleGetHand(w http.ResponseWriter, r *http.Request) {
	handID := strings.TrimSpace(r.PathValue("id"))
	if handID == "" {
		writeAPIError(w, http.StatusBadRequest, "missing hand id")
		return
	}

	proxyReq, tenantID, tenantPort, err := h.prepareProxyRequest(r)
	if err != nil {
		writeResolutionError(w, err)
		return
	}

	status, headers, body, err := requestOpenFang(proxyReq, tenantPort, "/v1/hands/"+url.PathEscape(handID))
	if err != nil {
		writeProxyRequestError(w, err)
		return
	}
	if status < 200 || status >= 300 {
		writeRawUpstreamResponse(w, status, headers, body)
		return
	}

	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeRawUpstreamResponse(w, status, headers, body)
		return
	}

	usageByHand, tenantUsage, usageErr := h.loadUsageStats(r.Context(), tenantID)
	if usageErr != nil {
		slog.Warn("hand usage enrichment failed", "tenant", tenantID, "hand", handID, "err", usageErr)
	}
	customizations, customErr := h.loadCustomizations(r.Context(), tenantID)
	if customErr != nil {
		slog.Warn("hand customization enrichment failed", "tenant", tenantID, "hand", handID, "err", customErr)
	}

	enriched := enrichSingleHand(payload, handID, usageByHand, tenantUsage, customizations)
	writeJSONWithUpstreamHeaders(w, status, headers, enriched)
}

func (h *HandsHandler) handleUpdateHand(w http.ResponseWriter, r *http.Request) {
	handID := strings.TrimSpace(r.PathValue("id"))
	if handID == "" {
		writeAPIError(w, http.StatusBadRequest, "missing hand id")
		return
	}

	proxyReq, _, tenantPort, err := h.prepareProxyRequest(r)
	if err != nil {
		writeResolutionError(w, err)
		return
	}

	if err := proxyToOpenFang(w, proxyReq, tenantPort, "/v1/hands/"+url.PathEscape(handID)); err != nil {
		slog.Warn("hand update proxy failed", "hand", handID, "err", err)
	}
}

func (h *HandsHandler) handleEnableHand(w http.ResponseWriter, r *http.Request) {
	handID := strings.TrimSpace(r.PathValue("id"))
	if handID == "" {
		writeAPIError(w, http.StatusBadRequest, "missing hand id")
		return
	}

	proxyReq, _, tenantPort, err := h.prepareProxyRequest(r)
	if err != nil {
		writeResolutionError(w, err)
		return
	}

	if err := proxyToOpenFang(w, proxyReq, tenantPort, "/v1/hands/"+url.PathEscape(handID)+"/enable"); err != nil {
		slog.Warn("hand enable proxy failed", "hand", handID, "err", err)
	}
}

func (h *HandsHandler) handleDisableHand(w http.ResponseWriter, r *http.Request) {
	handID := strings.TrimSpace(r.PathValue("id"))
	if handID == "" {
		writeAPIError(w, http.StatusBadRequest, "missing hand id")
		return
	}

	proxyReq, _, tenantPort, err := h.prepareProxyRequest(r)
	if err != nil {
		writeResolutionError(w, err)
		return
	}

	if err := proxyToOpenFang(w, proxyReq, tenantPort, "/v1/hands/"+url.PathEscape(handID)+"/disable"); err != nil {
		slog.Warn("hand disable proxy failed", "hand", handID, "err", err)
	}
}

func (h *HandsHandler) handleHandHistory(w http.ResponseWriter, r *http.Request) {
	handID := strings.TrimSpace(r.PathValue("id"))
	if handID == "" {
		writeAPIError(w, http.StatusBadRequest, "missing hand id")
		return
	}

	proxyReq, _, tenantPort, err := h.prepareProxyRequest(r)
	if err != nil {
		writeResolutionError(w, err)
		return
	}

	if err := proxyToOpenFang(w, proxyReq, tenantPort, "/v1/hands/"+url.PathEscape(handID)+"/history"); err != nil {
		slog.Warn("hand history proxy failed", "hand", handID, "err", err)
	}
}

func (h *HandsHandler) prepareProxyRequest(r *http.Request) (*http.Request, string, int, error) {
	tenantID, err := resolveTenantID(r)
	if err != nil {
		return nil, "", 0, err
	}
	baseURL, tenantPort, err := h.resolveTenantOpenFangEndpoint(r.Context(), tenantID)
	if err != nil {
		return nil, "", 0, err
	}

	ctx := context.WithValue(r.Context(), openFangBaseURLContextKey, baseURL)
	ctx = context.WithValue(ctx, openFangHTTPClientKey, h.httpClient)
	return r.WithContext(ctx), tenantID, tenantPort, nil
}

func resolveTenantID(r *http.Request) (string, error) {
	tenantID := strings.TrimSpace(r.Header.Get(tenantIDHeader))
	if tenantID == "" {
		tenantID = strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	}
	if tenantID == "" {
		tenantID = strings.TrimSpace(r.URL.Query().Get("tenantId"))
	}
	if tenantID == "" {
		return "", errMissingTenantID
	}
	return tenantID, nil
}

func (h *HandsHandler) resolveTenantOpenFangEndpoint(ctx context.Context, tenantID string) (string, int, error) {
	if h.db == nil || h.docker == nil {
		return "", 0, fmt.Errorf("hands proxy dependencies are not configured")
	}

	var containerID sql.NullString
	err := h.db.QueryRowContext(ctx, "SELECT container_id FROM tenants WHERE id = $1", tenantID).Scan(&containerID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", 0, errTenantNotFound
	}
	if err != nil {
		return "", 0, fmt.Errorf("query tenant container: %w", err)
	}
	if !containerID.Valid || strings.TrimSpace(containerID.String) == "" {
		return "", 0, errTenantNoContainer
	}

	info, err := h.docker.ContainerInspect(ctx, containerID.String)
	if err != nil {
		return "", 0, fmt.Errorf("inspect tenant container: %w", err)
	}
	if info.State == nil || !info.State.Running {
		return "", 0, errTenantNotRunning
	}

	if info.NetworkSettings != nil {
		for _, networkCfg := range info.NetworkSettings.Networks {
			ip := strings.TrimSpace(networkCfg.IPAddress)
			if ip != "" {
				return fmt.Sprintf("http://%s:%d", ip, openFangTenantPort), openFangTenantPort, nil
			}
		}

		ip := strings.TrimSpace(info.NetworkSettings.IPAddress)
		if ip != "" {
			return fmt.Sprintf("http://%s:%d", ip, openFangTenantPort), openFangTenantPort, nil
		}
	}

	return "", 0, errTenantNoContainerIP
}

func (h *HandsHandler) loadUsageStats(ctx context.Context, tenantID string) (map[string]usageStats, usageStats, error) {
	byHand := make(map[string]usageStats)
	tenantUsage := usageStats{}

	if h.db == nil {
		return byHand, tenantUsage, fmt.Errorf("database is not configured")
	}

	var (
		totalTokens sql.NullInt64
		usageLast   sql.NullTime
		msgLast     sql.NullTime
	)
	if err := h.db.QueryRowContext(
		ctx,
		`SELECT COALESCE(SUM(input_tokens + output_tokens), 0), MAX(created_at)
		 FROM usage_logs
		 WHERE tenant_id = $1`,
		tenantID,
	).Scan(&totalTokens, &usageLast); err != nil {
		return byHand, tenantUsage, fmt.Errorf("query usage stats: %w", err)
	}
	tenantUsage.TotalTokens = totalTokens.Int64
	if usageLast.Valid {
		t := usageLast.Time.UTC()
		tenantUsage.LastActive = &t
	}

	if err := h.db.QueryRowContext(
		ctx,
		`SELECT MAX(m.created_at)
		 FROM conversations c
		 JOIN messages m ON m.conversation_id = c.id
		 WHERE c.tenant_id = $1`,
		tenantID,
	).Scan(&msgLast); err == nil && msgLast.Valid {
		t := msgLast.Time.UTC()
		if tenantUsage.LastActive == nil || t.After(*tenantUsage.LastActive) {
			tenantUsage.LastActive = &t
		}
	}

	rows, err := h.db.QueryContext(
		ctx,
		`SELECT
			 COALESCE(
			   NULLIF(m.metadata->>'hand_id', ''),
			   NULLIF(m.metadata->>'hand', ''),
			   NULLIF(m.metadata->>'agent', '')
			 ) AS hand_id,
			 MAX(m.created_at) AS last_active
		 FROM conversations c
		 JOIN messages m ON m.conversation_id = c.id
		 WHERE c.tenant_id = $1
		 GROUP BY hand_id`,
		tenantID,
	)
	if err != nil {
		return byHand, tenantUsage, nil
	}
	defer rows.Close()

	for rows.Next() {
		var (
			handID     sql.NullString
			lastActive sql.NullTime
		)
		if err := rows.Scan(&handID, &lastActive); err != nil {
			return byHand, tenantUsage, nil
		}
		id := strings.TrimSpace(handID.String)
		if id == "" {
			continue
		}
		stats := byHand[id]
		stats.TotalTokens = tenantUsage.TotalTokens
		if lastActive.Valid {
			t := lastActive.Time.UTC()
			stats.LastActive = &t
		} else {
			stats.LastActive = tenantUsage.LastActive
		}
		byHand[id] = stats
	}

	for id, stats := range byHand {
		if stats.TotalTokens == 0 {
			stats.TotalTokens = tenantUsage.TotalTokens
		}
		if stats.LastActive == nil && tenantUsage.LastActive != nil {
			t := *tenantUsage.LastActive
			stats.LastActive = &t
		}
		byHand[id] = stats
	}

	return byHand, tenantUsage, nil
}

func (h *HandsHandler) loadCustomizations(ctx context.Context, tenantID string) (map[string]map[string]any, error) {
	customizations := make(map[string]map[string]any)

	tables := []string{"tenant_hand_customizations", "hand_customizations"}
	for _, table := range tables {
		tableCustomizations, err := h.loadCustomizationsFromTable(ctx, table, tenantID)
		if err != nil {
			return customizations, err
		}
		for handID, custom := range tableCustomizations {
			customizations[handID] = custom
		}
	}

	return customizations, nil
}

func (h *HandsHandler) loadCustomizationsFromTable(ctx context.Context, tableName, tenantID string) (map[string]map[string]any, error) {
	result := make(map[string]map[string]any)

	if h.db == nil {
		return result, fmt.Errorf("database is not configured")
	}

	hasTable, err := h.tableHasColumns(ctx, tableName, "tenant_id", "hand_id")
	if err != nil {
		return result, err
	}
	if !hasTable {
		return result, nil
	}

	query := fmt.Sprintf("SELECT * FROM %s WHERE tenant_id = $1", tableName)
	rows, err := h.db.QueryContext(ctx, query, tenantID)
	if err != nil {
		return result, fmt.Errorf("query %s: %w", tableName, err)
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return result, err
	}

	for rows.Next() {
		values := make([]any, len(columns))
		dest := make([]any, len(columns))
		for i := range values {
			dest[i] = &values[i]
		}

		if err := rows.Scan(dest...); err != nil {
			return result, err
		}

		handID := ""
		custom := map[string]any{"source": tableName}
		for i, col := range columns {
			if col == "tenant_id" {
				continue
			}
			normalized := normalizeDBValue(values[i])
			if col == "hand_id" {
				handID, _ = normalized.(string)
				handID = strings.TrimSpace(handID)
				continue
			}
			custom[col] = normalized
		}
		if handID == "" {
			continue
		}
		result[handID] = custom
	}
	if err := rows.Err(); err != nil {
		return result, err
	}

	return result, nil
}

func (h *HandsHandler) tableHasColumns(ctx context.Context, tableName string, requiredColumns ...string) (bool, error) {
	rows, err := h.db.QueryContext(
		ctx,
		`SELECT column_name
		 FROM information_schema.columns
		 WHERE table_schema = current_schema()
		   AND table_name = $1`,
		tableName,
	)
	if err != nil {
		return false, fmt.Errorf("query table schema: %w", err)
	}
	defer rows.Close()

	columns := make(map[string]struct{})
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			return false, err
		}
		columns[column] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	if len(columns) == 0 {
		return false, nil
	}
	for _, column := range requiredColumns {
		if _, ok := columns[column]; !ok {
			return false, nil
		}
	}
	return true, nil
}

func normalizeDBValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case []byte:
		text := string(typed)
		if json.Valid(typed) {
			var decoded any
			if err := json.Unmarshal(typed, &decoded); err == nil {
				return decoded
			}
		}
		return text
	case string:
		return typed
	case time.Time:
		return typed.UTC()
	default:
		return typed
	}
}

func enrichHandsCollection(payload any, byHand map[string]usageStats, tenantUsage usageStats, customizations map[string]map[string]any) any {
	switch typed := payload.(type) {
	case []any:
		return enrichHandsArray(typed, byHand, tenantUsage, customizations)
	case map[string]any:
		if hands, ok := typed["hands"].([]any); ok {
			typed["hands"] = enrichHandsArray(hands, byHand, tenantUsage, customizations)
		} else if data, ok := typed["data"].([]any); ok {
			typed["data"] = enrichHandsArray(data, byHand, tenantUsage, customizations)
		}
		typed["tenant_usage"] = map[string]any{
			"total_tokens": tenantUsage.TotalTokens,
			"last_active":  tenantUsage.LastActive,
		}
		return typed
	default:
		return payload
	}
}

func enrichHandsArray(hands []any, byHand map[string]usageStats, tenantUsage usageStats, customizations map[string]map[string]any) []any {
	for i, entry := range hands {
		hand, ok := entry.(map[string]any)
		if !ok {
			continue
		}

		handID := resolveHandID(hand)
		hands[i] = enrichHandMap(hand, handID, byHand, tenantUsage, customizations)
	}
	return hands
}

func enrichSingleHand(payload any, expectedHandID string, byHand map[string]usageStats, tenantUsage usageStats, customizations map[string]map[string]any) any {
	switch typed := payload.(type) {
	case map[string]any:
		if hand, ok := typed["hand"].(map[string]any); ok {
			id := resolveHandID(hand)
			if id == "" {
				id = expectedHandID
			}
			typed["hand"] = enrichHandMap(hand, id, byHand, tenantUsage, customizations)
			return typed
		}
		id := resolveHandID(typed)
		if id == "" {
			id = expectedHandID
		}
		return enrichHandMap(typed, id, byHand, tenantUsage, customizations)
	default:
		return payload
	}
}

func enrichHandMap(hand map[string]any, handID string, byHand map[string]usageStats, tenantUsage usageStats, customizations map[string]map[string]any) map[string]any {
	stats, ok := byHand[handID]
	if !ok {
		stats = tenantUsage
	}
	if stats.TotalTokens == 0 {
		stats.TotalTokens = tenantUsage.TotalTokens
	}
	if stats.LastActive == nil && tenantUsage.LastActive != nil {
		t := *tenantUsage.LastActive
		stats.LastActive = &t
	}

	hand["usage"] = map[string]any{
		"total_tokens": stats.TotalTokens,
		"last_active":  stats.LastActive,
	}

	if customization, ok := customizations[handID]; ok {
		hand["customization"] = customization
	}

	enabled := extractEnabled(hand)
	if enabled == nil {
		if customization, ok := customizations[handID]; ok {
			if value, ok := customization["enabled"].(bool); ok {
				enabled = &value
			}
		}
	}
	status := map[string]any{
		"last_active": stats.LastActive,
	}
	if enabled != nil {
		status["enabled"] = *enabled
		if *enabled {
			status["state"] = "enabled"
		} else {
			status["state"] = "disabled"
		}
	}
	hand["status"] = status

	return hand
}

func resolveHandID(hand map[string]any) string {
	candidates := []string{"id", "name", "key", "slug", "hand_id"}
	for _, candidate := range candidates {
		if raw, ok := hand[candidate]; ok {
			if value, ok := raw.(string); ok {
				value = strings.TrimSpace(value)
				if value != "" {
					return value
				}
			}
		}
	}
	return ""
}

func extractEnabled(hand map[string]any) *bool {
	if value, ok := hand["enabled"].(bool); ok {
		return &value
	}
	if status, ok := hand["status"].(map[string]any); ok {
		if value, ok := status["enabled"].(bool); ok {
			return &value
		}
	}
	return nil
}

// proxyToOpenFang forwards the request to the tenant OpenFang API and relays the response.
func proxyToOpenFang(w http.ResponseWriter, r *http.Request, tenantPort int, path string) error {
	resp, err := doOpenFangRequest(r, tenantPort, path)
	if err != nil {
		writeProxyRequestError(w, err)
		return err
	}
	defer resp.Body.Close()

	copyHeaders(w.Header(), resp.Header, true)
	w.WriteHeader(resp.StatusCode)
	_, err = io.Copy(w, resp.Body)
	return err
}

func requestOpenFang(r *http.Request, tenantPort int, path string) (int, http.Header, []byte, error) {
	resp, err := doOpenFangRequest(r, tenantPort, path)
	if err != nil {
		return 0, nil, nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, nil, err
	}
	return resp.StatusCode, resp.Header.Clone(), body, nil
}

func doOpenFangRequest(r *http.Request, tenantPort int, path string) (*http.Response, error) {
	targetURL, err := buildOpenFangURL(r.Context(), tenantPort, path, r.URL.RawQuery)
	if err != nil {
		return nil, err
	}

	body, err := readRequestBody(r)
	if err != nil {
		return nil, err
	}

	outboundReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create upstream request: %w", err)
	}

	copyHeaders(outboundReq.Header, r.Header, true)
	outboundReq.Header.Del("Host")
	outboundReq.Host = ""

	client := openFangHTTPClientFromContext(r.Context())
	resp, err := client.Do(outboundReq)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func buildOpenFangURL(ctx context.Context, tenantPort int, path, rawQuery string) (string, error) {
	baseURL, _ := ctx.Value(openFangBaseURLContextKey).(string)
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = fmt.Sprintf("http://127.0.0.1:%d", tenantPort)
	}

	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" {
		cleanPath = "/"
	}
	if !strings.HasPrefix(cleanPath, "/") {
		cleanPath = "/" + cleanPath
	}

	target := strings.TrimRight(baseURL, "/") + cleanPath
	if rawQuery != "" {
		target += "?" + rawQuery
	}

	if _, err := url.Parse(target); err != nil {
		return "", fmt.Errorf("invalid OpenFang URL %q: %w", target, err)
	}
	return target, nil
}

func readRequestBody(r *http.Request) ([]byte, error) {
	if r.Body == nil {
		return nil, nil
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	return body, nil
}

func openFangHTTPClientFromContext(ctx context.Context) *http.Client {
	if client, ok := ctx.Value(openFangHTTPClientKey).(*http.Client); ok && client != nil {
		return client
	}
	return &http.Client{Timeout: 15 * time.Second}
}

func copyHeaders(dst, src http.Header, includeContentLength bool) {
	hopByHop := map[string]struct{}{
		"Connection":          {},
		"Proxy-Connection":    {},
		"Keep-Alive":          {},
		"Proxy-Authenticate":  {},
		"Proxy-Authorization": {},
		"Te":                  {},
		"Trailer":             {},
		"Transfer-Encoding":   {},
		"Upgrade":             {},
	}
	for key, values := range src {
		if _, blocked := hopByHop[key]; blocked {
			continue
		}
		if !includeContentLength && strings.EqualFold(key, "Content-Length") {
			continue
		}
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func writeResolutionError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errMissingTenantID):
		writeAPIError(w, http.StatusBadRequest, "missing tenant id (set X-Tenant-ID header)")
	case errors.Is(err, errTenantNotFound):
		writeAPIError(w, http.StatusNotFound, "tenant not found")
	case errors.Is(err, errTenantNoContainer):
		writeAPIError(w, http.StatusServiceUnavailable, "tenant container is not provisioned")
	case errors.Is(err, errTenantNotRunning):
		writeAPIError(w, http.StatusServiceUnavailable, "tenant container is not running")
	case errors.Is(err, errTenantNoContainerIP):
		writeAPIError(w, http.StatusServiceUnavailable, "tenant container network is unavailable")
	default:
		writeAPIError(w, http.StatusInternalServerError, "failed to resolve tenant OpenFang endpoint")
	}
}

func writeProxyRequestError(w http.ResponseWriter, err error) {
	var netErr net.Error
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		writeAPIError(w, http.StatusGatewayTimeout, "OpenFang request timed out")
	case errors.As(err, &netErr) && netErr.Timeout():
		writeAPIError(w, http.StatusGatewayTimeout, "OpenFang request timed out")
	default:
		writeAPIError(w, http.StatusBadGateway, "OpenFang is unavailable for this tenant")
	}
}

func writeRawUpstreamResponse(w http.ResponseWriter, status int, headers http.Header, body []byte) {
	copyHeaders(w.Header(), headers, true)
	w.WriteHeader(status)
	if len(body) > 0 {
		_, _ = w.Write(body)
	}
}

func writeJSONWithUpstreamHeaders(w http.ResponseWriter, status int, headers http.Header, payload any) {
	copyHeaders(w.Header(), headers, false)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeAPIError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
