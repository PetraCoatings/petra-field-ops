-- =============================================================================
-- Phase 8 (part 2): jobsite issues and photos
--
-- Issues: anyone on a job can report one (concrete, moisture, equipment,
-- product, delay, extra work, safety, other), optionally marked "needs
-- attention". The job's project manager (or the office admins if it has
-- none) is notified. The office or the job's crew lead marks it resolved,
-- with a note.
--
-- Photos: anyone on a job can add photos, tagged with a stage. The phone
-- shrinks each photo to at most 4096 px on the long edge (high-quality JPEG)
-- plus a small thumbnail (owner decision Q12) and uploads both to the private
-- job-photos bucket under {project_id}/. Only people who can see the job can
-- see its photos. The office, or the person who took it on the same day, can
-- remove a photo.
-- =============================================================================

create table public.jobsite_issues (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete cascade,
  type                text not null check (type in ('concrete', 'moisture', 'equipment', 'product', 'delay', 'extra_work', 'safety', 'other')),
  description         text not null check (length(trim(description)) between 3 and 2000),
  requires_attention  boolean not null default false,
  status              text not null default 'open' check (status in ('open', 'resolved')),
  reported_by         uuid references public.employees (id) on delete set null default app.current_employee_id(),
  created_at          timestamptz not null default now(),
  resolved_by         uuid references public.employees (id) on delete set null,
  resolved_at         timestamptz,
  resolution_note     text
);
create index jobsite_issues_project_idx on public.jobsite_issues (project_id, created_at desc);
create trigger audit_jobsite_issues after insert or update or delete on public.jobsite_issues
  for each row execute function audit.capture();

create table public.photos (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null unique,  -- made on the phone: a retried upload isn't saved twice
  project_id    uuid not null references public.projects (id) on delete cascade,
  uploaded_by   uuid references public.employees (id) on delete set null default app.current_employee_id(),
  taken_at      timestamptz,
  stage         text not null default 'other' check (stage in ('before', 'surface_prep', 'repairs', 'primer', 'body_coat', 'broadcast', 'topcoat', 'finished', 'issue', 'other')),
  notes         text check (notes is null or length(notes) <= 500),
  storage_path  text not null unique,
  thumb_path    text not null unique,
  width         integer check (width > 0 and width <= 4096),
  height        integer check (height > 0 and height <= 4096),
  size_bytes    integer check (size_bytes > 0 and size_bytes <= 20971520),
  issue_id      uuid references public.jobsite_issues (id) on delete set null,
  dfr_id        uuid references public.daily_field_reports (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (storage_path like project_id::text || '/%' and thumb_path like project_id::text || '/%')
);
create index photos_project_idx on public.photos (project_id, created_at desc);

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('fwo_published', 'checklist_missing', 'time_off_requested', 'time_off_decided', 'dfr_submitted', 'dfr_correction', 'issue_reported'));

-- -----------------------------------------------------------------------------
-- Issues
-- -----------------------------------------------------------------------------
create function public.report_issue(p_project_id uuid, p_type text, p_description text, p_requires_attention boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_pm uuid;
  v_name text;
  v_me uuid := app.current_employee_id();
begin
  if v_me is null or not app.can_view_project(p_project_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.jobsite_issues (project_id, type, description, requires_attention, reported_by)
  values (p_project_id, p_type, trim(p_description), coalesce(p_requires_attention, false), v_me)
  returning id into v_id;
  select project_manager_id, name into v_pm, v_name from public.projects where id = p_project_id;
  insert into public.notifications (recipient_id, type, project_id, entity_id, data, dedup_key)
  select r, 'issue_reported', p_project_id, v_id,
         jsonb_build_object('projectName', v_name, 'issueType', p_type, 'description', left(trim(p_description), 140),
                            'urgent', coalesce(p_requires_attention, false), 'by', (select display_name from public.employees where id = v_me)),
         'issue_reported:' || v_id
  from unnest(case when v_pm is not null then array[v_pm] else app.office_admin_ids() end) r
  where r <> v_me
  on conflict (recipient_id, dedup_key) do nothing;
  return v_id;
end $$;

-- The office, or the job's crew lead, resolves an issue (a note is optional).
create function public.resolve_issue(p_issue_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
begin
  select project_id into v_project from public.jobsite_issues where id = p_issue_id and status = 'open' for update;
  if v_project is null then
    raise exception 'Issue not found or already resolved' using errcode = 'P0002';
  end if;
  if not (app.is_office_staff() or exists (select 1 from public.projects where id = v_project and crew_lead_id = app.current_employee_id())) then
    raise exception 'Only the office or the job''s crew lead can resolve issues' using errcode = '42501';
  end if;
  update public.jobsite_issues
    set status = 'resolved', resolved_by = app.current_employee_id(), resolved_at = now(), resolution_note = nullif(trim(p_note), '')
    where id = p_issue_id;
end $$;

revoke all on function public.report_issue(uuid, text, text, boolean), public.resolve_issue(uuid, text) from public, anon;
grant execute on function public.report_issue(uuid, text, text, boolean), public.resolve_issue(uuid, text) to authenticated;

alter table public.jobsite_issues enable row level security;
grant select on public.jobsite_issues to authenticated;
grant select, insert, update, delete on public.jobsite_issues to service_role;
create policy issues_read on public.jobsite_issues for select to authenticated using (app.can_view_project(project_id));

-- -----------------------------------------------------------------------------
-- Photos
-- -----------------------------------------------------------------------------
alter table public.photos enable row level security;
grant select, insert, delete on public.photos to authenticated;
grant update (stage, notes) on public.photos to authenticated;
grant select, insert, update, delete on public.photos to service_role;

create policy photos_read on public.photos for select to authenticated using (app.can_view_project(project_id));
create policy photos_insert on public.photos for insert to authenticated
  with check (app.can_view_project(project_id) and uploaded_by = app.current_employee_id()
              and (issue_id is null or exists (select 1 from public.jobsite_issues i where i.id = issue_id and i.project_id = photos.project_id)));
create policy photos_update on public.photos for update to authenticated
  using (app.is_office_staff() or uploaded_by = app.current_employee_id())
  with check (app.is_office_staff() or uploaded_by = app.current_employee_id());
create policy photos_delete on public.photos for delete to authenticated
  using (app.is_office_staff() or (uploaded_by = app.current_employee_id() and created_at > now() - interval '24 hours'));

-- Storage bucket (skipped where Supabase Storage isn't installed, e.g. the local test database).
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Supabase Storage not installed; skipping the job-photos bucket.';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('job-photos', 'job-photos', false, 20971520, array['image/jpeg'])
  on conflict (id) do nothing;

  create policy job_photos_select on storage.objects for select to authenticated
    using (bucket_id = 'job-photos' and app.can_view_project(app.uuid_or_null((storage.foldername(name))[1])));
  create policy job_photos_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'job-photos' and app.can_view_project(app.uuid_or_null((storage.foldername(name))[1])));
end $$;
