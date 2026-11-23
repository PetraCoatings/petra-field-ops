#!/usr/bin/env bash
# =============================================================================
# Petra Field Operations — practice restore
#
# Opens a backup made by backup.sh and restores it into an EMPTY PostgreSQL
# database (never the live one), then proves it worked:
#   * every table has exactly as many rows as when the backup was made
#   * key records can be read back (people, jobs, time, payroll, audit log)
#   * every stored file is present and unchanged (checksums)
#
# Needs: BACKUP_PASSPHRASE, TARGET_DB_URL (an empty database, superuser).
# Usage: scripts/backup/restore-drill.sh BACKUP_FILE.tar.gz.gpg
# =============================================================================
set -euo pipefail
FILE="${1:?usage: restore-drill.sh BACKUP_FILE}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
: "${TARGET_DB_URL:?TARGET_DB_URL is not set}"
BIN="${PG_BIN:+$PG_BIN/}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fail() { echo "::error::Practice restore failed: $*"; echo "FAILED: $*" >&2; exit 1; }

if [ "$("${BIN}psql" "$TARGET_DB_URL" -At -c "select count(*) from pg_namespace where nspname in ('app', 'audit', 'auth')")" != "0" ]; then
  fail "the target database is not empty — refusing to restore over it"
fi

echo "Decrypting…"
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$FILE" 3<<<"$BACKUP_PASSPHRASE" | tar -xzf - -C "$WORK" \
  || fail "could not decrypt (wrong passphrase or damaged file)"
DIR="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)"
cat "$DIR/manifest.txt"

echo "Preparing the empty database (Supabase's built-in roles and extensions)…"
"${BIN}psql" "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -q -f "$HERE/drill-setup.sql"

echo "Restoring sign-in accounts…"
"${BIN}pg_restore" --no-owner --no-privileges --dbname="$TARGET_DB_URL" "$DIR/auth.dump" 2> "$WORK/auth.err" || true
echo "Restoring the app's data…"
"${BIN}pg_restore" --no-owner --dbname="$TARGET_DB_URL" "$DIR/db.dump" 2> "$WORK/db.err" || true
# Supabase-only parts (its internal roles, event triggers, extensions we don't
# need) can't exist in a plain database; anything else is a real failure.
IGNORE='role "[a-z_]+" does not exist|schema "(public|extensions)" already exists|extension "[a-z_]+" (already exists|is not available)|must be owner of|event trigger|pg_graphql|pgsodium|supabase_vault|pg_net|pgjwt|warning: errors ignored on restore|^pg_restore: (from TOC entry|while PROCESSING TOC|error: could not execute query: ERROR:  (role|schema|extension))|^Command was:|^LINE [0-9]+:|^ +\^|^\s*$|^(CREATE|ALTER|COMMENT|GRANT|REVOKE) '
for part in auth db; do
  if grep -Ev "$IGNORE" "$WORK/$part.err" | grep -q .; then
    echo "---- unexpected $part restore messages ----"
    cat "$WORK/$part.err"
    fail "restoring $part.dump reported errors (see above)"
  fi
done

echo "Comparing row counts…"
"${BIN}psql" "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -At -f "$HERE/counts.sql" | sort > "$WORK/counts.restored"
"${BIN}psql" "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -At -c "select 'auth.users|' || count(*) from auth.users" >> "$WORK/counts.restored"
sort -o "$WORK/counts.restored" "$WORK/counts.restored"
sort "$DIR/counts.txt" > "$WORK/counts.backup"
if ! diff -u "$WORK/counts.backup" "$WORK/counts.restored"; then
  fail "row counts differ from the backup (see above)"
fi
TABLES=$(grep -c . "$WORK/counts.backup")
ROWS=$(awk -F'|' '{s+=$2} END {print s}' "$WORK/counts.backup")

echo "Reading key records back…"
"${BIN}psql" "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -q -At -F " " -f "$HERE/drill-checks.sql" || fail "key records could not be read back"

FILES=0
if [ -f "$DIR/files/files.sha256" ]; then
  echo "Checking stored files…"
  (cd "$DIR/files" && sha256sum --quiet -c files.sha256) || fail "some stored files are missing or changed"
  FILES=$(grep -c . "$DIR/files/files.sha256")
fi

MSG="Practice restore passed: $TABLES tables, $ROWS rows match the backup exactly; $FILES stored files verified."
echo "::notice::$MSG"
echo "$MSG"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "### ✅ $MSG"; echo; echo '```'; cat "$DIR/manifest.txt"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
fi
