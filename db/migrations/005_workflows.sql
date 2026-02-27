DROP TABLE IF EXISTS workflow_runs;

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  workflow_id TEXT NOT NULL,
  inputs JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'confirmed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
