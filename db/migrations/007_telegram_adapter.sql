ALTER TABLE tenant_channels
  ADD COLUMN IF NOT EXISTS bot_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT,
  ADD COLUMN IF NOT EXISTS bot_username TEXT,
  ADD COLUMN IF NOT EXISTS bot_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_channels_telegram_webhook_secret
  ON tenant_channels (webhook_secret)
  WHERE channel = 'telegram' AND webhook_secret IS NOT NULL;
