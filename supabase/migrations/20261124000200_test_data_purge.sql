-- =============================================================================
-- Cleanup of automated test data
--
-- The browser tests run against the same Supabase project as the live site.
-- They publish work orders and upload data sheets, which are permanent by
-- design, so their test jobs and products could never be deleted and piled up
-- in the office's lists.
--
-- public.purge_e2e_test_data() deletes ONLY rows whose names start with "E2E"
-- (every test job and test product is named that way; nobody names a real job
-- "E2E…"), including their published revisions and data sheet versions.
--
-- Only the service role (the server-side secret key the test runner uses) can
-- call it. Signed-in users, including office admins, cannot. Real work orders
-- and data sheets keep their full protection. Every deleted row is still
-- written to the audit log.
-- =============================================================================

create function public.purge_e2e_test_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_projects uuid[];
  v_fwos uuid[];
  v_products uuid[];
  v_documents uuid[];
  v_jobs integer;
  v_products_deleted integer;
begin
  select coalesce(array_agg(id), '{}') into v_projects from public.projects where name like 'E2E%';
  select coalesce(array_agg(id), '{}') into v_fwos from public.field_work_orders where project_id = any (v_projects);

  -- Work orders on test jobs: acknowledgments, checklists, then the revisions.
  delete from public.fwo_acknowledgments
   where fwo_revision_id in (select id from public.fwo_revisions where fwo_id = any (v_fwos));
  delete from public.loading_checklists where fwo_id = any (v_fwos);
  update public.field_work_orders set current_revision_id = null, status = 'void' where id = any (v_fwos);
  alter table public.fwo_revisions disable trigger fwo_revisions_protect;
  delete from public.fwo_revisions where fwo_id = any (v_fwos);
  alter table public.fwo_revisions enable trigger fwo_revisions_protect;
  -- The jobs (their work orders, drafts, crews, contacts, saved calculations
  -- and notifications go with them).
  delete from public.projects where id = any (v_projects);
  get diagnostics v_jobs = row_count;

  -- Test products and standalone test SDS, with their data sheet versions.
  select coalesce(array_agg(id), '{}') into v_products from public.products where name like 'E2E%';
  select coalesce(array_agg(id), '{}') into v_documents from public.documents
   where product_id = any (v_products) or (product_id is null and name like 'E2E%');
  alter table public.document_versions disable trigger document_versions_protect;
  delete from public.document_versions where document_id = any (v_documents);
  alter table public.document_versions enable trigger document_versions_protect;
  delete from public.documents where id = any (v_documents);
  delete from public.products where id = any (v_products);
  get diagnostics v_products_deleted = row_count;

  -- Test templates.
  delete from public.work_order_templates where name like 'E2E%';

  return jsonb_build_object('jobs', v_jobs, 'products', v_products_deleted, 'documents', coalesce(array_length(v_documents, 1), 0));
end $$;

revoke all on function public.purge_e2e_test_data() from public, anon, authenticated;
grant execute on function public.purge_e2e_test_data() to service_role;
