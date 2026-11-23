-- =============================================================================
-- Phase 5 (part 3): timesheets
--
-- Corrections   public.correct_time() replaces a segment with a corrected copy
--               (or voids it, or adds a missed one). The original row is never
--               changed except to mark it superseded/void, so the history of
--               what was clocked and every fix (who, when, why) is kept.
--               Who may correct (docs/ARCHITECTURE_PLAN.md §0 Q9 and §4):
--                 * the person: their own time, within the self-edit window
--                   (24 h by default) of the time being changed, open weeks only;
--                 * a crew lead or project manager: their crew, weeks not yet submitted;
--                 * an office admin: any week not approved.
-- Requests      after the window, or once a week is submitted, people ask for
--               a fix (time_change_requests); the lead or office resolves it.
-- Weeks         timesheets: open → submitted (crew lead) → approved (office
--               admin, locks the week). An admin can reopen with a reason.
--               Approved weeks reject any change to segments in them (trigger).
-- Access        crew leads and project managers see their crew's time
--               (owner decision, 2026-11-23); office admins everyone's.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create function app.is_office_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('office_admin')
$$;

-- Is the current user this person's crew lead (or project manager)? Their crew
-- is everyone on a job they lead (as the job's crew lead, assigned as lead, or
-- the job's project manager), plus anyone they clocked in as a group in the
-- last 35 days (helpers added for the day). Project managers have the same
-- timesheet powers as crew leads for their crews (owner decision, 2026-11-23).
create function app.leads_employee(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('crew_lead', 'project_manager') and (
    p_employee_id = app.current_employee_id()
    or exists (
      select 1 from public.project_assignments pa
      join public.projects p on p.id = pa.project_id
      where pa.employee_id = p_employee_id and p.status <> 'closed'
        and (p.crew_lead_id = app.current_employee_id()
             or p.project_manager_id = app.current_employee_id()
             or exists (select 1 from public.project_assignments me
                        where me.project_id = p.id and me.employee_id = app.current_employee_id() and me.role_on_job = 'lead'))
    )
    or exists (
      select 1 from public.time_events te
      where te.actor_employee_id = app.current_employee_id() and te.employee_id = p_employee_id
        and te.is_group_action and te.server_received_at > now() - interval '35 days'
    )
  )
$$;

-- The workweek containing a moment, from the company settings (DST-aware).
create function app.workweek_bounds(p_at timestamptz) returns tstzrange
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
  v_dow int;
  v_time time;
  v_local timestamp;
  v_start timestamp;
begin
  select company_timezone, workweek_start_dow, workweek_start_time into v_tz, v_dow, v_time from public.app_settings;
  v_local := p_at at time zone v_tz;
  v_start := (v_local::date - ((extract(isodow from v_local)::int - v_dow + 7) % 7)) + v_time;
  if v_start > v_local then
    v_start := v_start - interval '7 days';
  end if;
  return tstzrange(v_start at time zone v_tz, (v_start + interval '7 days') at time zone v_tz, '[)');
end $$;

-- The time a segment covers, as a range. A zero-length entry still counts at its moment.
create function app.seg_range(p_start timestamptz, p_end timestamptz) returns tstzrange
language sql immutable set search_path = '' as $$
  select tstzrange(p_start, coalesce(p_end, 'infinity'), case when p_start = p_end then '[]' else '[)' end)
$$;

revoke all on function app.is_office_admin(), app.leads_employee(uuid), app.workweek_bounds(timestamptz) from public;
grant execute on function app.is_office_admin(), app.leads_employee(uuid), app.workweek_bounds(timestamptz), app.seg_range(timestamptz, timestamptz) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Weeks
-- -----------------------------------------------------------------------------
create table public.timesheets (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees (id) on delete cascade,
  week_start     timestamptz not null,
  week_end       timestamptz not null check (week_end > week_start),
  status         text not null default 'open' check (status in ('open', 'submitted', 'approved')),
  submitted_by   uuid references public.employees (id) on delete set null,
  submitted_at   timestamptz,
  approved_by    uuid references public.employees (id) on delete set null,
  approved_at    timestamptz,
  reopened_by    uuid references public.employees (id) on delete set null,
  reopened_at    timestamptz,
  reopen_reason  text,
  updated_at     timestamptz not null default now(),
  unique (employee_id, week_start)
);
create trigger timesheets_touch before update on public.timesheets
  for each row execute function app.touch_updated_at();
create trigger audit_timesheets after insert or update or delete on public.timesheets
  for each row execute function audit.capture();

-- Status of the week(s) a range touches, for one person: the "most locked" one.
create function app.week_status(p_employee_id uuid, p_range tstzrange) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case when bool_or(t.status = 'approved') then 'approved'
                 when bool_or(t.status = 'submitted') then 'submitted' end
     from public.timesheets t
     where t.employee_id = p_employee_id and tstzrange(t.week_start, t.week_end, '[)') && p_range),
    'open')
$$;
revoke all on function app.week_status(uuid, tstzrange) from public;
grant execute on function app.week_status(uuid, tstzrange) to authenticated, service_role;

-- Approved weeks are locked: no segment in them can be added, changed or removed.
create function app.protect_locked_weeks() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- A deleted job only clears the reference; that's not a change to the time.
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'project_id') = (to_jsonb(old) - 'project_id') and new.project_id is null then
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE')
     and app.week_status(old.employee_id, app.seg_range(old.start_at, old.end_at)) = 'approved'
     and exists (select 1 from public.employees e where e.id = old.employee_id) then
    raise exception 'This week is approved and locked. An office admin must reopen it first.' using errcode = 'P0001';
  end if;
  if tg_op in ('INSERT', 'UPDATE')
     and app.week_status(new.employee_id, app.seg_range(new.start_at, new.end_at)) = 'approved' then
    raise exception 'This week is approved and locked. An office admin must reopen it first.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger time_segments_locked_weeks before insert or update or delete on public.time_segments
  for each row execute function app.protect_locked_weeks();

-- -----------------------------------------------------------------------------
-- Corrections
-- -----------------------------------------------------------------------------
-- p_segment_id set: replace that segment with the corrected one (or void it).
-- p_segment_id null: add a missed segment for p_employee_id.
-- Returns the new segment's id (null when voiding).
create function public.correct_time(
  p_segment_id uuid,
  p_reason text,
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_kind text default 'work',
  p_category public.time_category default null,
  p_project_id uuid default null,
  p_void boolean default false,
  p_employee_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.current_employee_id();
  v_old public.time_segments;
  v_emp uuid;
  v_window int;
  v_earliest timestamptz;
  v_ranges tstzrange[];
  v_r tstzrange;
  v_new uuid;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 or length(p_reason) > 500 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;

  if p_segment_id is not null then
    select * into v_old from public.time_segments where id = p_segment_id for update;
    if v_old.id is null or v_old.status <> 'active' then
      raise exception 'That entry no longer exists or was already changed' using errcode = 'P0002';
    end if;
    v_emp := v_old.employee_id;
  else
    v_emp := coalesce(p_employee_id, v_me);
    if p_void then
      raise exception 'Nothing to remove' using errcode = '22023';
    end if;
  end if;

  if not p_void then
    if p_start is null or p_kind not in ('work', 'lunch') or (p_kind = 'work' and p_category is null) then
      raise exception 'Start time and category are required' using errcode = '22023';
    end if;
    -- Only a running entry may stay running.
    if p_end is null and (v_old.id is null or v_old.end_at is not null) then
      raise exception 'An end time is required' using errcode = '22023';
    end if;
    if p_end is not null and p_end < p_start then
      raise exception 'The end time is before the start time' using errcode = '22023';
    end if;
    if greatest(p_start, coalesce(p_end, p_start)) > now() + interval '1 minute' then
      raise exception 'Time is in the future' using errcode = '22023';
    end if;
    if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id) then
      raise exception 'Unknown job' using errcode = '22023';
    end if;
  end if;

  -- The time ranges this change touches (old and new).
  v_ranges := array_remove(array[
    case when v_old.id is not null then app.seg_range(v_old.start_at, coalesce(v_old.end_at, now())) end,
    case when not p_void then app.seg_range(p_start, coalesce(p_end, now())) end
  ], null);
  v_earliest := least(v_old.start_at, case when not p_void then p_start end);

  if app.is_office_admin() then
    null;  -- any week that isn't approved (the lock trigger enforces that)
  elsif v_emp <> v_me and app.leads_employee(v_emp) then
    foreach v_r in array v_ranges loop
      if app.week_status(v_emp, v_r) <> 'open' then
        raise exception 'This week was already submitted. Ask the office to fix it.' using errcode = '42501';
      end if;
    end loop;
  elsif v_emp = v_me then
    select self_edit_window_hours into v_window from public.app_settings;
    if now() - v_earliest > make_interval(hours => v_window) then
      raise exception 'Too late to fix this yourself. Ask your crew lead or the office.' using errcode = '42501';
    end if;
    foreach v_r in array v_ranges loop
      if app.week_status(v_emp, v_r) <> 'open' then
        raise exception 'This week was already submitted. Ask your crew lead or the office.' using errcode = '42501';
      end if;
    end loop;
  else
    raise exception 'You can''t change this person''s time' using errcode = '42501';
  end if;

  if v_old.id is not null then
    update public.time_segments
      set status = case when p_void then 'void' else 'superseded' end,
          correction_reason = case when p_void then trim(p_reason) else correction_reason end,
          corrected_by = case when p_void then v_me else corrected_by end
      where id = v_old.id;
  end if;
  if not p_void then
    begin
      insert into public.time_segments (employee_id, kind, category, project_id, start_at, end_at, source,
        supersedes_id, correction_reason, corrected_by, start_event_id, end_event_id)
      values (v_emp, p_kind, p_category, p_project_id, p_start, p_end, 'correction',
        v_old.id, trim(p_reason), v_me, v_old.start_event_id, case when p_end is null then null else v_old.end_event_id end)
      returning id into v_new;
    exception when exclusion_violation or unique_violation then
      raise exception 'That time overlaps another entry. Fix or remove the other entry first.' using errcode = '23P01';
    end;
  end if;
  return v_new;
end $$;

-- -----------------------------------------------------------------------------
-- Requests for a fix
-- -----------------------------------------------------------------------------
create table public.time_change_requests (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.employees (id) on delete cascade,
  segment_id       uuid references public.time_segments (id) on delete set null,
  week_start       timestamptz not null,
  message          text not null check (length(trim(message)) between 3 and 1000),
  status           text not null default 'open' check (status in ('open', 'resolved')),
  created_at       timestamptz not null default now(),
  resolved_by      uuid references public.employees (id) on delete set null,
  resolved_at      timestamptz,
  resolution_note  text
);
create index time_change_requests_open_idx on public.time_change_requests (week_start) where status = 'open';
create trigger audit_time_change_requests after insert or update or delete on public.time_change_requests
  for each row execute function audit.capture();

create function public.request_time_change(p_week_of timestamptz, p_message text, p_segment_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.current_employee_id();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_segment_id is not null and not exists (select 1 from public.time_segments where id = p_segment_id and employee_id = v_me) then
    raise exception 'Unknown entry' using errcode = '42501';
  end if;
  insert into public.time_change_requests (employee_id, segment_id, week_start, message)
  values (v_me, p_segment_id, lower(app.workweek_bounds(p_week_of)), trim(p_message))
  returning id into v_id;
  return v_id;
end $$;

create function public.resolve_time_change(p_request_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid;
begin
  select employee_id into v_emp from public.time_change_requests where id = p_request_id and status = 'open';
  if v_emp is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if not (app.is_office_admin() or (app.leads_employee(v_emp) and v_emp <> app.current_employee_id())) then
    raise exception 'Only the crew lead or the office can resolve this' using errcode = '42501';
  end if;
  update public.time_change_requests
    set status = 'resolved', resolved_by = app.current_employee_id(), resolved_at = now(), resolution_note = nullif(trim(p_note), '')
    where id = p_request_id;
end $$;

-- -----------------------------------------------------------------------------
-- Submit, approve, reopen
-- -----------------------------------------------------------------------------
create function app.set_timesheet_status(p_employee_id uuid, p_week tstzrange, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.timesheets (employee_id, week_start, week_end, status)
  values (p_employee_id, lower(p_week), upper(p_week), p_status)
  on conflict (employee_id, week_start) do update set status = excluded.status;
  update public.timesheets set
    submitted_by = case when p_status = 'submitted' then app.current_employee_id() when p_status = 'open' then null else submitted_by end,
    submitted_at = case when p_status = 'submitted' then now() when p_status = 'open' then null else submitted_at end,
    approved_by = case when p_status = 'approved' then app.current_employee_id() else null end,
    approved_at = case when p_status = 'approved' then now() else null end
  where employee_id = p_employee_id and week_start = lower(p_week);
end $$;
revoke all on function app.set_timesheet_status(uuid, tstzrange, text) from public;

create function app.check_week_complete(p_employee_id uuid, p_week tstzrange) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.time_segments s
             where s.employee_id = p_employee_id and s.status = 'active' and s.end_at is null and s.start_at < upper(p_week)) then
    raise exception 'Someone is still clocked in for this week (a missing clock-out). Fix it first.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function app.check_week_complete(uuid, tstzrange) from public;

create function public.submit_timesheet(p_employee_id uuid, p_week_of timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_week tstzrange := app.workweek_bounds(p_week_of);
begin
  if not (app.leads_employee(p_employee_id) or app.is_office_admin()) then
    raise exception 'Only the crew lead or project manager can submit this week' using errcode = '42501';
  end if;
  if app.week_status(p_employee_id, v_week) <> 'open' then
    raise exception 'This week was already submitted' using errcode = 'P0001';
  end if;
  perform app.check_week_complete(p_employee_id, v_week);
  perform app.set_timesheet_status(p_employee_id, v_week, 'submitted');
end $$;

create function public.approve_timesheet(p_employee_id uuid, p_week_of timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_week tstzrange := app.workweek_bounds(p_week_of);
begin
  if not app.is_office_admin() then
    raise exception 'Only an office admin can approve timesheets' using errcode = '42501';
  end if;
  if app.week_status(p_employee_id, v_week) = 'approved' then
    raise exception 'This week is already approved' using errcode = 'P0001';
  end if;
  perform app.check_week_complete(p_employee_id, v_week);
  perform app.set_timesheet_status(p_employee_id, v_week, 'approved');
end $$;

create function public.reopen_timesheet(p_employee_id uuid, p_week_of timestamptz, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_week tstzrange := app.workweek_bounds(p_week_of);
begin
  if not app.is_office_admin() then
    raise exception 'Only an office admin can reopen a week' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  perform app.set_timesheet_status(p_employee_id, v_week, 'open');
  update public.timesheets set reopened_by = app.current_employee_id(), reopened_at = now(), reopen_reason = trim(p_reason)
    where employee_id = p_employee_id and week_start = lower(v_week);
end $$;

revoke all on function public.correct_time(uuid, text, timestamptz, timestamptz, text, public.time_category, uuid, boolean, uuid),
  public.request_time_change(timestamptz, text, uuid), public.resolve_time_change(uuid, text),
  public.submit_timesheet(uuid, timestamptz), public.approve_timesheet(uuid, timestamptz),
  public.reopen_timesheet(uuid, timestamptz, text) from public, anon;
grant execute on function public.correct_time(uuid, text, timestamptz, timestamptz, text, public.time_category, uuid, boolean, uuid),
  public.request_time_change(timestamptz, text, uuid), public.resolve_time_change(uuid, text),
  public.submit_timesheet(uuid, timestamptz), public.approve_timesheet(uuid, timestamptz),
  public.reopen_timesheet(uuid, timestamptz, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Access: own time; crew leads their crew; office admins all.
-- -----------------------------------------------------------------------------
alter table public.timesheets enable row level security;
alter table public.time_change_requests enable row level security;
grant select on public.timesheets, public.time_change_requests to authenticated;
grant select, insert, update, delete on public.timesheets, public.time_change_requests to service_role;

create policy timesheets_read on public.timesheets for select to authenticated
  using (employee_id = app.current_employee_id() or app.leads_employee(employee_id) or app.is_office_admin());
create policy time_change_requests_read on public.time_change_requests for select to authenticated
  using (employee_id = app.current_employee_id() or app.leads_employee(employee_id) or app.is_office_admin());

drop policy time_segments_read on public.time_segments;
create policy time_segments_read on public.time_segments for select to authenticated
  using (employee_id = app.current_employee_id() or app.leads_employee(employee_id) or app.is_office_admin());
drop policy time_events_read on public.time_events;
create policy time_events_read on public.time_events for select to authenticated
  using (employee_id = app.current_employee_id() or actor_employee_id = app.current_employee_id()
         or app.leads_employee(employee_id) or app.is_office_admin());

-- Crew status (unchanged from part 2 except for the clearer error).
create or replace function public.crew_clock_status(p_employee_ids uuid[])
returns table (employee_id uuid, kind text, category public.time_category, project_id uuid, start_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_role('crew_lead', 'project_manager', 'office_admin') then
    raise exception 'Only crew leads and the office can see crew status' using errcode = '42501';
  end if;
  if cardinality(p_employee_ids) > 100 then
    raise exception 'Too many people' using errcode = '22023';
  end if;
  return query
    select s.employee_id, s.kind, s.category, s.project_id, s.start_at
    from public.time_segments s
    join public.employees e on e.id = s.employee_id and e.is_active
    where s.employee_id = any (p_employee_ids) and s.end_at is null and s.status = 'active';
end $$;

