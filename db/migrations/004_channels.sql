-- Align tenant_channels with unified channel registry used by channel sync router.
DROP TABLE IF EXISTS tenant_channels;

CREATE TABLE tenant_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('web', 'telegram', 'whatsapp')),
  channel_user_id TEXT,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  muted BOOLEAN DEFAULT FALSE,
  UNIQUE(tenant_id, channel)
);
