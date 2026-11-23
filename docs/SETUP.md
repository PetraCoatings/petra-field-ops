# Setup and development

## What you need

| Item | Development | Production |
|---|---|---|
| Supabase | Free project is fine (use a separate **dev** project) | **Paid plan** (automatic backups, no pausing) |
| Vercel | Hobby is fine for testing | **Pro** (Hobby is for non-commercial use) |
| Email | Supabase's built-in sender (very low hourly limit) | Your own SMTP provider configured in Supabase |

## 1. Create the Supabase dev project

1. In the Supabase dashboard, create a project (e.g. `petra-field-ops-dev`), region close to Texas.
2. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up". Only office admins invite people.
3. **Authentication → URL Configuration:** set Site URL to your app URL and add both `<app-url>/auth/confirm` and `<app-url>/auth/accept` to Redirect URLs.
4. **Email templates (after custom SMTP is set up):** paste `supabase/templates/invite.html` into *Invite user* and `recovery.html` into *Reset password* (Authentication → Emails → Templates). They are bilingual and link to `/auth/start`, which uses the one-time token only when the person taps **Continue**, so email scanners (Outlook Safe Links, Gmail) opening the link first can't use it up. Without them, the app still works with Supabase's **default** templates: invitations land on `/auth/accept` (tokens in the URL fragment), password resets on `/auth/confirm` (`?code=`).
   - With the default templates, a password-reset link must be opened in the same browser where the reset was requested (Supabase's one-time-code security). The custom templates remove that limitation.
5. **Authentication → Policies:** minimum password length 10, require letters and digits.
6. Apply the database migrations: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
   - **No direct database connection?** (Claude cloud sessions can only make HTTPS requests, so port 5432 is blocked.) Paste each file in `supabase/migrations/`, oldest first, into **SQL Editor → New query** and click **Run**. Never paste anything from `supabase/tests/`.

## 2. Create the first office administrator

No one can sign in until there is at least one office admin. In the Supabase dashboard:

1. **Authentication → Users → Invite user** with the administrator's email.
2. **SQL Editor**, run (with the real name and email):

```sql
insert into public.employees (user_id, first_name, last_name, email, role, flsa_status)
select id, 'First', 'Last', email, 'office_admin', 'nonexempt'
from auth.users where email = 'admin@example.com';
```

After that, the admin invites everyone else from **Management → Employees**.

## 3. Environment variables

Copy `.env.example` to `.env.local` and fill in values from **Project Settings → API Keys**. In Vercel, add the same variables under **Settings → Environment Variables**. `SUPABASE_SECRET_KEY` must never be prefixed with `NEXT_PUBLIC_` and must never be pasted into chat or committed.

## 4. Run locally

```bash
npm install
npm run dev
```

## 5. Tests

| Command | What it checks |
|---|---|
| `npm run test:unit` | Pure logic (navigation rules, form parsing, translations) |
| `npm run test:db` | Applies all migrations to a fresh PostgreSQL database and tests Row Level Security as each role, including forbidden requests. Needs `TEST_DATABASE_URL` (PostgreSQL 16+). |
| `npm run test:e2e` | Browser tests on iPhone, Android and desktop sizes. Builds the app first. Set `PW_CHROMIUM_PATH` to use an already-installed Chromium. |
| `npm run test:e2e` with a dev project | Also signs in as **every role** and checks which pages each may open. Set `E2E_SUPABASE_URL`, `E2E_SUPABASE_KEY` (publishable) and `E2E_SUPABASE_SECRET_KEY` to the **dev** project's values. Temporary `@example.test` logins are created before the run and deleted after it; their audit-log rows remain. Never point this at production. |
| `npm run typecheck`, `npm run lint` | Static checks |
| `npm run check:bundle` | After a build, fails if a server secret appears in browser code |

`supabase/tests/supabase-shim.sql` recreates the parts of Supabase (roles, `auth.uid()`) that the migrations need, so the security tests run on plain PostgreSQL. **It is for tests only and must never be applied to a real project.**

## Notes

- **Next.js 16:** request middleware lives in `src/proxy.ts` (the new name for `middleware.ts`). Cache Components is turned off on purpose; see `next.config.ts`.
- **Languages:** text lives in `messages/en.json` and `messages/es.json`. A test fails if the two files ever have different keys. Spanish text should be reviewed by a native speaker at Petra before launch.
- **Offline (airplane mode):** `public/sw.js` is a hand-written service worker, registered for signed-in users in production builds only. It saves the five calculator pages and their code, so they open with no signal. Every other page shows `public/offline.html` when offline. Job, time and pay data are never cached. Signing out (or landing on the sign-in page) clears the saved pages and remembered calculator entries. On iPhone, add the app to the Home Screen; Safari may otherwise drop saved data from sites not opened for about a week. When adding a new offline page, list it in `OFFLINE_ROUTES` in `public/sw.js`.
- **Brand:** colors in `src/app/globals.css` (`--color-brand-*`) and the "P" icons in `public/icons/` are placeholders for Petra's real logo and colors.

## Test database (browser tests)

The browser tests create and delete people, jobs and time, so they run against
a **separate, free Supabase project** ("petra-field-ops-dev", in its own free
organization), never the live one (`e2e/support/global-setup.ts` refuses the
live project). In GitHub Actions (`.github/workflows/ci.yml`) every run:

1. applies any new `supabase/migrations/*.sql` to the test project
   (`scripts/apply-migrations.sh`, which also refuses the live project), then
2. runs all browser tests against it, one run at a time.

Repository secrets: `DEV_SUPABASE_URL`, `DEV_SUPABASE_PUBLISHABLE_KEY`,
`DEV_SUPABASE_SECRET_KEY`, `DEV_SUPABASE_DB_URL` (the test project's session
pooler connection string). The live database is still updated by pasting each
new migration into its SQL Editor.

A free project pauses after a week without use; if the browser tests start
failing to connect, open the test project in Supabase and click **Restore**.
