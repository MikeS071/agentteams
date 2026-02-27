package channels

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// InboundMessage is a normalized message payload entering the channel router.
type InboundMessage struct {
	TenantID string            `json:"tenant_id"`
	Content  string            `json:"content"`
	Channel  string            `json:"channel"`
	Metadata map[string]string `json:"metadata"`
}

// OutboundMessage is the assistant response returned by the channel router.
type OutboundMessage struct {
	TenantID       string `json:"tenant_id"`
	Content        string `json:"content"`
	Channel        string `json:"channel"`
	ConversationID string `json:"conversation_id"`
}

// Router is the central inbound -> assistant -> outbound channel pipeline.
type Router struct {
	db          *sql.DB
	redis       *redis.Client
	httpClient  *http.Client
	llmProxyURL string
	model       string
}

func NewRouter(db *sql.DB, redisClient *redis.Client) *Router {
	return &Router{
		db:          db,
		redis:       redisClient,
		httpClient:  &http.Client{Timeout: 120 * time.Second},
		llmProxyURL: resolveLLMProxyURL(),
		model:       resolveModel(),
	}
}

// Route normalizes, persists, executes, persists response, publishes, and returns outbound payload.
func (r *Router) Route(ctx context.Context, msg InboundMessage) (OutboundMessage, error) {
	normalized, err := normalizeInbound(msg)
	if err != nil {
		return OutboundMessage{}, err
	}

	conversationID, err := r.saveInbound(ctx, normalized)
	if err != nil {
		return OutboundMessage{}, err
	}

	assistantContent, err := r.generateAssistantResponse(ctx, normalized.TenantID, conversationID)
	if err != nil {
		return OutboundMessage{}, err
	}

	if err := r.saveAssistant(ctx, conversationID, normalized.Channel, assistantContent); err != nil {
		return OutboundMessage{}, err
	}

	out := OutboundMessage{
		TenantID:       normalized.TenantID,
		Content:        assistantContent,
		Channel:        normalized.Channel,
		ConversationID: conversationID,
	}

	if err := r.publishResponse(ctx, out); err != nil {
		return OutboundMessage{}, err
	}

	return out, nil
}

func normalizeInbound(msg InboundMessage) (InboundMessage, error) {
	msg.TenantID = strings.TrimSpace(msg.TenantID)
	msg.Content = strings.TrimSpace(msg.Content)
	if msg.TenantID == "" {
		return InboundMessage{}, errors.New("tenant id is required")
	}
	if msg.Content == "" {
		return InboundMessage{}, errors.New("content is required")
	}

	channel, err := normalizeChannel(msg.Channel)
	if err != nil {
		return InboundMessage{}, err
	}
	msg.Channel = channel

	if msg.Metadata == nil {
		msg.Metadata = map[string]string{}
	}

	normalizedMetadata := make(map[string]string, len(msg.Metadata))
	for k, v := range msg.Metadata {
		key := strings.TrimSpace(k)
		if key == "" {
			continue
		}
		normalizedMetadata[key] = strings.TrimSpace(v)
	}
	msg.Metadata = normalizedMetadata
	return msg, nil
}

func (r *Router) saveInbound(ctx context.Context, msg InboundMessage) (string, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	conversationID, err := resolveConversationID(ctx, tx, msg.TenantID, msg.Metadata)
	if err != nil {
		return "", err
	}

	metadataJSON, err := json.Marshal(msg.Metadata)
	if err != nil {
		return "", fmt.Errorf("marshal metadata: %w", err)
	}

	_, err = tx.ExecContext(ctx,
		`INSERT INTO messages (conversation_id, role, content, channel, metadata)
		 VALUES ($1, 'user', $2, $3, $4::jsonb)`,
		conversationID,
		msg.Content,
		msg.Channel,
		metadataJSON,
	)
	if err != nil {
		return "", fmt.Errorf("insert user message: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit transaction: %w", err)
	}
	return conversationID, nil
}

func resolveConversationID(ctx context.Context, tx *sql.Tx, tenantID string, metadata map[string]string) (string, error) {
	if conversationID := conversationIDFromMetadata(metadata); conversationID != "" {
		var existing string
		err := tx.QueryRowContext(ctx,
			"SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2",
			conversationID,
			tenantID,
		).Scan(&existing)
		if err == sql.ErrNoRows {
			return "", errors.New("conversation not found")
		}
		if err != nil {
			return "", fmt.Errorf("query conversation: %w", err)
		}
		return existing, nil
	}

	var created string
	err := tx.QueryRowContext(ctx,
		"INSERT INTO conversations (tenant_id) VALUES ($1) RETURNING id",
		tenantID,
	).Scan(&created)
	if err != nil {
		return "", fmt.Errorf("create conversation: %w", err)
	}
	return created, nil
}

func conversationIDFromMetadata(metadata map[string]string) string {
	if metadata == nil {
		return ""
	}
	if conversationID := strings.TrimSpace(metadata["conversation_id"]); conversationID != "" {
		return conversationID
	}
	return strings.TrimSpace(metadata["conversationId"])
}

func (r *Router) generateAssistantResponse(ctx context.Context, tenantID, conversationID string) (string, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT role, content
		 FROM (
		   SELECT role, content, created_at
		   FROM messages
		   WHERE conversation_id = $1
		   ORDER BY created_at DESC
		   LIMIT 50
		 ) recent
		 ORDER BY created_at ASC`,
		conversationID,
	)
	if err != nil {
		return "", fmt.Errorf("load context messages: %w", err)
	}
	defer rows.Close()

	type llmMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	messages := make([]llmMessage, 0, 50)
	for rows.Next() {
		var role, content string
		if err := rows.Scan(&role, &content); err != nil {
			return "", fmt.Errorf("scan context message: %w", err)
		}
		messages = append(messages, llmMessage{Role: role, Content: content})
	}
	if err := rows.Err(); err != nil {
		return "", fmt.Errorf("iterate context messages: %w", err)
	}
	if len(messages) == 0 {
		return "", errors.New("no conversation context available")
	}

	payloadBody, err := json.Marshal(map[string]any{
		"model":    r.model,
		"messages": messages,
	})
	if err != nil {
		return "", fmt.Errorf("marshal llm payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.llmProxyURL, bytes.NewReader(payloadBody))
	if err != nil {
		return "", fmt.Errorf("build llm request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-ID", tenantID)

	resp, err := r.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("llm proxy request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read llm response: %w", err)
	}

	if resp.StatusCode >= http.StatusBadRequest {
		return "", fmt.Errorf("llm proxy returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var completion struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &completion); err != nil {
		return "", fmt.Errorf("decode llm response: %w", err)
	}

	assistantContent := strings.TrimSpace("")
	if len(completion.Choices) > 0 {
		assistantContent = strings.TrimSpace(completion.Choices[0].Message.Content)
	}
	if assistantContent == "" {
		return "", errors.New("llm proxy returned empty response")
	}
	return assistantContent, nil
}

func (r *Router) saveAssistant(ctx context.Context, conversationID, channel, content string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO messages (conversation_id, role, content, channel)
		 VALUES ($1, 'assistant', $2, $3)`,
		conversationID,
		content,
		channel,
	)
	if err != nil {
		return fmt.Errorf("insert assistant message: %w", err)
	}
	return nil
}

func (r *Router) publishResponse(ctx context.Context, out OutboundMessage) error {
	if r.redis == nil {
		return errors.New("redis is not configured")
	}

	payload, err := json.Marshal(out)
	if err != nil {
		return fmt.Errorf("marshal outbound message: %w", err)
	}

	topic := fmt.Sprintf("tenant:%s:response", out.TenantID)
	if err := r.redis.Publish(ctx, topic, payload).Err(); err != nil {
		return fmt.Errorf("publish outbound message: %w", err)
	}
	return nil
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
