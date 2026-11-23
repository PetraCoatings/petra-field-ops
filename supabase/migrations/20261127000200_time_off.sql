-- =============================================================================
-- Phase 7 (part 2): time off
--
-- Anyone can request time off. Two steps (docs/ARCHITECTURE_PLAN.md §4):
--   1. their crew lead (or the project manager of a job they're on) approves
--      or rejects;
--   2. an office admin gives the final approval or rejects.
-- Someone with no crew lead or project manager (office staff, for example)
-- goes straight to step 2. An office admin may also decide at step 1. A
-- rejection needs a reason. Each step notifies the next person and the
-- requester. No accrual or balance math is done (no policy is configured).
-- Approved time off shows on the calendar and in calendar links.
-- =============================================================================

create table public.leave_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) between 1 and 40),
  is_paid     boolean not null default false,
  sort        smallint not null default 0,
  is_active   boolean not null default true
);
insert into public.leave_types (name, sort) values ('Vacation', 1), ('Sick', 2), ('Personal', 3), ('Unpaid', 4);
alter table public.leave_types enable row level security;
grant select, insert, update, delete on public.leave_types to authenticated;
grant select, insert, update, delete on public.leave_types to service_role;
create policy leave_types_read on public.leave_types for select to authenticated using (app.current_employee_id() is not null);
create policy leave_types_write on public.leave_types for all to authenticated using (app.is_office_admin()) with check (app.is_office_admin());

create table public.time_off_requests (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees (id) on delete cascade,
  leave_type_id       uuid not null references public.leave_types (id),
  start_date          date not null,
  end_date            date not null,
  partial_hours       numeric(4, 2) check (partial_hours is null or (partial_hours > 0 and partial_hours <= 12)),
  notes               text check (notes is null or length(notes) <= 500),
  status              text not null default 'pending_lead'
                      check (status in ('pending_lead', 'pending_office', 'approved', 'rejected', 'cancelled')),
  created_at          timestamptz not null default now(),
  lead_decision_by    uuid references public.employees (id) on delete set null,
  lead_decision_at    timestamptz,
  lead_decision_note  text,
  office_decision_by  uuid references public.employees (id) on delete set null,
  office_decision_at  timestamptz,
  office_decision_note text,
  cancelled_by        uuid references public.employees (id) on delete set null,
  cancelled_at        timestamptz,
  check (end_date >= start_date),
  check (end_date - start_date <= 60),
  check (partial_hours is null or start_date = end_date)
);
create index time_off_requests_employee_idx on public.time_off_requests (employee_id, start_date);
create index time_off_requests_pending_idx on public.time_off_requests (status) where status in ('pending_lead', 'pending_office');
create trigger audit_time_off_requests after insert or update or delete on public.time_off_requests
  for each row execute function audit.capture();

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('fwo_published', 'checklist_missing', 'time_off_requested', 'time_off_decided'));

-- Who leads this person: crew leads and project managers of open jobs they're
-- on (and anyone assigned to such a job as lead), not themselves.
create function app.leads_of(p_employee_id uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct x.lead from (
    select p.crew_lead_id as lead from public.projects p
      join public.project_assignments pa on pa.project_id = p.id and pa.employee_id = p_employee_id
      where p.status <> 'closed'
    union
    select p.project_manager_id from public.projects p
      join public.project_assignments pa on pa.project_id = p.id and pa.employee_id = p_employee_id
      where p.status <> 'closed'
    union
    select me.employee_id from public.project_assignments me
      join public.projects p on p.id = me.project_id and p.status <> 'closed'
      join public.project_assignments pa on pa.project_id = p.id and pa.employee_id = p_employee_id
      where me.role_on_job = 'lead'
  ) x
  join public.employees e on e.id = x.lead and e.is_active and e.role in ('crew_lead', 'project_manager')
  where x.lead is not null and x.lead <> p_employee_id
$$;
revoke all on function app.leads_of(uuid) from public;
grant execute on function app.leads_of(uuid) to authenticated, service_role;

create function app.notify_time_off(p_request public.time_off_requests, p_type text, p_recipients uuid[]) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, type, entity_id, data, dedup_key)
  select r, p_type, p_request.id,
         jsonb_build_object('name', e.display_name, 'start', p_request.start_date, 'end', p_request.end_date,
                            'leaveType', lt.name, 'status', p_request.status,
                            'note', coalesce(p_request.office_decision_note, p_request.lead_decision_note)),
         p_type || ':' || p_request.id || ':' || p_request.status
  from unnest(p_recipients) r
  join public.employees e on e.id = p_request.employee_id
  join public.leave_types lt on lt.id = p_request.leave_type_id
  where r is not null
  on conflict (recipient_id, dedup_key) do nothing
$$;
revoke all on function app.notify_time_off(public.time_off_requests, text, uuid[]) from public;

create function app.office_admin_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from public.employees where role = 'office_admin' and is_active
$$;
revoke all on function app.office_admin_ids() from public;

-- -----------------------------------------------------------------------------
-- Request, decide, cancel
-- -----------------------------------------------------------------------------
create function public.request_time_off(
  p_leave_type_id uuid,
  p_start date,
  p_end date,
  p_partial_hours numeric default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.current_employee_id();
  v_leads uuid[];
  v_req public.time_off_requests;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.leave_types where id = p_leave_type_id and is_active) then
    raise exception 'Choose a kind of time off' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'The last day is before the first day' using errcode = '22023';
  end if;
  if exists (select 1 from public.time_off_requests r
             where r.employee_id = v_me and r.status in ('pending_lead', 'pending_office', 'approved')
               and daterange(r.start_date, r.end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'You already asked for time off on some of these days' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(l), '{}') into v_leads from app.leads_of(v_me) l;
  insert into public.time_off_requests (employee_id, leave_type_id, start_date, end_date, partial_hours, notes, status)
  values (v_me, p_leave_type_id, p_start, p_end, p_partial_hours, nullif(trim(p_notes), ''),
          case when cardinality(v_leads) > 0 then 'pending_lead' else 'pending_office' end)
  returning * into v_req;
  perform app.notify_time_off(v_req, 'time_off_requested',
    case when v_req.status = 'pending_lead' then v_leads else app.office_admin_ids() end);
  return v_req.id;
end $$;

create function public.decide_time_off(p_request_id uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.current_employee_id();
  v_req public.time_off_requests;
  v_admin boolean := app.is_office_admin();
  v_note text := nullif(trim(p_note), '');
begin
  select * into v_req from public.time_off_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_req.employee_id = v_me and not v_admin then
    raise exception 'You can''t approve your own time off' using errcode = '42501';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Write a reason for saying no' using errcode = '22023';
  end if;

  if v_req.status = 'pending_lead' and not v_admin then
    if not (v_me in (select app.leads_of(v_req.employee_id))) then
      raise exception 'Only their crew lead or the office can decide this' using errcode = '42501';
    end if;
    update public.time_off_requests
      set status = case when p_approve then 'pending_office' else 'rejected' end,
          lead_decision_by = v_me, lead_decision_at = now(), lead_decision_note = v_note
      where id = p_request_id returning * into v_req;
    if p_approve then
      perform app.notify_time_off(v_req, 'time_off_requested', app.office_admin_ids());
    else
      perform app.notify_time_off(v_req, 'time_off_decided', array[v_req.employee_id]);
    end if;
  elsif v_req.status in ('pending_lead', 'pending_office') then
    if not v_admin then
      raise exception 'Only an office admin gives the final approval' using errcode = '42501';
    end if;
    update public.time_off_requests
      set status = case when p_approve then 'approved' else 'rejected' end,
          office_decision_by = v_me, office_decision_at = now(), office_decision_note = v_note
      where id = p_request_id returning * into v_req;
    perform app.notify_time_off(v_req, 'time_off_decided', array[v_req.employee_id]);
  else
    raise exception 'This request was already decided' using errcode = 'P0001';
  end if;
  return v_req.status;
end $$;

-- The requester can cancel while it's pending, or approved time off that
-- hasn't started yet (the office is told). Office admins can cancel any.
create function public.cancel_time_off(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.current_employee_id();
  v_req public.time_off_requests;
  v_today date;
  v_was text;
begin
  select (now() at time zone company_timezone)::date into v_today from public.app_settings;
  select * into v_req from public.time_off_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if not (app.is_office_admin() or (v_req.employee_id = v_me
          and (v_req.status in ('pending_lead', 'pending_office') or (v_req.status = 'approved' and v_req.start_date > v_today)))) then
    raise exception 'This request can''t be cancelled' using errcode = '42501';
  end if;
  if v_req.status in ('rejected', 'cancelled') then
    raise exception 'This request can''t be cancelled' using errcode = 'P0001';
  end if;
  v_was := v_req.status;
  update public.time_off_requests set status = 'cancelled', cancelled_by = v_me, cancelled_at = now()
    where id = p_request_id returning * into v_req;
  if v_was = 'approved' and v_req.employee_id = v_me then
    perform app.notify_time_off(v_req, 'time_off_decided', app.office_admin_ids());
  end if;
end $$;

revoke all on function public.request_time_off(uuid, date, date, numeric, text), public.decide_time_off(uuid, boolean, text),
  public.cancel_time_off(uuid) from public, anon;
grant execute on function public.request_time_off(uuid, date, date, numeric, text), public.decide_time_off(uuid, boolean, text),
  public.cancel_time_off(uuid) to authenticated;

alter table public.time_off_requests enable row level security;
grant select on public.time_off_requests to authenticated;
grant select, insert, update, delete on public.time_off_requests to service_role;
create policy time_off_read on public.time_off_requests for select to authenticated
  using (employee_id = app.current_employee_id()
         or app.current_employee_id() in (select app.leads_of(employee_id))
         or app.is_office_admin());

-- -----------------------------------------------------------------------------
-- Calendar: approved time off. Everyone sees their own; crew leads and
-- project managers see their crew's; office staff see everyone's.
-- -----------------------------------------------------------------------------
create or replace function app.calendar_events(p_employee_id uuid, p_all boolean, p_from date, p_to date)
returns table (kind text, day date, title text, start_text text, project_id uuid, project_name text, address text, job_number text)
language sql stable security definer set search_path = '' as $$
  with visible as (
    select p.* from public.projects p
    where p.status <> 'closed'
      and (p_all
           or p.crew_lead_id = p_employee_id
           or p.project_manager_id = p_employee_id
           or exists (select 1 from public.project_assignments pa where pa.project_id = p.id and pa.employee_id = p_employee_id))
      and (p.status <> 'draft' or p_all)
  ),
  dated as (
    select v.id as project_id, (d.value ->> 'date')::date as day, nullif(trim(d.value ->> 'title'), '') as title,
           nullif(trim(d.value ->> 'startTime'), '') as start_text
    from visible v
    join public.field_work_orders f on f.project_id = v.id and f.status <> 'void' and f.current_revision_id is not null
    join public.fwo_revisions r on r.id = f.current_revision_id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.content -> 'schedule') = 'array' then r.content -> 'schedule' else '[]'::jsonb end) d
    where (d.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  fallback as (
    select v.id as project_id, (v.scheduled_start + g.n)::date as day, null::text as title, null::text as start_text
    from visible v
    cross join lateral generate_series(0, coalesce(v.estimated_duration_days, 1) - 1) g(n)
    where v.scheduled_start is not null
      and not exists (select 1 from dated x where x.project_id = v.id)
  ),
  jobs as (select * from dated union all select * from fallback),
  off as (
    select r.*, e.display_name, lt.name as leave_name
    from public.time_off_requests r
    join public.employees e on e.id = r.employee_id
    join public.leave_types lt on lt.id = r.leave_type_id
    where r.status = 'approved' and r.start_date <= p_to and r.end_date >= p_from
      and (p_all or r.employee_id = p_employee_id or p_employee_id in (select app.leads_of(r.employee_id)))
  )
  select 'job', j.day, j.title, j.start_text, v.id, v.name,
         nullif(concat_ws(', ', nullif(v.site_street, ''), nullif(v.site_city, ''), nullif(concat_ws(' ', nullif(v.site_state, ''), nullif(v.site_postal_code, '')), '')), ''),
         v.job_number
  from jobs j join visible v on v.id = j.project_id
  where j.day between p_from and p_to
  union all
  select 'holiday', h.date, h.name, null, null, null, null, null
  from public.holidays h
  where h.date between p_from and p_to
  union all
  select 'time_off', g.day::date, o.display_name || ': ' || o.leave_name,
         case when o.partial_hours is not null then trim(to_char(o.partial_hours, 'FM90.##')) || ' h' end,
         null, null, null, null
  from off o
  cross join lateral generate_series(greatest(o.start_date, p_from), least(o.end_date, p_to), interval '1 day') g(day)
  order by 2, 1, 6
$$;
