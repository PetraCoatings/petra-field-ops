-- =============================================================================
-- Daily reports: project managers write and edit them like office admins
-- (owner decision, 2026-11-25)
--
-- * Project managers can start, edit and submit any job's daily report.
--   Crew leads keep exactly what they had (their own jobs).
-- * The office (project managers and office admins) can edit a SUBMITTED
--   report before accepting it, instead of sending it back: the report goes
--   back to a draft holding the submitted content; they fix it and submit it
--   (saved as the next version, with their name), then accept it. Every
--   submitted version stays in the report's history.
-- * Accepting / sending back was already open to project managers.
--
-- Safe to run while people are clocked in (no time records are touched).
-- =============================================================================

create or replace function app.can_write_dfr(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_office_admin()
    or (app.has_role('project_manager') and app.can_view_project(p_project_id))
    or (
      app.has_role('crew_lead') and (
        exists (select 1 from public.projects p where p.id = p_project_id and p.crew_lead_id = app.current_employee_id())
        or exists (select 1 from public.project_assignments pa where pa.project_id = p_project_id and pa.employee_id = app.current_employee_id())
      )
    )
$$;

-- The office opens a submitted report for editing. Returns the draft version
-- to save against.
create function public.edit_submitted_daily_report(p_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_dfr public.daily_field_reports;
  v_latest jsonb;
begin
  if not app.is_office_staff() then
    raise exception 'Only the office can edit a submitted report' using errcode = '42501';
  end if;
  select * into v_dfr from public.daily_field_reports where id = p_id for update;
  if v_dfr.id is null or v_dfr.status <> 'submitted' then
    raise exception 'Only a submitted report can be opened for editing' using errcode = 'P0001';
  end if;
  select content into v_latest from public.dfr_versions where dfr_id = p_id order by version_number desc limit 1;
  update public.daily_field_reports
    set status = 'draft',
        draft = coalesce(v_latest, draft),
        version = version + 1,
        draft_saved_by = app.current_employee_id(),
        draft_saved_at = now()
    where id = p_id;
  return v_dfr.version + 1;
end $$;

revoke all on function public.edit_submitted_daily_report(uuid) from public, anon;
grant execute on function public.edit_submitted_daily_report(uuid) to authenticated;
