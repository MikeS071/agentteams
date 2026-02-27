-- Admin roles for platform-level access control
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT;

UPDATE users
SET role = CASE
  WHEN is_admin = TRUE THEN 'admin'
  ELSE 'user'
END
WHERE role IS NULL;

ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'user';

ALTER TABLE users
  ALTER COLUMN role SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'disabled'));
  END IF;
END $$;
