-- =============================================================================
-- Phase 3d — Loading checklists
--
-- The work order's "Materials to bring in trailer" list becomes a checklist
-- the crew lead ticks off before leaving the shop. Typed once (in the work
-- order), checked on a phone.
--
--   loading_checklists       one per work order; remembers which revision it
--                            was last brought up to date with
--   loading_checklist_items  one per item: Loaded / Missing / not yet, with a
--                            note. Items added on site are kept separate from
--                            items that came from the work order.
--
-- Who may do what (docs/ARCHITECTURE_PLAN.md §4, "Loading checklists"):
--   view    anyone who can see the published work order
--   tick    the job's crew lead(s) and office staff, through the functions
--           below (no direct table writes for anyone)
-- Marking an item Missing notifies the job's project manager. Every change is
-- in the audit log.
-- =============================================================================

create type public.checklist_item_status as enum ('pending', 'loaded', 'missing');

create table public.loading_checklists (
  id           uuid primary key default gen_random_uuid(),
  fwo_id       uuid not null unique references public.field_work_orders (id) on delete cascade,
  revision_id  uuid not null references public.fwo_revisions (id) on delete restrict,
  created_by   uuid default app.current_employee_id() references public.employees (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger loading_checklists_touch before update on public.loading_checklists
  for each row execute function app.touch_updated_at();

create table public.loading_checklist_items (
  id                       uuid primary key default gen_random_uuid(),
  checklist_id             uuid not null references public.loading_checklists (id) on delete cascade,
  position                 integer not null,
  item                     text not null check (length(trim(item)) between 1 and 200),
  qty                      text check (qty is null or length(qty) <= 80),
  source                   text not null check (source in ('work_order', 'added')),
  removed_from_work_order  boolean not null default false,
  status                   public.checklist_item_status not null default 'pending',
  note                     text check (note is null or length(note) <= 500),
  updated_by               uuid references public.employees (id) on delete set null,
  updated_at               timestamptz not null default now(),
  created_at               timestamptz not null default now()
);
create index loading_checklist_items_checklist_idx on public.loading_checklist_items (checklist_id, position);

create trigger audit_loading_checklists after insert or update or delete on public.loading_checklists
  for each row execute function audit.capture();
create trigger audit_loading_checklist_items after insert or update or delete on public.loading_checklist_items
  for each row execute function audit.capture();

-- Missing items notify the project manager.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('fwo_published', 'checklist_missing'));

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- Office staff, or a crew lead on this job.
create function app.can_load_trailer(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_office_staff() or (app.has_role('crew_lead') and app.is_assigned_to_project(p_project_id))
$$;

create function app.checklist_fwo_id(p_checklist_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select fwo_id from public.loading_checklists where id = p_checklist_id
$$;

revoke all on function app.can_load_trailer(uuid), app.checklist_fwo_id(uuid) from public;
grant execute on function app.can_load_trailer(uuid), app.checklist_fwo_id(uuid) to authenticated, service_role;

-- Brings a checklist's work-order items in line with a revision's trailer list.
-- Matching is by item text (ignoring case and spaces). Ticks and notes on
-- items that are still there are kept.
create function app.sync_checklist_items(p_checklist_id uuid, p_revision_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_materials jsonb;
  v_row jsonb;
  v_pos integer := 0;
  v_keys text[] := '{}';
  v_key text;
begin
  select case when jsonb_typeof(content -> 'trailerMaterials') = 'array' then content -> 'trailerMaterials' else '[]'::jsonb end
    into v_materials
  from public.fwo_revisions where id = p_revision_id;

  for v_row in select * from jsonb_array_elements(v_materials) loop
    v_pos := v_pos + 1;
    v_key := lower(trim(v_row ->> 'item'));
    continue when v_key is null or v_key = '';
    v_keys := v_keys || v_key;
    update public.loading_checklist_items
       set qty = nullif(trim(coalesce(v_row ->> 'qty', '')), ''), position = v_pos, removed_from_work_order = false
     where checklist_id = p_checklist_id and source = 'work_order' and lower(trim(item)) = v_key;
    if not found then
      insert into public.loading_checklist_items (checklist_id, position, item, qty, source)
      values (p_checklist_id, v_pos, trim(v_row ->> 'item'), nullif(trim(coalesce(v_row ->> 'qty', '')), ''), 'work_order');
    end if;
  end loop;

  update public.loading_checklist_items
     set removed_from_work_order = true
   where checklist_id = p_checklist_id and source = 'work_order' and not (lower(trim(item)) = any (v_keys));

  update public.loading_checklists set revision_id = p_revision_id where id = p_checklist_id;
end $$;
revoke all on function app.sync_checklist_items(uuid, uuid) from public;

-- -----------------------------------------------------------------------------
-- The functions the app calls
-- -----------------------------------------------------------------------------
-- Returns the work order's checklist, creating it from the current revision
-- the first time a crew lead (or the office) opens it.
create function public.ensure_loading_checklist(p_fwo_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_fwo public.field_work_orders;
  v_id uuid;
begin
  select * into v_fwo from public.field_work_orders where id = p_fwo_id;
  if not found or v_fwo.status <> 'published' or not app.can_view_published_fwo(p_fwo_id) then
    raise exception 'Work order not found.' using errcode = 'P0002';
  end if;
  select id into v_id from public.loading_checklists where fwo_id = p_fwo_id;
  if v_id is not null then
    return v_id;
  end if;
  if not app.can_load_trailer(v_fwo.project_id) then
    raise exception 'Only the crew lead or the office can start the loading checklist.' using errcode = '42501';
  end if;
  insert into public.loading_checklists (fwo_id, revision_id) values (p_fwo_id, v_fwo.current_revision_id)
  on conflict (fwo_id) do nothing
  returning id into v_id;
  if v_id is null then  -- someone else started it at the same moment
    select id into v_id from public.loading_checklists where fwo_id = p_fwo_id;
    return v_id;
  end if;
  perform app.sync_checklist_items(v_id, v_fwo.current_revision_id);
  return v_id;
end $$;

-- Ticks an item: 'loaded', 'missing' or back to 'pending', with an optional note.
create function public.set_checklist_item(p_item_id uuid, p_status public.checklist_item_status, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
  v_fwo public.field_work_orders;
  v_item public.loading_checklist_items;
  v_pm uuid;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select i.* into v_item from public.loading_checklist_items i where i.id = p_item_id;
  if not found then
    raise exception 'Item not found.' using errcode = 'P0002';
  end if;
  select f.* into v_fwo from public.field_work_orders f where f.id = app.checklist_fwo_id(v_item.checklist_id);
  v_project := v_fwo.project_id;
  if not app.can_view_published_fwo(v_fwo.id) or not app.can_load_trailer(v_project) then
    raise exception 'Only the crew lead or the office can tick the loading checklist.' using errcode = '42501';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'Note is too long.' using errcode = '22001';
  end if;

  update public.loading_checklist_items
     set status = p_status, note = v_note, updated_by = app.current_employee_id(), updated_at = now()
   where id = p_item_id;

  if p_status = 'missing' then
    select project_manager_id into v_pm from public.projects where id = v_project;
    if v_pm is not null and v_pm is distinct from app.current_employee_id()
       and exists (select 1 from public.employees where id = v_pm and is_active) then
      insert into public.notifications (recipient_id, type, project_id, entity_id, data, dedup_key)
      select v_pm, 'checklist_missing', v_project, v_fwo.id,
             jsonb_build_object('item', v_item.item, 'note', v_note, 'projectName', p.name, 'fwoNumber', v_fwo.fwo_number),
             'checklist_missing:' || p_item_id::text
      from public.projects p where p.id = v_project
      on conflict (recipient_id, dedup_key) do nothing;
    end if;
  end if;
end $$;

-- Adds an item that wasn't on the work order (e.g. "extra roller covers").
create function public.add_checklist_item(p_checklist_id uuid, p_item text, p_qty text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_fwo public.field_work_orders;
  v_id uuid;
begin
  select f.* into v_fwo from public.field_work_orders f where f.id = app.checklist_fwo_id(p_checklist_id);
  if not found or not app.can_view_published_fwo(v_fwo.id) or not app.can_load_trailer(v_fwo.project_id) then
    raise exception 'Only the crew lead or the office can add to the loading checklist.' using errcode = '42501';
  end if;
  insert into public.loading_checklist_items (checklist_id, position, item, qty, source, updated_by)
  values (p_checklist_id,
          coalesce((select max(position) from public.loading_checklist_items where checklist_id = p_checklist_id), 0) + 1000,
          trim(p_item), nullif(trim(coalesce(p_qty, '')), ''), 'added', app.current_employee_id())
  returning id into v_id;
  return v_id;
end $$;

-- Brings the checklist up to date with the work order's current revision.
create function public.sync_loading_checklist(p_checklist_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_fwo public.field_work_orders;
begin
  select f.* into v_fwo from public.field_work_orders f where f.id = app.checklist_fwo_id(p_checklist_id);
  if not found or not app.can_view_published_fwo(v_fwo.id) or not app.can_load_trailer(v_fwo.project_id) then
    raise exception 'Only the crew lead or the office can update the loading checklist.' using errcode = '42501';
  end if;
  perform app.sync_checklist_items(p_checklist_id, v_fwo.current_revision_id);
end $$;

revoke all on function public.ensure_loading_checklist(uuid), public.set_checklist_item(uuid, public.checklist_item_status, text),
  public.add_checklist_item(uuid, text, text), public.sync_loading_checklist(uuid) from public;
grant execute on function public.ensure_loading_checklist(uuid), public.set_checklist_item(uuid, public.checklist_item_status, text),
  public.add_checklist_item(uuid, text, text), public.sync_loading_checklist(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Privileges and Row Level Security: read-only tables; all writes go through
-- the functions above.
-- -----------------------------------------------------------------------------
grant select on public.loading_checklists, public.loading_checklist_items to authenticated;
grant select, insert, update, delete on public.loading_checklists, public.loading_checklist_items to service_role;
alter table public.loading_checklists enable row level security;
alter table public.loading_checklist_items enable row level security;

create policy loading_checklists_select on public.loading_checklists for select to authenticated
  using (app.can_view_published_fwo(fwo_id));
create policy loading_checklist_items_select on public.loading_checklist_items for select to authenticated
  using (app.can_view_published_fwo(app.checklist_fwo_id(checklist_id)));
