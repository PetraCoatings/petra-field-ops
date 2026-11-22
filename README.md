# Petra Field Operations

Field operations app (installable PWA) for Petra crews and office (used across the Petra companies): time clock, payroll review, calculators, Job Center, field work orders, daily field reports, and product/SDS libraries. English and Spanish.

- **Plan and decisions:** [docs/ARCHITECTURE_PLAN.md](docs/ARCHITECTURE_PLAN.md)
- **Setup, environment and tests:** [docs/SETUP.md](docs/SETUP.md)

## Status

| Phase | Status |
|---|---|
| 1. Foundation (auth, roles, security, home screen, management shell, projects, employees) | Done; sign-in tested for every role against the dev Supabase project |
| 2. Calculators | Done: five calculators, offline (airplane mode), and "Save to job"  |
| 3. Projects & work orders | In progress: work orders and templates done; loading checklists and PDF next |
| 4–9 | Not started |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Postgres + Row Level Security, Auth, Storage) · next-intl · Vitest · Playwright · Vercel
