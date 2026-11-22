-- =============================================================================
-- Phase 3b — Work order templates
--
-- A template is a reusable chunk of work order content (same sections as a
-- work order: summary rows, trailer and jobsite materials, mix ratios, schedule
-- days, safety, QC tests, notes, custom sections; never drawings).
--
-- Inserting a template into a work order COPIES its content into that work
-- order's draft. Nothing links them afterwards: editing a job never changes
-- the template, and editing the template never changes existing work orders.
--
-- Office staff (project managers and office admins) only. Crews never see
-- templates; they see the published work orders built from them.
-- =============================================================================

create table public.work_order_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 1 and 120),
  description  text check (description is null or length(description) <= 500),
  content      jsonb not null default '{}'::jsonb
               check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 262144),
  is_active    boolean not null default true,
  created_by   uuid default app.current_employee_id() references public.employees (id) on delete set null,
  updated_by   uuid default app.current_employee_id() references public.employees (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index work_order_templates_name_idx on public.work_order_templates (lower(trim(name)));
create trigger work_order_templates_touch before update on public.work_order_templates
  for each row execute function app.touch_updated_at();
create trigger audit_work_order_templates after insert or update or delete on public.work_order_templates
  for each row execute function audit.capture();

grant select, insert, update, delete on public.work_order_templates to authenticated;
grant select, insert, update, delete on public.work_order_templates to service_role;
alter table public.work_order_templates enable row level security;

create policy work_order_templates_select on public.work_order_templates for select to authenticated
  using (app.is_office_staff());
create policy work_order_templates_insert on public.work_order_templates for insert to authenticated
  with check (app.is_office_staff());
create policy work_order_templates_update on public.work_order_templates for update to authenticated
  using (app.is_office_staff()) with check (app.is_office_staff());
create policy work_order_templates_delete on public.work_order_templates for delete to authenticated
  using (app.is_office_staff());
