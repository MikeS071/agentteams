package channels

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/redis/go-redis/v9"
)

// Fanout subscribes to tenant response topics and relays responses to linked channels.
type Fanout struct {
	redis    *redis.Client
	links    *LinkStore
	adapters map[string]ChannelAdapter
	log      *slog.Logger
}

func NewFanout(redisClient *redis.Client, links *LinkStore, channelAdapters ...ChannelAdapter) *Fanout {
	adapterMap := make(map[string]ChannelAdapter, len(channelAdapters))
	for _, adapter := range channelAdapters {
		if adapter == nil {
			continue
		}
		adapterMap[adapter.Channel()] = adapter
	}

	return &Fanout{
		redis:    redisClient,
		links:    links,
		adapters: adapterMap,
		log:      slog.Default().With("component", "channels.fanout"),
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

	for _, channel := range channels {
		if channel.Muted {
			continue
		}

		switch channel.Channel {
		case "web":
			_ = FormatForWeb(out)
		case "telegram":
			adapter, ok := f.adapters["telegram"]
			if !ok {
				f.log.Warn("telegram adapter is not configured", "tenant", channel.TenantID)
				continue
			}
			if err := adapter.Send(ctx, channel, out); err != nil {
				f.log.Error("telegram send failed", "tenant", channel.TenantID, "err", err)
			}
		case "whatsapp":
			payload := FormatForWhatsApp(out)
			f.sendWhatsApp(ctx, channel, payload)
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

func (f *Fanout) sendWhatsApp(_ context.Context, channel TenantChannel, payload string) {
	f.log.Info("would send to whatsapp", "tenant", channel.TenantID, "channel_user_id", channel.ChannelUserID, "payload", payload)
}
