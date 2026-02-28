package routes

import (
	"bufio"
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
	"strings"
	"time"

	"github.com/agentteams/api/orchestrator"
)

const (
	openFangUnavailableMessage = "Agent not available, starting..."
	openFangTimeout            = 30 * time.Second
)

// ChatProxy handles /api/chat and forwards requests to tenant-local OpenFang.
type ChatProxy struct {
	db              *sql.DB
	orch            orchestrator.TenantOrchestrator
	streamClient    *http.Client
	nonStreamClient *http.Client
}

type chatProxyRequest struct {
	Messages    []map[string]any `json:"messages"`
	Model       string           `json:"model"`
	Stream      bool             `json:"stream,omitempty"`
	TenantID    string           `json:"tenant_id"`
	TenantIDAlt string           `json:"tenantId"`
	HandID      string           `json:"handId,omitempty"`
	HandIDAlt   string           `json:"hand_id,omitempty"`
}

type chatUsage struct {
	PromptTokens     int
	CompletionTokens int
}

func NewChatProxy(db *sql.DB, orch orchestrator.TenantOrchestrator) *ChatProxy {
	return &ChatProxy{
		db:   db,
		orch: orch,
		streamClient: &http.Client{
			Timeout: 0,
		},
		nonStreamClient: &http.Client{
			Timeout: openFangTimeout,
		},
	}
}

func (h *ChatProxy) Mount(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/chat", h.handleChat)
}

func (h *ChatProxy) handleChat(w http.ResponseWriter, r *http.Request) {
	if h.orch == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "orchestrator is not configured")
		return
	}

	var req chatProxyRequest
	if err := decodeJSON(r, &req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	req.Model = strings.TrimSpace(req.Model)
	if req.Model == "" {
		writeAPIError(w, http.StatusBadRequest, "model is required")
		return
	}
	if len(req.Messages) == 0 {
		writeAPIError(w, http.StatusBadRequest, "messages are required")
		return
	}

	tenantID := strings.TrimSpace(r.Header.Get("X-Tenant-ID"))
	if tenantID == "" {
		tenantID = strings.TrimSpace(req.TenantID)
	}
	if tenantID == "" {
		tenantID = strings.TrimSpace(req.TenantIDAlt)
	}
	if tenantID == "" {
		writeAPIError(w, http.StatusBadRequest, "tenant id is required")
		return
	}

	if !h.ensureTenantRunning(r.Context(), tenantID) {
		writeAPIError(w, http.StatusServiceUnavailable, openFangUnavailableMessage)
		return
	}

	port, err := h.orch.Port(r.Context(), tenantID)
	if err != nil {
		slog.Error("failed to resolve tenant OpenFang port", "tenant", tenantID, "err", err)
		writeAPIError(w, http.StatusServiceUnavailable, openFangUnavailableMessage)
		return
	}

	payload := map[string]any{
		"messages": req.Messages,
		"model":    req.Model,
		"stream":   req.Stream,
	}
	handID := strings.TrimSpace(req.HandID)
	if handID == "" {
		handID = strings.TrimSpace(req.HandIDAlt)
	}
	if handID != "" {
		payload["handId"] = handID
	}

	body, err := json.Marshal(payload)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to encode upstream request")
		return
	}

	upstreamURL := fmt.Sprintf("http://localhost:%d/v1/chat/completions", port)
	if req.Stream {
		h.proxyStream(w, r, upstreamURL, tenantID, req.Model, body)
		return
	}
	h.proxyNonStream(w, r, upstreamURL, tenantID, req.Model, body)
}

func (h *ChatProxy) ensureTenantRunning(ctx context.Context, tenantID string) bool {
	status, err := h.orch.Status(ctx, tenantID)
	if err == nil && status != nil && status.Running {
		return true
	}

	if startErr := h.orch.Start(ctx, tenantID); startErr != nil {
		if _, createErr := h.orch.Create(ctx, tenantID); createErr != nil {
			slog.Warn("tenant container is unavailable", "tenant", tenantID, "status_err", err, "start_err", startErr, "create_err", createErr)
			return false
		}
	}

	return false
}

func (h *ChatProxy) proxyNonStream(w http.ResponseWriter, r *http.Request, upstreamURL, tenantID, model string, body []byte) {
	upstreamReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, upstreamURL, bytes.NewReader(body))
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to build upstream request")
		return
	}
	upstreamReq.Header.Set("Content-Type", "application/json")
	upstreamReq.Header.Set("X-Tenant-ID", tenantID)

	resp, err := h.nonStreamClient.Do(upstreamReq)
	if err != nil {
		if isTimeoutError(err) {
			writeAPIError(w, http.StatusGatewayTimeout, "OpenFang timeout")
			return
		}
		writeAPIError(w, http.StatusBadGateway, "failed to reach OpenFang")
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, "failed to read OpenFang response")
		return
	}

	if resp.StatusCode >= http.StatusBadRequest {
		writeUpstreamResponse(w, resp.StatusCode, resp.Header.Get("Content-Type"), respBody)
		return
	}

	usage, usageFound := extractUsageFromJSON(respBody)
	if usageFound {
		h.recordUsageAsync(tenantID, model, usage)
	}

	writeUpstreamResponse(w, resp.StatusCode, resp.Header.Get("Content-Type"), respBody)
}

func (h *ChatProxy) proxyStream(w http.ResponseWriter, r *http.Request, upstreamURL, tenantID, model string, body []byte) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAPIError(w, http.StatusInternalServerError, "streaming is not supported")
		return
	}

	upstreamReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, upstreamURL, bytes.NewReader(body))
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to build upstream request")
		return
	}
	upstreamReq.Header.Set("Content-Type", "application/json")
	upstreamReq.Header.Set("X-Tenant-ID", tenantID)

	resp, err := h.streamClient.Do(upstreamReq)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, "failed to reach OpenFang")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		respBody, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			writeAPIError(w, http.StatusBadGateway, "failed to read OpenFang response")
			return
		}
		writeUpstreamResponse(w, resp.StatusCode, resp.Header.Get("Content-Type"), respBody)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	reader := bufio.NewReader(resp.Body)
	usage := chatUsage{}
	usageFound := false

	for {
		if err := r.Context().Err(); err != nil {
			return
		}

		line, readErr := reader.ReadString('\n')
		if line != "" {
			if data, ok := extractSSEDataLine(line); ok {
				if parsedUsage, ok := extractUsageFromChunk(data); ok {
					usage = parsedUsage
					usageFound = true
				}
			}

			if _, writeErr := io.WriteString(w, line); writeErr != nil {
				return
			}
			flusher.Flush()
		}

		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				break
			}
			slog.Warn("streaming read from OpenFang failed", "tenant", tenantID, "err", readErr)
			return
		}
	}

	if usageFound {
		h.recordUsageAsync(tenantID, model, usage)
	}
}

func (h *ChatProxy) recordUsageAsync(tenantID, model string, usage chatUsage) {
	if h.db == nil {
		return
	}
	if usage.PromptTokens < 0 || usage.CompletionTokens < 0 {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		_, err := h.db.ExecContext(ctx,
			`INSERT INTO usage_logs (tenant_id, model, input_tokens, output_tokens)
			 VALUES ($1, $2, $3, $4)`,
			tenantID,
			model,
			usage.PromptTokens,
			usage.CompletionTokens,
		)
		if err != nil {
			slog.Warn("failed to insert usage log", "tenant", tenantID, "model", model, "err", err)
		}
	}()
}

func extractUsageFromJSON(body []byte) (chatUsage, bool) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return chatUsage{}, false
	}
	return extractUsageFromMap(payload)
}

func extractUsageFromChunk(chunk string) (chatUsage, bool) {
	if chunk == "" || chunk == "[DONE]" {
		return chatUsage{}, false
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(chunk), &payload); err != nil {
		return chatUsage{}, false
	}
	return extractUsageFromMap(payload)
}

func extractUsageFromMap(payload map[string]any) (chatUsage, bool) {
	usageRaw, ok := payload["usage"].(map[string]any)
	if !ok {
		return chatUsage{}, false
	}

	return chatUsage{
		PromptTokens:     jsonInt(usageRaw, "prompt_tokens"),
		CompletionTokens: jsonInt(usageRaw, "completion_tokens"),
	}, true
}

func extractSSEDataLine(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "data:") {
		return "", false
	}
	data := strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
	if data == "" {
		return "", false
	}
	return data, true
}

func jsonInt(source map[string]any, key string) int {
	value, ok := source[key]
	if !ok {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		i64, err := typed.Int64()
		if err == nil {
			return int(i64)
		}
	}
	return 0
}

func isTimeoutError(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	return false
}

func writeUpstreamResponse(w http.ResponseWriter, status int, contentType string, body []byte) {
	if strings.TrimSpace(contentType) == "" {
		contentType = "application/json"
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeAPIError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func decodeJSON(r *http.Request, dest any) error {
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(dest); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}
