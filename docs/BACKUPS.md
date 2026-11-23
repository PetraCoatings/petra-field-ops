# Backups and restoring

## The short version (for the owner)

- **Every night at about 2 AM**, GitHub makes an encrypted copy of everything
  in the app's database: people, jobs, work orders, time, payroll records,
  daily reports, QC readings and the change log. **Every Sunday** the copy also
  includes every stored file: drawings, data sheets and job photos.
- **Straight after each backup, it practises a restore.** It opens the backup
  in a brand-new empty database and checks that every table has exactly the
  same number of rows and every file is unchanged. A green check in GitHub →
  Actions → Backup means last night's backup can really be restored.
- **If a backup or practice restore fails, GitHub emails you.** Forward that
  email to whoever helps you with the app.
- Backups are kept for **30 days**.
- Backups are locked with **your backup passphrase**. Nobody can open a backup
  without it — not GitHub, not a helper, not you. **Keep it in your password
  manager.** If it's lost, the backups are useless (a new passphrase only
  protects backups made after the change).

Supabase's own daily backups (included in the paid Pro plan) are a second
layer: Supabase can roll the whole database back to any of the last 7 days
from its dashboard. Those don't include stored files; ours do.

## What is in a backup

One file named `petra-backup-<date>.tar.gz.gpg` (AES-256 encrypted), holding:

| Part | What |
|---|---|
| `db.dump` | The app's data and its rules (schemas `public`, `app`, `audit`) |
| `auth.dump` | Sign-in accounts (schema `auth`) |
| `counts.txt` | Rows per table when the backup was made |
| `files/` | Sundays and manual runs: every stored file, with `files.sha256` checksums |
| `manifest.txt` | When it was made, and with which tools |

## Making a backup right now

GitHub → the repository → **Actions** → **Backup** → **Run workflow** → Run.
Leave "Include every stored file" ticked. About 3 minutes.

## Getting a backup out

GitHub → **Actions** → **Backup** → click a green run → at the bottom,
**Artifacts** → download `petra-backup-…`. It downloads as a `.zip` holding
the encrypted `.gpg` file.

## Restoring after a disaster (for a technical helper)

You need: the backup file, the backup passphrase, and a computer with
`gpg`, `node` 22 and PostgreSQL 17 tools (`pg_restore`, `psql`).

1. **Open it.**
   ```bash
   gpg --decrypt petra-backup-DATE.tar.gz.gpg | tar -xzf -
   ```
2. **Practise first** (optional, recommended): restore into an empty local
   database and check it —
   `TARGET_DB_URL=postgres://… BACKUP_PASSPHRASE=… scripts/backup/restore-drill.sh petra-backup-DATE.tar.gz.gpg`
3. **Choose where to restore.**
   - *Data was damaged or deleted, project still exists:* the fastest fix is
     Supabase Dashboard → Database → Backups (Pro plan) → restore a day.
     Use our backup when the damage is older than Supabase's 7 days, or for files.
   - *The project is gone:* create a new Supabase project (same region),
     then continue.
4. **Restore the data** into the new project, using its session connection
   string (Dashboard → Connect → Session pooler):
   ```bash
   pg_restore --no-owner --dbname="$NEW_DB_URL" --data-only --table=users --table=identities petra-backup-DATE/auth.dump
   pg_restore --no-owner --dbname="$NEW_DB_URL" petra-backup-DATE/db.dump
   ```
   Messages about Supabase's own roles or extensions already existing are
   expected. Then compare row counts:
   `psql "$NEW_DB_URL" -At -f scripts/backup/counts.sql | sort | diff - <(grep -v '^auth' petra-backup-DATE/counts.txt)`
5. **Restore the files.** Create the buckets `fwo-files`, `product-docs` and
   `job-photos` (private) by running the storage part of the migrations in
   `supabase/migrations` (search for `storage.buckets`), then upload each
   folder under `files/<bucket>/` to the bucket of the same name, keeping
   the paths (Supabase CLI `supabase storage cp -r`, or the dashboard).
6. **Point the app at it.** In Vercel → Settings → Environment Variables, set
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
   `SUPABASE_SECRET_KEY` to the new project's values; redeploy. In Supabase →
   Authentication → URL configuration, add the site address and
   `/auth/callback` as in `docs/SETUP.md`. Update the three GitHub secrets
   used by the backup.
7. **Check:** sign in as an office admin; open a job, a timesheet, a data
   sheet and a photo.

## Setting it up (once)

GitHub → the repository → **Settings → Secrets and variables → Actions →
New repository secret**, three times:

| Name | Value |
|---|---|
| `SUPABASE_DB_URL` | Supabase → **Connect** → *Session pooler* connection string, with `[YOUR-PASSWORD]` replaced by the database password |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → **API Keys** → the secret key (same one Vercel has) |
| `BACKUP_PASSPHRASE` | A new random password of at least 24 characters from your password manager. Save it there first. |

Then run it once (see "Making a backup right now").

## Later

- When job photos pass a few hundred megabytes, move the Sunday file copies
  to low-cost storage (e.g. Backblaze B2 or Cloudflare R2) so GitHub's storage
  limits never get in the way.
- GitHub turns off nightly jobs in a repository with no changes for 60 days.
  If that happens it emails you; one click on "Enable workflow" turns it back on.
