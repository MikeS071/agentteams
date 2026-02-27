package adapters

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
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

	"github.com/agentteams/api/channels"
)

const (
	telegramAPIBaseURL = "https://api.telegram.org"
)

type TelegramAdapter struct {
	links      *channels.LinkStore
	httpClient *http.Client
}

type TelegramBotIdentity struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

func NewTelegramAdapter(links *channels.LinkStore) *TelegramAdapter {
	return &TelegramAdapter{
		links:      links,
		httpClient: &http.Client{Timeout: 20 * time.Second},
	}
}

func (a *TelegramAdapter) Channel() string {
	return "telegram"
}

func (a *TelegramAdapter) VerifyWebhook(r *http.Request, expectedSecret string) error {
	provided := strings.TrimSpace(r.Header.Get("X-Telegram-Bot-Api-Secret-Token"))
	if provided == "" {
		return errors.New("missing webhook secret")
	}
	if subtle.ConstantTimeCompare([]byte(provided), []byte(strings.TrimSpace(expectedSecret))) != 1 {
		return errors.New("invalid webhook secret")
	}
	return nil
}

func (a *TelegramAdapter) ParseWebhook(_ context.Context, tenantID string, payload []byte) ([]channels.InboundMessage, error) {
	var update telegramUpdate
	if err := json.Unmarshal(payload, &update); err != nil {
		return nil, fmt.Errorf("decode telegram webhook payload: %w", err)
	}

	message := update.Message
	if message.ID == 0 {
		message = update.EditedMessage
	}
	if message.ID == 0 {
		return nil, nil
	}
	message.UpdateID = update.UpdateID

	content, metadata := normalizeTelegramMessage(message)
	if content == "" {
		return nil, nil
	}

	inbound := channels.InboundMessage{
		TenantID: tenantID,
		Content:  content,
		Channel:  "telegram",
		Metadata: metadata,
	}
	return []channels.InboundMessage{inbound}, nil
}

func (a *TelegramAdapter) Send(ctx context.Context, linkedChannel channels.TenantChannel, msg channels.OutboundMessage) error {
	cfg, err := a.links.GetTelegramConfigByTenant(linkedChannel.TenantID)
	if err != nil {
		return fmt.Errorf("load telegram config: %w", err)
	}

	token, err := channels.DecryptSecret(cfg.BotTokenEncrypted)
	if err != nil {
		return fmt.Errorf("decrypt telegram bot token: %w", err)
	}

	chatID := strings.TrimSpace(linkedChannel.ChannelUserID)
	if chatID == "" {
		chatID = strings.TrimSpace(cfg.ChannelUserID)
	}
	if chatID == "" {
		return errors.New("telegram channel_user_id is not set")
	}

	payload := telegramSendMessageRequest{
		ChatID:    chatID,
		Text:      msg.Content,
		ParseMode: "Markdown",
	}
	if msg.Metadata != nil {
		if parseMode := strings.TrimSpace(msg.Metadata["telegram_parse_mode"]); parseMode != "" {
			payload.ParseMode = parseMode
		}
		if keyboardJSON := strings.TrimSpace(msg.Metadata["telegram_inline_keyboard"]); keyboardJSON != "" {
			var markup telegramInlineKeyboardMarkup
			if err := json.Unmarshal([]byte(keyboardJSON), &markup); err != nil {
				return fmt.Errorf("decode inline keyboard metadata: %w", err)
			}
			payload.ReplyMarkup = &markup
		}
	}

	if _, err := a.telegramAPI(ctx, token, "sendMessage", payload); err != nil {
		return fmt.Errorf("send telegram message: %w", err)
	}
	return nil
}

func (a *TelegramAdapter) ConnectTenant(ctx context.Context, tenantID, botToken, webhookURL string) (TelegramBotIdentity, error) {
	trimmedToken := strings.TrimSpace(botToken)
	if trimmedToken == "" {
		return TelegramBotIdentity{}, errors.New("bot token is required")
	}
	webhookURL = strings.TrimSpace(webhookURL)
	if webhookURL == "" {
		return TelegramBotIdentity{}, errors.New("webhook url is required")
	}

	identity, err := a.ValidateBotToken(ctx, trimmedToken)
	if err != nil {
		return TelegramBotIdentity{}, err
	}

	secret, err := randomSecret(24)
	if err != nil {
		return TelegramBotIdentity{}, fmt.Errorf("generate webhook secret: %w", err)
	}

	if err := a.RegisterWebhook(ctx, trimmedToken, webhookURL, secret); err != nil {
		return TelegramBotIdentity{}, err
	}

	encryptedToken, err := channels.EncryptSecret(trimmedToken)
	if err != nil {
		return TelegramBotIdentity{}, fmt.Errorf("encrypt bot token: %w", err)
	}

	if err := a.links.UpsertTelegramConfig(tenantID, encryptedToken, secret, identity.Username, identity.ID); err != nil {
		return TelegramBotIdentity{}, err
	}
	return identity, nil
}

func (a *TelegramAdapter) DisconnectTenant(ctx context.Context, tenantID string) error {
	cfg, err := a.links.GetTelegramConfigByTenant(tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}

	token, err := channels.DecryptSecret(cfg.BotTokenEncrypted)
	if err == nil {
		_ = a.DeleteWebhook(ctx, token)
	}

	return a.links.UnlinkChannel(tenantID, "telegram")
}

func (a *TelegramAdapter) ValidateBotToken(ctx context.Context, token string) (TelegramBotIdentity, error) {
	body, err := a.telegramAPI(ctx, token, "getMe", map[string]any{})
	if err != nil {
		return TelegramBotIdentity{}, fmt.Errorf("validate bot token: %w", err)
	}

	var resp struct {
		OK     bool                `json:"ok"`
		Result TelegramBotIdentity `json:"result"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return TelegramBotIdentity{}, fmt.Errorf("decode getMe response: %w", err)
	}
	if !resp.OK || resp.Result.ID == 0 {
		return TelegramBotIdentity{}, errors.New("invalid telegram bot token")
	}
	return resp.Result, nil
}

func (a *TelegramAdapter) RegisterWebhook(ctx context.Context, token, webhookURL, secret string) error {
	payload := map[string]any{
		"url":          strings.TrimSpace(webhookURL),
		"secret_token": strings.TrimSpace(secret),
	}

	if _, err := a.telegramAPI(ctx, token, "setWebhook", payload); err != nil {
		return fmt.Errorf("register webhook: %w", err)
	}
	return nil
}

func (a *TelegramAdapter) DeleteWebhook(ctx context.Context, token string) error {
	_, err := a.telegramAPI(ctx, token, "deleteWebhook", map[string]any{"drop_pending_updates": true})
	if err != nil {
		return fmt.Errorf("delete webhook: %w", err)
	}
	return nil
}

func (a *TelegramAdapter) telegramAPI(ctx context.Context, token, method string, payload any) ([]byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal telegram payload: %w", err)
	}

	url := fmt.Sprintf("%s/bot%s/%s", telegramAPIBaseURL, strings.TrimSpace(token), method)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build telegram request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("telegram request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read telegram response: %w", err)
	}

	var envelope struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	_ = json.Unmarshal(respBody, &envelope)

	if resp.StatusCode >= http.StatusBadRequest || !envelope.OK {
		description := strings.TrimSpace(envelope.Description)
		if description == "" {
			description = strings.TrimSpace(string(respBody))
		}
		if description == "" {
			description = fmt.Sprintf("status %d", resp.StatusCode)
		}
		return nil, errors.New(description)
	}

	return respBody, nil
}

func normalizeTelegramMessage(message telegramMessage) (string, map[string]string) {
	content := strings.TrimSpace(message.Text)
	if content == "" {
		content = strings.TrimSpace(message.Caption)
	}

	metadata := map[string]string{
		"telegram_update_id":    strconv.FormatInt(message.UpdateID, 10),
		"telegram_message_id":   strconv.FormatInt(message.ID, 10),
		"telegram_chat_id":      strconv.FormatInt(message.Chat.ID, 10),
		"telegram_chat_type":    strings.TrimSpace(message.Chat.Type),
		"telegram_chat_title":   strings.TrimSpace(message.Chat.Title),
		"telegram_username":     strings.TrimSpace(message.From.Username),
		"telegram_first_name":   strings.TrimSpace(message.From.FirstName),
		"telegram_last_name":    strings.TrimSpace(message.From.LastName),
		"telegram_sender_id":    strconv.FormatInt(message.From.ID, 10),
		"telegram_content_type": "text",
	}

	if message.From.IsBot {
		return "", metadata
	}

	if len(message.Photo) > 0 {
		photo := message.Photo[len(message.Photo)-1]
		metadata["telegram_content_type"] = "photo"
		metadata["telegram_file_id"] = photo.FileID
		metadata["telegram_file_unique_id"] = photo.FileUniqueID
		if content == "" {
			content = "[photo]"
		}
	}

	if message.Document.FileID != "" {
		metadata["telegram_content_type"] = "document"
		metadata["telegram_file_id"] = message.Document.FileID
		metadata["telegram_file_unique_id"] = message.Document.FileUniqueID
		metadata["telegram_file_name"] = strings.TrimSpace(message.Document.FileName)
		metadata["telegram_mime_type"] = strings.TrimSpace(message.Document.MimeType)
		if content == "" {
			if metadata["telegram_file_name"] != "" {
				content = "[document] " + metadata["telegram_file_name"]
			} else {
				content = "[document]"
			}
		}
	}

	metadata["telegram_update_id"] = strconv.FormatInt(message.UpdateID, 10)
	return content, metadata
}

func randomSecret(byteLen int) (string, error) {
	if byteLen < 16 {
		byteLen = 16
	}
	buf := make([]byte, byteLen)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

type telegramUpdate struct {
	UpdateID      int64           `json:"update_id"`
	Message       telegramMessage `json:"message"`
	EditedMessage telegramMessage `json:"edited_message"`
}

type telegramMessage struct {
	UpdateID int64          `json:"-"`
	ID       int64          `json:"message_id"`
	From     telegramUser   `json:"from"`
	Chat     telegramChat   `json:"chat"`
	Date     int64          `json:"date"`
	Text     string         `json:"text"`
	Caption  string         `json:"caption"`
	Photo    []telegramFile `json:"photo"`
	Document telegramDoc    `json:"document"`
}

type telegramUser struct {
	ID        int64  `json:"id"`
	IsBot     bool   `json:"is_bot"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Username  string `json:"username"`
}

type telegramChat struct {
	ID    int64  `json:"id"`
	Type  string `json:"type"`
	Title string `json:"title"`
}

type telegramFile struct {
	FileID       string `json:"file_id"`
	FileUniqueID string `json:"file_unique_id"`
}

type telegramDoc struct {
	FileID       string `json:"file_id"`
	FileUniqueID string `json:"file_unique_id"`
	FileName     string `json:"file_name"`
	MimeType     string `json:"mime_type"`
}

type telegramInlineKeyboardButton struct {
	Text string `json:"text"`
	URL  string `json:"url,omitempty"`
	Data string `json:"callback_data,omitempty"`
}

type telegramInlineKeyboardMarkup struct {
	InlineKeyboard [][]telegramInlineKeyboardButton `json:"inline_keyboard"`
}

type telegramSendMessageRequest struct {
	ChatID      string                        `json:"chat_id"`
	Text        string                        `json:"text"`
	ParseMode   string                        `json:"parse_mode,omitempty"`
	ReplyMarkup *telegramInlineKeyboardMarkup `json:"reply_markup,omitempty"`
}
