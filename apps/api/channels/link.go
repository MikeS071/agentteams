package channels

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrInvalidChannel = errors.New("invalid channel")

// TenantChannel represents a linked outbound channel for a tenant.
type TenantChannel struct {
	ID            string    `json:"id"`
	TenantID      string    `json:"tenant_id"`
	Channel       string    `json:"channel"`
	ChannelUserID string    `json:"channel_user_id,omitempty"`
	BotUsername   string    `json:"bot_username,omitempty"`
	LinkedAt      time.Time `json:"linked_at"`
	Muted         bool      `json:"muted"`
}

// TelegramChannelConfig is tenant-level telegram configuration.
type TelegramChannelConfig struct {
	TenantID          string
	ChannelUserID     string
	BotTokenEncrypted string
	WebhookSecret     string
	BotUsername       string
	BotID             int64
}

// LinkStore manages tenant channel links.
type LinkStore struct {
	db *sql.DB
}

func NewLinkStore(db *sql.DB) *LinkStore {
	return &LinkStore{db: db}
}

// LinkChannel inserts or updates a linked channel for a tenant.
func (s *LinkStore) LinkChannel(tenantID, channel, channelUserID string) error {
	channel, err := normalizeChannel(channel)
	if err != nil {
		return err
	}
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}

	_, err = s.db.Exec(
		`INSERT INTO tenant_channels (tenant_id, channel, channel_user_id)
		 VALUES ($1, $2, NULLIF($3, ''))
		 ON CONFLICT (tenant_id, channel)
		 DO UPDATE SET channel_user_id = EXCLUDED.channel_user_id,
		               muted = FALSE,
		               linked_at = NOW()`,
		tenantID,
		channel,
		strings.TrimSpace(channelUserID),
	)
	if err != nil {
		return fmt.Errorf("link channel: %w", err)
	}
	return nil
}

// UnlinkChannel removes a linked channel for a tenant.
func (s *LinkStore) UnlinkChannel(tenantID, channel string) error {
	channel, err := normalizeChannel(channel)
	if err != nil {
		return err
	}
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}

	_, err = s.db.Exec(`DELETE FROM tenant_channels WHERE tenant_id = $1 AND channel = $2`, tenantID, channel)
	if err != nil {
		return fmt.Errorf("unlink channel: %w", err)
	}
	return nil
}

// GetChannels lists all channels linked to a tenant.
func (s *LinkStore) GetChannels(tenantID string) ([]TenantChannel, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}

	rows, err := s.db.Query(
		`SELECT id, tenant_id, channel, channel_user_id, COALESCE(bot_username, ''), linked_at, muted
		 FROM tenant_channels
		 WHERE tenant_id = $1
		 ORDER BY linked_at ASC`,
		tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("get channels: %w", err)
	}
	defer rows.Close()

	result := make([]TenantChannel, 0)
	for rows.Next() {
		var ch TenantChannel
		var channelUserID sql.NullString
		if err := rows.Scan(&ch.ID, &ch.TenantID, &ch.Channel, &channelUserID, &ch.BotUsername, &ch.LinkedAt, &ch.Muted); err != nil {
			return nil, fmt.Errorf("scan channel: %w", err)
		}
		if channelUserID.Valid {
			ch.ChannelUserID = channelUserID.String
		}
		result = append(result, ch)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate channels: %w", err)
	}
	return result, nil
}

// UpsertTelegramConfig links telegram channel and stores credential metadata for a tenant.
func (s *LinkStore) UpsertTelegramConfig(tenantID, encryptedBotToken, webhookSecret, botUsername string, botID int64) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(encryptedBotToken) == "" {
		return errors.New("encrypted bot token is required")
	}
	if strings.TrimSpace(webhookSecret) == "" {
		return errors.New("webhook secret is required")
	}

	_, err := s.db.Exec(
		`INSERT INTO tenant_channels (
		   tenant_id, channel, bot_token_encrypted, webhook_secret, bot_username, bot_id, muted
		 )
		 VALUES ($1, 'telegram', $2, $3, NULLIF($4, ''), $5, FALSE)
		 ON CONFLICT (tenant_id, channel)
		 DO UPDATE
		 SET bot_token_encrypted = EXCLUDED.bot_token_encrypted,
		     webhook_secret = EXCLUDED.webhook_secret,
		     bot_username = EXCLUDED.bot_username,
		     bot_id = EXCLUDED.bot_id,
		     muted = FALSE,
		     linked_at = NOW()`,
		tenantID,
		strings.TrimSpace(encryptedBotToken),
		strings.TrimSpace(webhookSecret),
		strings.TrimSpace(botUsername),
		botID,
	)
	if err != nil {
		return fmt.Errorf("upsert telegram config: %w", err)
	}
	return nil
}

// GetTelegramConfigByTenant returns telegram configuration for a tenant.
func (s *LinkStore) GetTelegramConfigByTenant(tenantID string) (TelegramChannelConfig, error) {
	if strings.TrimSpace(tenantID) == "" {
		return TelegramChannelConfig{}, errors.New("tenant id is required")
	}

	var cfg TelegramChannelConfig
	var channelUserID sql.NullString
	var botUsername sql.NullString
	err := s.db.QueryRow(
		`SELECT tenant_id,
		        channel_user_id,
		        bot_token_encrypted,
		        webhook_secret,
		        bot_username,
		        COALESCE(bot_id, 0)
		 FROM tenant_channels
		 WHERE tenant_id = $1 AND channel = 'telegram'`,
		tenantID,
	).Scan(
		&cfg.TenantID,
		&channelUserID,
		&cfg.BotTokenEncrypted,
		&cfg.WebhookSecret,
		&botUsername,
		&cfg.BotID,
	)
	if err != nil {
		return TelegramChannelConfig{}, fmt.Errorf("get telegram config by tenant: %w", err)
	}

	if channelUserID.Valid {
		cfg.ChannelUserID = channelUserID.String
	}
	if botUsername.Valid {
		cfg.BotUsername = botUsername.String
	}
	return cfg, nil
}

// GetTelegramConfigByWebhookSecret returns telegram configuration using webhook secret lookup.
func (s *LinkStore) GetTelegramConfigByWebhookSecret(secret string) (TelegramChannelConfig, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return TelegramChannelConfig{}, errors.New("webhook secret is required")
	}

	var cfg TelegramChannelConfig
	var channelUserID sql.NullString
	var botUsername sql.NullString
	err := s.db.QueryRow(
		`SELECT tenant_id,
		        channel_user_id,
		        bot_token_encrypted,
		        webhook_secret,
		        bot_username,
		        COALESCE(bot_id, 0)
		 FROM tenant_channels
		 WHERE channel = 'telegram' AND webhook_secret = $1`,
		secret,
	).Scan(
		&cfg.TenantID,
		&channelUserID,
		&cfg.BotTokenEncrypted,
		&cfg.WebhookSecret,
		&botUsername,
		&cfg.BotID,
	)
	if err != nil {
		return TelegramChannelConfig{}, fmt.Errorf("get telegram config by webhook secret: %w", err)
	}

	if channelUserID.Valid {
		cfg.ChannelUserID = channelUserID.String
	}
	if botUsername.Valid {
		cfg.BotUsername = botUsername.String
	}
	return cfg, nil
}

func normalizeChannel(channel string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(channel))
	switch normalized {
	case "web", "telegram", "whatsapp":
		return normalized, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrInvalidChannel, channel)
	}
}
