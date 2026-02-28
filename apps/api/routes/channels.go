package routes

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/agentsquads/api/channels"
)

const telegramWebhookURL = "https://agentsquads.ai/api/channels/telegram/webhook"

type ChannelHandler struct {
	Router      *channels.Router
	Links       *channels.LinkStore
	Credentials *channels.CredentialsStore
	DB          *sql.DB
	HTTPClient  *http.Client
}

func NewChannelHandler(db *sql.DB, router *channels.Router, links *channels.LinkStore, creds *channels.CredentialsStore) *ChannelHandler {
	return &ChannelHandler{
		Router:      router,
		Links:       links,
		Credentials: creds,
		DB:          db,
		HTTPClient:  &http.Client{Timeout: 15 * time.Second},
	}
}

func (h *ChannelHandler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/channels/inbound", h.handleInbound)
	mux.HandleFunc("POST /api/channels/telegram", h.handleConnectTelegram)
	mux.HandleFunc("POST /api/channels/whatsapp", h.handleConnectWhatsApp)
	mux.HandleFunc("GET /api/channels", h.handleListChannels)
	mux.HandleFunc("DELETE /api/channels/{id}", h.handleDeleteChannel)
	mux.HandleFunc("POST /api/channels/telegram/webhook", h.handleTelegramWebhook)
	mux.HandleFunc("POST /api/channels/whatsapp/webhook", h.handleWhatsAppWebhook)
}

func (h *ChannelHandler) handleInbound(w http.ResponseWriter, r *http.Request) {
	if h.Router == nil {
		writeError(w, http.StatusServiceUnavailable, "channel router is not configured")
		return
	}

	var req struct {
		TenantID    string            `json:"tenant_id"`
		TenantIDAlt string            `json:"tenantId"`
		Content     string            `json:"content"`
		Channel     string            `json:"channel"`
		Metadata    map[string]string `json:"metadata"`
	}
	if err := decodeJSONStrict(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	tenantID := strings.TrimSpace(req.TenantID)
	if tenantID == "" {
		tenantID = strings.TrimSpace(req.TenantIDAlt)
	}

	out, err := h.Router.Route(r.Context(), channels.InboundMessage{
		TenantID: tenantID,
		Content:  req.Content,
		Channel:  req.Channel,
		Metadata: req.Metadata,
	})
	if err != nil {
		status := http.StatusInternalServerError
		if isInboundConflictError(err) {
			status = http.StatusConflict
		} else if isInboundValidationError(err) {
			status = http.StatusBadRequest
		}
		writeError(w, status, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, out)
}

func (h *ChannelHandler) handleConnectTelegram(w http.ResponseWriter, r *http.Request) {
	if h.Links == nil || h.Credentials == nil {
		writeError(w, http.StatusServiceUnavailable, "channel stores are not configured")
		return
	}

	var req struct {
		TenantID string `json:"tenant_id"`
		BotToken string `json:"bot_token"`
	}
	if err := decodeJSONStrict(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	tenantID := strings.TrimSpace(req.TenantID)
	botToken := strings.TrimSpace(req.BotToken)
	if tenantID == "" || botToken == "" {
		writeError(w, http.StatusBadRequest, "tenant_id and bot_token are required")
		return
	}

	botInfo, err := h.verifyTelegramBot(r.Context(), botToken)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	secret := randomToken(24)
	if err := h.setTelegramWebhook(r.Context(), botToken, secret); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.Credentials.Upsert(r.Context(), tenantID, "telegram", map[string]string{
		"bot_token":      botToken,
		"bot_id":         strconv.FormatInt(botInfo.ID, 10),
		"bot_username":   botInfo.Username,
		"webhook_url":    telegramWebhookURL,
		"webhook_secret": secret,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save telegram credentials")
		return
	}

	if err := h.Links.LinkChannel(tenantID, "telegram", strconv.FormatInt(botInfo.ID, 10)); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to link telegram channel")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"status": "connected",
		"channel": map[string]any{
			"channel":  "telegram",
			"username": botInfo.Username,
			"bot_id":   botInfo.ID,
		},
	})
}

func (h *ChannelHandler) handleConnectWhatsApp(w http.ResponseWriter, r *http.Request) {
	if h.Links == nil || h.Credentials == nil {
		writeError(w, http.StatusServiceUnavailable, "channel stores are not configured")
		return
	}

	var req struct {
		TenantID          string `json:"tenant_id"`
		AccessToken       string `json:"access_token"`
		PhoneNumberID     string `json:"phone_number_id"`
		BusinessAccountID string `json:"business_account_id"`
		APIVersion        string `json:"api_version"`
	}
	if err := decodeJSONStrict(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	tenantID := strings.TrimSpace(req.TenantID)
	accessToken := strings.TrimSpace(req.AccessToken)
	phoneNumberID := strings.TrimSpace(req.PhoneNumberID)
	businessAccountID := strings.TrimSpace(req.BusinessAccountID)
	apiVersion := strings.TrimSpace(req.APIVersion)
	if apiVersion == "" {
		apiVersion = "v20.0"
	}

	if tenantID == "" || accessToken == "" || phoneNumberID == "" {
		writeError(w, http.StatusBadRequest, "tenant_id, access_token and phone_number_id are required")
		return
	}

	if err := h.verifyWhatsAppCredentials(r.Context(), accessToken, apiVersion, phoneNumberID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.Credentials.Upsert(r.Context(), tenantID, "whatsapp", map[string]string{
		"access_token":        accessToken,
		"phone_number_id":     phoneNumberID,
		"business_account_id": businessAccountID,
		"api_version":         apiVersion,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save whatsapp credentials")
		return
	}

	if err := h.Links.LinkChannel(tenantID, "whatsapp", phoneNumberID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to link whatsapp channel")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"status": "connected",
		"channel": map[string]string{
			"channel":         "whatsapp",
			"phone_number_id": phoneNumberID,
		},
	})
}

func (h *ChannelHandler) handleListChannels(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}

	tenantID := tenantIDFromRequest(r)
	if tenantID == "" {
		writeError(w, http.StatusBadRequest, "tenant_id is required")
		return
	}

	rows, err := h.DB.QueryContext(r.Context(), `
		SELECT
			tc.id,
			tc.channel,
			tc.linked_at,
			tc.muted,
			COALESCE((
				SELECT COUNT(*)
				FROM messages m
				JOIN conversations c ON c.id = m.conversation_id
				WHERE c.tenant_id = tc.tenant_id
				  AND m.channel = tc.channel
			), 0) AS message_count,
			COALESCE(cc.updated_at, tc.linked_at) AS updated_at,
			COALESCE(NULLIF(cc.config::text, ''), '{}') AS config_json
		FROM tenant_channels tc
		LEFT JOIN channel_credentials cc
		  ON cc.tenant_id = tc.tenant_id
		 AND cc.channel = tc.channel
		WHERE tc.tenant_id = $1
		ORDER BY tc.linked_at ASC
	`, tenantID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list channels")
		return
	}
	defer rows.Close()

	result := make([]map[string]any, 0)
	for rows.Next() {
		var (
			id           string
			channel      string
			linkedAt     time.Time
			muted        bool
			messageCount int64
			updatedAt    time.Time
			configJSON   string
		)

		if err := rows.Scan(&id, &channel, &linkedAt, &muted, &messageCount, &updatedAt, &configJSON); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read channels")
			return
		}

		masked := map[string]any{}
		if err := json.Unmarshal([]byte(configJSON), &masked); err != nil {
			masked = map[string]any{}
		}
		maskSecrets(masked)

		result = append(result, map[string]any{
			"id":            id,
			"channel":       channel,
			"linked_at":     linkedAt,
			"updated_at":    updatedAt,
			"status":        map[bool]string{true: "disabled", false: "connected"}[muted],
			"enabled":       !muted,
			"message_count": messageCount,
			"credentials":   masked,
		})
	}

	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read channels")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"channels": result})
}

func (h *ChannelHandler) handleDeleteChannel(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusServiceUnavailable, "database is not configured")
		return
	}

	id := strings.TrimSpace(r.PathValue("id"))
	tenantID := tenantIDFromRequest(r)
	if id == "" || tenantID == "" {
		writeError(w, http.StatusBadRequest, "channel id and tenant_id are required")
		return
	}

	var channel string
	err := h.DB.QueryRowContext(r.Context(), `
		DELETE FROM tenant_channels
		WHERE id = $1 AND tenant_id = $2
		RETURNING channel
	`, id, tenantID).Scan(&channel)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "channel link not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to disconnect channel")
		return
	}

	if _, err := h.DB.ExecContext(r.Context(), `DELETE FROM channel_credentials WHERE tenant_id = $1 AND channel = $2`, tenantID, channel); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove channel credentials")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *ChannelHandler) handleTelegramWebhook(w http.ResponseWriter, r *http.Request) {
	if h.Router == nil || h.Credentials == nil {
		writeError(w, http.StatusServiceUnavailable, "channel webhook is not configured")
		return
	}

	secret := strings.TrimSpace(r.Header.Get("X-Telegram-Bot-Api-Secret-Token"))
	tenantID, err := h.Credentials.FindTenantByTelegramSecret(r.Context(), secret)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "invalid telegram webhook secret")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid telegram webhook request")
		return
	}

	var payload struct {
		UpdateID int64 `json:"update_id"`
		Message  struct {
			Text string `json:"text"`
			Chat struct {
				ID int64 `json:"id"`
			} `json:"chat"`
			From struct {
				ID int64 `json:"id"`
			} `json:"from"`
		} `json:"message"`
	}
	if err := decodeJSONStrict(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid telegram payload")
		return
	}

	content := strings.TrimSpace(payload.Message.Text)
	if content == "" {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ignored"})
		return
	}

	metadata := map[string]string{
		"channel_user_id":    strconv.FormatInt(payload.Message.Chat.ID, 10),
		"user_id":            strconv.FormatInt(payload.Message.From.ID, 10),
		"telegram_update_id": strconv.FormatInt(payload.UpdateID, 10),
	}

	if _, err := h.Router.Route(r.Context(), channels.InboundMessage{
		TenantID: tenantID,
		Content:  content,
		Channel:  "telegram",
		Metadata: metadata,
	}); err != nil {
		status := http.StatusInternalServerError
		if isInboundValidationError(err) {
			status = http.StatusBadRequest
		}
		writeError(w, status, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *ChannelHandler) handleWhatsAppWebhook(w http.ResponseWriter, r *http.Request) {
	if h.Router == nil || h.Credentials == nil {
		writeError(w, http.StatusServiceUnavailable, "channel webhook is not configured")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid webhook body")
		return
	}

	var payload struct {
		Entry []struct {
			Changes []struct {
				Value struct {
					Metadata struct {
						PhoneNumberID string `json:"phone_number_id"`
					} `json:"metadata"`
					Messages []struct {
						From string `json:"from"`
						ID   string `json:"id"`
						Text struct {
							Body string `json:"body"`
						} `json:"text"`
					} `json:"messages"`
				} `json:"value"`
			} `json:"changes"`
		} `json:"entry"`
	}
	if err := decodeJSONStrictRaw(body, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid whatsapp payload")
		return
	}

	processed := 0
	for _, entry := range payload.Entry {
		for _, change := range entry.Changes {
			phoneNumberID := strings.TrimSpace(change.Value.Metadata.PhoneNumberID)
			if phoneNumberID == "" {
				continue
			}

			tenantID, err := h.Credentials.FindTenantByWhatsAppPhoneNumberID(r.Context(), phoneNumberID)
			if err != nil {
				continue
			}

			for _, msg := range change.Value.Messages {
				content := strings.TrimSpace(msg.Text.Body)
				if content == "" {
					continue
				}

				metadata := map[string]string{
					"channel_user_id": msg.From,
					"user_id":         msg.From,
					"message_id":      msg.ID,
				}

				if _, err := h.Router.Route(r.Context(), channels.InboundMessage{
					TenantID: tenantID,
					Content:  content,
					Channel:  "whatsapp",
					Metadata: metadata,
				}); err == nil {
					processed++
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "processed": processed})
}

func (h *ChannelHandler) verifyTelegramBot(ctx context.Context, token string) (telegramBotInfo, error) {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/getMe", token)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := h.HTTPClient.Do(req)
	if err != nil {
		return telegramBotInfo{}, fmt.Errorf("telegram token validation failed: %w", err)
	}
	defer resp.Body.Close()

	var payload struct {
		OK          bool            `json:"ok"`
		Description string          `json:"description"`
		Result      telegramBotInfo `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return telegramBotInfo{}, errors.New("invalid response from telegram")
	}
	if !payload.OK {
		detail := strings.TrimSpace(payload.Description)
		if detail == "" {
			detail = "telegram rejected token"
		}
		return telegramBotInfo{}, errors.New(detail)
	}
	if payload.Result.ID == 0 {
		return telegramBotInfo{}, errors.New("telegram token verification returned empty bot id")
	}
	return payload.Result, nil
}

func (h *ChannelHandler) setTelegramWebhook(ctx context.Context, token, secret string) error {
	body, _ := json.Marshal(map[string]string{
		"url":          telegramWebhookURL,
		"secret_token": secret,
	})
	url := fmt.Sprintf("https://api.telegram.org/bot%s/setWebhook", token)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("setWebhook call failed: %w", err)
	}
	defer resp.Body.Close()

	var payload struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return errors.New("invalid response from telegram setWebhook")
	}
	if !payload.OK {
		detail := strings.TrimSpace(payload.Description)
		if detail == "" {
			detail = "telegram setWebhook failed"
		}
		return errors.New(detail)
	}
	return nil
}

func (h *ChannelHandler) verifyWhatsAppCredentials(ctx context.Context, accessToken, apiVersion, phoneNumberID string) error {
	url := fmt.Sprintf("https://graph.facebook.com/%s/%s", apiVersion, phoneNumberID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := h.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("whatsapp credential verification failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		body, _ := io.ReadAll(resp.Body)
		msg := strings.TrimSpace(string(body))
		if msg == "" {
			msg = "whatsapp credential verification failed"
		}
		return errors.New(msg)
	}
	return nil
}

type telegramBotInfo struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

func tenantIDFromRequest(r *http.Request) string {
	if id := strings.TrimSpace(r.URL.Query().Get("tenant_id")); id != "" {
		return id
	}
	return strings.TrimSpace(r.Header.Get("X-Tenant-ID"))
}

func maskSecrets(config map[string]any) {
	for key, value := range config {
		lower := strings.ToLower(strings.TrimSpace(key))
		if strings.Contains(lower, "token") || strings.Contains(lower, "secret") || strings.Contains(lower, "password") {
			if s, ok := value.(string); ok && s != "" {
				config[key] = maskSecretValue(s)
			}
		}
	}
}

func maskSecretValue(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) <= 6 {
		return "***"
	}
	return trimmed[:3] + "***" + trimmed[len(trimmed)-3:]
}

func randomToken(byteLen int) string {
	buf := make([]byte, byteLen)
	if _, err := rand.Read(buf); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(buf)
}

func isInboundValidationError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, channels.ErrInvalidChannel) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "required") || strings.Contains(msg, "not found") || strings.Contains(msg, "missing")
}

func isInboundConflictError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "already running")
}

func decodeJSONStrictRaw(body []byte, dest any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}

func routeMessage(ctx context.Context, router *channels.Router, msg channels.InboundMessage) (channels.OutboundMessage, error) {
	if router == nil {
		return channels.OutboundMessage{}, errors.New("router unavailable")
	}
	return router.Route(ctx, msg)
}
