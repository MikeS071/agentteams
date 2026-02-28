CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'adjustment',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS type TEXT;

ALTER TABLE credit_transactions
  ALTER COLUMN type SET DEFAULT 'adjustment';

UPDATE credit_transactions
SET type = CASE
  WHEN LOWER(reason) LIKE '%stripe%' OR LOWER(reason) LIKE '%purchase%' THEN 'purchase'
  WHEN LOWER(reason) LIKE '%usage%' OR amount_cents < 0 THEN 'deduct'
  WHEN LOWER(reason) LIKE '%grant%' OR LOWER(reason) LIKE '%free%' OR LOWER(reason) LIKE '%signup%' THEN 'grant'
  ELSE 'adjustment'
END
WHERE type IS NULL;

ALTER TABLE credit_transactions
  ALTER COLUMN type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'credit_transactions_type_check'
  ) THEN
    ALTER TABLE credit_transactions
      ADD CONSTRAINT credit_transactions_type_check
      CHECK (type IN ('grant', 'deduct', 'purchase', 'adjustment'));
  END IF;
END $$;

ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_credit_transactions_tenant_created_at
  ON credit_transactions(tenant_id, created_at DESC);
