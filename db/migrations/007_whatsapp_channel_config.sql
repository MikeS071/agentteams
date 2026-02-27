ALTER TABLE tenant_channels
ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_tenant_channels_channel_user_id
ON tenant_channels(channel, channel_user_id);
