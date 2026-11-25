-- =============================================================================
-- QC: a "Dew point" test (owner request, 2026-11-25)
--
-- The crew lead enters air temperature, relative humidity and surface
-- temperature; the app computes the dew point (the same Magnus formula as the
-- dew point calculator and daily reports) and records how far the surface is
-- above it, in °F. The job's requirement (a minimum, e.g. 5 °F; the company
-- margin when the office leaves it blank) gives pass or fail as for any test.
-- The three readings and the computed dew point are kept with the reading.
--
-- Safe to run while people are clocked in (no time records are touched).
-- =============================================================================

insert into public.qc_test_types (code, name, unit, method, sort)
values ('dew_point', 'Dew point: surface above dew point', '°F above dew point', 'Air temp + humidity + surface temp (Magnus formula)', 9)
on conflict (code) do nothing;

alter table public.qc_measurements add column inputs jsonb
  check (inputs is null or (jsonb_typeof(inputs) = 'object' and pg_column_size(inputs) <= 2048));

-- Same as before, plus p_inputs (the readings behind a computed value).
drop function public.record_qc_measurement(uuid, uuid, numeric, text, text, text, timestamptz);
create function public.record_qc_measurement(
  p_project_id uuid,
  p_test_type_id uuid,
  p_value numeric,
  p_location text default null,
  p_method text default null,
  p_notes text default null,
  p_measured_at timestamptz default null,
  p_inputs jsonb default null
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
  if v_type.code = 'dew_point' and (p_inputs is null or p_inputs ->> 'dewPointF' is null) then
    raise exception 'Enter air temperature, humidity and surface temperature' using errcode = '22023';
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
    measured_by, criteria_min, criteria_max, result, inputs)
  values (p_project_id, p_test_type_id, v_req.id, p_value, v_type.unit, coalesce(nullif(trim(p_method), ''), v_type.method),
    nullif(trim(p_location), ''), nullif(trim(p_notes), ''), coalesce(p_measured_at, now()),
    app.current_employee_id(), v_req.min_value, v_req.max_value, v_result, p_inputs)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_qc_measurement(uuid, uuid, numeric, text, text, text, timestamptz, jsonb) from public, anon;
grant execute on function public.record_qc_measurement(uuid, uuid, numeric, text, text, text, timestamptz, jsonb) to authenticated;
