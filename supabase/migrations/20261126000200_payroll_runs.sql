-- =============================================================================
-- Phase 6 (part 2): payroll runs ("entered in Gusto")
--
-- When the office manager has typed a pay period into Gusto, she marks it as
-- entered. That saves a permanent snapshot: for each person and week, the
-- Job / Drive / Ride hours per rate that were entered, the totals, and the
-- app's check figure, with the engine version and a fingerprint of the inputs.
--
-- Rules (docs/ARCHITECTURE_PLAN.md §7, owner decision Q6a):
--   * every week with time in the period must be approved (locked) first;
--   * a period can be marked entered once; marking it again needs a reason
--     and keeps the earlier snapshot (voided), so nothing is entered twice
--     without a record of why;
--   * snapshots can't be changed or deleted. Office admins only.
-- =============================================================================

create table public.payroll_runs (
  id              uuid primary key default gen_random_uuid(),
  period_start    date not null,
  period_end      date not null check (period_end > period_start),
  engine_version  text not null,
  input_hash      text not null,
  entered_by      uuid references public.employees (id) on delete set null,
  entered_at      timestamptz not null default now(),
  voided_at       timestamptz,
  voided_by       uuid references public.employees (id) on delete set null,
  void_reason     text
);
create unique index payroll_runs_one_active on public.payroll_runs (period_start) where voided_at is null;

create table public.payroll_lines (
  id                      uuid primary key default gen_random_uuid(),
  run_id                  uuid not null references public.payroll_runs (id) on delete cascade,
  employee_id             uuid references public.employees (id) on delete set null,
  employee_name           text not null,
  exempt                  boolean not null,
  week_start              date not null,
  entries                 jsonb not null,   -- [{ category, rate_cents, hours }] as typed into Gusto
  total_hours             numeric(7, 2) not null,
  regular_hours           numeric(7, 2) not null,
  overtime_hours          numeric(7, 2) not null,
  check_gross_cents       bigint,           -- null for salaried
  details                 jsonb not null    -- exact seconds, rate ids, straight time, premium
);
create index payroll_lines_run_idx on public.payroll_lines (run_id);

create trigger audit_payroll_runs after insert or update or delete on public.payroll_runs
  for each row execute function audit.capture();

-- Snapshots are permanent. A run may only be voided (once, with a reason), and
-- references to a removed employee or admin may be cleared.
create function app.protect_payroll_run() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payroll records cannot be deleted.';
  end if;
  if (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason', 'entered_by'])
       is distinct from (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason', 'entered_by'])
     or (new.entered_by is distinct from old.entered_by and new.entered_by is not null)
     or (old.voided_at is not null and (new.voided_at, new.void_reason) is distinct from (old.voided_at, old.void_reason)) then
    raise exception 'Payroll records cannot be changed.';
  end if;
  return new;
end $$;
create trigger payroll_runs_protect before update or delete on public.payroll_runs
  for each row execute function app.protect_payroll_run();

create function app.protect_payroll_line() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payroll records cannot be deleted.';
  end if;
  if (to_jsonb(new) - 'employee_id') is distinct from (to_jsonb(old) - 'employee_id') or new.employee_id is not null then
    raise exception 'Payroll records cannot be changed.';
  end if;
  return new;
end $$;
create trigger payroll_lines_protect before update or delete on public.payroll_lines
  for each row execute function app.protect_payroll_line();

-- Mark a pay period as entered in Gusto. p_lines comes from the app's payroll
-- engine (run on the server). p_replace_reason is required if the period was
-- already marked entered; the earlier snapshot is voided, not deleted.
create function public.record_payroll_run(
  p_period_start date,
  p_period_end date,
  p_engine_version text,
  p_input_hash text,
  p_lines jsonb,
  p_replace_reason text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.current_employee_id();
  v_existing uuid;
  v_run uuid;
  v_line jsonb;
  v_tz text;
  v_week_start timestamptz;
begin
  if not app.is_office_admin() then
    raise exception 'Only an office admin can record payroll' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Payroll lines are missing' using errcode = '22023';
  end if;
  select company_timezone into v_tz from public.app_settings;
  -- Every hourly person's week with hours must be approved (and so locked).
  -- Salaried people's hours are recorded for reference and don't hold it up.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line ->> 'total_hours')::numeric > 0 and not coalesce((v_line ->> 'exempt')::boolean, false) then
      v_week_start := ((v_line ->> 'week_start')::date)::timestamp at time zone v_tz;
      if app.week_status((v_line ->> 'employee_id')::uuid, tstzrange(v_week_start, v_week_start + interval '1 day', '[)')) <> 'approved' then
        raise exception 'Every week must be approved before payroll is marked entered (%, week of %)', v_line ->> 'employee_name', v_line ->> 'week_start'
          using errcode = 'P0001';
      end if;
    end if;
  end loop;

  select id into v_existing from public.payroll_runs where period_start = p_period_start and voided_at is null;
  if v_existing is not null then
    if p_replace_reason is null or length(trim(p_replace_reason)) < 3 then
      raise exception 'This pay period was already marked entered in Gusto' using errcode = 'P0001';
    end if;
    update public.payroll_runs set voided_at = now(), voided_by = v_me, void_reason = trim(p_replace_reason) where id = v_existing;
  end if;

  insert into public.payroll_runs (period_start, period_end, engine_version, input_hash, entered_by)
  values (p_period_start, p_period_end, p_engine_version, p_input_hash, v_me)
  returning id into v_run;
  insert into public.payroll_lines (run_id, employee_id, employee_name, exempt, week_start, entries, total_hours, regular_hours,
    overtime_hours, check_gross_cents, details)
  select v_run, (l ->> 'employee_id')::uuid, l ->> 'employee_name', (l ->> 'exempt')::boolean, (l ->> 'week_start')::date,
    l -> 'entries', (l ->> 'total_hours')::numeric, (l ->> 'regular_hours')::numeric, (l ->> 'overtime_hours')::numeric,
    (l ->> 'check_gross_cents')::bigint, coalesce(l -> 'details', '{}'::jsonb)
  from jsonb_array_elements(p_lines) l;
  return v_run;
end $$;

revoke all on function public.record_payroll_run(date, date, text, text, jsonb, text) from public, anon;
grant execute on function public.record_payroll_run(date, date, text, text, jsonb, text) to authenticated;

alter table public.payroll_runs enable row level security;
alter table public.payroll_lines enable row level security;
grant select on public.payroll_runs, public.payroll_lines to authenticated;
grant select, insert, update, delete on public.payroll_runs, public.payroll_lines to service_role;
create policy payroll_runs_read on public.payroll_runs for select to authenticated using (app.is_office_admin());
create policy payroll_lines_read on public.payroll_lines for select to authenticated using (app.is_office_admin());
