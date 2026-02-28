package coordinator

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/agentteams/api/channels"
)

// Bridge routes inbound channel messages into coordinator swarm runs.
type Bridge struct {
	handler     *Handler
	httpClient  *http.Client
	llmProxyURL string
	model       string
}

func NewBridge(handler *Handler) *Bridge {
	return &Bridge{
		handler:     handler,
		httpClient:  &http.Client{Timeout: 30 * time.Second},
		llmProxyURL: resolveLLMProxyURL(),
		model:       resolveModel(),
	}
}

// HandleChannelMessage decides whether inbound channel traffic should trigger the agent swarm.
func (b *Bridge) HandleChannelMessage(ctx context.Context, req channels.AgentTaskRequest) (channels.AgentTaskResult, error) {
	task, triggerType, ok := parseExplicitCommand(req.Content)
	if !ok {
		classifiedTask, classified := b.classifyTask(ctx, req)
		if !classified {
			return channels.AgentTaskResult{}, nil
		}
		task = classifiedTask
		triggerType = "classifier"
	}

	channelCtx := &ChannelContext{
		Channel:        req.Channel,
		ConversationID: req.ConversationID,
		Metadata:       copyMetadata(req.Metadata),
		UserID:         strings.TrimSpace(req.Metadata["user_id"]),
		UserName:       strings.TrimSpace(req.Metadata["user_name"]),
		ThreadID:       strings.TrimSpace(req.Metadata["thread_id"]),
	}
	if channelCtx.UserID == "" {
		channelCtx.UserID = strings.TrimSpace(req.Metadata["channel_user_id"])
	}

	run, err := b.handler.StartRun(ctx, req.TenantID, RunRequest{
		Task:           task,
		TriggerType:    triggerType,
		ChannelContext: channelCtx,
	})
	if err != nil {
		return channels.AgentTaskResult{}, err
	}

	ack := fmt.Sprintf("Agent swarm started (`%s`). I will stream progress updates here.", run.RunID)
	return channels.AgentTaskResult{
		Accepted: true,
		Ack:      ack,
		RunID:    run.RunID,
	}, nil
}

func parseExplicitCommand(content string) (task, triggerType string, ok bool) {
	trimmed := strings.TrimSpace(content)
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "/agent run ") {
		return strings.TrimSpace(trimmed[len("/agent run "):]), "command", true
	}
	if strings.HasPrefix(lower, "/agent ") {
		return strings.TrimSpace(trimmed[len("/agent "):]), "command", true
	}
	return "", "", false
}

func (b *Bridge) classifyTask(ctx context.Context, req channels.AgentTaskRequest) (string, bool) {
	if strings.TrimSpace(b.llmProxyURL) == "" {
		return heuristicClassification(req.Content)
	}

	task, ok := b.classifyWithLLM(ctx, req)
	if ok {
		return task, true
	}
	return heuristicClassification(req.Content)
}

func (b *Bridge) classifyWithLLM(ctx context.Context, req channels.AgentTaskRequest) (string, bool) {
	type llmMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	prompt := "Decide whether this message should trigger an autonomous multi-step agent swarm. Return strict JSON: {\"trigger\":true|false,\"task\":\"...\"}. Set trigger=true only when the user asks for delegated execution."

	payload, err := json.Marshal(map[string]any{
		"model": b.model,
		"messages": []llmMessage{
			{Role: "system", Content: prompt},
			{Role: "user", Content: req.Content},
		},
	})
	if err != nil {
		return "", false
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, b.llmProxyURL, bytes.NewReader(payload))
	if err != nil {
		return "", false
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Tenant-ID", req.TenantID)
	if serviceKey := strings.TrimSpace(os.Getenv("SERVICE_API_KEY")); serviceKey != "" {
		httpReq.Header.Set("X-Service-API-Key", serviceKey)
	}

	resp, err := b.httpClient.Do(httpReq)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode >= http.StatusBadRequest {
		return "", false
	}

	var completion struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &completion); err != nil || len(completion.Choices) == 0 {
		return "", false
	}

	content := strings.TrimSpace(completion.Choices[0].Message.Content)
	if content == "" {
		return "", false
	}

	var parsed struct {
		Trigger bool   `json:"trigger"`
		Task    string `json:"task"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		start := strings.Index(content, "{")
		end := strings.LastIndex(content, "}")
		if start < 0 || end <= start {
			return "", false
		}
		if err := json.Unmarshal([]byte(content[start:end+1]), &parsed); err != nil {
			return "", false
		}
	}
	if !parsed.Trigger {
		return "", false
	}
	task := strings.TrimSpace(parsed.Task)
	if task == "" {
		task = strings.TrimSpace(req.Content)
	}
	return task, true
}

func heuristicClassification(content string) (string, bool) {
	trimmed := strings.TrimSpace(content)
	lower := strings.ToLower(trimmed)
	keywords := []string{
		"run an agent",
		"use agents",
		"delegate this",
		"break this down",
		"multi-step",
		"swarm",
	}
	for _, keyword := range keywords {
		if strings.Contains(lower, keyword) {
			return trimmed, true
		}
	}
	return "", false
}

func copyMetadata(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]string, len(input))
	for k, v := range input {
		out[k] = v
	}
	return out
}

func resolveLLMProxyURL() string {
	base := strings.TrimSpace(os.Getenv("LLM_PROXY_URL"))
	if base == "" {
		base = "http://localhost:8080"
	}
	base = strings.TrimRight(base, "/")
	if strings.HasSuffix(base, "/v1/chat/completions") {
		return base
	}
	if strings.HasSuffix(base, "/v1") {
		return base + "/chat/completions"
	}
	return base + "/v1/chat/completions"
}

func resolveModel() string {
	model := strings.TrimSpace(os.Getenv("LLM_MODEL"))
	if model == "" {
		return "gpt-4o-mini"
	}
	return model
}
