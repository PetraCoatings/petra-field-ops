-- Newer Supabase projects no longer grant table privileges to `service_role`
-- by default. The server-only secret key already bypasses Row Level Security;
-- these grants restore the access it needs for admin scripts and the signed-in
-- browser tests (e2e/support/role-users.ts). `anon` still gets nothing.
grant select, insert, update, delete on all tables in schema public to service_role;
grant select, insert on audit.log to service_role;
