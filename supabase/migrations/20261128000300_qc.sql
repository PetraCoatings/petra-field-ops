-- =============================================================================
-- Phase 8 (part 3): quality-control checks
--
-- qc_test_types     the kinds of test (moisture by RH probe or calcium
--                   chloride, pH, surface profile, film thickness, adhesion,
--                   ESD resistance) with their unit and usual method.
-- qc_requirements   the tests a job needs, set by the office (project
--                   managers, office admins), each with OPTIONAL acceptance
--                   limits (minimum and/or maximum).
-- qc_measurements   readings taken on site by the job's crew lead (or an
--                   office admin): value, location, when, method, notes.
--
-- Rule (docs/ARCHITECTURE_PLAN.md §10, Phase 8): a reading shows "pass" or
-- "fail" ONLY when the job's requirement for that test has a limit. The limit
-- in force is copied onto the reading when it's recorded, so changing a
-- limit later never changes an earlier result. Without a limit the result
-- stays empty: the reading is recorded, never judged.
-- =============================================================================

create table public.qc_test_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  unit        text not null,
  method      text,
  sort        smallint not null default 0,
  is_active   boolean not null default true
);
insert into public.qc_test_types (code, name, unit, method, sort) values
  ('moisture_rh', 'Moisture: relative humidity (in-slab probe)', '% RH', 'ASTM F2170', 1),
  ('moisture_cacl', 'Moisture: calcium chloride (MVER)', 'lbs/1,000 sf/24 h', 'ASTM F1869', 2),
  ('ph', 'Surface pH', 'pH', 'ASTM F710', 3),
  ('csp', 'Surface profile (CSP)', 'CSP', 'ICRI 310.2R chips', 4),
  ('wft', 'Wet film thickness', 'mils', 'Wet film gauge', 5),
  ('dft', 'Dry film thickness', 'mils', 'ASTM D7091', 6),
  ('adhesion', 'Pull-off adhesion', 'psi', 'ASTM D4541 / D7234', 7),
  ('esd', 'ESD resistance (point to ground)', 'ohms', 'ANSI/ESD S7.1', 8);

create table public.qc_requirements (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  test_type_id  uuid not null references public.qc_test_types (id),
  min_value     numeric check (min_value is null or min_value > -1e15),
  max_value     numeric check (max_value is null or max_value < 1e15),
  notes         text check (notes is null or length(notes) <= 300),
  created_by    uuid references public.employees (id) on delete set null default app.current_employee_id(),
  created_at    timestamptz not null default now(),
  check (min_value is null or max_value is null or min_value <= max_value),
  unique (project_id, test_type_id)
);
create trigger audit_qc_requirements after insert or update or delete on public.qc_requirements
  for each row execute function audit.capture();

create table public.qc_measurements (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  test_type_id    uuid not null references public.qc_test_types (id),
  requirement_id  uuid references public.qc_requirements (id) on delete set null,
  value           numeric not null check (value > -1e15 and value < 1e15),
  unit            text not null,
  method          text check (method is null or length(method) <= 120),
  location        text check (location is null or length(location) <= 200),
  notes           text check (notes is null or length(notes) <= 1000),
  measured_at     timestamptz not null default now(),
  measured_by     uuid references public.employees (id) on delete set null default app.current_employee_id(),
  criteria_min    numeric,    -- the limits in force when recorded
  criteria_max    numeric,
  result          text check (result in ('pass', 'fail')),  -- null when no limit was set
  created_at      timestamptz not null default now(),
  check (result is null or criteria_min is not null or criteria_max is not null)
);
create index qc_measurements_project_idx on public.qc_measurements (project_id, measured_at desc);
create trigger audit_qc_measurements after insert or update or delete on public.qc_measurements
  for each row execute function audit.capture();

alter table public.photos add column qc_measurement_id uuid references public.qc_measurements (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Recording a reading
-- -----------------------------------------------------------------------------
create function public.record_qc_measurement(
  p_project_id uuid,
  p_test_type_id uuid,
  p_value numeric,
  p_location text default null,
  p_method text default null,
  p_notes text default null,
  p_measured_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_type public.qc_test_types;
  v_req public.qc_requirements;
  v_result text;
  v_id uuid;
begin
  if not app.can_write_dfr(p_project_id) then
    raise exception 'Only the job''s crew lead or the office records QC readings' using errcode = '42501';
  end if;
  select * into v_type from public.qc_test_types where id = p_test_type_id and is_active;
  if v_type.id is null or p_value is null then
    raise exception 'Choose a test and enter a value' using errcode = '22023';
  end if;
  if p_measured_at is not null and p_measured_at > now() + interval '5 minutes' then
    raise exception 'That time is in the future' using errcode = '22023';
  end if;
  select * into v_req from public.qc_requirements where project_id = p_project_id and test_type_id = p_test_type_id;
  if v_req.id is not null and (v_req.min_value is not null or v_req.max_value is not null) then
    v_result := case when (v_req.min_value is null or p_value >= v_req.min_value)
                      and (v_req.max_value is null or p_value <= v_req.max_value) then 'pass' else 'fail' end;
  end if;
  insert into public.qc_measurements (project_id, test_type_id, requirement_id, value, unit, method, location, notes, measured_at,
    measured_by, criteria_min, criteria_max, result)
  values (p_project_id, p_test_type_id, v_req.id, p_value, v_type.unit, coalesce(nullif(trim(p_method), ''), v_type.method),
    nullif(trim(p_location), ''), nullif(trim(p_notes), ''), coalesce(p_measured_at, now()),
    app.current_employee_id(), v_req.min_value, v_req.max_value, v_result)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_qc_measurement(uuid, uuid, numeric, text, text, text, timestamptz) from public, anon;
grant execute on function public.record_qc_measurement(uuid, uuid, numeric, text, text, text, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Access
-- -----------------------------------------------------------------------------
alter table public.qc_test_types enable row level security;
alter table public.qc_requirements enable row level security;
alter table public.qc_measurements enable row level security;
grant select on public.qc_test_types to authenticated;
grant select, insert, update, delete on public.qc_requirements to authenticated;
grant select, delete on public.qc_measurements to authenticated;
grant select, insert, update, delete on public.qc_test_types, public.qc_requirements, public.qc_measurements to service_role;

create policy qc_types_read on public.qc_test_types for select to authenticated using (app.current_employee_id() is not null);
create policy qc_req_read on public.qc_requirements for select to authenticated using (app.can_view_project(project_id));
create policy qc_req_write on public.qc_requirements for all to authenticated
  using (app.is_office_staff()) with check (app.is_office_staff());
create policy qc_meas_read on public.qc_measurements for select to authenticated using (app.can_view_project(project_id));
-- A reading entered by mistake: the office, or whoever took it on the same day, removes it (audited).
create policy qc_meas_delete on public.qc_measurements for delete to authenticated
  using (app.is_office_staff() or (measured_by = app.current_employee_id() and created_at > now() - interval '24 hours'));
