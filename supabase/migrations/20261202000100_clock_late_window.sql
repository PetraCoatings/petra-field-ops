-- =============================================================================
-- Time Clock: presses can arrive up to 7 days late (was 72 hours)
--
-- A press saved on a phone with no signal is sent the next time the app is
-- opened with signal. Someone who clocks out with no signal on a Friday and
-- doesn't open the app until Monday (or after a holiday) was past the 72-hour
-- limit and their clock-out was refused. Presses that arrive more than 15
-- minutes late are still flagged "late_sync" on the timesheet for the office
-- to check; approved (locked) weeks still can't change.
--
-- Safe to run while people are clocked in: the function is replaced in one
-- step, and no time records are changed.
-- =============================================================================

create or replace function public.clock_action(
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
  v_too_late boolean;
  v_emp uuid;
  v_open public.time_segments;
  v_last_end timestamptz;
  v_event uuid;
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
  -- Sent from the phone's queue well after it was pressed: keep it, but flag it.
  if v_now - v_ts > interval '15 minutes' then
    v_flags := v_flags || array['late_sync'];
  end if;
  v_too_late := v_now - v_ts > interval '7 days';

  foreach v_emp in array (select array_agg(distinct x) from unnest(v_targets) x) loop
    v_err := null;
    -- One action at a time per person, so two phones can't race each other.
    perform pg_advisory_xact_lock(hashtextextended(v_emp::text, 5));

    if exists (select 1 from public.time_events where client_event_id = p_client_event_id and employee_id = v_emp) then
      v_results := v_results || jsonb_build_object('employee_id', v_emp, 'ok', true, 'replayed', true);
      continue;
    end if;
    if v_too_late then
      v_results := v_results || jsonb_build_object('employee_id', v_emp, 'ok', false, 'error', 'too_late');
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
