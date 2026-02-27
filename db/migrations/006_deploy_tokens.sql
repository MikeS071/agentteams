CREATE TABLE deploy_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('vercel', 'supabase')),
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  provider_user_id TEXT,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, provider)
);
