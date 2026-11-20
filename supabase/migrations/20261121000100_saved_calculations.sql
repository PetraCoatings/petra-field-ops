-- =============================================================================
-- Phase 2 — saved calculator results ("Save to job")
--
-- A crew member or the office saves a calculator result onto a project.
--   * inputs:  what was typed in (numbers only, validated by the server)
--   * outputs: the result, RECOMPUTED ON THE SERVER from the inputs with the
--              same code the phone uses (src/domain/calculators). Whatever the
--              phone claims the answer is, is never stored.
--   * engine_version: which version of that code produced the outputs.
--
-- Append-only: rows can be added and deleted but never edited, so a saved
-- number can't be quietly changed later. Every insert and delete is audited.
--
-- Who may do what (docs/ARCHITECTURE_PLAN.md §4, "Save calculation to a project"):
--   read    anyone who can see the project (assigned crew, project managers, office admins)
--   save    installers and crew leads on projects they're assigned to; PMs and admins on any
--   delete  the person who saved it, or a project manager / office admin
-- =============================================================================

create type public.calculation_type as enum (
  'square_footage', 'spread_rate', 'material_quantity', 'mix_ratio', 'dew_point'
);

create table public.saved_calculations (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  type            public.calculation_type not null,
  label           text check (label is null or (length(trim(label)) between 1 and 120)),
  inputs          jsonb not null check (jsonb_typeof(inputs) = 'object' and pg_column_size(inputs) <= 16384),
  outputs         jsonb not null check (jsonb_typeof(outputs) = 'object' and pg_column_size(outputs) <= 4096),
  engine_version  text not null check (length(engine_version) between 1 and 60),
  created_by      uuid default app.current_employee_id() references public.employees (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index saved_calculations_project_idx on public.saved_calculations (project_id, created_at desc);

create trigger audit_saved_calculations after insert or update or delete on public.saved_calculations
  for each row execute function audit.capture();

-- No UPDATE grant: rows are append-only.
grant select, insert, delete on public.saved_calculations to authenticated;
grant select, insert, update, delete on public.saved_calculations to service_role;

alter table public.saved_calculations enable row level security;

create policy saved_calculations_select on public.saved_calculations for select to authenticated
  using (app.can_view_project(project_id));

-- can_view_project = office staff (any project) or assigned to it.
-- created_by must be the person saving: nobody can save in someone else's name.
create policy saved_calculations_insert on public.saved_calculations for insert to authenticated
  with check (
    created_by = app.current_employee_id()
    and app.can_view_project(project_id)
  );

create policy saved_calculations_delete on public.saved_calculations for delete to authenticated
  using (
    app.can_view_project(project_id)
    and (created_by = app.current_employee_id() or app.is_office_staff())
  );
