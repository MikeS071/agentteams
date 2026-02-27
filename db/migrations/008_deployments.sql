CREATE TABLE tenant_deployments (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'failed', 'succeeded')),
  current_step TEXT,
  steps JSONB NOT NULL DEFAULT '{}'::jsonb,
  supabase_project_id TEXT,
  supabase_project_url TEXT,
  vercel_project_id TEXT,
  vercel_project_url TEXT,
  vercel_deployment_id TEXT,
  vercel_deployment_url TEXT,
  custom_domain TEXT,
  custom_domain_verified BOOLEAN NOT NULL DEFAULT FALSE,
  last_error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenant_deployments_status ON tenant_deployments(status);
