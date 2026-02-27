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
	LinkedAt      time.Time `json:"linked_at"`
	Muted         bool      `json:"muted"`
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
		`SELECT id, tenant_id, channel, channel_user_id, linked_at, muted
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
		if err := rows.Scan(&ch.ID, &ch.TenantID, &ch.Channel, &channelUserID, &ch.LinkedAt, &ch.Muted); err != nil {
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

func normalizeChannel(channel string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(channel))
	switch normalized {
	case "web", "telegram", "whatsapp":
		return normalized, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrInvalidChannel, channel)
	}
}
