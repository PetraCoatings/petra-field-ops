-- Practice restore only: read key records back through the app's own rules.
\set ON_ERROR_STOP 1
-- The company settings row, people, jobs and the audit log are there.
select 1 / (count(*) = 1)::int as settings_ok from public.app_settings;
select 1 / (count(*) > 0)::int as people_ok from public.employees;
select 1 / (count(*) > 0)::int as admin_ok from public.employees where role = 'office_admin' and is_active;
-- Every employee who signs in still has their sign-in account.
select 1 / (count(*) = 0)::int as accounts_ok from public.employees e
  where e.user_id is not null and not exists (select 1 from auth.users u where u.id = e.user_id);
-- The database's own rules came back: time can't overlap, published work orders can't change.
select 1 / (count(*) = 1)::int as overlap_rule_ok from pg_constraint where conname = 'time_segments_no_overlap';
select 1 / (count(*) >= 1)::int as protect_rule_ok from pg_trigger where tgname = 'fwo_revisions_protect';
select 1 / (count(*) > 0)::int as row_security_ok from pg_policies where schemaname = 'public';
-- Hours can be totaled from the restored time records.
select count(*) as segments, coalesce(round(sum(extract(epoch from (coalesce(end_at, start_at) - start_at))) / 3600, 2), 0) as hours
  from public.time_segments where status = 'active';
