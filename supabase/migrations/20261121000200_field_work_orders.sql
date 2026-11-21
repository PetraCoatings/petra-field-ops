-- =============================================================================
-- Phase 3a — Field work orders (FWOs), revisions, acknowledgments, notifications
--
-- How it fits together:
--   field_work_orders   one per work order on a project (number, title, status,
--                       pointer to the current published revision)
--   fwo_drafts          the office's working copy. Crews can never read it.
--   fwo_revisions       APPEND-ONLY. Publishing copies the draft plus a snapshot
--                       of the project's details into a new numbered revision.
--                       Nobody can change or delete a published revision, so
--                       "what the crew was told" is always exact.
--   fwo_acknowledgments a crew member's "I've read this revision".
--   notifications       in-app notices (e.g. "new work order revision").
--   storage bucket      fwo-files: drawings and photos attached to work orders
--                       (office uploads; crews on the job can view).
--
-- Publishing goes through public.publish_fwo(), which checks the caller's
-- role and does everything in one transaction (docs/ARCHITECTURE_PLAN.md §1).
--
-- Who may do what (§4):
--   PMs and office admins   create, edit drafts, publish, void; see everything
--   installers, crew leads  read published work orders on assigned projects,
--                           acknowledge revisions
-- =============================================================================

create type public.fwo_status as enum ('draft', 'published', 'void');

create table public.field_work_orders (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects (id) on delete cascade,
  fwo_number            integer not null check (fwo_number > 0),
  title                 text not null check (length(trim(title)) between 1 and 200),
  status                public.fwo_status not null default 'draft',
  current_revision_id   uuid,  -- FK added below (circular reference)
  created_by            uuid default app.current_employee_id() references public.employees (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (project_id, fwo_number),
  check (status = 'draft' or current_revision_id is not null or status = 'void')
);
create index field_work_orders_project_idx on public.field_work_orders (project_id);
create trigger field_work_orders_touch before update on public.field_work_orders
  for each row execute function app.touch_updated_at();

-- Number work orders 1, 2, 3… per project.
create function app.assign_fwo_number() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.fwo_number is null then
    perform pg_advisory_xact_lock(hashtext('fwo_number:' || new.project_id::text));
    select coalesce(max(fwo_number), 0) + 1 into new.fwo_number
    from public.field_work_orders where project_id = new.project_id;
  end if;
  return new;
end $$;
alter table public.field_work_orders alter column fwo_number drop not null;
create trigger field_work_orders_number before insert on public.field_work_orders
  for each row execute function app.assign_fwo_number();
alter table public.field_work_orders add constraint field_work_orders_number_set check (fwo_number is not null);

create table public.fwo_drafts (
  fwo_id      uuid primary key references public.field_work_orders (id) on delete cascade,
  content     jsonb not null default '{}'::jsonb
              check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 262144),
  updated_by  uuid default app.current_employee_id() references public.employees (id) on delete set null,
  updated_at  timestamptz not null default now()
);
create trigger fwo_drafts_touch before update on public.fwo_drafts
  for each row execute function app.touch_updated_at();

create table public.fwo_revisions (
  id                uuid primary key default gen_random_uuid(),
  fwo_id            uuid not null references public.field_work_orders (id) on delete restrict,
  revision_number   integer not null check (revision_number > 0),
  content           jsonb not null check (jsonb_typeof(content) = 'object'),
  project_snapshot  jsonb not null check (jsonb_typeof(project_snapshot) = 'object'),
  change_summary    text check (change_summary is null or length(trim(change_summary)) between 1 and 1000),
  published_by      uuid references public.employees (id) on delete set null,
  published_at      timestamptz not null default now(),
  pdf_storage_path  text,
  unique (fwo_id, revision_number)
);
alter table public.field_work_orders
  add constraint field_work_orders_current_revision_fk
  foreign key (current_revision_id) references public.fwo_revisions (id) on delete restrict;

-- Belt and braces: even the service role can't rewrite or delete a published revision.
-- (pdf_storage_path may be filled in once, for the PDF export in a later part.)
create function app.protect_fwo_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Published work order revisions cannot be deleted.';
  end if;
  if (to_jsonb(new) - 'pdf_storage_path') is distinct from (to_jsonb(old) - 'pdf_storage_path')
     or (old.pdf_storage_path is not null and new.pdf_storage_path is distinct from old.pdf_storage_path) then
    raise exception 'Published work order revisions cannot be changed.';
  end if;
  return new;
end $$;
create trigger fwo_revisions_protect before update or delete on public.fwo_revisions
  for each row execute function app.protect_fwo_revision();

create table public.fwo_acknowledgments (
  id                uuid primary key default gen_random_uuid(),
  fwo_revision_id   uuid not null references public.fwo_revisions (id) on delete restrict,
  employee_id       uuid not null default app.current_employee_id() references public.employees (id) on delete cascade,
  acknowledged_at   timestamptz not null default now(),
  unique (fwo_revision_id, employee_id)
);
create index fwo_acknowledgments_employee_idx on public.fwo_acknowledgments (employee_id);

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references public.employees (id) on delete cascade,
  type          text not null check (type in ('fwo_published')),
  project_id    uuid references public.projects (id) on delete cascade,
  entity_id     uuid,
  data          jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  dedup_key     text not null,
  read_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (recipient_id, dedup_key)
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER so policies don't recurse through each other)
-- -----------------------------------------------------------------------------
create function app.fwo_project_id(p_fwo_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select project_id from public.field_work_orders where id = p_fwo_id
$$;

-- Can the current user read this work order's published content?
create function app.can_view_published_fwo(p_fwo_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.field_work_orders f
    where f.id = p_fwo_id
      and app.can_view_project(f.project_id)
      and (app.is_office_staff() or f.status = 'published')
  )
$$;

create function app.uuid_or_null(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create function app.revision_fwo_id(p_revision_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select fwo_id from public.fwo_revisions where id = p_revision_id
$$;

revoke all on function app.assign_fwo_number(), app.protect_fwo_revision(), app.fwo_project_id(uuid),
  app.can_view_published_fwo(uuid), app.revision_fwo_id(uuid), app.uuid_or_null(text) from public;
grant execute on function app.fwo_project_id(uuid), app.can_view_published_fwo(uuid), app.revision_fwo_id(uuid),
  app.uuid_or_null(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Publishing (the only way to create a revision)
-- -----------------------------------------------------------------------------
create function public.publish_fwo(p_fwo_id uuid, p_change_summary text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_fwo      public.field_work_orders;
  v_content  jsonb;
  v_next     integer;
  v_summary  text := nullif(trim(coalesce(p_change_summary, '')), '');
  v_snapshot jsonb;
  v_rev_id   uuid;
  v_me       uuid := app.current_employee_id();
begin
  if not app.is_office_staff() then
    raise exception 'Only project managers and office administrators can publish work orders.'
      using errcode = '42501';
  end if;

  select * into v_fwo from public.field_work_orders where id = p_fwo_id for update;
  if not found then
    raise exception 'Work order not found.' using errcode = 'P0002';
  end if;
  if v_fwo.status = 'void' then
    raise exception 'A voided work order cannot be published.' using errcode = 'P0001';
  end if;

  select content into v_content from public.fwo_drafts where fwo_id = p_fwo_id;
  if v_content is null or v_content = '{}'::jsonb then
    raise exception 'The work order is empty.' using errcode = 'P0001';
  end if;

  select coalesce(max(revision_number), 0) + 1 into v_next
  from public.fwo_revisions where fwo_id = p_fwo_id;
  if v_next > 1 and v_summary is null then
    raise exception 'Describe what changed in this revision.' using errcode = 'P0001';
  end if;

  -- Freeze the project details the crew sees with this revision.
  select jsonb_build_object(
           'name', p.name,
           'jobNumber', p.job_number,
           'customer', c.name,
           'street', p.site_street, 'city', p.site_city, 'state', p.site_state, 'postalCode', p.site_postal_code,
           'scheduledStart', p.scheduled_start,
           'totalSqft', p.total_sqft,
           'flooringSystem', p.flooring_system,
           'projectManager', pm.display_name,
           'crewLead', cl.display_name,
           'contacts', coalesce((
             select jsonb_agg(jsonb_build_object('name', pc.name, 'title', pc.title, 'phone', pc.phone)
                              order by pc.is_primary desc, pc.created_at)
             from public.project_contacts pc where pc.project_id = p.id), '[]'::jsonb))
    into v_snapshot
  from public.projects p
  left join public.customers c on c.id = p.customer_id
  left join public.employees pm on pm.id = p.project_manager_id
  left join public.employees cl on cl.id = p.crew_lead_id
  where p.id = v_fwo.project_id;

  insert into public.fwo_revisions (fwo_id, revision_number, content, project_snapshot, change_summary, published_by)
  values (p_fwo_id, v_next, v_content, v_snapshot, v_summary, v_me)
  returning id into v_rev_id;

  update public.field_work_orders
     set status = 'published', current_revision_id = v_rev_id
   where id = p_fwo_id;

  -- Tell the crew (assigned employees and the project's crew lead), once each.
  insert into public.notifications (recipient_id, type, project_id, entity_id, data, dedup_key)
  select distinct e.id, 'fwo_published', v_fwo.project_id, p_fwo_id,
         jsonb_build_object('fwoNumber', v_fwo.fwo_number, 'title', v_fwo.title,
                            'revision', v_next, 'projectName', v_snapshot ->> 'name'),
         'fwo_published:' || v_rev_id::text
  from public.employees e
  where e.is_active
    and e.id is distinct from v_me
    and (e.id in (select employee_id from public.project_assignments where project_id = v_fwo.project_id)
         or e.id = (select crew_lead_id from public.projects where id = v_fwo.project_id))
  on conflict (recipient_id, dedup_key) do nothing;

  return v_rev_id;
end $$;
revoke all on function public.publish_fwo(uuid, text) from public;
grant execute on function public.publish_fwo(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Audit
-- -----------------------------------------------------------------------------
create trigger audit_field_work_orders after insert or update or delete on public.field_work_orders
  for each row execute function audit.capture();
create trigger audit_fwo_revisions after insert or update or delete on public.fwo_revisions
  for each row execute function audit.capture();
create trigger audit_fwo_acknowledgments after insert or update or delete on public.fwo_acknowledgments
  for each row execute function audit.capture();
-- Drafts change constantly while typing; the published revisions are the record.

-- -----------------------------------------------------------------------------
-- Privileges and Row Level Security
-- -----------------------------------------------------------------------------
grant select, insert, update on public.field_work_orders to authenticated;
grant select, insert, update on public.fwo_drafts to authenticated;
grant select on public.fwo_revisions to authenticated;          -- written only by publish_fwo()
grant select, insert on public.fwo_acknowledgments to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated; -- marking as read only
grant select, insert, update, delete on public.field_work_orders, public.fwo_drafts,
  public.fwo_acknowledgments, public.notifications to service_role;
grant select, insert, update on public.fwo_revisions to service_role;

alter table public.field_work_orders   enable row level security;
alter table public.fwo_drafts          enable row level security;
alter table public.fwo_revisions       enable row level security;
alter table public.fwo_acknowledgments enable row level security;
alter table public.notifications       enable row level security;

-- Work orders: office sees all (incl. drafts); crews see published ones on their projects.
create policy field_work_orders_select on public.field_work_orders for select to authenticated
  using (app.can_view_project(project_id) and (app.is_office_staff() or status = 'published'));
create policy field_work_orders_insert on public.field_work_orders for insert to authenticated
  with check (app.is_office_staff() and status = 'draft' and current_revision_id is null);
-- The office may rename or void; publishing (status/current revision) happens in publish_fwo().
create policy field_work_orders_update on public.field_work_orders for update to authenticated
  using (app.is_office_staff())
  with check (app.is_office_staff());

-- Drafts: office only.
create policy fwo_drafts_select on public.fwo_drafts for select to authenticated
  using (app.is_office_staff());
create policy fwo_drafts_insert on public.fwo_drafts for insert to authenticated
  with check (app.is_office_staff());
create policy fwo_drafts_update on public.fwo_drafts for update to authenticated
  using (app.is_office_staff()) with check (app.is_office_staff());

-- Revisions: readable along with their work order. No write policies for anyone.
create policy fwo_revisions_select on public.fwo_revisions for select to authenticated
  using (app.can_view_published_fwo(fwo_id));

-- Acknowledgments: the crew acknowledges for themselves; everyone who can see the
-- work order can see who has acknowledged it.
create policy fwo_acknowledgments_select on public.fwo_acknowledgments for select to authenticated
  using (app.can_view_published_fwo(app.revision_fwo_id(fwo_revision_id)));
create policy fwo_acknowledgments_insert on public.fwo_acknowledgments for insert to authenticated
  with check (
    employee_id = app.current_employee_id()
    and app.has_role('installer', 'crew_lead')
    and app.can_view_published_fwo(app.revision_fwo_id(fwo_revision_id))
  );

-- Notifications: your own only; you may only mark them read.
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = app.current_employee_id());
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = app.current_employee_id())
  with check (recipient_id = app.current_employee_id());

-- -----------------------------------------------------------------------------
-- File storage for drawings and photos (Supabase Storage).
-- Private bucket; files live at  <project_id>/<fwo_id>/<file>.
--   upload  PMs and office admins, only into a real work order's folder
--   view    anyone who can see that work order (crews: once published)
-- Files are never deleted by the app: an older revision may still show them.
-- Skipped where Supabase Storage isn't installed (the local test database).
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Supabase Storage not installed; skipping the fwo-files bucket.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('fwo-files', 'fwo-files', false, 20971520,
          array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do nothing;

  create policy fwo_files_select on storage.objects for select to authenticated
    using (bucket_id = 'fwo-files'
           and app.can_view_published_fwo(app.uuid_or_null((storage.foldername(name))[2])));

  create policy fwo_files_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'fwo-files'
                and app.is_office_staff()
                and app.fwo_project_id(app.uuid_or_null((storage.foldername(name))[2]))
                    = app.uuid_or_null((storage.foldername(name))[1]));
end $$;
