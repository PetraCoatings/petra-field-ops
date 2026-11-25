-- =============================================================================
-- Daily reports: the office can reopen an accepted report (owner request,
-- 2026-11-25)
--
-- Accepted reports were final for everyone. Now a project manager or office
-- admin can reopen one, with a reason: it goes back to a draft holding the
-- accepted content; they fix it, submit it (saved as the next version) and
-- accept it again. Each reopening is kept in dfr_reopens (which accepted
-- version, who had accepted it, who reopened it, when and why), and every
-- submitted version stays in the report's history.
--
-- Safe to run while people are clocked in (no time records are touched).
-- =============================================================================

create table public.dfr_reopens (
  id                uuid primary key default gen_random_uuid(),
  dfr_id            uuid not null references public.daily_field_reports (id) on delete cascade,
  accepted_version  integer not null,
  accepted_by       uuid references public.employees (id) on delete set null,
  accepted_at       timestamptz,
  reason            text not null check (length(trim(reason)) between 3 and 500),
  reopened_by       uuid references public.employees (id) on delete set null default app.current_employee_id(),
  reopened_at       timestamptz not null default now()
);
create index dfr_reopens_dfr_idx on public.dfr_reopens (dfr_id, reopened_at);
create trigger audit_dfr_reopens after insert or update or delete on public.dfr_reopens
  for each row execute function audit.capture();

alter table public.dfr_reopens enable row level security;
grant select on public.dfr_reopens to authenticated;
grant select, insert, update, delete on public.dfr_reopens to service_role;
create policy dfr_reopens_read on public.dfr_reopens for select to authenticated
  using (exists (select 1 from public.daily_field_reports d where d.id = dfr_id and app.can_view_project(d.project_id)));

-- Reopen an accepted report for changes. Returns the draft version to save against.
create function public.reopen_daily_report(p_id uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_dfr public.daily_field_reports;
  v_latest public.dfr_versions;
begin
  if not app.is_office_staff() then
    raise exception 'Only the office can reopen an accepted report' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 or length(p_reason) > 500 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  select * into v_dfr from public.daily_field_reports where id = p_id for update;
  if v_dfr.id is null or v_dfr.status <> 'accepted' then
    raise exception 'Only an accepted report can be reopened' using errcode = 'P0001';
  end if;
  select * into v_latest from public.dfr_versions where dfr_id = p_id order by version_number desc limit 1;
  insert into public.dfr_reopens (dfr_id, accepted_version, accepted_by, accepted_at, reason)
  values (p_id, coalesce(v_latest.version_number, 0), v_dfr.accepted_by, v_dfr.accepted_at, trim(p_reason));
  update public.daily_field_reports
    set status = 'draft',
        draft = coalesce(v_latest.content, draft),
        version = version + 1,
        accepted_by = null,
        accepted_at = null,
        draft_saved_by = app.current_employee_id(),
        draft_saved_at = now()
    where id = p_id;
  return v_dfr.version + 1;
end $$;

revoke all on function public.reopen_daily_report(uuid, text) from public, anon;
grant execute on function public.reopen_daily_report(uuid, text) to authenticated;
