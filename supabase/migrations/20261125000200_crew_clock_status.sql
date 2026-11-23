-- =============================================================================
-- Phase 5 (part 2): crew clock-in
--
-- A crew lead (or the office) clocks a group in, switches them, starts and
-- ends lunch, and clocks them out with public.clock_action(..., p_employee_ids).
-- To show who is on the clock right now, they need each person's current
-- status, but not anyone's history or hours: this function returns only the
-- open segment (what they're doing and since when) for the people asked about.
-- =============================================================================

create function public.crew_clock_status(p_employee_ids uuid[])
returns table (employee_id uuid, kind text, category public.time_category, project_id uuid, start_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_role('crew_lead', 'project_manager', 'office_admin') then
    raise exception 'Only crew leads and the office can see crew status' using errcode = '42501';
  end if;
  if cardinality(p_employee_ids) > 100 then
    raise exception 'Too many people' using errcode = '22023';
  end if;
  return query
    select s.employee_id, s.kind, s.category, s.project_id, s.start_at
    from public.time_segments s
    join public.employees e on e.id = s.employee_id and e.is_active
    where s.employee_id = any (p_employee_ids) and s.end_at is null and s.status = 'active';
end $$;

revoke all on function public.crew_clock_status(uuid[]) from public, anon;
grant execute on function public.crew_clock_status(uuid[]) to authenticated;
