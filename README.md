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
| 5. Time Clock | In progress: clock in/out, Job/Drive/Ride switching, lunch, GPS with status, segments that can't overlap; group clock-in and timesheets next |
| 6–9 | Not started |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Postgres + Row Level Security, Auth, Storage) · next-intl · Vitest · Playwright · Vercel
