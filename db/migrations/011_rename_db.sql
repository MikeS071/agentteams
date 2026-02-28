-- DB rename note:
-- PostgreSQL database rename requires connecting to a different database
-- (for example "postgres"), then reconnecting after rename.
--
-- Manual step to run outside transactional migrations:
--   ALTER DATABASE <previous_db_name> RENAME TO agentsquads;
--
-- This migration is intentionally a no-op and only documents the required step.
SELECT 1;
