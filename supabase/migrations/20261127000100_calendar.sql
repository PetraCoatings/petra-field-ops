-- =============================================================================
-- Phase 7 (part 1): calendar, holidays, calendar links
--
-- Calendar events come from data the app already has:
--   * job days: each dated day in a job's published work order schedule
--     ("Day 1", date, start time); a job whose work order has no dated days
--     falls back to its scheduled start + estimated duration;
--   * company holidays (new table, office admins manage).
-- Who sees what: crews see the jobs they're on (assigned, crew lead or project
-- manager); office staff see every job. Time off is added in part 2.
--
-- Calendar links: each person can make a private link that Apple Calendar,
-- Outlook or Google Calendar subscribe to (iCalendar). Only a SHA-256 hash of
-- the link's secret is stored; making a new link replaces the old one, which
-- stops working at once. Calendar apps fetch the link without signing in, so
-- the feed is read on the server with the secret key through
-- public.calendar_feed(), which is callable by the service role only.
-- =============================================================================

create table public.holidays (
  id          uuid primary key default gen_random_uuid(),
  date        date not null unique,
  name        text not null check (length(trim(name)) between 1 and 80),
  is_paid     boolean not null default true,
  created_at  timestamptz not null default now()
);
create trigger audit_holidays after insert or update or delete on public.holidays
  for each row execute function audit.capture();
alter table public.holidays enable row level security;
grant select, insert, update, delete on public.holidays to authenticated;
grant select, insert, update, delete on public.holidays to service_role;
create policy holidays_read on public.holidays for select to authenticated using (app.current_employee_id() is not null);
create policy holidays_write on public.holidays for all to authenticated using (app.is_office_admin()) with check (app.is_office_admin());

-- -----------------------------------------------------------------------------
-- Events
-- -----------------------------------------------------------------------------
-- kind: 'job' | 'holiday'. For jobs: the work order day title ("Day 1") and
-- its start time as typed ("5am"), the job's name and address.
create function app.calendar_events(p_employee_id uuid, p_all boolean, p_from date, p_to date)
returns table (kind text, day date, title text, start_text text, project_id uuid, project_name text, address text, job_number text)
language sql stable security definer set search_path = '' as $$
  with visible as (
    select p.* from public.projects p
    where p.status <> 'closed'
      and (p_all
           or p.crew_lead_id = p_employee_id
           or p.project_manager_id = p_employee_id
           or exists (select 1 from public.project_assignments pa where pa.project_id = p.id and pa.employee_id = p_employee_id))
      -- crews never see draft jobs
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
  jobs as (select * from dated union all select * from fallback)
  select 'job', j.day, j.title, j.start_text, v.id, v.name,
         nullif(concat_ws(', ', nullif(v.site_street, ''), nullif(v.site_city, ''), nullif(concat_ws(' ', nullif(v.site_state, ''), nullif(v.site_postal_code, '')), '')), ''),
         v.job_number
  from jobs j join visible v on v.id = j.project_id
  where j.day between p_from and p_to
  union all
  select 'holiday', h.date, h.name, null, null, null, null, null
  from public.holidays h
  where h.date between p_from and p_to
  order by 2, 1, 6
$$;
revoke all on function app.calendar_events(uuid, boolean, date, date) from public;

-- In the app: my calendar for a date range (office staff see every job).
create function public.my_calendar(p_from date, p_to date)
returns table (kind text, day date, title text, start_text text, project_id uuid, project_name text, address text, job_number text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.current_employee_id() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Choose a shorter date range' using errcode = '22023';
  end if;
  return query select * from app.calendar_events(app.current_employee_id(), app.is_office_staff(), p_from, p_to);
end $$;
revoke all on function public.my_calendar(date, date) from public, anon;
grant execute on function public.my_calendar(date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Calendar links
-- -----------------------------------------------------------------------------
create table public.calendar_feeds (
  employee_id  uuid primary key references public.employees (id) on delete cascade,
  token_hash   text not null unique,
  scope        text not null default 'mine' check (scope in ('mine', 'all')),
  created_at   timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;
grant select on public.calendar_feeds to authenticated;
grant select, insert, update, delete on public.calendar_feeds to service_role;
-- People see whether they have a link (never the secret, which isn't stored).
create policy calendar_feeds_read on public.calendar_feeds for select to authenticated
  using (employee_id = app.current_employee_id() or app.is_office_admin());

-- Make (or replace) my calendar link. Returns the secret once; only its hash is kept.
-- 'all' (every job) is only for office staff.
create function public.new_calendar_feed(p_scope text default 'mine') returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app.current_employee_id();
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_scope not in ('mine', 'all') or (p_scope = 'all' and not app.is_office_staff()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.calendar_feeds (employee_id, token_hash, scope)
  values (v_me, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_scope)
  on conflict (employee_id) do update set token_hash = excluded.token_hash, scope = excluded.scope, created_at = now();
  return v_token;
end $$;

-- Turn off a calendar link: my own, or (office admins) anyone's, e.g. a lost phone.
create function public.revoke_calendar_feed(p_employee_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_target uuid := coalesce(p_employee_id, app.current_employee_id());
begin
  if v_target is null or (v_target <> app.current_employee_id() and not app.is_office_admin()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  delete from public.calendar_feeds where employee_id = v_target;
end $$;

revoke all on function public.new_calendar_feed(text), public.revoke_calendar_feed(uuid) from public, anon;
grant execute on function public.new_calendar_feed(text), public.revoke_calendar_feed(uuid) to authenticated;

-- What a calendar app gets for a link: about 2 months back to 13 months ahead.
-- Service role only (called by the server with the secret key).
create function public.calendar_feed(p_token_hash text)
returns table (employee_name text, kind text, day date, title text, start_text text, project_id uuid, project_name text, address text, job_number text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp uuid;
  v_name text;
  v_all boolean;
  v_today date;
begin
  select f.employee_id, e.display_name, f.scope = 'all' and e.role in ('project_manager', 'office_admin')
    into v_emp, v_name, v_all
  from public.calendar_feeds f join public.employees e on e.id = f.employee_id and e.is_active
  where f.token_hash = p_token_hash;
  if v_emp is null then
    return;
  end if;
  select (now() at time zone s.company_timezone)::date into v_today from public.app_settings s;
  return query select v_name, c.* from app.calendar_events(v_emp, v_all, v_today - 60, v_today + 400) c;
end $$;
revoke all on function public.calendar_feed(text) from public, anon, authenticated;
grant execute on function public.calendar_feed(text) to service_role;
