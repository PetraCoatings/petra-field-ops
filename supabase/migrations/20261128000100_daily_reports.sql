-- =============================================================================
-- Phase 8 (part 1): daily field reports
--
-- One report per job per day. The job's crew lead (or an office admin) keeps
-- a draft, then submits it. Each submission is saved as a permanent version.
-- The office (project managers and office admins) accepts it or sends it back
-- with a note ("correction requested"); the crew lead fixes and submits again,
-- which saves the next version. Accepted reports are final.
--
-- Two phones editing the same draft: every save carries the version it was
-- based on. If someone else saved in between, the save is refused and both
-- copies are kept (the app shows the saved one and lets the lead choose).
--
-- The report's content (crew, work done, readings, materials, notes) is JSON
-- validated by the app, which also computes the dew point (with the
-- product's own margin when it has one) and the actual spread rate.
-- =============================================================================

create table public.daily_field_reports (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  report_date        date not null,
  author_id          uuid references public.employees (id) on delete set null,
  status             text not null default 'draft' check (status in ('draft', 'submitted', 'correction_requested', 'accepted')),
  version            integer not null default 1,      -- draft version (optimistic concurrency)
  draft              jsonb not null default '{}'::jsonb check (jsonb_typeof(draft) = 'object' and pg_column_size(draft) <= 262144),
  draft_saved_by     uuid references public.employees (id) on delete set null,
  draft_saved_at     timestamptz not null default now(),
  correction_note    text,
  correction_by      uuid references public.employees (id) on delete set null,
  correction_at      timestamptz,
  accepted_by        uuid references public.employees (id) on delete set null,
  accepted_at        timestamptz,
  created_at         timestamptz not null default now(),
  unique (project_id, report_date)
);
create index daily_field_reports_project_idx on public.daily_field_reports (project_id, report_date desc);
create trigger audit_daily_field_reports after insert or update or delete on public.daily_field_reports
  for each row execute function audit.capture();

create table public.dfr_versions (
  id              uuid primary key default gen_random_uuid(),
  dfr_id          uuid not null references public.daily_field_reports (id) on delete cascade,
  version_number  integer not null,
  content         jsonb not null check (jsonb_typeof(content) = 'object'),
  submitted_by    uuid references public.employees (id) on delete set null,
  submitted_at    timestamptz not null default now(),
  unique (dfr_id, version_number)
);

-- Submitted versions can't be changed. (A removed employee's id may be
-- cleared, and deleting a whole job removes its reports.)
create function app.protect_dfr_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.daily_field_reports d where d.id = old.dfr_id) then
      raise exception 'Submitted daily reports cannot be deleted.';
    end if;
    return old;
  end if;
  if (to_jsonb(new) - 'submitted_by') is distinct from (to_jsonb(old) - 'submitted_by') or new.submitted_by is not null then
    raise exception 'Submitted daily reports cannot be changed.';
  end if;
  return new;
end $$;
create trigger dfr_versions_protect before update or delete on public.dfr_versions
  for each row execute function app.protect_dfr_version();

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('fwo_published', 'checklist_missing', 'time_off_requested', 'time_off_decided', 'dfr_submitted', 'dfr_correction'));

-- Who may write a job's daily report: its crew lead(s) and office admins.
create function app.can_write_dfr(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_office_admin() or (
    app.has_role('crew_lead') and (
      exists (select 1 from public.projects p where p.id = p_project_id and p.crew_lead_id = app.current_employee_id())
      or exists (select 1 from public.project_assignments pa where pa.project_id = p_project_id and pa.employee_id = app.current_employee_id())
    )
  )
$$;
revoke all on function app.can_write_dfr(uuid) from public;
grant execute on function app.can_write_dfr(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Writing
-- -----------------------------------------------------------------------------
-- The report for a job and day, created as an empty draft if there's none yet.
create function public.ensure_daily_report(p_project_id uuid, p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from public.daily_field_reports where project_id = p_project_id and report_date = p_date;
  if v_id is not null then
    if not app.can_view_project(p_project_id) then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    return v_id;
  end if;
  if not app.can_write_dfr(p_project_id) then
    raise exception 'Only the job''s crew lead can start its daily report' using errcode = '42501';
  end if;
  if p_date > (now() at time zone (select company_timezone from public.app_settings))::date + 1 then
    raise exception 'That day is in the future' using errcode = '22023';
  end if;
  insert into public.daily_field_reports (project_id, report_date, author_id, draft_saved_by)
  values (p_project_id, p_date, app.current_employee_id(), app.current_employee_id())
  on conflict (project_id, report_date) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.daily_field_reports where project_id = p_project_id and report_date = p_date;
  end if;
  return v_id;
end $$;

-- Save the draft. p_based_on is the draft version the phone started from.
-- Returns the new version, or raises 'version_conflict' if someone else saved first.
create function public.save_daily_report(p_id uuid, p_content jsonb, p_based_on integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_dfr public.daily_field_reports;
begin
  select * into v_dfr from public.daily_field_reports where id = p_id for update;
  if v_dfr.id is null or not app.can_write_dfr(v_dfr.project_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_dfr.status in ('submitted', 'accepted') then
    raise exception 'This report was already submitted' using errcode = 'P0001';
  end if;
  if v_dfr.version <> p_based_on then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_content) <> 'object' then
    raise exception 'Bad report' using errcode = '22023';
  end if;
  update public.daily_field_reports
    set draft = p_content, version = version + 1, draft_saved_by = app.current_employee_id(), draft_saved_at = now()
    where id = p_id;
  return v_dfr.version + 1;
end $$;

-- Submit: saves the current draft as the next permanent version and tells the
-- job's project manager (or the office admins if it has none).
create function public.submit_daily_report(p_id uuid, p_based_on integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_dfr public.daily_field_reports;
  v_next integer;
  v_pm uuid;
  v_project text;
begin
  select * into v_dfr from public.daily_field_reports where id = p_id for update;
  if v_dfr.id is null or not app.can_write_dfr(v_dfr.project_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_dfr.status in ('submitted', 'accepted') then
    raise exception 'This report was already submitted' using errcode = 'P0001';
  end if;
  if v_dfr.version <> p_based_on then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;
  if v_dfr.draft = '{}'::jsonb then
    raise exception 'The report is empty' using errcode = '22023';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_next from public.dfr_versions where dfr_id = p_id;
  insert into public.dfr_versions (dfr_id, version_number, content, submitted_by)
  values (p_id, v_next, v_dfr.draft, app.current_employee_id());
  update public.daily_field_reports set status = 'submitted' where id = p_id;

  select p.project_manager_id, p.name into v_pm, v_project from public.projects p where p.id = v_dfr.project_id;
  insert into public.notifications (recipient_id, type, project_id, entity_id, data, dedup_key)
  select r, 'dfr_submitted', v_dfr.project_id, p_id,
         jsonb_build_object('projectName', v_project, 'date', v_dfr.report_date, 'version', v_next),
         'dfr_submitted:' || p_id || ':' || v_next
  from unnest(case when v_pm is not null then array[v_pm] else app.office_admin_ids() end) r
  where r <> app.current_employee_id()
  on conflict (recipient_id, dedup_key) do nothing;
  return v_next;
end $$;

-- -----------------------------------------------------------------------------
-- Review (project managers and office admins)
-- -----------------------------------------------------------------------------
create function public.request_daily_report_correction(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_dfr public.daily_field_reports;
begin
  if not app.is_office_staff() then
    raise exception 'Only the office reviews daily reports' using errcode = '42501';
  end if;
  if p_note is null or length(trim(p_note)) < 3 then
    raise exception 'Write what needs to be corrected' using errcode = '22023';
  end if;
  select * into v_dfr from public.daily_field_reports where id = p_id for update;
  if v_dfr.id is null or v_dfr.status <> 'submitted' then
    raise exception 'Only a submitted report can be sent back' using errcode = 'P0001';
  end if;
  update public.daily_field_reports
    set status = 'correction_requested', correction_note = trim(p_note), correction_by = app.current_employee_id(), correction_at = now()
    where id = p_id;
  insert into public.notifications (recipient_id, type, project_id, entity_id, data, dedup_key)
  select v_dfr.author_id, 'dfr_correction', v_dfr.project_id, p_id,
         jsonb_build_object('projectName', p.name, 'date', v_dfr.report_date, 'note', trim(p_note)),
         'dfr_correction:' || p_id || ':' || extract(epoch from now())::bigint
  from public.projects p where p.id = v_dfr.project_id and v_dfr.author_id is not null
  on conflict (recipient_id, dedup_key) do nothing;
end $$;

create function public.accept_daily_report(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if not app.is_office_staff() then
    raise exception 'Only the office reviews daily reports' using errcode = '42501';
  end if;
  select status into v_status from public.daily_field_reports where id = p_id for update;
  if v_status is distinct from 'submitted' then
    raise exception 'Only a submitted report can be accepted' using errcode = 'P0001';
  end if;
  update public.daily_field_reports set status = 'accepted', accepted_by = app.current_employee_id(), accepted_at = now() where id = p_id;
end $$;

revoke all on function public.ensure_daily_report(uuid, date), public.save_daily_report(uuid, jsonb, integer),
  public.submit_daily_report(uuid, integer), public.request_daily_report_correction(uuid, text), public.accept_daily_report(uuid)
  from public, anon;
grant execute on function public.ensure_daily_report(uuid, date), public.save_daily_report(uuid, jsonb, integer),
  public.submit_daily_report(uuid, integer), public.request_daily_report_correction(uuid, text), public.accept_daily_report(uuid)
  to authenticated;

-- Reading: anyone who can see the job (its crew read the reports).
alter table public.daily_field_reports enable row level security;
alter table public.dfr_versions enable row level security;
grant select on public.daily_field_reports, public.dfr_versions to authenticated;
grant select, insert, update, delete on public.daily_field_reports, public.dfr_versions to service_role;
create policy dfr_read on public.daily_field_reports for select to authenticated using (app.can_view_project(project_id));
create policy dfr_versions_read on public.dfr_versions for select to authenticated
  using (exists (select 1 from public.daily_field_reports d where d.id = dfr_id and app.can_view_project(d.project_id)));
