#!/usr/bin/env bash
# =============================================================================
# Applies supabase/migrations/*.sql, in order, to the TEST (dev) database:
# each one once, in its own transaction, remembered in
# dev_tools.applied_migrations. Refuses to touch the live project.
#
# The live database is still updated by hand in the Supabase SQL Editor.
# Runs in CI before the browser tests (.github/workflows/ci.yml).
# Usage: DEV_DB_URL=postgresql://… scripts/apply-migrations.sh
# =============================================================================
set -euo pipefail
: "${DEV_DB_URL:?DEV_DB_URL is not set}"
LIVE_REF="oledxskbtjiqyyyaoqdd" # the live project: never apply automatically
case "$DEV_DB_URL" in *"$LIVE_REF"*) echo "Refusing: DEV_DB_URL points at the LIVE project" >&2; exit 1 ;; esac
BIN="${PG_BIN:+$PG_BIN/}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
q() { "${BIN}psql" "$DEV_DB_URL" -v ON_ERROR_STOP=1 -q "$@"; }

q -c "create schema if not exists dev_tools;
      create table if not exists dev_tools.applied_migrations (name text primary key, applied_at timestamptz not null default now());"
applied=0
for f in "$HERE"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  if [ "$(q -At -c "select count(*) from dev_tools.applied_migrations where name = '$name'")" = "1" ]; then continue; fi
  echo "Applying $name"
  q -1 -f "$f" -c "insert into dev_tools.applied_migrations (name) values ('$name')"
  applied=$((applied + 1))
done
echo "Test database up to date ($applied new)."
