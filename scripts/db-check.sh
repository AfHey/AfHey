#!/usr/bin/env bash
# Verifies the local PostgreSQL setup this project expects: server reachable,
# afhey role can log in, and both databases exist. Zero exit = ready.
set -euo pipefail

PGBIN="$(brew --prefix 2>/dev/null)/opt/postgresql@18/bin"
if [ ! -x "$PGBIN/psql" ]; then
  PGBIN="$(dirname "$(command -v psql || true)")"
fi
if [ -z "$PGBIN" ] || [ ! -x "$PGBIN/psql" ]; then
  echo "psql not found. Install PostgreSQL: brew install postgresql@18" >&2
  exit 1
fi

"$PGBIN/pg_isready" -h localhost -q || {
  echo "PostgreSQL is not accepting connections. Start it: brew services start postgresql@18" >&2
  exit 1
}

for db in afhey_dev afhey_test; do
  PGPASSWORD=afhey "$PGBIN/psql" -h localhost -U afhey -d "$db" -tAc "SELECT 1" >/dev/null || {
    echo "Cannot connect to $db as role afhey. See README 'Database setup'." >&2
    exit 1
  }
  echo "ok: $db"
done
echo "Database setup looks good."
