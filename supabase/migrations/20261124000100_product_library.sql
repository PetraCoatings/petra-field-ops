-- =============================================================================
-- Phase 4a — Product and SDS library
--
--   manufacturers       Sika, Stonhard, …
--   products            one per product, with OPTIONAL spec fields (a blank
--                       field means "not specified", never a guess) and an
--                       approval state. Crews see approved products only.
--   documents           a data sheet "slot": the TDS or SDS of a product, or
--                       a standalone SDS (acetone, cleaners…) with its own name
--   document_versions   APPEND-ONLY. Every upload is a new version; nothing is
--                       ever replaced or deleted, so a work order can point at
--                       the exact version it was built with (Phase 4c).
--   storage bucket      product-docs (PDFs): office uploads, every active
--                       employee can read.
--
-- Who may do what (docs/ARCHITECTURE_PLAN.md §4):
--   view     every active employee: approved products, and ALL documents
--            (SDS must be reachable with no job assignment)
--   manage   project managers and office admins: add/edit products, upload
--   approve  office admins only. When a project manager changes a spec field
--            the product goes back to "draft" for an admin to re-approve.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Fix (Phase 3): deleting an employee who published a work order failed,
-- because clearing "published by" counted as changing the revision. Allow
-- exactly that one change; the content and project snapshot stay identical
-- and the audit log still records who published it.
-- -----------------------------------------------------------------------------
create or replace function app.protect_fwo_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Published work order revisions cannot be deleted.';
  end if;
  if (to_jsonb(new) - array['pdf_storage_path', 'published_by']) is distinct from (to_jsonb(old) - array['pdf_storage_path', 'published_by'])
     or (old.pdf_storage_path is not null and new.pdf_storage_path is distinct from old.pdf_storage_path)
     or (new.published_by is distinct from old.published_by and new.published_by is not null) then
    raise exception 'Published work order revisions cannot be changed.';
  end if;
  return new;
end $$;

create type public.spec_status as enum ('draft', 'approved');
create type public.doc_type as enum ('tds', 'sds');
create type public.ratio_basis as enum ('volume', 'weight');

create table public.manufacturers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 120),
  created_at  timestamptz not null default now()
);
create unique index manufacturers_name_idx on public.manufacturers (lower(trim(name)));

create table public.products (
  id                                  uuid primary key default gen_random_uuid(),
  name                                text not null check (length(trim(name)) between 1 and 160),
  manufacturer_id                     uuid references public.manufacturers (id) on delete restrict,
  category                            text check (category is null or category in
                                        ('primer', 'basecoat', 'topcoat', 'mortar', 'self_leveler', 'sealer', 'grout', 'cleaner', 'aggregate', 'additive', 'other')),
  product_code                        text check (product_code is null or length(product_code) <= 80),
  description                         text check (description is null or length(description) <= 2000),
  -- Spec fields: all optional.
  mix_ratio_a                         numeric(10, 4) check (mix_ratio_a is null or mix_ratio_a > 0),
  mix_ratio_b                         numeric(10, 4) check (mix_ratio_b is null or mix_ratio_b > 0),
  mix_ratio_text                      text check (mix_ratio_text is null or length(mix_ratio_text) <= 120),
  ratio_basis                         public.ratio_basis,
  kit_size_gal                        numeric(10, 3) check (kit_size_gal is null or kit_size_gal > 0),
  recommended_coverage_sqft_per_gal   numeric(10, 2) check (recommended_coverage_sqft_per_gal is null or recommended_coverage_sqft_per_gal > 0),
  volume_solids_pct                   numeric(5, 2) check (volume_solids_pct is null or (volume_solids_pct > 0 and volume_solids_pct <= 100)),
  recommended_wft_mils                numeric(8, 2) check (recommended_wft_mils is null or recommended_wft_mils > 0),
  recommended_dft_mils                numeric(8, 2) check (recommended_dft_mils is null or recommended_dft_mils > 0),
  min_application_temp_f              numeric(5, 1),
  max_application_temp_f              numeric(5, 1),
  max_rh_pct                          numeric(5, 2) check (max_rh_pct is null or (max_rh_pct > 0 and max_rh_pct <= 100)),
  min_substrate_above_dew_point_f     numeric(5, 1) check (min_substrate_above_dew_point_f is null or min_substrate_above_dew_point_f >= 0),
  pot_life_minutes                    integer check (pot_life_minutes is null or pot_life_minutes > 0),
  cure_notes                          text check (cure_notes is null or length(cure_notes) <= 2000),
  spec_status                         public.spec_status not null default 'draft',
  approved_by                         uuid references public.employees (id) on delete set null,
  approved_at                         timestamptz,
  is_active                           boolean not null default true,
  created_by                          uuid default app.current_employee_id() references public.employees (id) on delete set null,
  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now(),
  check (min_application_temp_f is null or max_application_temp_f is null or min_application_temp_f <= max_application_temp_f),
  check ((mix_ratio_a is null) = (mix_ratio_b is null))
);
create unique index products_name_idx on public.products (coalesce(manufacturer_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(trim(name)));
create trigger products_touch before update on public.products
  for each row execute function app.touch_updated_at();

-- Approval rules, enforced in the database:
--   * only office admins can mark a product approved
--   * a spec change by anyone other than an office admin sends it back to draft
create function app.guard_product_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := app.has_role('office_admin');
  v_spec_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.spec_status = 'approved' and not v_admin then
      raise exception 'Only an office administrator can approve product specs.' using errcode = '42501';
    end if;
  else
    v_spec_changed :=
      (to_jsonb(new) - array['spec_status','approved_by','approved_at','is_active','updated_at','description','product_code','category','name','manufacturer_id'])
      is distinct from
      (to_jsonb(old) - array['spec_status','approved_by','approved_at','is_active','updated_at','description','product_code','category','name','manufacturer_id']);
    if new.spec_status = 'approved' and old.spec_status <> 'approved' and not v_admin then
      raise exception 'Only an office administrator can approve product specs.' using errcode = '42501';
    end if;
    if v_spec_changed and not v_admin then
      new.spec_status := 'draft';
    end if;
  end if;
  if new.spec_status = 'approved' and (tg_op = 'INSERT' or old.spec_status <> 'approved' or v_spec_changed) then
    new.approved_by := app.current_employee_id();
    new.approved_at := now();
  elsif new.spec_status = 'draft' then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end $$;
create trigger products_guard_approval before insert or update on public.products
  for each row execute function app.guard_product_approval();

create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  doc_type         public.doc_type not null,
  product_id       uuid references public.products (id) on delete restrict,
  name             text check (name is null or length(trim(name)) between 1 and 160),
  manufacturer_id  uuid references public.manufacturers (id) on delete restrict,
  is_active        boolean not null default true,
  created_by       uuid default app.current_employee_id() references public.employees (id) on delete set null,
  created_at       timestamptz not null default now(),
  -- A product's TDS/SDS, or a standalone SDS that has its own name.
  check (product_id is not null or (doc_type = 'sds' and name is not null))
);
create unique index documents_product_type_idx on public.documents (product_id, doc_type) where product_id is not null;

create table public.document_versions (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references public.documents (id) on delete restrict,
  version        integer not null check (version > 0),
  storage_path   text not null check (length(storage_path) between 1 and 400),
  file_name      text not null check (length(file_name) between 1 and 200),
  file_size      integer not null check (file_size > 0 and file_size <= 31457280),
  file_sha256    text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  revision_date  date,
  uploaded_by    uuid default app.current_employee_id() references public.employees (id) on delete set null,
  uploaded_at    timestamptz not null default now(),
  unique (document_id, version)
);

-- Number versions 1, 2, 3… per document.
create function app.assign_document_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('document_version:' || new.document_id::text));
  select coalesce(max(version), 0) + 1 into new.version from public.document_versions where document_id = new.document_id;
  return new;
end $$;
alter table public.document_versions alter column version drop not null;
create trigger document_versions_number before insert on public.document_versions
  for each row execute function app.assign_document_version();
alter table public.document_versions add constraint document_versions_version_set check (version is not null);

-- Versions are permanent, even for the service role. One exception: when an
-- employee record is deleted, "uploaded by" may be cleared (the foreign key's
-- ON DELETE SET NULL); the audit log still records who uploaded it.
create function app.protect_document_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.uploaded_by is null
     and (to_jsonb(new) - 'uploaded_by') = (to_jsonb(old) - 'uploaded_by') then
    return new;
  end if;
  raise exception 'Uploaded data sheet versions cannot be changed or deleted.';
end $$;
create trigger document_versions_protect before update or delete on public.document_versions
  for each row execute function app.protect_document_version();

-- Current version = the newest one.
create view public.current_document_versions with (security_invoker = true) as
  select distinct on (document_id) * from public.document_versions order by document_id, version desc;

create trigger audit_products after insert or update or delete on public.products
  for each row execute function audit.capture();
create trigger audit_documents after insert or update or delete on public.documents
  for each row execute function audit.capture();
create trigger audit_document_versions after insert or update or delete on public.document_versions
  for each row execute function audit.capture();

revoke all on function app.guard_product_approval(), app.assign_document_version(), app.protect_document_version() from public;

-- -----------------------------------------------------------------------------
-- Privileges and Row Level Security
-- -----------------------------------------------------------------------------
grant select, insert on public.manufacturers to authenticated;
grant select, insert, update on public.products, public.documents to authenticated;
grant select, insert on public.document_versions to authenticated;
grant select on public.current_document_versions to authenticated;
grant select, insert, update, delete on public.manufacturers, public.products, public.documents to service_role;
grant select, insert on public.document_versions to service_role;
grant select on public.current_document_versions to service_role;

alter table public.manufacturers     enable row level security;
alter table public.products          enable row level security;
alter table public.documents         enable row level security;
alter table public.document_versions enable row level security;

create policy manufacturers_select on public.manufacturers for select to authenticated
  using (app.current_employee_id() is not null);
create policy manufacturers_insert on public.manufacturers for insert to authenticated
  with check (app.is_office_staff());

-- Crews see approved, active products; the office sees everything.
create policy products_select on public.products for select to authenticated
  using (app.is_office_staff() or (app.current_employee_id() is not null and spec_status = 'approved' and is_active));
create policy products_insert on public.products for insert to authenticated
  with check (app.is_office_staff());
create policy products_update on public.products for update to authenticated
  using (app.is_office_staff()) with check (app.is_office_staff());

-- Every active employee sees every active document (SDS with no job assignment).
create policy documents_select on public.documents for select to authenticated
  using (app.is_office_staff() or (app.current_employee_id() is not null and is_active));
create policy documents_insert on public.documents for insert to authenticated
  with check (app.is_office_staff());
create policy documents_update on public.documents for update to authenticated
  using (app.is_office_staff()) with check (app.is_office_staff());

create policy document_versions_select on public.document_versions for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));  -- follows documents' rules
create policy document_versions_insert on public.document_versions for insert to authenticated
  with check (app.is_office_staff());

-- Data sheet files. Skipped where Supabase Storage isn't installed (local tests).
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('product-docs', 'product-docs', false, 31457280, array['application/pdf'])
  on conflict (id) do nothing;
  create policy product_docs_select on storage.objects for select to authenticated
    using (bucket_id = 'product-docs' and app.current_employee_id() is not null);
  create policy product_docs_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'product-docs' and app.is_office_staff());
end $$;
