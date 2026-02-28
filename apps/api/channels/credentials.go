package channels

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ChannelCredential stores provider configuration for a tenant/channel pair.
type ChannelCredential struct {
	TenantID  string                 `json:"tenant_id"`
	Channel   string                 `json:"channel"`
	Config    map[string]string      `json:"config"`
	UpdatedAt time.Time              `json:"updated_at"`
	RawConfig map[string]interface{} `json:"-"`
}

// CredentialsStore manages channel provider credentials.
type CredentialsStore struct {
	db *sql.DB
}

func NewCredentialsStore(db *sql.DB) *CredentialsStore {
	return &CredentialsStore{db: db}
}

func (s *CredentialsStore) Upsert(ctx context.Context, tenantID, channel string, config map[string]string) error {
	if s == nil || s.db == nil {
		return errors.New("credential store is not configured")
	}
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	normalizedChannel, err := normalizeChannel(channel)
	if err != nil {
		return err
	}

	payload, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("marshal credential config: %w", err)
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO channel_credentials (tenant_id, channel, config, updated_at)
		VALUES ($1, $2, $3::jsonb, NOW())
		ON CONFLICT (tenant_id, channel)
		DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
	`, tenantID, normalizedChannel, payload)
	if err != nil {
		return fmt.Errorf("upsert credentials: %w", err)
	}
	return nil
}

func (s *CredentialsStore) GetByTenantChannel(ctx context.Context, tenantID, channel string) (ChannelCredential, error) {
	if s == nil || s.db == nil {
		return ChannelCredential{}, errors.New("credential store is not configured")
	}
	normalizedChannel, err := normalizeChannel(channel)
	if err != nil {
		return ChannelCredential{}, err
	}

	var cred ChannelCredential
	var raw []byte
	if err := s.db.QueryRowContext(ctx, `
		SELECT tenant_id, channel, config::text, updated_at
		FROM channel_credentials
		WHERE tenant_id = $1 AND channel = $2
	`, tenantID, normalizedChannel).Scan(&cred.TenantID, &cred.Channel, &raw, &cred.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ChannelCredential{}, sql.ErrNoRows
		}
		return ChannelCredential{}, fmt.Errorf("get credentials: %w", err)
	}

	if err := unmarshalConfig(raw, &cred); err != nil {
		return ChannelCredential{}, err
	}
	return cred, nil
}

func (s *CredentialsStore) FindTenantByTelegramSecret(ctx context.Context, secret string) (string, error) {
	if s == nil || s.db == nil {
		return "", errors.New("credential store is not configured")
	}
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return "", errors.New("telegram webhook secret is required")
	}

	var tenantID string
	if err := s.db.QueryRowContext(ctx, `
		SELECT tenant_id
		FROM channel_credentials
		WHERE channel = 'telegram' AND config->>'webhook_secret' = $1
		LIMIT 1
	`, secret).Scan(&tenantID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", sql.ErrNoRows
		}
		return "", fmt.Errorf("lookup tenant by telegram secret: %w", err)
	}

	return strings.TrimSpace(tenantID), nil
}

func (s *CredentialsStore) FindTenantByWhatsAppPhoneNumberID(ctx context.Context, phoneNumberID string) (string, error) {
	if s == nil || s.db == nil {
		return "", errors.New("credential store is not configured")
	}
	phoneNumberID = strings.TrimSpace(phoneNumberID)
	if phoneNumberID == "" {
		return "", errors.New("phone number id is required")
	}

	var tenantID string
	if err := s.db.QueryRowContext(ctx, `
		SELECT tenant_id
		FROM channel_credentials
		WHERE channel = 'whatsapp' AND config->>'phone_number_id' = $1
		LIMIT 1
	`, phoneNumberID).Scan(&tenantID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", sql.ErrNoRows
		}
		return "", fmt.Errorf("lookup tenant by phone number id: %w", err)
	}

	return strings.TrimSpace(tenantID), nil
}

func unmarshalConfig(raw []byte, cred *ChannelCredential) error {
	var generic map[string]interface{}
	if err := json.Unmarshal(raw, &generic); err != nil {
		return fmt.Errorf("decode credential config: %w", err)
	}
	cred.RawConfig = generic

	cfg := make(map[string]string, len(generic))
	for k, v := range generic {
		s, ok := v.(string)
		if !ok {
			continue
		}
		cfg[strings.TrimSpace(k)] = strings.TrimSpace(s)
	}
	cred.Config = cfg
	return nil
}
