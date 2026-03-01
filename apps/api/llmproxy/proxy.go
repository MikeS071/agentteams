package llmproxy

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/agentsquads/api/orchestrator"
)

// Proxy is the LLM proxy handler.
type Proxy struct {
	DB       *sql.DB
	Orch     orchestrator.TenantOrchestrator
	Registry *ModelRegistry
	Client   *http.Client
}

// NewProxy creates a new LLM proxy.
func NewProxy(db *sql.DB, reg *ModelRegistry, orch orchestrator.TenantOrchestrator) *Proxy {
	return &Proxy{
		DB:       db,
		Orch:     orch,
		Registry: reg,
		Client:   &http.Client{Timeout: 120 * time.Second},
	}
}

// Mount registers all proxy routes on the given mux.
func (p *Proxy) Mount(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/chat/completions", p.handleChatCompletions)
	mux.HandleFunc("GET /v1/models", p.handleListModels)
}

// OpenAI-compatible request/response types.
type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature *float64      `json:"temperature,omitempty"`
	MaxTokens   *int          `json:"max_tokens,omitempty"`
	Stream      bool          `json:"stream,omitempty"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResponse struct {
	ID      string       `json:"id"`
	Object  string       `json:"object"`
	Model   string       `json:"model"`
	Choices []chatChoice `json:"choices"`
	Usage   *usageInfo   `json:"usage,omitempty"`
}

type chatChoice struct {
	Index        int         `json:"index"`
	Message      chatMessage `json:"message"`
	FinishReason string      `json:"finish_reason"`
}

type usageInfo struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

func (p *Proxy) handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		writeError(w, http.StatusUnauthorized, "missing X-Tenant-ID header")
		return
	}
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		writeError(w, http.StatusUnauthorized, "invalid X-Tenant-ID header")
		return
	}

	// Parse request
	var req chatRequest
	if err := decodeJSONStrict(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Model = strings.TrimSpace(req.Model)
	if req.Model == "" {
		writeError(w, http.StatusBadRequest, "model is required")
		return
	}
	if len(req.Messages) == 0 {
		writeError(w, http.StatusBadRequest, "messages are required")
		return
	}
	if len(req.Messages) > 100 {
		writeError(w, http.StatusBadRequest, "too many messages")
		return
	}
	for _, msg := range req.Messages {
		if strings.TrimSpace(msg.Role) == "" || strings.TrimSpace(msg.Content) == "" {
			writeError(w, http.StatusBadRequest, "messages must include role and content")
			return
		}
	}

	// Look up model
	model, err := p.Registry.GetModel(req.Model)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	upstreamModel := resolveProviderModelID(model)
	if upstreamModel == "" {
		writeError(w, http.StatusBadRequest, "invalid model id: "+model.ID)
		return
	}
	req.Model = upstreamModel

	// Credit check
	balance, err := CheckCredits(p.DB, tenantID)
	if err != nil {
		slog.Error("credit check failed", "err", err)
		writeError(w, http.StatusInternalServerError, "billing error")
		return
	}
	if balance <= 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusPaymentRequired)
		json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"message": "Insufficient credits",
				"type":    "billing_error",
			},
		})
		return
	}

	// Route to provider
	var inputTokens, outputTokens int
	var respBody []byte

	switch model.Provider {
	case "openai":
		respBody, inputTokens, outputTokens, err = p.proxyOpenAI(req)
	case "anthropic":
		respBody, inputTokens, outputTokens, err = p.proxyAnthropic(req)
	case "google":
		respBody, inputTokens, outputTokens, err = p.proxyGemini(req)
	default:
		writeError(w, http.StatusBadRequest, "unsupported provider: "+model.Provider)
		return
	}

	if err != nil {
		slog.Error("upstream error", "provider", model.Provider, "err", err)
		writeError(w, http.StatusBadGateway, "upstream error: "+err.Error())
		return
	}

	// Bill
	costCents := CalcCostCents(model, inputTokens, outputTokens)
	if err := BillUsage(p.DB, tenantID, model.ID, inputTokens, outputTokens, costCents); err != nil {
		slog.Error("billing failed", "err", err)
		// Still return the response — billing is best-effort
	} else {
		remainingBalance, err := CheckCredits(p.DB, tenantID)
		if err != nil {
			slog.Error("post-billing credit check failed", "tenant", tenantID, "err", err)
		} else if remainingBalance <= 0 {
			if err := PauseTenant(p.DB, p.Orch, tenantID); err != nil {
				slog.Error("tenant auto-pause failed", "tenant", tenantID, "err", err)
			} else {
				slog.Info(fmt.Sprintf("tenant %s auto-paused: credits exhausted", tenantID))
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(respBody)
}

// proxyOpenAI forwards directly to OpenAI (already compatible format).
func (p *Proxy) proxyOpenAI(req chatRequest) ([]byte, int, int, error) {
	body, _ := json.Marshal(req)
	httpReq, _ := http.NewRequest("POST", "https://api.openai.com/v1/chat/completions", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+os.Getenv("OPENAI_API_KEY"))

	resp, err := p.Client.Do(httpReq)
	if err != nil {
		return nil, 0, 0, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return nil, 0, 0, fmt.Errorf("openai returned %d: %s", resp.StatusCode, string(respBody))
	}

	var parsed map[string]any
	json.Unmarshal(respBody, &parsed)
	input, output := ExtractOpenAIUsage(parsed)
	return respBody, input, output, nil
}

// proxyAnthropic translates to/from Anthropic Messages API.
func (p *Proxy) proxyAnthropic(req chatRequest) ([]byte, int, int, error) {
	// Build Anthropic request
	antReq := map[string]any{
		"model":      req.Model,
		"max_tokens": 4096,
	}
	if req.MaxTokens != nil {
		antReq["max_tokens"] = *req.MaxTokens
	}
	if req.Temperature != nil {
		antReq["temperature"] = *req.Temperature
	}

	// Separate system message
	var messages []map[string]string
	for _, m := range req.Messages {
		if m.Role == "system" {
			antReq["system"] = m.Content
		} else {
			messages = append(messages, map[string]string{"role": m.Role, "content": m.Content})
		}
	}
	antReq["messages"] = messages

	body, _ := json.Marshal(antReq)
	httpReq, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", os.Getenv("ANTHROPIC_API_KEY"))
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	resp, err := p.Client.Do(httpReq)
	if err != nil {
		return nil, 0, 0, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return nil, 0, 0, fmt.Errorf("anthropic returned %d: %s", resp.StatusCode, string(respBody))
	}

	// Parse and translate to OpenAI format
	var antResp map[string]any
	json.Unmarshal(respBody, &antResp)
	input, output := ExtractAnthropicUsage(antResp)

	// Extract text content
	content := ""
	if contentArr, ok := antResp["content"].([]any); ok && len(contentArr) > 0 {
		if block, ok := contentArr[0].(map[string]any); ok {
			content, _ = block["text"].(string)
		}
	}

	finishReason := "stop"
	if sr, ok := antResp["stop_reason"].(string); ok {
		switch sr {
		case "end_turn":
			finishReason = "stop"
		case "max_tokens":
			finishReason = "length"
		default:
			finishReason = sr
		}
	}

	oaiResp := chatResponse{
		ID:     fmt.Sprintf("chatcmpl-%v", antResp["id"]),
		Object: "chat.completion",
		Model:  req.Model,
		Choices: []chatChoice{{
			Index:        0,
			Message:      chatMessage{Role: "assistant", Content: content},
			FinishReason: finishReason,
		}},
		Usage: &usageInfo{
			PromptTokens:     input,
			CompletionTokens: output,
			TotalTokens:      input + output,
		},
	}
	out, _ := json.Marshal(oaiResp)
	return out, input, output, nil
}

// proxyGemini translates to/from Gemini generateContent API.
func (p *Proxy) proxyGemini(req chatRequest) ([]byte, int, int, error) {
	gemReq := map[string]any{}

	var contents []map[string]any
	for _, m := range req.Messages {
		if m.Role == "system" {
			gemReq["systemInstruction"] = map[string]any{
				"parts": []map[string]string{{"text": m.Content}},
			}
			continue
		}
		role := m.Role
		if role == "assistant" {
			role = "model"
		}
		contents = append(contents, map[string]any{
			"role":  role,
			"parts": []map[string]string{{"text": m.Content}},
		})
	}
	gemReq["contents"] = contents

	if req.Temperature != nil {
		gemReq["generationConfig"] = map[string]any{"temperature": *req.Temperature}
	}

	apiKey := os.Getenv("GOOGLE_AI_API_KEY")
	// Map model ID to Gemini model name
	modelName := req.Model
	if !strings.HasPrefix(modelName, "models/") {
		modelName = "models/" + modelName
	}
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/%s:generateContent?key=%s", modelName, apiKey)

	body, _ := json.Marshal(gemReq)
	httpReq, _ := http.NewRequest("POST", url, bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.Client.Do(httpReq)
	if err != nil {
		return nil, 0, 0, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return nil, 0, 0, fmt.Errorf("gemini returned %d: %s", resp.StatusCode, string(respBody))
	}

	var gemResp map[string]any
	json.Unmarshal(respBody, &gemResp)
	input, output := ExtractGeminiUsage(gemResp)

	// Extract text
	content := ""
	if candidates, ok := gemResp["candidates"].([]any); ok && len(candidates) > 0 {
		if c, ok := candidates[0].(map[string]any); ok {
			if ct, ok := c["content"].(map[string]any); ok {
				if parts, ok := ct["parts"].([]any); ok && len(parts) > 0 {
					if part, ok := parts[0].(map[string]any); ok {
						content, _ = part["text"].(string)
					}
				}
			}
		}
	}

	oaiResp := chatResponse{
		ID:     "chatcmpl-gemini",
		Object: "chat.completion",
		Model:  req.Model,
		Choices: []chatChoice{{
			Index:        0,
			Message:      chatMessage{Role: "assistant", Content: content},
			FinishReason: "stop",
		}},
		Usage: &usageInfo{
			PromptTokens:     input,
			CompletionTokens: output,
			TotalTokens:      input + output,
		},
	}
	out, _ := json.Marshal(oaiResp)
	return out, input, output, nil
}

func (p *Proxy) handleListModels(w http.ResponseWriter, r *http.Request) {
	models := p.Registry.ListModels()
	data := make([]map[string]any, len(models))
	for i, m := range models {
		data[i] = map[string]any{
			"id":       m.ID,
			"object":   "model",
			"owned_by": m.Provider,
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"object": "list",
		"data":   data,
	})
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"message": msg,
			"type":    "invalid_request_error",
		},
	})
}

func decodeJSONStrict(r *http.Request, dst any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}

func resolveProviderModelID(model *Model) string {
	candidate := strings.TrimSpace(model.ID)
	if candidate == "" {
		candidate = strings.TrimSpace(model.Name)
	}
	if candidate == "" {
		return ""
	}

	provider := strings.TrimSpace(model.Provider)
	if provider != "" {
		prefix := provider + "/"
		if strings.HasPrefix(candidate, prefix) {
			return strings.TrimPrefix(candidate, prefix)
		}
	}

	if idx := strings.Index(candidate, "/"); idx > 0 && idx < len(candidate)-1 {
		return candidate[idx+1:]
	}

	return candidate
}
