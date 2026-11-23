# Petra Field Operations

Field operations app (installable PWA) for Petra crews and office (used across the Petra companies): time clock, payroll review, calculators, Job Center, field work orders, daily field reports, and product/SDS libraries. English and Spanish.

- **Plan and decisions:** [docs/ARCHITECTURE_PLAN.md](docs/ARCHITECTURE_PLAN.md)
- **Setup, environment and tests:** [docs/SETUP.md](docs/SETUP.md)

## Status

| Phase | Status |
|---|---|
| 1. Foundation (auth, roles, security, home screen, management shell, projects, employees) | Done; sign-in tested for every role against the dev Supabase project |
| 2. Calculators | Done: five calculators, offline (airplane mode), and "Save to job"  |
| 3. Jobs & work orders | Done: work orders (revisions, crew confirmation, drawings, notifications), templates, Job Center (my jobs + past work orders library), loading checklists, PDF export |
| 4. Product & SDS library | Done: office library (products, approval, TDS/SDS versions), field tiles (product data sheets, SDS with offline save, in-app PDF viewer), products on work orders with pinned data sheet versions, calculator auto-fill (Dew Point uses the product's margin) |
| 5. Time Clock | Done: clock in/out, Job/Drive/Ride, lunch, GPS with status, segments that can't overlap, crew clock-in, timesheets (fixes with reasons keep the original, requests, lead submit, office approve/lock/reopen) |
| 6. Payroll | Done: pay rates (private), weighted-average overtime engine, Payroll page with Gusto entry sheet (PDF/CSV), mark as entered (permanent snapshot) |
| 7. Calendar & leave | Done: calendar (job days, holidays, approved time off), private calendar links for Apple/Outlook/Google, time-off requests with crew lead then office approval and notifications |
| 8. Field reporting | Done: optional daily field reports (readings with dew point, material and spread rate, versions, review), jobsite issues with PM notification, photos (4096 px + thumbnails, private storage), QC tests with optional limits (pass/fail only with a limit) |
| 9. Offline & production readiness | In progress: Time Clock works with no signal (phone queue, Sync page); daily reports and photos offline, security review, backups and go-live checklist next |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Postgres + Row Level Security, Auth, Storage) · next-intl · Vitest · Playwright · Vercel
