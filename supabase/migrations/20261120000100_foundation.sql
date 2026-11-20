-- =============================================================================
-- Petra Field Operations — Phase 1 foundation schema
--
-- Tables: employees, app_settings, customers, projects, project_contacts,
--         project_assignments, audit.log
--
-- Security model (see docs/ARCHITECTURE_PLAN.md §4 and §9):
--   * Every public table has Row Level Security enabled. The UI hiding a button
--     is never the only protection.
--   * Role and assignment checks live in SECURITY DEFINER helpers in the
--     private `app` schema (not exposed through the Supabase REST API).
--   * The `anon` role gets no table privileges at all.
--   * Sensitive changes are captured by an append-only audit trigger.
-- =============================================================================

create extension if not exists btree_gist;  -- used by Phase 5 time-segment overlap constraint

create schema if not exists app;    -- private helpers (not in the exposed API schemas)
create schema if not exists audit;  -- append-only audit trail

revoke all on schema app from public;
revoke all on schema audit from public;
grant usage on schema app to authenticated, service_role;
grant usage on schema audit to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('installer', 'crew_lead', 'project_manager', 'office_admin');
create type public.flsa_status as enum ('nonexempt', 'exempt');
create type public.project_status as enum ('draft', 'scheduled', 'in_progress', 'on_hold', 'completed', 'closed');
create type public.assignment_role as enum ('lead', 'installer');

-- -----------------------------------------------------------------------------
-- Shared trigger: maintain updated_at
-- -----------------------------------------------------------------------------
create function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Employees
-- One row per person. `user_id` links to Supabase Auth once the person has
-- accepted their invitation. Everyone clocks in (owner decision Q2); overtime
-- math applies only to `nonexempt` employees.
-- -----------------------------------------------------------------------------
create table public.employees (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid unique references auth.users (id) on delete set null,
  first_name        text not null check (length(trim(first_name)) > 0),
  last_name         text not null check (length(trim(last_name)) > 0),
  display_name      text generated always as (first_name || ' ' || last_name) stored,
  email             text not null,
  phone             text,
  role              public.app_role not null default 'installer',
  flsa_status       public.flsa_status not null default 'nonexempt',
  preferred_locale  text not null default 'en' check (preferred_locale in ('en', 'es')),
  hire_date         date,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index employees_email_key on public.employees (lower(email));
create trigger employees_touch before update on public.employees
  for each row execute function app.touch_updated_at();

comment on table public.employees is
  'Company personnel. Full rows readable only by the person themselves and office admins; '
  'others use public.employee_directory.';

-- -----------------------------------------------------------------------------
-- Role / identity helpers (SECURITY DEFINER so RLS policies can call them
-- without recursive policy evaluation on public.employees).
-- -----------------------------------------------------------------------------
create function app.current_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e
  where e.user_id = auth.uid() and e.is_active
$$;

create function app.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select e.role from public.employees e
  where e.user_id = auth.uid() and e.is_active
$$;

create function app.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.current_app_role() = any (roles), false)
$$;

-- Office-wide visibility: project managers and office admins.
create function app.is_office_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('project_manager', 'office_admin')
$$;

revoke all on all functions in schema app from public;
grant execute on function app.current_employee_id(), app.current_app_role(),
  app.has_role(public.app_role[]), app.is_office_staff() to authenticated, service_role;

-- Guard: never allow the last active office admin to be demoted or deactivated.
create function app.protect_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'office_admin' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'office_admin' or not new.is_active)
     and not exists (
       select 1 from public.employees e
       where e.role = 'office_admin' and e.is_active and e.id <> old.id
     ) then
    raise exception 'Cannot remove the last active office administrator'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger employees_protect_last_admin before update or delete on public.employees
  for each row execute function app.protect_last_admin();

-- -----------------------------------------------------------------------------
-- Company settings (single row). Payroll-affecting values are also audited.
-- workweek: Monday 00:00 America/Chicago (owner decision Q1).
-- -----------------------------------------------------------------------------
create table public.app_settings (
  id                        boolean primary key default true check (id),  -- enforces single row
  company_name              text not null default 'Petra Industrial Flooring LLC',
  company_timezone          text not null default 'America/Chicago',
  workweek_start_dow        smallint not null default 1 check (workweek_start_dow between 1 and 7), -- ISO: 1 = Monday
  workweek_start_time       time not null default '00:00',
  self_edit_window_hours    integer not null default 24 check (self_edit_window_hours between 0 and 168),
  gps_on_category_switch    boolean not null default false,
  dew_point_margin_f        numeric(5, 2) not null default 5.00 check (dew_point_margin_f >= 0),
  updated_at                timestamptz not null default now()
);
insert into public.app_settings default values;
create trigger app_settings_touch before update on public.app_settings
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Customers and projects
-- -----------------------------------------------------------------------------
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger customers_touch before update on public.customers
  for each row execute function app.touch_updated_at();

create table public.projects (
  id                        uuid primary key default gen_random_uuid(),
  job_number                text unique,
  name                      text not null check (length(trim(name)) > 0),
  customer_id               uuid references public.customers (id) on delete restrict,
  site_street               text,
  site_city                 text,
  site_state                text,
  site_postal_code          text,
  project_manager_id        uuid references public.employees (id) on delete set null,
  crew_lead_id              uuid references public.employees (id) on delete set null,
  scheduled_start           date,
  estimated_duration_days   integer check (estimated_duration_days is null or estimated_duration_days > 0),
  scope_summary             text,
  total_sqft                numeric(12, 2) check (total_sqft is null or total_sqft >= 0),
  flooring_system           text,
  status                    public.project_status not null default 'draft',
  created_by                uuid references public.employees (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index projects_status_idx on public.projects (status);
create index projects_crew_lead_idx on public.projects (crew_lead_id);
create trigger projects_touch before update on public.projects
  for each row execute function app.touch_updated_at();

create table public.project_contacts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  title       text,
  phone       text,
  email       text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index project_contacts_project_idx on public.project_contacts (project_id);

-- Crews are assembled per project (owner decision Q8): crew membership is
-- simply the set of assignments on a project.
create table public.project_assignments (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  employee_id   uuid not null references public.employees (id) on delete cascade,
  role_on_job   public.assignment_role not null default 'installer',
  start_date    date,
  end_date      date check (end_date is null or start_date is null or end_date >= start_date),
  created_at    timestamptz not null default now(),
  unique (project_id, employee_id)
);
create index project_assignments_employee_idx on public.project_assignments (employee_id);

-- Is the current user on this project (as assigned crew or as its crew lead)?
create function app.is_assigned_to_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_assignments pa
    where pa.project_id = p_project_id and pa.employee_id = app.current_employee_id()
  ) or exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.crew_lead_id = app.current_employee_id()
  )
$$;
revoke all on function app.is_assigned_to_project(uuid) from public;
grant execute on function app.is_assigned_to_project(uuid) to authenticated, service_role;

-- Can the current user see this project? Office staff see all projects.
create function app.can_view_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_office_staff() or app.is_assigned_to_project(p_project_id)
$$;
revoke all on function app.can_view_project(uuid) from public;
grant execute on function app.can_view_project(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Employee directory: the non-sensitive fields everyone may see (names, role),
-- needed for crew lists and group clock-in (a crew lead may clock in anyone
-- present). Email, phone, hire date and FLSA status are NOT exposed here.
-- -----------------------------------------------------------------------------
create view public.employee_directory
with (security_barrier = true) as
  select e.id, e.first_name, e.last_name, e.display_name, e.role, e.is_active
  from public.employees e
  where app.current_employee_id() is not null;   -- only signed-in, active employees

-- -----------------------------------------------------------------------------
-- Self-service: change my own language without granting UPDATE on employees.
-- -----------------------------------------------------------------------------
create function public.set_my_locale(p_locale text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_locale not in ('en', 'es') then
    raise exception 'Unsupported language' using errcode = '22023';
  end if;
  update public.employees set preferred_locale = p_locale
  where id = app.current_employee_id();
end $$;

-- Narrow "who am I" payload for the app shell.
create function public.get_my_profile()
returns table (employee_id uuid, first_name text, last_name text, display_name text,
               role public.app_role, flsa_status public.flsa_status, preferred_locale text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.first_name, e.last_name, e.display_name, e.role, e.flsa_status, e.preferred_locale
  from public.employees e
  where e.user_id = auth.uid() and e.is_active
$$;

-- -----------------------------------------------------------------------------
-- Audit trail (append-only). Written only by the trigger below; nobody,
-- including office admins, can update or delete rows through the API.
-- -----------------------------------------------------------------------------
create table audit.log (
  id                  bigint generated always as identity primary key,
  occurred_at         timestamptz not null default now(),
  table_name          text not null,
  row_id              text,
  action              text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data            jsonb,
  new_data            jsonb,
  actor_user_id       uuid,
  actor_employee_id   uuid
);
create index audit_log_table_row_idx on audit.log (table_name, row_id);
create index audit_log_occurred_idx on audit.log (occurred_at desc);

create function audit.capture() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  -- Skip no-op updates (e.g. only updated_at changed).
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;
  insert into audit.log (table_name, row_id, action, old_data, new_data, actor_user_id, actor_employee_id)
  values (tg_table_schema || '.' || tg_table_name,
          coalesce(v_new ->> 'id', v_old ->> 'id'),
          tg_op, v_old, v_new, auth.uid(), app.current_employee_id());
  return coalesce(new, old);
end $$;
revoke all on function audit.capture() from public;

create trigger audit_employees after insert or update or delete on public.employees
  for each row execute function audit.capture();
create trigger audit_app_settings after insert or update or delete on public.app_settings
  for each row execute function audit.capture();
create trigger audit_projects after insert or update or delete on public.projects
  for each row execute function audit.capture();
create trigger audit_project_assignments after insert or update or delete on public.project_assignments
  for each row execute function audit.capture();

-- Office admins read the audit log through this view.
create view public.audit_log with (security_invoker = true) as
  select * from audit.log;

-- =============================================================================
-- Privileges and Row Level Security
-- =============================================================================
-- Start from zero: no table access for anon, explicit grants for authenticated.
revoke all on all tables in schema public from anon, authenticated;
revoke all on audit.log from anon, authenticated;

grant select, insert, update, delete on public.employees, public.customers, public.projects,
  public.project_contacts, public.project_assignments to authenticated;
grant select, update on public.app_settings to authenticated;
grant select on public.employee_directory, public.audit_log to authenticated;
grant select on audit.log to authenticated;  -- still filtered by RLS below
grant execute on function public.set_my_locale(text), public.get_my_profile() to authenticated;
revoke execute on function public.set_my_locale(text), public.get_my_profile() from anon, public;

alter table public.employees           enable row level security;
alter table public.app_settings        enable row level security;
alter table public.customers           enable row level security;
alter table public.projects            enable row level security;
alter table public.project_contacts    enable row level security;
alter table public.project_assignments enable row level security;
alter table audit.log                  enable row level security;

-- employees: yourself, or office admin. (Directory view covers everyone else.)
create policy employees_select on public.employees for select to authenticated
  using (user_id = auth.uid() or app.has_role('office_admin'));
create policy employees_insert on public.employees for insert to authenticated
  with check (app.has_role('office_admin'));
create policy employees_update on public.employees for update to authenticated
  using (app.has_role('office_admin')) with check (app.has_role('office_admin'));
create policy employees_delete on public.employees for delete to authenticated
  using (app.has_role('office_admin'));

-- app_settings: everyone signed in may read; only office admins change.
create policy app_settings_select on public.app_settings for select to authenticated
  using (app.current_employee_id() is not null);
create policy app_settings_update on public.app_settings for update to authenticated
  using (app.has_role('office_admin')) with check (app.has_role('office_admin'));

-- customers: office staff; field staff only for customers on their projects.
create policy customers_select on public.customers for select to authenticated
  using (app.is_office_staff() or exists (
    select 1 from public.projects p
    where p.customer_id = customers.id and app.is_assigned_to_project(p.id)));
create policy customers_write on public.customers for insert to authenticated
  with check (app.is_office_staff());
create policy customers_update on public.customers for update to authenticated
  using (app.is_office_staff()) with check (app.is_office_staff());
create policy customers_delete on public.customers for delete to authenticated
  using (app.has_role('office_admin'));

-- projects
create policy projects_select on public.projects for select to authenticated
  using (app.can_view_project(id));
create policy projects_insert on public.projects for insert to authenticated
  with check (app.is_office_staff());
create policy projects_update on public.projects for update to authenticated
  using (app.is_office_staff()) with check (app.is_office_staff());
create policy projects_delete on public.projects for delete to authenticated
  using (app.has_role('office_admin'));

-- project_contacts
create policy project_contacts_select on public.project_contacts for select to authenticated
  using (app.can_view_project(project_id));
create policy project_contacts_insert on public.project_contacts for insert to authenticated
  with check (app.is_office_staff());
create policy project_contacts_update on public.project_contacts for update to authenticated
  using (app.is_office_staff()) with check (app.is_office_staff());
create policy project_contacts_delete on public.project_contacts for delete to authenticated
  using (app.is_office_staff());

-- project_assignments: see the crew on projects you can see.
create policy project_assignments_select on public.project_assignments for select to authenticated
  using (app.can_view_project(project_id));
create policy project_assignments_insert on public.project_assignments for insert to authenticated
  with check (app.is_office_staff());
create policy project_assignments_update on public.project_assignments for update to authenticated
  using (app.is_office_staff()) with check (app.is_office_staff());
create policy project_assignments_delete on public.project_assignments for delete to authenticated
  using (app.is_office_staff());

-- audit log: office admins read; no write policies exist, so API writes are impossible.
create policy audit_log_select on audit.log for select to authenticated
  using (app.has_role('office_admin'));
