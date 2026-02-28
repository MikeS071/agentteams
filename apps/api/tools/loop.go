package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

// Message is an OpenAI-format message for the tool loop.
type Message struct {
	Role       string          `json:"role"`
	Content    any             `json:"content,omitempty"`
	ToolCalls  []ToolCall      `json:"tool_calls,omitempty"`
	ToolCallID string          `json:"tool_call_id,omitempty"`
}

// LoopConfig controls the tool-calling loop behavior.
type LoopConfig struct {
	LLMProxyURL   string  // unused now, kept for interface compat
	Model         string
	TenantID      string
	ServiceAPIKey string
	MaxIterations int
	HTTPClient    *http.Client
}

// RunToolLoop calls the upstream LLM (OpenAI) directly with tool definitions,
// handling the tool-call loop until the model produces a final text response.
func RunToolLoop(ctx context.Context, reg *Registry, cfg LoopConfig, messages []Message, agentTools []Tool) (string, error) {
	if cfg.MaxIterations <= 0 {
		cfg.MaxIterations = 15
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 120 * time.Second}
	}

	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		return "", fmt.Errorf("OPENAI_API_KEY not set — required for tool-calling agents")
	}

	// Map our model to OpenAI model name
	model := mapModel(cfg.Model)

	for i := 0; i < cfg.MaxIterations; i++ {
		payload := map[string]any{
			"model":    model,
			"messages": messages,
		}
		if len(agentTools) > 0 {
			payload["tools"] = agentTools
			payload["tool_choice"] = "auto"
		}

		body, err := json.Marshal(payload)
		if err != nil {
			return "", fmt.Errorf("marshal payload: %w", err)
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.openai.com/v1/chat/completions", bytes.NewReader(body))
		if err != nil {
			return "", fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := cfg.HTTPClient.Do(req)
		if err != nil {
			return "", fmt.Errorf("openai request: %w", err)
		}

		respBody, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return "", fmt.Errorf("read response: %w", err)
		}

		if resp.StatusCode >= 400 {
			return "", fmt.Errorf("openai returned %d: %s", resp.StatusCode, truncate(string(respBody), 500))
		}

		var completion struct {
			Choices []struct {
				Message struct {
					Role      string     `json:"role"`
					Content   *string    `json:"content"`
					ToolCalls []ToolCall `json:"tool_calls"`
				} `json:"message"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(respBody, &completion); err != nil {
			return "", fmt.Errorf("parse response: %w", err)
		}

		if len(completion.Choices) == 0 {
			return "", fmt.Errorf("no choices in response")
		}

		choice := completion.Choices[0]

		// If no tool calls, we're done
		if len(choice.Message.ToolCalls) == 0 {
			content := ""
			if choice.Message.Content != nil {
				content = *choice.Message.Content
			}
			slog.Info("tool loop complete", "iterations", i+1, "agent", cfg.TenantID)
			return strings.TrimSpace(content), nil
		}

		// Append the assistant message with tool calls (content may be null)
		assistantMsg := Message{
			Role:      "assistant",
			ToolCalls: choice.Message.ToolCalls,
		}
		if choice.Message.Content != nil {
			assistantMsg.Content = *choice.Message.Content
		}
		messages = append(messages, assistantMsg)

		// Execute each tool call
		for _, tc := range choice.Message.ToolCalls {
			slog.Info("executing tool", "tool", tc.Function.Name, "iteration", i+1)

			result, err := reg.Execute(ctx, tc.Function.Name, json.RawMessage(tc.Function.Arguments))
			if err != nil {
				result = fmt.Sprintf("Error: %s", err.Error())
				slog.Warn("tool failed", "tool", tc.Function.Name, "error", err)
			}

			// Truncate large results
			if len(result) > 15000 {
				result = result[:15000] + "\n\n[...truncated]"
			}

			messages = append(messages, Message{
				Role:       "tool",
				ToolCallID: tc.ID,
				Content:    result,
			})
		}

		slog.Info("tool loop", "iteration", i+1, "calls", len(choice.Message.ToolCalls))
	}

	return "Reached maximum research iterations. Here's what I found so far.", nil
}

func mapModel(model string) string {
	// Map internal model names to OpenAI API model names
	switch {
	case strings.Contains(model, "gpt-4o-mini"):
		return "gpt-4o-mini"
	case strings.Contains(model, "gpt-4o"):
		return "gpt-4o"
	default:
		return "gpt-4o" // Default to gpt-4o for tool calling
	}
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}
