ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS container_port INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_container_port_unique
  ON tenants(container_port)
  WHERE container_port IS NOT NULL;
