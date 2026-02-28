DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feature_policy') THEN
    CREATE TYPE feature_policy AS ENUM (
      'swarm',
      'terminal',
      'deploy',
      'telegram',
      'whatsapp',
      'webchat',
      'catalog'
    );
  END IF;
END $$;

ALTER TABLE IF EXISTS tenant_policies RENAME TO tenant_policies_legacy_010;

CREATE TABLE IF NOT EXISTS tenant_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature feature_policy NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, feature)
);

INSERT INTO tenant_policies (tenant_id, feature, enabled)
SELECT
  legacy.tenant_id,
  legacy.feature::feature_policy,
  COALESCE(legacy.enabled, TRUE)
FROM tenant_policies_legacy_010 legacy
WHERE legacy.feature IN ('swarm', 'terminal', 'deploy', 'telegram', 'whatsapp', 'webchat', 'catalog')
ON CONFLICT (tenant_id, feature) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

INSERT INTO tenant_policies (tenant_id, feature, enabled)
SELECT
  t.id,
  f.feature::feature_policy,
  TRUE
FROM tenants t
CROSS JOIN (
  VALUES
    ('swarm'),
    ('terminal'),
    ('deploy'),
    ('telegram'),
    ('whatsapp'),
    ('webchat'),
    ('catalog')
) AS f(feature)
LEFT JOIN tenant_policies tp
  ON tp.tenant_id = t.id
 AND tp.feature = f.feature::feature_policy
WHERE tp.id IS NULL;

DROP TABLE IF EXISTS tenant_policies_legacy_010;

CREATE OR REPLACE FUNCTION set_tenant_policy_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_policy_updated_at ON tenant_policies;
CREATE TRIGGER trg_tenant_policy_updated_at
BEFORE UPDATE ON tenant_policies
FOR EACH ROW
EXECUTE FUNCTION set_tenant_policy_updated_at();

CREATE OR REPLACE FUNCTION seed_tenant_policies()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO tenant_policies (tenant_id, feature, enabled)
  SELECT
    NEW.id,
    f.feature::feature_policy,
    TRUE
  FROM (
    VALUES
      ('swarm'),
      ('terminal'),
      ('deploy'),
      ('telegram'),
      ('whatsapp'),
      ('webchat'),
      ('catalog')
  ) AS f(feature)
  ON CONFLICT (tenant_id, feature) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_tenant_policies ON tenants;
CREATE TRIGGER trg_seed_tenant_policies
AFTER INSERT ON tenants
FOR EACH ROW
EXECUTE FUNCTION seed_tenant_policies();
