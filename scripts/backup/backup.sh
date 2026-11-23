#!/usr/bin/env bash
# =============================================================================
# Petra Field Operations — backup
#
# Makes one encrypted file holding:
#   db.dump      the app's data and rules (schemas public, app, audit)
#   auth.dump    sign-in accounts (schema auth)
#   counts.txt   how many rows each table had, to check a restore against
#   files/       (when WITH_FILES=1) every stored file: work order drawings,
#                data sheets, job photos — plus files.sha256 to check them
#
# Encrypted with AES-256 using BACKUP_PASSPHRASE. Without the passphrase the
# backup can't be opened, so keep the passphrase in the owner's password manager.
#
# Needs: SUPABASE_DB_URL, BACKUP_PASSPHRASE; for files also SUPABASE_URL and
# SUPABASE_SECRET_KEY. PG_BIN may point at a pg_dump matching the server.
# Usage: scripts/backup/backup.sh OUT_DIR
# =============================================================================
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
if [ "${#BACKUP_PASSPHRASE}" -lt 20 ]; then
  echo "BACKUP_PASSPHRASE must be at least 20 characters" >&2
  exit 1
fi
OUT="${1:?usage: backup.sh OUT_DIR}"
BIN="${PG_BIN:+$PG_BIN/}"
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
NAME="petra-backup-$STAMP"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DIR="$WORK/$NAME"
mkdir -p "$DIR" "$OUT"

echo "Dumping the database…"
"${BIN}pg_dump" "$SUPABASE_DB_URL" --format=custom --schema=public --schema=app --schema=audit --file="$DIR/db.dump"
"${BIN}pg_dump" "$SUPABASE_DB_URL" --format=custom --schema=auth --file="$DIR/auth.dump"

echo "Counting rows…"
"${BIN}psql" "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -At -f "$HERE/counts.sql" | sort > "$DIR/counts.txt"
"${BIN}psql" "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -At -c "select 'auth.users|' || count(*) from auth.users" >> "$DIR/counts.txt"

if [ "${WITH_FILES:-0}" = "1" ]; then
  echo "Downloading stored files…"
  node "$HERE/download-files.mjs" "$DIR/files"
  (cd "$DIR/files" && find . -type f ! -name files.sha256 -print0 | sort -z | xargs -0 -r sha256sum > files.sha256)
fi

{
  echo "made_at=$STAMP"
  echo "with_files=${WITH_FILES:-0}"
  "${BIN}pg_dump" --version | sed 's/^/pg_dump=/'
} > "$DIR/manifest.txt"

echo "Encrypting…"
tar -czf - -C "$WORK" "$NAME" \
  | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 \
        --output "$OUT/$NAME.tar.gz.gpg" 3<<<"$BACKUP_PASSPHRASE"
echo "Backup written: $OUT/$NAME.tar.gz.gpg ($(du -h "$OUT/$NAME.tar.gz.gpg" | cut -f1))"
grep -c . "$DIR/counts.txt" | sed 's/^/Tables counted: /'
