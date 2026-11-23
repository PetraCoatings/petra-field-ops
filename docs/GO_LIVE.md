# Go-live checklist

What's left before the whole crew relies on Petra Field Operations. Work top
to bottom; each step says who does it and roughly how long it takes.

## Already done

- [x] Security review, with fixes (`docs/SECURITY_REVIEW.md`)
- [x] Nightly encrypted backups, with an automatic practice restore (`docs/BACKUPS.md`)
- [x] Two-step sign-in required for office admins. Travis is set up.

## 1. Paid plans (owner, 10 minutes)

- [ ] **Supabase Pro** (about $25/month). Supabase → Organization → Billing → upgrade.
  - Free projects **pause after a week without use**. A paused app means nobody can clock in.
  - Pro adds Supabase's own daily backups (7 days) on top of ours, and room for job photos.
  - After upgrading, turn on **Authentication → Attack Protection → Leaked password protection**. It blocks passwords known from data breaches.
- [ ] **Vercel Pro** (about $20/month per team member). Vercel → Settings → Billing.
  - The free Hobby plan is for non-commercial use only.

## 2. A real email sender (owner + Claude, 30 minutes)

Supabase's built-in email only reaches the Supabase account's own team members, and
only a few emails an hour. That's why Troye's invite never arrived.
Invites and "forgot password" emails need a proper sender:

- [ ] Create a free **Resend** account (resend.com). The free tier is 3,000 emails/month.
- [ ] Add the domain **petracoatings.com** in Resend. It shows 3–4 DNS records.
  Add them where the domain is managed (GoDaddy, Squarespace, Google…).
  Claude can walk through this with screenshots.
- [ ] In Supabase → Authentication → Emails → **SMTP Settings**, turn on custom SMTP:
  - host `smtp.resend.com`, port `465`, user `resend`;
  - password: a Resend API key;
  - sender `no-reply@petracoatings.com`, name "Petra Coatings".
- [ ] Paste the bilingual email templates (`supabase/templates/invite.html`,
  `recovery.html`) into *Invite user* and *Reset password* (see `docs/SETUP.md`).
- [ ] Test: invite yourself at a second email address, and use "Forgot password".

## 3. Settings (owner, 10 minutes)

- [ ] **Vercel → Settings → Environment Variables**: add `NEXT_PUBLIC_SITE_URL` =
  `https://petra-field-ops.vercel.app` (or your own domain, if you add one). Then redeploy.
  Email links then always point at the real site.
- [ ] **Supabase → Authentication → Providers → Email**: turn on **Secure password change**,
  and set the minimum password length to **10** (the app already asks for 10).
- [ ] **Supabase → Authentication → URL Configuration**: confirm Site URL is the app
  address, and Redirect URLs include `/auth/confirm` and `/auth/accept` (see `docs/SETUP.md`).

## 4. People (owner + Gandy, 15 minutes)

- [ ] **Gandy sets up two-step sign-in** (Google Authenticator) the next time she signs in.
  You two can then reset each other's if a phone is lost.
- [ ] Check every employee's **email, role, and pay rates** on the Employees page.
- [ ] After step 2 works: **send invites** to the crew. Anyone who has trouble can get a
  sign-in link from their employee page instead.

## 5. Keep tests away from live data (Claude, with one step from the owner)

The automated browser tests currently run against the live database. They clean
up after themselves and never touch payroll, but live data and tests shouldn't share a home.

- [ ] Owner: create a second, **free** Supabase project named "petra-field-ops-dev".
  Add its keys to this coding environment's secrets (Claude will say exactly where).
- [ ] Claude: apply all migrations there and point the tests at it.

## 6. Recommended

- [ ] **Make the GitHub repository private**: GitHub → Settings → General → Danger Zone →
  Change visibility. Nothing secret is in it (checked), but there's no reason for it to be public.
- [ ] **Own address** such as `app.petracoatings.com`: Vercel → Domains, plus one DNS record.
  If you do this, update `NEXT_PUBLIC_SITE_URL` and the Supabase URL settings to match.
- [ ] **How long to keep records:** the app never deletes time or payroll records. Federal
  rules require payroll records for 3 years and time cards for 2 years. Ask your CPA
  whether Texas or your insurer want longer. Nothing needs to change in the app.
