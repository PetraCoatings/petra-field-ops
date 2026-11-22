-- =============================================================================
-- Phase 3c — Work order library ("Past work orders" in Job Center)
--
-- Crews learn from past jobs the way they used to with the Dropbox folder:
--   * Any active employee can look up the published work order of a FINISHED
--     job (project status completed or closed), plus their own current jobs.
--     Office staff can look up every published work order.
--   * On jobs the person wasn't on, site contacts (names and phone numbers)
--     are removed. Everything useful for the work stays: materials, mix
--     ratios, steps, drawings.
--
-- Crews read the library only through the two functions below. The tables
-- themselves keep their stricter rules (assigned jobs only), so contacts can't
-- be read around these functions.
--
-- Each work order is dated by the first scheduled day in its current revision,
-- else the job's scheduled start, else the day it was published, so the list
-- can be scrolled by date like the old folder.
-- =============================================================================

create function app.can_view_library_fwo(p_fwo_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.field_work_orders f
    join public.projects p on p.id = f.project_id
    where f.id = p_fwo_id
      and f.status = 'published'
      and app.current_employee_id() is not null
      and (app.is_office_staff() or app.is_assigned_to_project(p.id) or p.status in ('completed', 'closed'))
  )
$$;
revoke all on function app.can_view_library_fwo(uuid) from public;
grant execute on function app.can_view_library_fwo(uuid) to authenticated, service_role;

-- The date a work order is filed under.
create function app.work_order_date(p_content jsonb, p_scheduled_start date, p_published_at timestamptz) returns date
language sql immutable set search_path = '' as $$
  select coalesce(
    (select min((d ->> 'date')::date)
       from jsonb_array_elements(case when jsonb_typeof(p_content -> 'schedule') = 'array' then p_content -> 'schedule' else '[]'::jsonb end) d
      where d ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$'),
    p_scheduled_start,
    (p_published_at at time zone 'America/Chicago')::date)
$$;

-- Escape % _ \ so a search for "100%" means the text "100%".
create function app.like_escape(p text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_')
$$;
revoke all on function app.work_order_date(jsonb, date, timestamptz), app.like_escape(text) from public;
grant execute on function app.work_order_date(jsonb, date, timestamptz), app.like_escape(text) to authenticated, service_role;

-- Search the library. Every word must appear somewhere in the work order
-- (job name, customer, city, title, or any section text). Newest first.
create function public.search_work_order_library(
  p_query text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 300
)
returns table (
  fwo_id uuid,
  project_id uuid,
  fwo_number integer,
  title text,
  revision_number integer,
  job_date date,
  project_name text,
  customer text,
  city text,
  state text,
  system_install text,
  total_sqft text,
  project_status public.project_status,
  on_this_job boolean
)
language sql stable security definer set search_path = '' as $$
  with visible as (
    select f.id as fwo_id, f.project_id, f.fwo_number, f.title, r.revision_number, r.content,
           r.project_snapshot as snap, p.status,
           app.work_order_date(r.content, p.scheduled_start, r.published_at) as job_date,
           app.is_assigned_to_project(p.id) as on_job
    from public.field_work_orders f
    join public.fwo_revisions r on r.id = f.current_revision_id
    join public.projects p on p.id = f.project_id
    where f.status = 'published'
      and app.current_employee_id() is not null
      and (app.is_office_staff() or app.is_assigned_to_project(p.id) or p.status in ('completed', 'closed'))
  ),
  searchable as (
    select v.*,
           concat_ws(' ', v.snap ->> 'name', v.snap ->> 'customer', v.snap ->> 'city', v.title,
                     (v.content - 'attachments')::text) as haystack
    from visible v
  )
  select s.fwo_id, s.project_id, s.fwo_number, s.title, s.revision_number, s.job_date,
         s.snap ->> 'name', s.snap ->> 'customer', s.snap ->> 'city', s.snap ->> 'state',
         (select x ->> 'value'
            from jsonb_array_elements(case when jsonb_typeof(s.content -> 'summary') = 'array' then s.content -> 'summary' else '[]'::jsonb end) x
           where lower(x ->> 'label') like '%system%' and coalesce(trim(x ->> 'value'), '') <> ''
           limit 1),
         s.snap ->> 'totalSqft', s.status, s.on_job
  from searchable s
  where (p_from is null or s.job_date >= p_from)
    and (p_to is null or s.job_date <= p_to)
    and not exists (
      select 1 from regexp_split_to_table(trim(coalesce(p_query, '')), '\s+') w
      where w <> '' and s.haystack not ilike '%' || app.like_escape(w) || '%'
    )
  order by s.job_date desc, s.snap ->> 'name', s.fwo_number
  limit least(greatest(coalesce(p_limit, 300), 1), 1000)
$$;
revoke all on function public.search_work_order_library(text, date, date, integer) from public;
grant execute on function public.search_work_order_library(text, date, date, integer) to authenticated;

-- One work order from the library (current revision unless one is asked for).
-- Site contacts are removed unless the caller is office staff or on the job.
create function public.get_library_work_order(p_fwo_id uuid, p_revision integer default null)
returns table (
  fwo_id uuid,
  project_id uuid,
  fwo_number integer,
  title text,
  revision_number integer,
  current_revision_number integer,
  content jsonb,
  project_snapshot jsonb,
  change_summary text,
  published_at timestamptz,
  on_this_job boolean
)
language sql stable security definer set search_path = '' as $$
  select f.id, f.project_id, f.fwo_number, f.title, r.revision_number, cur.revision_number, r.content,
         case when app.is_office_staff() or app.is_assigned_to_project(f.project_id)
              then r.project_snapshot
              else jsonb_set(r.project_snapshot, '{contacts}', '[]'::jsonb) end,
         r.change_summary, r.published_at, app.is_assigned_to_project(f.project_id)
  from public.field_work_orders f
  join public.fwo_revisions cur on cur.id = f.current_revision_id
  join public.fwo_revisions r on r.fwo_id = f.id
       and r.revision_number = coalesce(p_revision, cur.revision_number)
  where f.id = p_fwo_id and app.can_view_library_fwo(f.id)
$$;
revoke all on function public.get_library_work_order(uuid, integer) from public;
grant execute on function public.get_library_work_order(uuid, integer) to authenticated;

-- Drawings on finished jobs are part of the library too.
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  drop policy if exists fwo_files_select on storage.objects;
  create policy fwo_files_select on storage.objects for select to authenticated
    using (bucket_id = 'fwo-files'
           and (app.can_view_published_fwo(app.uuid_or_null((storage.foldername(name))[2]))
                or app.can_view_library_fwo(app.uuid_or_null((storage.foldername(name))[2]))));
end $$;
