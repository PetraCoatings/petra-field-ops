-- =============================================================================
-- Phase 9: two-step sign-in required for office admins
-- (docs/ARCHITECTURE_PLAN.md §8: "MFA required for office admins")
--
-- An office admin's powers (pay rates, payroll, approving time, managing
-- people…) now need a session that passed two-step sign-in: password plus a
-- 6-digit code from an authenticator app. Supabase marks such a session
-- "aal2" in its sign-in token.
--
-- Until then — right after typing the password, or before setting up the
-- authenticator — the database treats the admin like an installer: they can
-- use the field side for themselves, but nothing office-wide. So a stolen
-- password alone can't reach pay or admin tools. The app sends the admin
-- straight to the two-step page.
--
-- Every role check in the database goes through app.current_app_role(), so
-- this one change covers all of them.
-- =============================================================================

-- The assurance level of the current request's sign-in token ("aal1" or "aal2").
create function app.session_aal() returns text
language sql stable set search_path = '' as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal'
$$;
revoke all on function app.session_aal() from public;
grant execute on function app.session_aal() to authenticated, service_role;

create or replace function app.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select case
           when e.role = 'office_admin' and app.session_aal() is distinct from 'aal2' then 'installer'::public.app_role
           else e.role
         end
  from public.employees e
  where e.user_id = auth.uid() and e.is_active
$$;
