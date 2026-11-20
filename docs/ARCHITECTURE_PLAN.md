# Petra Field Operations — Architecture & Development Plan

**Status:** Proposal, awaiting approval. No application code has been written yet.
**Owner:** Petra Industrial Flooring LLC (PIF)
**Scope:** Covers the 11 items in section 23 of the master development prompt ("Required First Response").

> Conventions in this document
> - **[Q#]** is an open question listed in §11. It must be answered before the phase that depends on it.
> - **[Assumption]** is a default I'll use unless you tell me otherwise.
> - **[Verify]** is a fact I'll confirm against current vendor documentation before building the feature that depends on it. I won't rely on memory for it.

---

## 1. Proposed system architecture

```
 ┌──────────────────────────── Devices (PWA) ─────────────────────────────┐
 │  iPhone / Android / iPad / Mac / Windows browsers, installable PWA      │
 │                                                                         │
 │  Next.js React UI ──► Local data layer (IndexedDB via Dexie)            │
 │        │                 ├─ cached reference data (jobs, FWOs, SDS…)    │
 │        │                 └─ OUTBOX: queued offline writes (UUID-keyed)  │
 │  Service worker (Serwist): app-shell + document caching, background sync│
 └────────┬────────────────────────────────────────────────────────────────┘
          │ HTTPS (user's Supabase JWT, never a service key)
 ┌────────▼──────────────── Vercel (Next.js server) ───────────────────────┐
 │  Server Components / Route Handlers / Server Actions                    │
 │   • input validation (zod)          • PDF generation (FWO, payroll)     │
 │   • calls Postgres RPCs as the user • sync endpoint (idempotent batch)  │
 │   • admin-only ops (invite user) use service-role key — server env only │
 └────────┬────────────────────────────────────────────────────────────────┘
          │
 ┌────────▼──────────────────── Supabase ──────────────────────────────────┐
 │  Postgres  — schema, constraints, RLS on every table, audit triggers,   │
 │              SECURITY DEFINER RPCs for critical state transitions       │
 │  Auth      — email/password + recovery; MFA for office admins           │
 │  Storage   — private buckets (photos, TDS, SDS, FWO PDFs), signed URLs  │
 └─────────────────────────────────────────────────────────────────────────┘

 Shared pure-TypeScript domain packages (no UI, no I/O, fully unit tested):
   /src/domain/payroll      weighted-average OT engine (decimal.js)
   /src/domain/calculators  area, spread rate, mils, mix ratio, dew point
   /src/domain/timeclock    segment building, week splitting, validation
```

**Key principles**

1. **The database is the security boundary.** Every table has RLS. The UI hides things for convenience, not for security. Critical transitions (clock events, approvals, locking a pay period, publishing an FWO revision) go through Postgres functions that check role and state inside a transaction.
2. **Calculations live in pure, framework-free modules.** The same calculator and payroll code runs in the browser (offline) and on the server (authoritative). Payroll results are always recomputed on the server before approval.
3. **Append-only for anything legally or financially significant.** That covers raw clock events, time corrections, FWO revisions, submitted DFRs, payroll snapshots and the audit log. Corrections add new records and never overwrite old ones.
4. **Single company (single tenant).** No multi-tenant `organization_id` columns. This keeps the schema simple, and a tenant column could be added later if it were ever needed.
5. **Modular by feature** (`/src/features/timeclock`, `/features/jobs`, …) so that future modules (inventory, training, cost tracking) slot in without restructuring.

---

## 2. Technology stack and reasons

Versions are the current stable releases on npm as of 2026‑11‑20. They'll be pinned exactly in `package.json` at Phase 1 and checked for mutual compatibility at that point.

| Layer | Choice | Version (today) | Why |
|---|---|---|---|
| Framework | Next.js (App Router) | 16.x | Your preference. SSR plus server actions keeps secrets server-side and deploys natively on Vercel. |
| UI | React | 19.x | Required by Next 16. |
| Language | TypeScript, strict mode | 5.x or 7.x **[Verify]** | TS 7 (the native compiler) is current. I'll use it only if Next 16 tooling fully supports it, and otherwise pin the latest 5.x. |
| Styling | Tailwind CSS | 4.x | Your preference. Large touch targets and high-contrast design tokens. |
| DB / Auth / Files | Supabase (Postgres, Auth, Storage) | supabase-js 2.x, @supabase/ssr 0.12.x | Your preference. RLS gives database-level authorization. |
| Hosting | Vercel | — | Your preference. Note: Vercel's free Hobby plan is for non-commercial use, so production needs a **Pro** plan **[Verify current terms]**. |
| PWA / offline | Serwist (`@serwist/next`) | 9.x | The maintained successor to `next-pwa`. Handles precaching and runtime caching. |
| Local storage | Dexie (IndexedDB) | 4.x | Reliable structured offline storage and the outbox queue. |
| Money / decimals | decimal.js | 10.x | Exact decimal arithmetic. Payroll never uses JS floating-point numbers. Postgres stores money as `numeric`. |
| Validation | zod | 4.x | One schema shared by forms, the server and the sync endpoint. |
| PDF | @react-pdf/renderer | 4.x | Server-side FWO and payroll PDFs with no headless browser in production. |
| Tests | Vitest (unit), pgTAP / SQL tests (RLS), Playwright (E2E, offline, mobile viewports) | latest | Playwright can simulate a truly disconnected browser (`context.setOffline(true)`) and real phone viewports. |
| Dates / time zones | `Temporal` polyfill or date-fns-tz **[decide in Phase 1]** | — | All timestamps are stored as UTC `timestamptz`. Workweek math uses the company time zone. |

No changes to your preferred stack are recommended. The only additions are supporting libraries.

---

## 3. Database schema

Postgres, `public` schema unless noted. All tables have `id uuid pk`, `created_at`, and `updated_at` where they're mutable. Every table has RLS enabled. **Bold** marks tables that are append-only or immutable once submitted.

### 3.1 People and access

| Table | Key columns | Notes |
|---|---|---|
| `employees` | `user_id → auth.users` (nullable until invited), `first_name`, `last_name`, `display_name`, `phone`, `email`, `role` enum(`installer`,`crew_lead`,`project_manager`,`office_admin`), `employment_status`, `flsa_status` enum(`nonexempt`,`exempt`), `payroll_external_id` (Gusto ID mapping), `hire_date`, `is_active` | One role per person. A crew lead has every installer permission. See [Q2]. |
| `employee_private` | `employee_id`, `date_of_birth?`, `emergency_contact`, … | Split out so that RLS can make it admin-only. Only collected if needed. |
| **`employee_pay_rates`** | `employee_id`, `category` enum(`job`,`drive`,`ride`), `hourly_rate numeric(10,4)`, `effective_from timestamptz`, `created_by`, `reason` | Effective-dated. A new rate adds a row and never edits an old one. **Office admin only** (see [Q10] for whether employees may see their own rates). |
| `crews` / `crew_members` | `name`, `default_lead_id`; `crew_id`, `employee_id`, `from`, `to` | Optional standing crews [Q8]. |

### 3.2 Projects, work orders, templates

| Table | Key columns |
|---|---|
| `customers` | `name`, `notes` |
| `projects` | `job_number`, `name`, `customer_id`, `site_address` (structured), `site_lat/lng?`, `project_manager_id`, `crew_lead_id`, `scheduled_start`, `estimated_duration_days`, `scope_summary`, `total_sqft numeric`, `flooring_system`, `status` enum(`draft`,`scheduled`,`in_progress`,`on_hold`,`completed`,`closed`) |
| `project_contacts` | `project_id`, `name`, `role`, `phone`, `email` |
| `project_assignments` | `project_id`, `employee_id`, `role_on_job` (`lead`/`installer`), `start_date`, `end_date` |
| `project_financials` | `project_id`, contract values… *(placeholder table; only PM/admin can read it; future cost tracking)* |
| `field_work_orders` | `project_id`, `fwo_number`, `current_revision_id`, `status` (`draft`,`published`,`superseded`,`void`) |
| **`fwo_revisions`** | `fwo_id`, `revision_number`, `content jsonb` (full snapshot: project info, scope, materials, equipment, steps, QC tests), `change_summary`, `edited_by`, `published_at`, `pdf_storage_path` |
| `fwo_acknowledgments` | `fwo_revision_id`, `employee_id`, `acknowledged_at`, `device_ts` |
| `instruction_templates` / `template_steps` | Master templates. Using a template copies its steps into the FWO revision, so editing for a job never changes the master. |
| `equipment_catalog` | Reusable list of tools and equipment (grinders, extractors, PPE…) |
| `loading_checklists` / `loading_checklist_items` | Linked to an FWO revision. Each item has `description`, `required_qty`, `confirmed_qty`, `checked`, `flag_missing`, `notes`, `checked_by`, `checked_at`. |

Storing FWO revisions as **full snapshots in `jsonb`** keeps revision history exact, makes PDFs reproducible and makes offline caching trivial. Structured child tables would complicate versioning. Product references inside a snapshot point to a specific **`product_document_versions.id`**, which keeps "the exact document version assigned to a work order" pinned.

### 3.3 Products and documents

| Table | Key columns |
|---|---|
| `manufacturers` | `name` |
| `products` | `name`, `manufacturer_id`, `category`, `description`, `product_code`, nullable spec fields: `mix_ratio_a numeric`, `mix_ratio_b numeric`, `ratio_basis` (`volume`/`weight`), `recommended_coverage_sqft_per_gal`, `volume_solids_pct`, `recommended_wft_mils`, `recommended_dft_mils`, `min/max_application_temp_f`, `max_rh_pct`, `min_substrate_above_dew_point_f`, `pot_life_minutes`, `cure_notes`, `density_a/b_lb_per_gal` (optional, needed only for weight↔volume conversion), `spec_status` (`draft`/`approved`), `approved_by`, `approved_at` |
| **`product_document_versions`** | `product_id?`, `doc_type` (`tds`/`sds`), `storage_path`, `file_sha256`, `revision_date?`, `uploaded_by`, `is_current` |
| `sds_documents` | SDS records can exist with or without a product record (for example, for solvents and cleaners). Searchable by product name and manufacturer. |
| `project_documents` | Attachments on a job (`project_id`, `document_version_id` or free upload, `label`) |

Every spec field is optional. A blank field stays blank, and calculators show "not specified" rather than a guessed value.

### 3.4 Time and payroll

| Table | Key columns | Notes |
|---|---|---|
| `payroll_settings` (effective-dated) | `timezone` (e.g. `America/Chicago`), `workweek_start_dow`, `workweek_start_time`, `pay_period_type`, `pay_period_anchor_date`, `gps_on_switch bool`, `rounding_policy` | Effective-dated so that a history of workweek definitions is preserved. |
| **`time_events`** | `client_event_id uuid unique` (idempotency key), `employee_id`, `event_type` (`clock_in`,`switch`,`clock_out`,`break_start`,`break_end`), `category`, `project_id?`, `device_ts`, `server_received_at` (DB default), `actor_employee_id` (self or crew lead), `is_group_action`, `group_action_id?`, `gps_lat/lng/accuracy_m?`, `gps_status` (`captured`,`denied`,`unavailable`,`timeout`), `gps_source` (`own_device`/`group_leader_device`), `flags text[]` | **The raw, immutable record of what was pressed, by whom, when and where.** Never edited. |
| `time_segments` | `employee_id`, `category`, `project_id?`, `start_at`, `end_at?`, `is_paid_break bool?`, `source` (`events`,`correction`), `status` (`active`,`superseded`,`void`), `supersedes_id?`, `correction_reason?`, `corrected_by?`, `start_event_id`, `end_event_id` | Derived from events. A **Postgres exclusion constraint** (`EXCLUDE USING gist (employee_id WITH =, tstzrange(start_at, coalesce(end_at,'infinity')) WITH &&) WHERE status='active'`) makes overlapping active segments impossible at the database level. A partial unique index allows only one open segment per employee. |
| `timesheets` | `employee_id`, `workweek_start`, `status` (`open`,`lead_submitted`,`admin_approved`,`locked`), `submitted_by/at`, `approved_by/at` | Each status change is recorded in the audit log. |
| `time_exceptions` | `employee_id`, `type` (`missing_clock_out`,`duplicate`,`clock_skew`,`overlap_rejected`,`late_sync_into_locked_period`,`gps_missing`,…), `ref ids`, `resolved_by/at`, `resolution_note` | Feeds the review screens. |
| `payroll_periods` | `start`, `end`, `status` (`open`,`in_review`,`approved`,`exported`,`locked`) | A locked period rejects writes through RLS and triggers. |
| **`payroll_runs`** / **`payroll_lines`** | Immutable snapshot of each calculation: per employee and workweek, hours by category, rates applied (with the rate row ids), straight-time earnings, regular rate, OT hours, OT premium, gross, exceptions, `engine_version`, `input_hash` | Reproducible: you can always see exactly which inputs produced an approved number. |
| `payroll_exports` | `payroll_run_id`, `format_profile_id`, `file_path`, `exported_by/at` | Lets the app warn before anything is exported twice. |
| `export_format_profiles` | Configurable CSV column mapping | Gusto mapping is to be verified in Phase 6. |
| `holidays` | `date`, `name`, `is_paid`, `paid_hours?` | |
| `leave_types` | `name`, `is_paid` (no accruals until a policy is configured) | |
| `time_off_requests` | `employee_id`, `leave_type_id`, `start_date`, `end_date`, `partial_hours?`, `notes`, `status` (`pending_lead`,`pending_office`,`approved`,`rejected`,`cancelled`), `lead_decision_by/at/note`, `office_decision_by/at/note` | |

### 3.5 Field reporting and quality control

| Table | Key columns |
|---|---|
| `daily_field_reports` | `project_id`, `report_date`, `crew_lead_id`, `status` (`draft`,`submitted`,`correction_requested`,`accepted`), `version int` (optimistic concurrency) |
| **`dfr_versions`** | Full `jsonb` snapshot on every submission: employees present, work performed, areas, sqft, environment readings (ambient, RH, substrate temperature, unit, computed dew point, formula version), coating applications (product, lot, gallons, area, actual vs target spread rate, WFT/DFT measured), notes |
| `jobsite_issues` | `project_id`, `dfr_id?`, `type` enum (concrete, moisture, equipment, product, delay, extra work, safety, other), `description`, `requires_attention`, `status`, `reported_by` |
| `photos` | `client_id uuid unique`, `project_id`, `taken_at` (from EXIF or device), `uploaded_by`, `stage` enum (the 10 categories), `notes`, `storage_path`, `original_path?`, `width/height`, links to DFR, FWO or issue |
| `qc_test_types` | e.g. moisture (RH probe or calcium chloride), surface profile (CSP), DFT, adhesion, ESD; default units and methods |
| `qc_requirements` | Per FWO revision: selected tests and **optional** acceptance criteria entered by the PM |
| `qc_measurements` | `value`, `unit`, `method`, `location`, `measured_at`, `measured_by`, `photo_ids`, `notes`. A pass/fail result is shown **only** when acceptance criteria exist. |
| `saved_calculations` | `type`, `inputs jsonb`, `outputs jsonb`, `engine_version`, `project_id?`, `fwo_id?`, `dfr_id?`, `created_by` |

### 3.6 Cross-cutting

| Table | Notes |
|---|---|
| `notifications` | `recipient_id`, `type`, `entity ref`, `title`, `body`, `read_at`. A dedup key keeps repeated events from sending repeated notifications. |
| `notification_preferences` | Placeholder for future push and email settings. |
| **`audit_log`** (`audit` schema) | Written by triggers on sensitive tables: `table`, `row_id`, `action`, `old jsonb`, `new jsonb`, `actor`, `at`, `reason`. No UPDATE or DELETE is allowed for anyone. Only office admins can read it. |
| `sync_receipts` | `client_mutation_id`, `user_id`, `received_at`, `result`. Makes offline replays idempotent. |

**Main relationships:** project 1–n FWO 1–n revision 1–n acknowledgment; project 1–n DFR 1–n version; project 1–n photos, issues, assignments; employee 1–n pay_rates, time_events, time_segments, timesheets, time_off_requests; product 1–n document_versions; FWO revision n–n document_versions (through the snapshot plus a join table for querying).

---

## 4. Role and permission matrix

✅ = allowed  ◐ = limited scope (noted)  — = denied. All enforced by RLS and RPC checks.

| Capability | Installer | Crew Lead | Project Manager | Office Admin |
|---|---|---|---|---|
| View own assigned projects and FWOs | ✅ | ✅ | ✅ (all) | ✅ (all) |
| View unassigned projects | — | — | ✅ | ✅ |
| Create/edit projects, assign crews, set schedules | — | — | ✅ | ✅ |
| Create/publish FWOs, templates | — | — | ✅ | ✅ |
| Acknowledge FWO revisions | ✅ | ✅ | — | — |
| Clock self in/out, switch category | ✅ | ✅ | ◐ only if nonexempt [Q2] | ◐ only if nonexempt [Q2] |
| Group clock-in/out of others | — | ◐ own crew or assigned project [Q8] | — | ✅ (correction tools) |
| View own time | ✅ | ✅ | ✅ | ✅ |
| View crew time | — | ◐ own crew | — | ✅ |
| Correct time (with required reason) | ◐ request a correction only [Q9] | ◐ own crew, unsubmitted weeks | — | ✅ unlocked periods |
| Submit crew timesheets | — | ✅ | — | — |
| Approve timesheets / lock payroll | — | — | — | ✅ |
| View pay rates | ◐ own only? [Q10] | ◐ own only? [Q10] | — | ✅ |
| Payroll calc, review, export | — | — | — | ✅ |
| Project financials | — | — | ✅ | ✅ |
| Calculators | ✅ | ✅ | ✅ | ✅ |
| Save calculation to a project | ◐ assigned projects | ◐ assigned projects | ✅ | ✅ |
| Upload project photos | ◐ assigned projects | ◐ assigned projects | ✅ | ✅ |
| Loading checklists, DFRs, issues, material consumption, QC entries | — (can add photos and notes) | ✅ assigned projects | review / request corrections | ✅ |
| Request time off | ✅ | ✅ | ✅ | ✅ |
| Time-off first-stage approval | — | ✅ own crew | — | — |
| Time-off final approval | — | — | — | ✅ |
| Product/TDS/SDS: view | ✅ (SDS **always**, regardless of assignment) | ✅ | ✅ | ✅ |
| Product/TDS/SDS: manage and approve specs | — | — | ◐ upload, propose specs **[Assumption]** | ✅ approve |
| Holidays, leave types, payroll settings | — | — | — | ✅ |
| Employees and roles | — | — | — | ✅ |
| Audit log | — | — | — | ✅ |

---

## 5. Application navigation

### 5.1 Field app (phone-first; installers and crew leads)

```
┌─────────────────────────────────┐
│ PETRA FIELD OPS      🔔3   ⟳✓   │  ← notifications · sync status
├─────────────────────────────────┤
│ ● ON THE CLOCK — JOB TIME 2:14  │  ← persistent status banner (tap → Time Clock)
│   Acme Warehouse                 │
├────────────────┬────────────────┤
│   ⏱ TIME       │  🧮 CALCULATORS │
│     CLOCK      │                │
├────────────────┼────────────────┤
│   📅 CALENDAR   │  📁 JOB CENTER │
├────────────────┼────────────────┤
│   📄 PRODUCT   │  ⚠ SAFETY DATA │
│   DATA SHEETS  │     SHEETS     │
└────────────────┴────────────────┘
```

- **Six tiles, always in the same place.** Tiles are at least 120 px tall with labels in text and icons, and the high-contrast palette is readable in sunlight.
- Crew leads see the same six tiles. Their extra tools appear *inside* modules: a "My Crew" tab in Time Clock, and DFR, checklist and issue actions on each job in Job Center.
- Back button and breadcrumb title on every screen. No hamburger menus in the field app.
- PMs and admins get a "Management" link in the header.

### 5.2 Management dashboard (`/manage`, desktop-first)

Left sidebar: **Dashboard · Projects · Work Orders · Templates · Daily Reports · Photos · Timesheets · Payroll · Time Off · Calendar · Employees · Products & TDS · SDS Library · Holidays & Settings · Audit Log**. Items the user's role can't use are hidden **and** blocked server-side.

---

## 6. Screen inventory

| # | Screen | Who | Layout notes |
|---|---|---|---|
| F1 | Sign in / forgot password | all | Large inputs, show-password toggle |
| F2 | Home (6 tiles) | field | As above |
| F3 | Time Clock: self | field | One giant state-aware button (CLOCK IN, or SWITCH plus CLOCK OUT). Three big category buttons (Job / Drive / Ride), a job picker limited to assigned jobs, a GPS status chip and today's segments listed below. |
| F4 | Time Clock: My Crew | lead | Crew list with checkboxes and each person's status, plus "Clock selected IN/OUT/SWITCH" and a confirmation sheet naming every affected person. |
| F5 | My Timesheet | field | Week selector with day rows and hours by category. Missing clock-outs are highlighted. "Request correction." |
| F6 | Crew Timesheet review | lead | Grid of person × day. Tap a cell to edit, with a required reason. "Submit week to office." |
| F7 | Calculators hub | all | Five cards: Square Footage, Spread Rate / Mils, Material Quantity, Mix Ratio, Dew Point |
| F8–F12 | Each calculator | all | Inputs at the top and a large result card, a "Show the math" expander, and "Save to job…" |
| F13 | Calendar | all | Month / week / day toggle with color legend (jobs, holidays, my time off, pending) |
| F14 | Request time off / My requests | all | Date-range picker, full or partial day, leave type, status chips |
| F15 | Job Center list | field | My jobs (status, start date). Search. |
| F16 | Job file | field | Tabs: Overview · Work Order · Checklist · Daily Reports · Photos · Docs · QC |
| F17 | FWO viewer | field | Sections collapse. "Revision 3 — updated, tap to acknowledge" banner. PDF button. |
| F18 | Loading checklist | lead | Big checkboxes, quantity steppers, "flag missing" |
| F19 | DFR editor | lead | Multi-step form: General → Conditions → Application → Issues → Photos → Review & Submit. Autosaves drafts locally. |
| F20 | Report issue | lead | Type chips, description, photos, "needs PM attention" toggle |
| F21 | Camera / photo upload | field | Stage picker, then capture. Shows the upload queue and sync state. |
| F22 | Product data sheets | all | Search, manufacturer filter, product card with spec fields and the TDS PDF |
| F23 | SDS library | all | Search, filter, "Save for offline", PDF viewer. A shortcut is reachable even when signed out of a job. |
| F24 | Notifications | all | List, mark as read |
| F25 | Offline / sync center | all | Pending items, failures, conflicts that need action |
| M1 | Dashboard | PM/admin | Exceptions, pending approvals, DFRs awaiting review, open issues |
| M2–M3 | Projects list / project editor | PM/admin | |
| M4 | FWO builder | PM/admin | Sections, product picker (pins the document version), template insert, QC test selection, preview, publish with change summary |
| M5 | Revision history / diff | PM/admin | |
| M6 | Templates manager | PM/admin | |
| M7 | DFR review | PM/admin | Accept or request a correction |
| M8 | Photo gallery | PM/admin | Filter by job and stage |
| M9 | Timesheet approval | admin | Week grid with exceptions panel and correction history |
| M10 | Payroll review | admin | Per-employee lines (all fields from §3 of the prompt), exceptions, approve, lock |
| M11 | Payroll export | admin | Choose a format profile, download CSV and PDF report, see export history |
| M12 | Employees / roles / pay rates | admin | Rate history with effective dates |
| M13 | Time-off approvals | admin | |
| M14 | Holidays, leave types, payroll settings | admin | |
| M15–M16 | Product library / SDS library management | admin (PM upload) | |
| M17 | Audit log | admin | Filter by entity, user and date |

---

## 7. Payroll calculation design

### 7.1 Pipeline

1. **Gather** active `time_segments` in the period. Segments with no end are *excluded and raised as exceptions*. They are never guessed.
2. **Split** each segment at workweek boundaries (configured start day and time, in the company time zone, DST-aware) and at any pay-rate `effective_from` boundary.
3. **Remove** unpaid break time per the configured break policy [Q4].
4. **Price** each piece: `hours × rate in effect at that moment for that category`. Hours are computed from exact seconds as `Decimal` (`seconds / 3600`). Nothing is rounded.
5. **Per employee per workweek:**
   - `straight_time = Σ(hours × rate)`
   - `total_hours = Σ compensable hours` (Job + Drive + Ride; **not** non-worked holiday or PTO hours)
   - `regular_rate = straight_time_included / total_hours` (with a guard for division by zero)
   - `ot_hours = max(0, total_hours − 40)`
   - `ot_premium = ot_hours × regular_rate × 0.5`
   - `gross_worked = straight_time + ot_premium`
6. **Add non-worked pay** (paid holidays, approved paid leave) as separate earning lines, excluded from both hours worked and the regular rate, per configuration [Q5].
7. **Rounding policy [Assumption, Q7]:** full precision until the end, then round each money output to the cent with **ROUND_HALF_UP** once per employee per workweek line. Display values are derived from the rounded values. Hours are displayed to 2 decimals, but the full precision is stored.
8. **Snapshot** the inputs, rate row ids, engine version and outputs into `payroll_runs` / `payroll_lines`.

### 7.2 Verified test case

```
Job 38 h × $25 = $950.00   Drive 6 h × $18 = $108.00   Ride 4 h × $15 = $60.00
Straight time = $1,118.00   Hours = 48
Regular rate = 1118 / 48 = $23.291666…
OT hours = 8   OT premium = 8 × 23.291666… × 0.5 = $93.166666…
Gross = $1,211.166666… → $1,211.17
```

This and the other required cases (no OT; OT spread across categories; overnight shift; a shift crossing the workweek boundary; mid-week rate change; edited timesheet; unpaid breaks; paid holiday; incomplete entries; duplicate entries; a pay period with multiple workweeks) become Vitest fixtures with hand-calculated expected values. Each case documents its arithmetic in a comment.

### 7.3 Safety checks built into the engine

- A rate below the configured minimum wage floor (federal $7.25 applies in Texas) is flagged, not blocked.
- Exceptions block approval until each one is resolved or explicitly overridden with a written reason: open segments, duplicate events, overlaps, clock skew, late events synced into a locked period, and missing rates for a category on a given date.
- Approved periods are locked: triggers reject changes to segments inside a locked period. Post-lock fixes need an admin "reopen" action with a reason, and that action is audited.

### 7.4 Compliance questions to resolve (with Petra's CPA or employment counsel)

I can implement the arithmetic exactly. **These are policy decisions I must not make for you:**

- **Commute vs compensable travel [Q3].** Ordinary home-to-jobsite commuting is generally not hours worked. Travel during the workday (for example shop → jobsite) generally is. Overnight out-of-town travel has its own rules (29 CFR 785.39: travel time that cuts across normal working hours counts, including on non-workdays; time spent as a passenger outside normal working hours generally does not). The app can only record what crews select. You need a written policy defining when Drive and Ride time may start, and I'll put that guidance on the clock screen.
- **Breaks [Q4].** Short rest breaks (typically 5–20 minutes) are generally compensable under federal rules. Bona fide meal periods (typically 30 minutes or more, fully relieved from duty) generally are not. Do you track meal breaks, and what is the policy?
- **Other pay [Q5].** Nondiscretionary bonuses, shift premiums or per diem above the reasonable-expense level can change the regular rate. Discretionary bonuses, holiday pay and PTO generally don't. Initially the engine will compute **only Job, Drive and Ride hourly earnings plus overtime**. Any other pay type is flagged as "requires professional review" until it's configured.
- **Gusto duplicate overtime [Q6].** If Gusto computes overtime itself from imported hours, sending it our calculated OT premium would double-count it. Which source of truth applies depends on how Gusto handles multiple rates and imported hours today **[Verify in Phase 6]**.

---

## 8. Offline synchronization strategy

**Read path (cache down)**
- The service worker precaches the app shell, so calculators work fully offline from the first install.
- On sign-in and every reconnect, the client pulls a **sync bundle** into IndexedDB: my assigned projects, the current FWO revision plus the last-acknowledged one, checklists, holidays, my timesheet weeks, the product library (structured fields) and the SDS index.
- PDFs (TDS, SDS, FWO) are cached **on demand** ("Save for offline"), plus automatically for products attached to my assigned FWOs. The SDS screen shows which documents are available offline.

**Write path (outbox)**
- Every offline write is an outbox record with a client-generated UUID, a device timestamp and a payload. It's sent to `/api/sync` in order when connectivity returns. The server is **idempotent**: replaying the same UUID never duplicates.
- UI states are **Saved on this device** (grey), **Sending…**, and **Synced ✓** (only after the server confirms). Failures stay visible in the Sync Center and are never discarded silently.

**Conflict rules by data type**

| Data | Rule |
|---|---|
| Clock events | Append-only, so they never "overwrite". The server stores both `device_ts` and `server_received_at`. Segments are rebuilt in device-time order. Duplicates are dropped by UUID and same-person/same-type/near-same-time heuristics, then flagged. Device-vs-server time drift beyond a threshold, events landing in a locked period, and sequence conflicts (for example, the lead group-clocked someone in and that person also clocked in offline) all become `time_exceptions` for review. None are auto-resolved. |
| FWOs | Read-only for the field. A revision is never replaced by an older one. If a newer revision exists when the crew reconnects, they see a banner and must acknowledge the new one. |
| DFR drafts | Owned by one crew lead and protected with a `version` column. On a mismatch, both copies are kept and the lead picks. **Submitted** DFRs are immutable versions. |
| Checklist items | Item-level last-write with full history. If the checklist's FWO revision has changed, the update is flagged. |
| Photos | Uploaded in the background with retries and keyed by UUID. Compressed copies are made on the device. Originals are kept if policy requires it [Q12]. |
| Timesheets | Edits to a week that has been submitted or approved since the device last synced are rejected and shown to the user. They are never applied. |

**Device security while offline:** cached data is limited to what the user may see. Signing out clears IndexedDB and caches. A configurable idle lock applies to shared devices [Q11].

---

## 9. Security architecture

- **AuthN:** Supabase Auth with email and password, password recovery by email, and **MFA required for office admins** (recommended for PMs). Users are created by invitation only. There is no public sign-up.
- **AuthZ:** RLS on every table, using helper SQL functions (`current_employee_id()`, `has_role()`, `is_assigned(project_id)`, `leads_employee(employee_id)`). Clients use only the anon key plus the user's JWT. **The service-role key exists only in server-side Vercel environment variables** and is used for a short list of admin operations (user invitations). Lint and CI checks fail the build if a service key is referenced from client code.
- **URL and API tampering:** because every query is filtered by RLS, guessing a project UUID returns nothing. Tests cover this explicitly: authorized and unauthorized requests for every role and every sensitive table.
- **Storage:** all buckets are private. Access goes through short-lived signed URLs, with storage policies keyed on path (`projects/{project_id}/…`). SDS files are readable by every authenticated employee.
- **Payroll and employee data:** separate tables with admin-only policies. PMs cannot read rates or payroll. Payroll snapshots are immutable.
- **Audit:** trigger-based, append-only `audit.audit_log` covering pay rates, time segments, timesheets, payroll, FWO revisions, roles and time-off decisions.
- **Secrets:** `.env.local` is git-ignored. Production and preview secrets live in Vercel and Supabase dashboards. Supabase keys are never pasted into chat or committed.
- **Backups and retention plan (delivered in Phase 9):** Supabase automated daily backups (a paid plan is required) plus optional Point-in-Time Recovery **[Verify plan specifics]**, a scheduled independent logical dump (`pg_dump`) and Storage export to separate storage, a documented and **tested** restore procedure, and retention periods for time and payroll records. Federal FLSA recordkeeping requires keeping payroll records for 3 years and time cards for 2 years. Your CPA may advise longer, and the retention policy should be confirmed.
- **Other:** HTTP security headers (CSP, HSTS), rate limiting on auth and sync, dependency scanning, and no PII in logs.

---

## 10. Development phases, deliverables and acceptance criteria

Each phase ends with a commit on a branch, a short demo note, and green CI. A phase is **not** complete just because screens render.

| Phase | Deliverables | Acceptance criteria (summary) |
|---|---|---|
| **1. Foundation** | Next.js app, Tailwind design system, Supabase local dev + migrations, auth (invite, login, recovery), roles, RLS helpers, base tables (employees, projects, assignments, audit), field home screen (6 tiles, stubs), management shell, PWA manifest + install, CI (lint, typecheck, tests) | Each role signs in and sees the correct navigation. RLS tests prove an installer can't read unassigned projects or other employees by direct API call. The app installs on iOS and Android. No secrets in the client bundle (checked in CI). |
| **2. Calculators** | Square footage (multi-area, add/subtract, ft-in and decimal), spread rate ↔ mils (WFT/DFT, volume solids, theoretical vs practical), material quantity (explicit waste), mix ratio (volume/weight, gal + fl oz, lb + oz, consistent rounding), dew point (Magnus formula with documented coefficients) | All examples from the prompt reproduce exactly. Edge cases are tested (zero, negatives, unit conversions). Everything works in airplane mode. Results can be saved to a job. |
| **3. Projects & FWOs** | Project CRUD, crew assignment, FWO builder, templates (copied per job), equipment lists, loading checklists, revision history, acknowledgments, PDF export | Publishing a revision notifies the crew, keeps prior revisions byte-identical and produces a PDF. Editing a job's steps never changes the master template (tested). |
| **4. Product & SDS libraries** | Product records with an approval workflow, TDS/SDS uploads, mobile PDF viewing, search and filters, version pinning in FWOs, calculator auto-fill | Updating a TDS doesn't change the version pinned on an existing FWO (tested). SDS is reachable by any employee with no job assignment. Saved SDS files open offline. |
| **5. Time Clock** | Self and group clock-in, switching, breaks, GPS capture with explicit status, segments, exclusion constraint, timesheets, corrections with reasons, lead submit, admin approve | Overlap is impossible (DB test). The 6:00/7:15/4:30/5:45 example produces 3 correct segments. Midnight, week-boundary and missing-clock-out cases are tested. Group actions are attributed to the lead, with GPS labelled as the lead's device. Every correction keeps the original. |
| **6. Payroll** | Effective-dated rates, OT engine, payroll runs and snapshots, review screen, exceptions, CSV and PDF export, written Gusto research memo | All required test cases pass, including the $1,211.17 example. Locked periods reject edits. Exporting twice warns. Nothing is ever submitted to Gusto automatically. |
| **7. Calendar & Leave** | Day/week/month calendar, holidays, time-off requests, two-stage approval, notifications | The full request → lead → office flow is tested, including rejections at each stage. No accrual math is performed without a configured policy. |
| **8. Field reporting** | DFRs (draft, submit, correction loop, versions), environment and dew-point warnings, material use and actual spread rate, issues with PM notification, photos, QC forms | Submitted DFR versions are immutable. Dew-point warnings use the product's threshold when one is set. QC never shows "pass" without acceptance criteria. |
| **9. Offline & production readiness** | Outbox and sync center, conflict rules, background photo upload, security review, backup and restore drill, performance, device testing, deployment runbook | A Playwright test with the browser truly offline clocks in, writes a DFR draft and takes a photo, then reconnects and verifies server receipt. Restore from backup has been demonstrated. Pen-test checklist complete. **Production deployment only with your explicit authorization.** |

---

## 11. Essential questions

These are the questions that change the schema, the business rules or the setup. Everything else is either decided as an **[Assumption]** above or is admin-configurable later.

**Payroll and time (needed before Phase 5/6, but they shape the Phase 1 schema)**

- **Q1. Pay period and workweek.** Is the pay frequency weekly or bi-weekly? What day and time does Petra's established workweek start? Should I use America/Chicago as the company time zone?
- **Q2. Who uses the time clock?** Only hourly installers and crew leads? Are PMs and office admins salaried (exempt), and should they be excluded from payroll calculations?
- **Q3. Travel policy.** When may Drive or Ride time begin? For example, do crews meet at the shop, or go directly to sites, or both? Do you have out-of-town or overnight jobs? Is a written travel-time policy, reviewed by your CPA or counsel, available?
- **Q4. Breaks.** Do crews take unpaid meal breaks that should be recorded? If so, what is the minimum length for a break to be unpaid?
- **Q5. Other pay.** Besides Job, Drive and Ride hourly pay, do employees receive any bonuses, per diem, premiums, paid holidays or PTO? For now the app will calculate only the three hourly categories plus overtime and flag anything else.
- **Q6. Gusto today.** How do hours get into Gusto now (manual entry or CSV)? Are your employees set up in Gusto with multiple pay rates? This decides whether we send hours by rate (and Gusto computes OT) or send calculated earnings, which is how we avoid double-counting overtime.
- **Q7. Rounding.** Can I record exact clock times with **no punch rounding** and round only the final pay to the cent (half-up)? I recommend this.

**Crew and roles**

- **Q8. Crews.** Are crews standing teams, or assembled per project? May a crew lead group-clock only people assigned to their current job, or anyone present?
- **Q9.** Can installers edit their own time, or only *request* corrections for the crew lead to make? I recommend requesting only.
- **Q10.** Should installers and crew leads see **their own** pay rates in the app?

**Setup and operations**

- **Q11. Devices.** Are phones company-issued, personal, or both? Are any tablets shared? This affects offline data retention and auto sign-out.
- **Q12. Photos.** Must full-resolution originals be kept, or are compressed copies (around 2 MB, roughly 2048 px) acceptable? Storage cost depends on this.
- **Q13. Language.** Do any installers need **Spanish**? Building bilingual support from Phase 1 is cheap. Retrofitting it later is not.
- **Q14. Accounts.** Do you already have Supabase and Vercel accounts, and on which plans? (Production needs Vercel Pro for commercial use and a paid Supabase plan for automated backups **[Verify]**.) For development I'll use a local Supabase instance in this environment, so no keys are needed until we connect a hosted dev project. Keys go into the environment's secret settings, never into chat.

**Two technical notes to confirm (no answer needed if you agree)**

- The coating formulas use **1600** as you specified. The exact constant for 1 US gallon over 1 ft² at 1 mil is 1604.2. 1600 is the common industry rounding, and the difference is under 0.3%. The constant will be named and documented in one place.
- Dew point uses the **Magnus formula** (Alduchov & Eskridge 1996 coefficients: a = 17.625, b = 243.04 °C). The substrate-temperature margin comes from each product's data sheet. When a product has none, an admin-configurable default applies. A 5 °F (3 °C) margin is common industry practice, but an admin must confirm it before the app uses it.

---

*Next step: once you approve this plan (with any changes) and answer the questions, I'll start Phase 1 on a feature branch.*
