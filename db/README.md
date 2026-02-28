# AgentSquads Database

## Running Migrations

```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/agentsquads"
bash db/migrate.sh
```

Migrations run in filename order from `db/migrations/`. Each file is applied via `psql`.

## Files

- `migrations/001_init.sql` — All tables (users, tenants, conversations, messages, usage, credits, models, channels, policies, workflows)
- `migrations/002_seed_models.sql` — Seed LLM model pricing data
