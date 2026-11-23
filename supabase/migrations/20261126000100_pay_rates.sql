-- =============================================================================
-- Phase 6 (part 1): pay rates
--
-- Each person has an hourly rate per category (Job, Drive, Ride), effective
-- from a date (company time zone, 12:00 AM). A raise is a new row with a later
-- date, so the history of what was paid when is kept, and payroll prices each
-- hour at the rate in effect at that moment.
--
-- Privacy (docs/ARCHITECTURE_PLAN.md §0 Q10, §4): office admins manage all
-- rates; each person can read only their own (the app shows them only on the
-- "My Pay Rates" page, after re-entering their password). Crew leads and
-- project managers can't read anyone else's rates. Every change is audited.
-- =============================================================================

create table public.pay_rates (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees (id) on delete cascade,
  category        public.time_category not null,
  hourly_rate     numeric(8, 2) not null check (hourly_rate > 0 and hourly_rate < 1000),
  effective_from  date not null,
  note            text check (note is null or length(note) <= 200),
  created_by      uuid references public.employees (id) on delete set null default app.current_employee_id(),
  created_at      timestamptz not null default now(),
  unique (employee_id, category, effective_from)
);
create index pay_rates_employee_idx on public.pay_rates (employee_id, category, effective_from desc);
create trigger audit_pay_rates after insert or update or delete on public.pay_rates
  for each row execute function audit.capture();

alter table public.pay_rates enable row level security;
grant select, insert, update, delete on public.pay_rates to authenticated;
grant select, insert, update, delete on public.pay_rates to service_role;

create policy pay_rates_read on public.pay_rates for select to authenticated
  using (employee_id = app.current_employee_id() or app.is_office_admin());
create policy pay_rates_insert on public.pay_rates for insert to authenticated
  with check (app.is_office_admin());
create policy pay_rates_update on public.pay_rates for update to authenticated
  using (app.is_office_admin()) with check (app.is_office_admin());
create policy pay_rates_delete on public.pay_rates for delete to authenticated
  using (app.is_office_admin());

-- Company payroll settings: the minimum wage floor (rates below it are
-- flagged, not blocked; federal $7.25 applies in Texas) and the pay period:
-- every two weeks, Monday to Sunday, from an anchor Monday. Owner decision
-- (2026-11-23): the current period runs Nov 16 – Nov 29, 2026.
alter table public.app_settings
  add column minimum_wage numeric(6, 2) not null default 7.25 check (minimum_wage >= 0),
  add column pay_period_weeks smallint not null default 2 check (pay_period_weeks in (1, 2)),
  add column pay_period_anchor date;
update public.app_settings set pay_period_anchor = '2026-11-16';
