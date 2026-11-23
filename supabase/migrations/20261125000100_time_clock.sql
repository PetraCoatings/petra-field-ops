-- =============================================================================
-- Phase 5 (part 1): Time Clock
--
-- time_events    the raw, permanent record of every button press: who, for whom,
--                when (phone time and server time) and where (GPS + its status).
-- time_segments  continuous stretches of Job / Drive / Ride work or lunch,
--                built from the events. Overlapping active segments for one
--                person are impossible (exclusion constraint), and each person
--                has at most one open segment.
--
-- Nobody writes these tables directly: every change goes through
-- public.clock_action(), which checks the order of actions (can't switch when
-- not clocked in, etc.), is idempotent per (client_event_id, employee) so a
-- retried press never doubles, and records who pressed it. A crew lead or the
-- office can act for others (group clock-in, part 2); the event is attributed
-- to them and the GPS is labelled as their device.
--
-- Times: the time on the phone when the button was pressed (device_ts) is
-- used, so a press that reaches the server late (slow or no signal) still
-- counts at the minute it was made. The phone also sends its clock reading at
-- the moment it sends (p_device_now). If that is more than 10 minutes off the
-- server's clock, the phone's clock is wrong: the time is corrected by that
-- difference and the event is flagged 'clock_skew' for review.
-- =============================================================================

create type public.time_category as enum ('job', 'drive', 'ride');
create type public.time_event_type as enum ('clock_in', 'switch', 'break_start', 'break_end', 'clock_out');
create type public.gps_status as enum ('captured', 'denied', 'unavailable', 'timeout', 'not_requested');

create table public.time_events (
  id                  uuid primary key default gen_random_uuid(),
  client_event_id     uuid not null,
  employee_id         uuid not null references public.employees (id) on delete cascade,
  event_type          public.time_event_type not null,
  category            public.time_category,
  project_id          uuid references public.projects (id) on delete set null,
  device_ts           timestamptz not null,
  server_received_at  timestamptz not null default now(),
  effective_at        timestamptz not null,
  actor_employee_id   uuid references public.employees (id) on delete set null,
  is_group_action     boolean not null default false,
  group_action_id     uuid,
  gps_lat             double precision check (gps_lat between -90 and 90),
  gps_lng             double precision check (gps_lng between -180 and 180),
  gps_accuracy_m      real check (gps_accuracy_m >= 0),
  gps_status          public.gps_status not null,
  gps_source          text check (gps_source in ('own_device', 'group_leader_device')),
  flags               text[] not null default '{}',
  unique (client_event_id, employee_id),
  check ((gps_status = 'captured') = (gps_lat is not null and gps_lng is not null))
);
create index time_events_employee_idx on public.time_events (employee_id, effective_at desc);
create index time_events_actor_idx on public.time_events (actor_employee_id);

create table public.time_segments (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees (id) on delete cascade,
  kind               text not null check (kind in ('work', 'lunch')),
  category           public.time_category,
  project_id         uuid references public.projects (id) on delete set null,
  start_at           timestamptz not null,
  end_at             timestamptz,
  source             text not null default 'events' check (source in ('events', 'correction')),
  status             text not null default 'active' check (status in ('active', 'superseded', 'void')),
  supersedes_id      uuid references public.time_segments (id),
  correction_reason  text,
  corrected_by       uuid references public.employees (id) on delete set null,
  start_event_id     uuid references public.time_events (id) on delete set null,
  end_event_id       uuid references public.time_events (id) on delete set null,
  created_at         timestamptz not null default now(),
  check (end_at is null or end_at >= start_at),
  check (kind = 'lunch' or category is not null),
  -- No two active stretches of time can overlap for the same person.
  constraint time_segments_no_overlap exclude using gist (
    employee_id with =,
    tstzrange(start_at, coalesce(end_at, 'infinity'::timestamptz), '[)') with &&
  ) where (status = 'active')
);
-- At most one open (running) segment per person.
create unique index time_segments_one_open on public.time_segments (employee_id)
  where end_at is null and status = 'active';
create index time_segments_employee_start_idx on public.time_segments (employee_id, start_at desc);

create trigger audit_time_segments after insert or update or delete on public.time_segments
  for each row execute function audit.capture();

-- Events are permanent. The only changes allowed are the database's own
-- clean-up when a related row is removed: a deleted project or actor sets its
-- reference to null, and deleting an employee removes their events.
create function app.protect_time_event() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.employees e where e.id = old.employee_id) then
      raise exception 'Time clock events cannot be deleted.';
    end if;
    return old;
  end if;
  if (to_jsonb(new) - array['project_id', 'actor_employee_id']) is distinct from (to_jsonb(old) - array['project_id', 'actor_employee_id'])
     or (new.project_id is distinct from old.project_id and new.project_id is not null)
     or (new.actor_employee_id is distinct from old.actor_employee_id and new.actor_employee_id is not null) then
    raise exception 'Time clock events cannot be changed.';
  end if;
  return new;
end $$;
create trigger time_events_protect before update or delete on public.time_events
  for each row execute function app.protect_time_event();

-- -----------------------------------------------------------------------------
-- Clock actions
-- -----------------------------------------------------------------------------
-- Returns one result per person:
--   [{ "employee_id": …, "ok": true, "replayed": false }
--    { "employee_id": …, "ok": false, "error": "already_clocked_in" }]
-- Errors: not_clocked_in, already_clocked_in, on_lunch, not_on_lunch,
--         no_change, category_required, before_last_entry, inactive.
create function public.clock_action(
  p_client_event_id uuid,
  p_action public.time_event_type,
  p_device_ts timestamptz,
  p_gps_status public.gps_status,
  p_category public.time_category default null,
  p_project_id uuid default null,
  p_gps_lat double precision default null,
  p_gps_lng double precision default null,
  p_gps_accuracy_m real default null,
  p_employee_ids uuid[] default null,
  p_device_now timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.current_employee_id();
  v_targets uuid[];
  v_group boolean;
  v_now timestamptz := now();
  v_ts timestamptz;
  v_skew interval;
  v_flags text[] := '{}';
  v_emp uuid;
  v_open public.time_segments;
  v_last_end timestamptz;
  v_event uuid;
  v_seg uuid;
  v_cat public.time_category;
  v_proj uuid;
  v_err text;
  v_results jsonb := '[]'::jsonb;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_client_event_id is null or p_action is null or p_device_ts is null or p_gps_status is null then
    raise exception 'Missing required values' using errcode = '22023';
  end if;
  v_targets := coalesce(p_employee_ids, array[v_me]);
  if cardinality(v_targets) = 0 or cardinality(v_targets) > 50 then
    raise exception 'Choose between 1 and 50 people' using errcode = '22023';
  end if;
  v_group := v_targets <> array[v_me];
  if v_group and not app.has_role('crew_lead', 'project_manager', 'office_admin') then
    raise exception 'Only crew leads and the office can clock in other people' using errcode = '42501';
  end if;
  if p_project_id is not null and not app.can_view_project(p_project_id) then
    raise exception 'Unknown job' using errcode = '42501';
  end if;
  if (p_gps_status = 'captured') <> (p_gps_lat is not null and p_gps_lng is not null) then
    raise exception 'GPS status and coordinates disagree' using errcode = '22023';
  end if;

  v_skew := coalesce(p_device_now, p_device_ts) - v_now;
  v_ts := p_device_ts;
  if abs(extract(epoch from v_skew)) > 600 then
    v_ts := p_device_ts - v_skew;
    v_flags := array['clock_skew'];
  end if;
  if v_ts > v_now + interval '1 minute' then
    raise exception 'Time is in the future' using errcode = '22023';
  end if;

  foreach v_emp in array (select array_agg(distinct x) from unnest(v_targets) x) loop
    v_err := null;
    -- One action at a time per person, so two phones can't race each other.
    perform pg_advisory_xact_lock(hashtextextended(v_emp::text, 5));

    if exists (select 1 from public.time_events where client_event_id = p_client_event_id and employee_id = v_emp) then
      v_results := v_results || jsonb_build_object('employee_id', v_emp, 'ok', true, 'replayed', true);
      continue;
    end if;
    if not exists (select 1 from public.employees where id = v_emp and is_active) then
      v_results := v_results || jsonb_build_object('employee_id', v_emp, 'ok', false, 'error', 'inactive');
      continue;
    end if;

    select * into v_open from public.time_segments
      where employee_id = v_emp and end_at is null and status = 'active';
    select max(end_at) into v_last_end from public.time_segments
      where employee_id = v_emp and status = 'active';

    v_cat := p_category;
    v_proj := p_project_id;
    if p_action = 'clock_in' then
      if v_open.id is not null then v_err := 'already_clocked_in';
      elsif p_category is null then v_err := 'category_required';
      elsif v_last_end is not null and v_ts < v_last_end then v_err := 'before_last_entry';
      end if;
    elsif p_action = 'switch' then
      if v_open.id is null then v_err := 'not_clocked_in';
      elsif v_open.kind = 'lunch' then v_err := 'on_lunch';
      elsif p_category is null then v_err := 'category_required';
      elsif p_category = v_open.category and p_project_id is not distinct from v_open.project_id then v_err := 'no_change';
      end if;
    elsif p_action = 'break_start' then
      if v_open.id is null then v_err := 'not_clocked_in';
      elsif v_open.kind = 'lunch' then v_err := 'on_lunch';
      end if;
      v_cat := v_open.category;  -- remembered so End lunch resumes the same work
      v_proj := v_open.project_id;
    elsif p_action = 'break_end' then
      if v_open.id is null then v_err := 'not_clocked_in';
      elsif v_open.kind <> 'lunch' then v_err := 'not_on_lunch';
      end if;
      v_cat := coalesce(p_category, v_open.category);
      v_proj := case when p_category is null then v_open.project_id else p_project_id end;
    elsif p_action = 'clock_out' then
      if v_open.id is null then v_err := 'not_clocked_in';
      end if;
      v_cat := v_open.category;
      v_proj := v_open.project_id;
    end if;
    if v_err is null and v_open.id is not null and v_ts < v_open.start_at then
      v_err := 'before_last_entry';
    end if;
    if v_err is not null then
      v_results := v_results || jsonb_build_object('employee_id', v_emp, 'ok', false, 'error', v_err);
      continue;
    end if;

    insert into public.time_events (client_event_id, employee_id, event_type, category, project_id, device_ts,
      server_received_at, effective_at, actor_employee_id, is_group_action, group_action_id,
      gps_lat, gps_lng, gps_accuracy_m, gps_status, gps_source, flags)
    values (p_client_event_id, v_emp, p_action, v_cat, v_proj, p_device_ts,
      v_now, v_ts, v_me, v_group, case when v_group then p_client_event_id end,
      p_gps_lat, p_gps_lng, p_gps_accuracy_m, p_gps_status,
      case when p_gps_status = 'captured' then case when v_emp = v_me then 'own_device' else 'group_leader_device' end end,
      v_flags)
    returning id into v_event;

    if v_open.id is not null then
      update public.time_segments set end_at = v_ts, end_event_id = v_event where id = v_open.id;
    end if;
    if p_action in ('clock_in', 'switch', 'break_end') then
      insert into public.time_segments (employee_id, kind, category, project_id, start_at, start_event_id)
      values (v_emp, 'work', v_cat, v_proj, v_ts, v_event);
    elsif p_action = 'break_start' then
      insert into public.time_segments (employee_id, kind, category, project_id, start_at, start_event_id)
      values (v_emp, 'lunch', v_cat, v_proj, v_ts, v_event);
    end if;
    v_results := v_results || jsonb_build_object('employee_id', v_emp, 'ok', true, 'replayed', false);
  end loop;
  return v_results;
end $$;

revoke all on function public.clock_action(uuid, public.time_event_type, timestamptz, public.gps_status,
  public.time_category, uuid, double precision, double precision, real, uuid[], timestamptz) from public, anon;
grant execute on function public.clock_action(uuid, public.time_event_type, timestamptz, public.gps_status,
  public.time_category, uuid, double precision, double precision, real, uuid[], timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Access: read only. People see their own time; the office sees everyone's;
-- whoever pressed the button for someone else can see that event.
-- -----------------------------------------------------------------------------
alter table public.time_events enable row level security;
alter table public.time_segments enable row level security;
grant select on public.time_events, public.time_segments to authenticated;
grant select, insert, update, delete on public.time_events, public.time_segments to service_role;

create policy time_events_read on public.time_events for select to authenticated
  using (employee_id = app.current_employee_id() or actor_employee_id = app.current_employee_id() or app.is_office_staff());
create policy time_segments_read on public.time_segments for select to authenticated
  using (employee_id = app.current_employee_id() or app.is_office_staff());
