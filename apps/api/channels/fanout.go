package channels

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Fanout subscribes to tenant response topics and relays responses to linked channels.
type Fanout struct {
	redis *redis.Client
	links *LinkStore
	creds *CredentialsStore
	http  *http.Client
	log   *slog.Logger
}

func NewFanout(redisClient *redis.Client, links *LinkStore, creds *CredentialsStore) *Fanout {
	return &Fanout{
		redis: redisClient,
		links: links,
		creds: creds,
		http:  &http.Client{Timeout: 15 * time.Second},
		log:   slog.Default().With("component", "channels.fanout"),
	}
}

// Start subscribes to tenant:*:response and dispatches each message to linked channels.
func (f *Fanout) Start(ctx context.Context) error {
	if f.redis == nil {
		return errors.New("redis is not configured")
	}

	pubsub := f.redis.PSubscribe(ctx, "tenant:*:response")
	defer pubsub.Close()

	for {
		message, err := pubsub.ReceiveMessage(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return nil
			}
			return fmt.Errorf("receive pubsub message: %w", err)
		}

		var out OutboundMessage
		if err := json.Unmarshal([]byte(message.Payload), &out); err != nil {
			f.log.Error("failed to decode outbound payload", "channel", message.Channel, "err", err)
			continue
		}

		if out.TenantID == "" {
			out.TenantID = tenantIDFromTopic(message.Channel)
		}
		if out.TenantID == "" {
			f.log.Warn("skip fanout: tenant id is missing", "channel", message.Channel)
			continue
		}

		if err := f.fanout(ctx, out); err != nil {
			f.log.Error("fanout failed", "tenant", out.TenantID, "err", err)
		}
	}
}

func (f *Fanout) fanout(ctx context.Context, out OutboundMessage) error {
	channels, err := f.links.GetChannels(out.TenantID)
	if err != nil {
		return err
	}

	targetChannel := strings.TrimSpace(out.Channel)
	targetChannelUserID := ""
	if out.Metadata != nil {
		targetChannelUserID = strings.TrimSpace(out.Metadata["channel_user_id"])
		if targetChannelUserID == "" {
			targetChannelUserID = strings.TrimSpace(out.Metadata["user_id"])
		}
	}

	for _, channel := range channels {
		if channel.Muted {
			continue
		}
		if targetChannel != "" && channel.Channel != targetChannel {
			continue
		}
		if targetChannelUserID != "" && channel.ChannelUserID != "" && channel.ChannelUserID != targetChannelUserID {
			continue
		}

		switch channel.Channel {
		case "web":
			_ = FormatForWeb(out)
		case "telegram":
			payload := FormatForTelegram(out)
			f.sendTelegram(ctx, channel, out, payload)
		case "whatsapp":
			payload := FormatForWhatsApp(out)
			f.sendWhatsApp(ctx, channel, out, payload)
		default:
			f.log.Warn("skip fanout for unknown channel", "tenant", out.TenantID, "channel", channel.Channel)
		}
	}

	return nil
}

func tenantIDFromTopic(topic string) string {
	parts := strings.Split(topic, ":")
	if len(parts) != 3 {
		return ""
	}
	if parts[0] != "tenant" || parts[2] != "response" {
		return ""
	}
	return parts[1]
}

func FormatForWeb(msg OutboundMessage) string {
	return msg.Content
}

func FormatForTelegram(msg OutboundMessage) string {
	return msg.Content
}

func FormatForWhatsApp(msg OutboundMessage) string {
	return msg.Content
}

func (f *Fanout) sendTelegram(ctx context.Context, channel TenantChannel, out OutboundMessage, payload string) {
	if f.creds == nil {
		f.log.Warn("skip telegram delivery: credentials store unavailable", "tenant", channel.TenantID)
		return
	}
	cred, err := f.creds.GetByTenantChannel(ctx, channel.TenantID, "telegram")
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			f.log.Warn("skip telegram delivery: credentials missing", "tenant", channel.TenantID)
			return
		}
		f.log.Error("failed loading telegram credentials", "tenant", channel.TenantID, "err", err)
		return
	}

	botToken := strings.TrimSpace(cred.Config["bot_token"])
	if botToken == "" {
		f.log.Warn("skip telegram delivery: bot token missing", "tenant", channel.TenantID)
		return
	}

	chatID := targetUserID(channel, out)
	if chatID == "" {
		f.log.Warn("skip telegram delivery: target user missing", "tenant", channel.TenantID)
		return
	}

	reqBody, _ := json.Marshal(map[string]string{
		"chat_id": chatID,
		"text":    payload,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", botToken), strings.NewReader(string(reqBody)))
	if err != nil {
		f.log.Error("build telegram request failed", "tenant", channel.TenantID, "err", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := f.http.Do(req)
	if err != nil {
		f.log.Error("telegram delivery failed", "tenant", channel.TenantID, "err", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		f.log.Error("telegram delivery non-success status", "tenant", channel.TenantID, "status", resp.StatusCode)
	}
}

func (f *Fanout) sendWhatsApp(ctx context.Context, channel TenantChannel, out OutboundMessage, payload string) {
	if f.creds == nil {
		f.log.Warn("skip whatsapp delivery: credentials store unavailable", "tenant", channel.TenantID)
		return
	}
	cred, err := f.creds.GetByTenantChannel(ctx, channel.TenantID, "whatsapp")
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			f.log.Warn("skip whatsapp delivery: credentials missing", "tenant", channel.TenantID)
			return
		}
		f.log.Error("failed loading whatsapp credentials", "tenant", channel.TenantID, "err", err)
		return
	}

	accessToken := strings.TrimSpace(cred.Config["access_token"])
	phoneNumberID := strings.TrimSpace(cred.Config["phone_number_id"])
	version := strings.TrimSpace(cred.Config["api_version"])
	if version == "" {
		version = "v20.0"
	}

	if accessToken == "" || phoneNumberID == "" {
		f.log.Warn("skip whatsapp delivery: missing access token or phone number id", "tenant", channel.TenantID)
		return
	}

	target := targetUserID(channel, out)
	if target == "" {
		f.log.Warn("skip whatsapp delivery: target user missing", "tenant", channel.TenantID)
		return
	}

	reqBody, _ := json.Marshal(map[string]any{
		"messaging_product": "whatsapp",
		"to":                target,
		"type":              "text",
		"text": map[string]string{
			"body": payload,
		},
	})
	url := fmt.Sprintf("https://graph.facebook.com/%s/%s/messages", version, phoneNumberID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(reqBody)))
	if err != nil {
		f.log.Error("build whatsapp request failed", "tenant", channel.TenantID, "err", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := f.http.Do(req)
	if err != nil {
		f.log.Error("whatsapp delivery failed", "tenant", channel.TenantID, "err", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		f.log.Error("whatsapp delivery non-success status", "tenant", channel.TenantID, "status", resp.StatusCode)
	}
}

func targetUserID(channel TenantChannel, out OutboundMessage) string {
	if out.Metadata != nil {
		if v := strings.TrimSpace(out.Metadata["channel_user_id"]); v != "" {
			return v
		}
		if v := strings.TrimSpace(out.Metadata["user_id"]); v != "" {
			return v
		}
	}
	return strings.TrimSpace(channel.ChannelUserID)
}
