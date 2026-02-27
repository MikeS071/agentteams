#!/usr/bin/env bash
set -euo pipefail

DB_URL="${DATABASE_URL:?Set DATABASE_URL}"
MIGRATIONS_DIR="$(dirname "$0")/migrations"

for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "Applying $(basename "$f")..."
  psql "$DB_URL" -f "$f"
done

echo "All migrations applied."
