package adapters

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/agentteams/api/channels"
)

const (
	whatsAppAPIVersion = "v21.0"
)

type WhatsAppAdapter struct {
	db         *sql.DB
	router     *channels.Router
	links      *channels.LinkStore
	httpClient *http.Client
	log        *slog.Logger
}

func NewWhatsAppAdapter(db *sql.DB, router *channels.Router, links *channels.LinkStore) *WhatsAppAdapter {
	return &WhatsAppAdapter{
		db:         db,
		router:     router,
		links:      links,
		httpClient: &http.Client{Timeout: 20 * time.Second},
		log:        slog.Default().With("component", "channels.whatsapp"),
	}
}

func (a *WhatsAppAdapter) Channel() string {
	return "whatsapp"
}

func (a *WhatsAppAdapter) Connect(ctx context.Context, tenantID, phoneNumberID, accessToken, verifyToken string) error {
	tenantID = strings.TrimSpace(tenantID)
	phoneNumberID = strings.TrimSpace(phoneNumberID)
	accessToken = strings.TrimSpace(accessToken)
	verifyToken = strings.TrimSpace(verifyToken)

	if tenantID == "" {
		return errors.New("tenant id is required")
	}
	if phoneNumberID == "" {
		return errors.New("phone number id is required")
	}
	if accessToken == "" {
		return errors.New("access token is required")
	}
	if verifyToken == "" {
		return errors.New("verify token is required")
	}

	if err := a.links.LinkChannel(tenantID, "whatsapp", phoneNumberID); err != nil {
		return err
	}

	configJSON, err := json.Marshal(map[string]string{
		"phone_number_id":  phoneNumberID,
		"access_token":     accessToken,
		"verify_token":     verifyToken,
		"webhook_verified": "false",
	})
	if err != nil {
		return fmt.Errorf("marshal whatsapp config: %w", err)
	}

	_, err = a.db.ExecContext(ctx,
		`UPDATE tenant_channels
		 SET config = COALESCE(config, '{}'::jsonb) || $1::jsonb,
		     muted = FALSE,
		     linked_at = NOW()
		 WHERE tenant_id = $2 AND channel = 'whatsapp'`,
		string(configJSON),
		tenantID,
	)
	if err != nil {
		return fmt.Errorf("save whatsapp config: %w", err)
	}
	return nil
}

func (a *WhatsAppAdapter) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		a.handleWebhookVerification(w, r)
	case http.MethodPost:
		a.handleWebhookEvent(w, r)
	default:
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *WhatsAppAdapter) Send(ctx context.Context, _ channels.TenantChannel, msg channels.OutboundMessage) error {
	recipient, err := a.resolveConversationRecipient(ctx, msg.ConversationID)
	if err != nil {
		return err
	}

	phoneNumberID, accessToken, err := a.resolveCredentials(ctx, msg.TenantID)
	if err != nil {
		return err
	}

	payloadBody, err := json.Marshal(map[string]any{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                recipient,
		"type":              "text",
		"text": map[string]any{
			"preview_url": false,
			"body":        msg.Content,
		},
	})
	if err != nil {
		return fmt.Errorf("marshal whatsapp send payload: %w", err)
	}

	url := fmt.Sprintf("https://graph.facebook.com/%s/%s/messages", whatsAppAPIVersion, phoneNumberID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payloadBody))
	if err != nil {
		return fmt.Errorf("build whatsapp send request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send whatsapp message: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read whatsapp send response: %w", err)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("whatsapp api returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var sendResp struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(body, &sendResp); err != nil {
		return fmt.Errorf("decode whatsapp send response: %w", err)
	}
	if len(sendResp.Messages) == 0 || strings.TrimSpace(sendResp.Messages[0].ID) == "" {
		return errors.New("whatsapp api returned empty message id")
	}

	return a.mergeLatestAssistantMetadata(ctx, msg.ConversationID, map[string]string{
		"whatsapp_message_id": sendResp.Messages[0].ID,
		"whatsapp_status":     "sent",
		"whatsapp_recipient":  recipient,
		"whatsapp_phone_id":   phoneNumberID,
		"whatsapp_sent_at":    time.Now().UTC().Format(time.RFC3339),
	})
}

func (a *WhatsAppAdapter) handleWebhookVerification(w http.ResponseWriter, r *http.Request) {
	mode := strings.TrimSpace(r.URL.Query().Get("hub.mode"))
	verifyToken := strings.TrimSpace(r.URL.Query().Get("hub.verify_token"))
	challenge := strings.TrimSpace(r.URL.Query().Get("hub.challenge"))
	if mode != "subscribe" || verifyToken == "" || challenge == "" {
		http.Error(w, "verification failed", http.StatusForbidden)
		return
	}

	tenantID, err := a.resolveTenantByVerifyToken(r.Context(), verifyToken)
	if err != nil {
		a.log.Warn("whatsapp verification failed", "err", err)
		http.Error(w, "verification failed", http.StatusForbidden)
		return
	}

	if err := a.updateTenantChannelConfig(r.Context(), tenantID, map[string]string{
		"webhook_verified":    "true",
		"webhook_verified_at": time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		a.log.Error("failed to persist whatsapp verification status", "tenant", tenantID, "err", err)
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(challenge))
}

func (a *WhatsAppAdapter) handleWebhookEvent(w http.ResponseWriter, r *http.Request) {
	var payload webhookPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if payload.Object != "whatsapp_business_account" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ignored"})
		return
	}

	ctx := r.Context()
	for _, entry := range payload.Entry {
		for _, change := range entry.Changes {
			if change.Field != "messages" {
				continue
			}

			phoneNumberID := strings.TrimSpace(change.Value.Metadata.PhoneNumberID)
			if phoneNumberID == "" {
				continue
			}

			tenantID, err := a.resolveTenantByPhoneNumberID(ctx, phoneNumberID)
			if err != nil {
				a.log.Warn("failed to resolve tenant for webhook", "phone_number_id", phoneNumberID, "err", err)
				continue
			}

			contactNames := make(map[string]string, len(change.Value.Contacts))
			for _, contact := range change.Value.Contacts {
				contactNames[strings.TrimSpace(contact.WAID)] = strings.TrimSpace(contact.Profile.Name)
			}

			for _, in := range change.Value.Messages {
				if err := a.handleIncomingMessage(ctx, tenantID, phoneNumberID, contactNames, in); err != nil {
					a.log.Error("failed to process inbound whatsapp message", "tenant", tenantID, "err", err)
				}
			}

			for _, status := range change.Value.Statuses {
				if err := a.handleStatusUpdate(ctx, status); err != nil {
					a.log.Error("failed to process whatsapp status", "tenant", tenantID, "err", err)
				}
				_ = a.updateTenantChannelConfig(ctx, tenantID, map[string]string{
					"last_status": status.Status,
				})
			}

			_ = a.updateTenantChannelConfig(ctx, tenantID, map[string]string{
				"last_webhook_at": time.Now().UTC().Format(time.RFC3339),
			})
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *WhatsAppAdapter) handleIncomingMessage(
	ctx context.Context,
	tenantID string,
	phoneNumberID string,
	contactNames map[string]string,
	message webhookMessage,
) error {
	content, mediaType, mediaID := extractInboundContent(message)
	if content == "" {
		return nil
	}

	metadata := map[string]string{
		"whatsapp_message_id":      strings.TrimSpace(message.ID),
		"whatsapp_from":            strings.TrimSpace(message.From),
		"channel_user_id":          strings.TrimSpace(message.From),
		"whatsapp_phone_number_id": phoneNumberID,
	}
	if mediaType != "" {
		metadata["whatsapp_media_type"] = mediaType
	}
	if mediaID != "" {
		metadata["whatsapp_media_id"] = mediaID
	}
	if profileName := strings.TrimSpace(contactNames[strings.TrimSpace(message.From)]); profileName != "" {
		metadata["whatsapp_profile_name"] = profileName
	}

	contextMessageID := strings.TrimSpace(message.Context.ID)
	if contextMessageID != "" {
		metadata["whatsapp_context_id"] = contextMessageID
		conversationID, err := a.findConversationByWhatsAppMessageID(ctx, contextMessageID)
		if err != nil {
			return err
		}
		if conversationID != "" {
			metadata["conversation_id"] = conversationID
		}
	}

	_, err := a.router.Route(ctx, channels.InboundMessage{
		TenantID: tenantID,
		Content:  content,
		Channel:  "whatsapp",
		Metadata: metadata,
	})
	return err
}

func (a *WhatsAppAdapter) handleStatusUpdate(ctx context.Context, status webhookStatus) error {
	messageID := strings.TrimSpace(status.ID)
	if messageID == "" {
		return nil
	}

	if !isHandledStatus(status.Status) {
		return nil
	}

	metadata := map[string]string{
		"whatsapp_status":          status.Status,
		"whatsapp_status_at":       parseWhatsAppTimestamp(status.Timestamp),
		"whatsapp_recipient":       strings.TrimSpace(status.RecipientID),
		"whatsapp_conversation_id": strings.TrimSpace(status.Conversation.ID),
	}
	return a.mergeMessageMetadataByWhatsAppID(ctx, messageID, metadata)
}

func (a *WhatsAppAdapter) resolveTenantByVerifyToken(ctx context.Context, verifyToken string) (string, error) {
	var tenantID string
	err := a.db.QueryRowContext(ctx,
		`SELECT tenant_id::text
		 FROM tenant_channels
		 WHERE channel = 'whatsapp'
		   AND config->>'verify_token' = $1
		 ORDER BY linked_at DESC
		 LIMIT 1`,
		verifyToken,
	).Scan(&tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errors.New("verify token not found")
		}
		return "", fmt.Errorf("lookup verify token: %w", err)
	}
	return tenantID, nil
}

func (a *WhatsAppAdapter) resolveTenantByPhoneNumberID(ctx context.Context, phoneNumberID string) (string, error) {
	var tenantID string
	err := a.db.QueryRowContext(ctx,
		`SELECT tenant_id::text
		 FROM tenant_channels
		 WHERE channel = 'whatsapp'
		   AND channel_user_id = $1
		 ORDER BY linked_at DESC
		 LIMIT 1`,
		phoneNumberID,
	).Scan(&tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errors.New("phone number id is not linked")
		}
		return "", fmt.Errorf("lookup tenant by phone number id: %w", err)
	}
	return tenantID, nil
}

func (a *WhatsAppAdapter) resolveCredentials(ctx context.Context, tenantID string) (phoneNumberID string, accessToken string, err error) {
	var channelUserID string
	var configRaw []byte
	err = a.db.QueryRowContext(ctx,
		`SELECT COALESCE(channel_user_id, ''), COALESCE(config, '{}'::jsonb)
		 FROM tenant_channels
		 WHERE tenant_id = $1 AND channel = 'whatsapp'
		 LIMIT 1`,
		tenantID,
	).Scan(&channelUserID, &configRaw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", errors.New("whatsapp is not connected")
		}
		return "", "", fmt.Errorf("load whatsapp credentials: %w", err)
	}

	config := map[string]string{}
	if err := json.Unmarshal(configRaw, &config); err != nil {
		return "", "", fmt.Errorf("decode whatsapp config: %w", err)
	}

	phoneNumberID = strings.TrimSpace(channelUserID)
	if phoneNumberID == "" {
		phoneNumberID = strings.TrimSpace(config["phone_number_id"])
	}
	accessToken = strings.TrimSpace(config["access_token"])
	if phoneNumberID == "" || accessToken == "" {
		return "", "", errors.New("whatsapp credentials are incomplete")
	}
	return phoneNumberID, accessToken, nil
}

func (a *WhatsAppAdapter) resolveConversationRecipient(ctx context.Context, conversationID string) (string, error) {
	var recipient string
	err := a.db.QueryRowContext(ctx,
		`SELECT COALESCE(metadata->>'whatsapp_from', metadata->>'channel_user_id', '')
		 FROM messages
		 WHERE conversation_id = $1
		   AND role = 'user'
		   AND channel = 'whatsapp'
		 ORDER BY created_at DESC
		 LIMIT 1`,
		conversationID,
	).Scan(&recipient)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errors.New("whatsapp recipient not found for conversation")
		}
		return "", fmt.Errorf("load whatsapp recipient: %w", err)
	}

	recipient = strings.TrimSpace(recipient)
	if recipient == "" {
		return "", errors.New("whatsapp recipient is empty")
	}
	return recipient, nil
}

func (a *WhatsAppAdapter) findConversationByWhatsAppMessageID(ctx context.Context, whatsappMessageID string) (string, error) {
	var conversationID string
	err := a.db.QueryRowContext(ctx,
		`SELECT conversation_id::text
		 FROM messages
		 WHERE metadata->>'whatsapp_message_id' = $1
		 ORDER BY created_at DESC
		 LIMIT 1`,
		whatsappMessageID,
	).Scan(&conversationID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("find conversation by whatsapp message id: %w", err)
	}
	return conversationID, nil
}

func (a *WhatsAppAdapter) mergeLatestAssistantMetadata(ctx context.Context, conversationID string, metadata map[string]string) error {
	payload, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal assistant metadata: %w", err)
	}

	_, err = a.db.ExecContext(ctx,
		`UPDATE messages
		 SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
		 WHERE id = (
		   SELECT id
		   FROM messages
		   WHERE conversation_id = $2
		     AND role = 'assistant'
		     AND channel = 'whatsapp'
		   ORDER BY created_at DESC
		   LIMIT 1
		 )`,
		string(payload),
		conversationID,
	)
	if err != nil {
		return fmt.Errorf("update assistant whatsapp metadata: %w", err)
	}
	return nil
}

func (a *WhatsAppAdapter) mergeMessageMetadataByWhatsAppID(ctx context.Context, whatsappMessageID string, metadata map[string]string) error {
	payload, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal whatsapp status metadata: %w", err)
	}

	_, err = a.db.ExecContext(ctx,
		`UPDATE messages
		 SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
		 WHERE metadata->>'whatsapp_message_id' = $2`,
		string(payload),
		whatsappMessageID,
	)
	if err != nil {
		return fmt.Errorf("update whatsapp status metadata: %w", err)
	}
	return nil
}

func (a *WhatsAppAdapter) updateTenantChannelConfig(ctx context.Context, tenantID string, updates map[string]string) error {
	payload, err := json.Marshal(updates)
	if err != nil {
		return fmt.Errorf("marshal channel config update: %w", err)
	}

	_, err = a.db.ExecContext(ctx,
		`UPDATE tenant_channels
		 SET config = COALESCE(config, '{}'::jsonb) || $1::jsonb
		 WHERE tenant_id = $2
		   AND channel = 'whatsapp'`,
		string(payload),
		tenantID,
	)
	if err != nil {
		return fmt.Errorf("update whatsapp channel config: %w", err)
	}
	return nil
}

func parseWhatsAppTimestamp(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Now().UTC().Format(time.RFC3339)
	}
	seconds, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return time.Now().UTC().Format(time.RFC3339)
	}
	return time.Unix(seconds, 0).UTC().Format(time.RFC3339)
}

func isHandledStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "sent", "delivered", "read":
		return true
	default:
		return false
	}
}

func extractInboundContent(message webhookMessage) (content string, mediaType string, mediaID string) {
	switch strings.ToLower(strings.TrimSpace(message.Type)) {
	case "text":
		return strings.TrimSpace(message.Text.Body), "", ""
	case "image":
		caption := strings.TrimSpace(message.Image.Caption)
		if caption == "" {
			caption = "[image]"
		}
		return caption, "image", strings.TrimSpace(message.Image.ID)
	case "video":
		caption := strings.TrimSpace(message.Video.Caption)
		if caption == "" {
			caption = "[video]"
		}
		return caption, "video", strings.TrimSpace(message.Video.ID)
	case "audio":
		return "[audio]", "audio", strings.TrimSpace(message.Audio.ID)
	case "document":
		caption := strings.TrimSpace(message.Document.Caption)
		if caption == "" {
			caption = "[document]"
		}
		return caption, "document", strings.TrimSpace(message.Document.ID)
	default:
		return "", "", ""
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

type webhookPayload struct {
	Object string         `json:"object"`
	Entry  []webhookEntry `json:"entry"`
}

type webhookEntry struct {
	Changes []webhookChange `json:"changes"`
}

type webhookChange struct {
	Field string       `json:"field"`
	Value webhookValue `json:"value"`
}

type webhookValue struct {
	Metadata struct {
		PhoneNumberID string `json:"phone_number_id"`
	} `json:"metadata"`
	Contacts []struct {
		WAID    string `json:"wa_id"`
		Profile struct {
			Name string `json:"name"`
		} `json:"profile"`
	} `json:"contacts"`
	Messages []webhookMessage `json:"messages"`
	Statuses []webhookStatus  `json:"statuses"`
}

type webhookMessage struct {
	ID        string `json:"id"`
	From      string `json:"from"`
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
	Text      struct {
		Body string `json:"body"`
	} `json:"text"`
	Image struct {
		ID      string `json:"id"`
		Caption string `json:"caption"`
	} `json:"image"`
	Video struct {
		ID      string `json:"id"`
		Caption string `json:"caption"`
	} `json:"video"`
	Audio struct {
		ID string `json:"id"`
	} `json:"audio"`
	Document struct {
		ID      string `json:"id"`
		Caption string `json:"caption"`
	} `json:"document"`
	Context struct {
		ID string `json:"id"`
	} `json:"context"`
}

type webhookStatus struct {
	ID           string `json:"id"`
	Status       string `json:"status"`
	Timestamp    string `json:"timestamp"`
	RecipientID  string `json:"recipient_id"`
	Conversation struct {
		ID string `json:"id"`
	} `json:"conversation"`
}
