CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_timestamp
  ON admin_audit_log("timestamp" DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin
  ON admin_audit_log(admin_id, "timestamp" DESC);
