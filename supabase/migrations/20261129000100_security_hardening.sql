-- =============================================================================
-- Phase 9c: security hardening (findings from the security review)
--
-- 1. Late clock presses     A press that reaches the server more than 15
--                           minutes after it was made is flagged "late_sync"
--                           (shown on the timesheet). One more than 72 hours
--                           old is refused: the person asks for a fix instead.
--                           Stops quietly back-dating time from a phone.
-- 2. Crew lead reach        A crew lead or PM no longer "leads" office staff
--                           (PMs, office admins) through a group clock-in, and
--                           can only fix crew time in the current or previous
--                           workweek. Older fixes go through the office.
-- 3. Corrections            correct_time() only accepts jobs the person
--                           making the fix can see.
-- 4. Photos                 A photo's file paths must be exactly
--                           {job}/{photo id}.jpg and _thumb.jpg, and any linked
--                           report or QC reading must be on the same job. This
--                           stops a photo record pointing at someone else's
--                           file (which removing the photo would then delete).
-- 5. Work orders            Signed-in users can only rename a work order or
--                           void it. Publishing still goes through
--                           publish_fwo(); moving a work order to another job
--                           or swapping its current revision is refused.
-- 6. Product approvals      "Approved by / at" are set only by the database,
--                           never typed in.
-- 7. Permanent records      An employee with time records, or a job with
--                           submitted daily reports, can't be deleted from the
--                           app. Payroll lines are now in the audit log.
-- 8. Test-data cleanup      Automated test jobs, products and data sheets are
--                           marked is_test by the test runner (server key
--                           only; signed-in users can't set it). The cleanup
--                           deletes only marked rows, so a real job named
--                           "E2E…" is never at risk.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Late clock presses
-- -----------------------------------------------------------------------------
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
  v_too_late := v_now - v_ts > interval '72 hours';

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

-- -----------------------------------------------------------------------------
-- 2. Crew lead reach
-- -----------------------------------------------------------------------------
-- Same as before, except that nobody "leads" a PM or office admin (other than
-- themselves). Before, a crew lead who group-clocked an office admin once
-- could see and fix that admin's time for 35 days.
create or replace function app.leads_employee(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('crew_lead', 'project_manager') and (
    p_employee_id = app.current_employee_id()
    or (
      not exists (select 1 from public.employees e
                  where e.id = p_employee_id and e.role in ('project_manager', 'office_admin'))
      and (
        exists (
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
    )
  )
$$;

-- -----------------------------------------------------------------------------
-- 2 + 3. Corrections: lead fixes limited to this week and last week; the job
-- must be one the person making the fix can see.
-- -----------------------------------------------------------------------------
create or replace function public.correct_time(
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
  v_last_week_start timestamptz;
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
    -- Keeping the job an entry already had is always fine; a new job must be one you can see.
    if p_project_id is not null and p_project_id is distinct from v_old.project_id
       and not (exists (select 1 from public.projects where id = p_project_id) and app.can_view_project(p_project_id)) then
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
    v_last_week_start := lower(app.workweek_bounds(lower(app.workweek_bounds(now())) - interval '1 second'));
    if v_earliest < v_last_week_start then
      raise exception 'That week is too old to fix here. Ask the office to fix it.' using errcode = '42501';
    end if;
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
-- 4. Photos
-- -----------------------------------------------------------------------------
-- NOT VALID: checked for every new or changed photo; existing photos were all
-- saved by the app with these exact paths.
alter table public.photos add constraint photos_paths_match
  check (storage_path = project_id::text || '/' || client_id::text || '.jpg'
         and thumb_path = project_id::text || '/' || client_id::text || '_thumb.jpg') not valid;

drop policy photos_insert on public.photos;
create policy photos_insert on public.photos for insert to authenticated
  with check (app.can_view_project(project_id) and uploaded_by = app.current_employee_id()
              and (issue_id is null or exists (select 1 from public.jobsite_issues i where i.id = issue_id and i.project_id = photos.project_id))
              and (dfr_id is null or exists (select 1 from public.daily_field_reports d where d.id = dfr_id and d.project_id = photos.project_id))
              and (qc_measurement_id is null or exists (select 1 from public.qc_measurements m where m.id = qc_measurement_id and m.project_id = photos.project_id)));
drop policy photos_update on public.photos;
create policy photos_update on public.photos for update to authenticated
  using (app.can_view_project(project_id) and (app.is_office_staff() or uploaded_by = app.current_employee_id()))
  with check (app.can_view_project(project_id) and (app.is_office_staff() or uploaded_by = app.current_employee_id()));

-- -----------------------------------------------------------------------------
-- 5. Work orders: signed-in users may rename or void, nothing else.
-- (publish_fwo() and the cleanup run as the database owner and aren't affected.)
-- -----------------------------------------------------------------------------
create function app.guard_fwo_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and (
       new.project_id is distinct from old.project_id
    or new.fwo_number is distinct from old.fwo_number
    or new.current_revision_id is distinct from old.current_revision_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or (new.status is distinct from old.status and new.status <> 'void')
    or (old.status = 'void' and new.status <> 'void')) then
    raise exception 'Work orders can only be renamed or voided here.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger field_work_orders_guard before update on public.field_work_orders
  for each row execute function app.guard_fwo_update();

-- -----------------------------------------------------------------------------
-- 6. Product approvals: approved_by / approved_at come only from this trigger.
-- -----------------------------------------------------------------------------
create or replace function app.guard_product_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := app.has_role('office_admin');
  v_spec_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.spec_status = 'approved' and not v_admin then
      raise exception 'Only an office administrator can approve product specs.' using errcode = '42501';
    end if;
  else
    v_spec_changed :=
      (to_jsonb(new) - array['spec_status','approved_by','approved_at','is_active','updated_at','description','product_code','category','name','manufacturer_id','is_test'])
      is distinct from
      (to_jsonb(old) - array['spec_status','approved_by','approved_at','is_active','updated_at','description','product_code','category','name','manufacturer_id','is_test']);
    if new.spec_status = 'approved' and old.spec_status <> 'approved' and not v_admin then
      raise exception 'Only an office administrator can approve product specs.' using errcode = '42501';
    end if;
    if v_spec_changed and not v_admin then
      new.spec_status := 'draft';
    end if;
  end if;
  if new.spec_status = 'approved' and (tg_op = 'INSERT' or old.spec_status <> 'approved' or v_spec_changed) then
    new.approved_by := app.current_employee_id();
    new.approved_at := now();
  elsif new.spec_status = 'approved' then
    -- Still approved, nothing re-approved: keep who approved it and when.
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  else
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Permanent records
-- -----------------------------------------------------------------------------
-- Runs as the person deleting (not security definer), so current_user tells
-- the app's signed-in users apart from the server key. Only office admins may
-- delete these rows, and they can read the records checked here.
create function app.guard_record_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then
    return old;  -- the server key / database owner (test cleanup, support work)
  end if;
  if tg_table_name = 'employees' and (
       exists (select 1 from public.time_events where employee_id = old.id)
    or exists (select 1 from public.time_segments where employee_id = old.id)) then
    raise exception 'This person has time records, which must be kept. Turn their account off instead.' using errcode = '42501';
  end if;
  if tg_table_name = 'projects' and exists (
       select 1 from public.dfr_versions v join public.daily_field_reports d on d.id = v.dfr_id where d.project_id = old.id) then
    raise exception 'This job has submitted daily reports, which must be kept. Close the job instead.' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger employees_guard_delete before delete on public.employees
  for each row execute function app.guard_record_delete();
create trigger projects_guard_delete before delete on public.projects
  for each row execute function app.guard_record_delete();

create trigger audit_payroll_lines after insert or update or delete on public.payroll_lines
  for each row execute function audit.capture();

-- -----------------------------------------------------------------------------
-- 8. Test-data cleanup by mark, not by name
-- -----------------------------------------------------------------------------
alter table public.projects add column is_test boolean not null default false;
alter table public.products add column is_test boolean not null default false;
alter table public.documents add column is_test boolean not null default false;

-- Test rows already in the database (made before this change).
update public.projects set is_test = true where name like 'E2E%';
update public.products set is_test = true where name like 'E2E%';
update public.documents d set is_test = true
 where d.name like 'E2E%' or d.product_id in (select id from public.products where is_test);

-- Only the server key can mark (or unmark) test rows.
create function app.guard_is_test() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated'
     and new.is_test is distinct from (case when tg_op = 'INSERT' then false else old.is_test end) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger projects_guard_is_test before insert or update on public.projects
  for each row execute function app.guard_is_test();
create trigger products_guard_is_test before insert or update on public.products
  for each row execute function app.guard_is_test();
create trigger documents_guard_is_test before insert or update on public.documents
  for each row execute function app.guard_is_test();

create or replace function public.purge_e2e_test_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_projects uuid[];
  v_fwos uuid[];
  v_products uuid[];
  v_documents uuid[];
  v_jobs integer;
  v_products_deleted integer;
begin
  select coalesce(array_agg(id), '{}') into v_projects from public.projects where is_test;
  select coalesce(array_agg(id), '{}') into v_fwos from public.field_work_orders where project_id = any (v_projects);

  -- Work orders on test jobs: acknowledgments, checklists, then the revisions.
  delete from public.fwo_acknowledgments
   where fwo_revision_id in (select id from public.fwo_revisions where fwo_id = any (v_fwos));
  delete from public.loading_checklists where fwo_id = any (v_fwos);
  update public.field_work_orders set current_revision_id = null, status = 'void' where id = any (v_fwos);
  alter table public.fwo_revisions disable trigger fwo_revisions_protect;
  delete from public.fwo_revisions where fwo_id = any (v_fwos);
  alter table public.fwo_revisions enable trigger fwo_revisions_protect;
  -- The jobs (their work orders, drafts, crews, contacts, saved calculations
  -- and notifications go with them).
  delete from public.projects where id = any (v_projects);
  get diagnostics v_jobs = row_count;

  -- Test products and test SDS, with their data sheet versions.
  select coalesce(array_agg(id), '{}') into v_products from public.products where is_test;
  select coalesce(array_agg(id), '{}') into v_documents from public.documents
   where is_test or product_id = any (v_products);
  alter table public.document_versions disable trigger document_versions_protect;
  delete from public.document_versions where document_id = any (v_documents);
  alter table public.document_versions enable trigger document_versions_protect;
  delete from public.documents where id = any (v_documents);
  delete from public.products where id = any (v_products);
  get diagnostics v_products_deleted = row_count;

  -- Test templates (not permanent records; still matched by name).
  delete from public.work_order_templates where name like 'E2E%';

  return jsonb_build_object('jobs', v_jobs, 'products', v_products_deleted, 'documents', coalesce(array_length(v_documents, 1), 0));
end $$;

revoke all on function public.purge_e2e_test_data() from public, anon, authenticated;
grant execute on function public.purge_e2e_test_data() to service_role;
