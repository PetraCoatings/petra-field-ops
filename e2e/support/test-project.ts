/** A temporary project (dev Supabase only) for tests that need a job to work on. */
import { randomBytes } from "node:crypto";
import { api, type RoleUser } from "./role-users";

/** True once the "saved calculations" migration has been applied to the dev project. */
export async function savedCalculationsTableExists(): Promise<boolean> {
  const res = await api("/rest/v1/saved_calculations?select=id&limit=1");
  return res.ok;
}

/** Creates a scheduled project with `crew` assigned. Returns its id and name. */
export async function createTestProject(crew: RoleUser[]): Promise<{ id: string; name: string }> {
  const name = `E2E Job ${randomBytes(3).toString("hex")}`;
  const res = await api("/rest/v1/projects", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name, status: "scheduled" }),
  });
  if (!res.ok) throw new Error(`create project failed: ${res.status} ${await res.text()}`);
  const [{ id }] = (await res.json()) as { id: string }[];
  for (const u of crew) {
    const emp = await api(`/rest/v1/employees?select=id&email=eq.${encodeURIComponent(u.email)}`);
    const [{ id: employeeId }] = (await emp.json()) as { id: string }[];
    const a = await api("/rest/v1/project_assignments", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ project_id: id, employee_id: employeeId }),
    });
    if (!a.ok) throw new Error(`assign crew failed: ${a.status} ${await a.text()}`);
  }
  return { id, name };
}

/** True once the work orders migration has been applied to the dev project. */
export async function workOrdersTableExists(): Promise<boolean> {
  const res = await api("/rest/v1/field_work_orders?select=id&limit=1");
  return res.ok;
}

/** True once the templates migration has been applied to the dev project. */
export async function templatesTableExists(): Promise<boolean> {
  const res = await api("/rest/v1/work_order_templates?select=id&limit=1");
  return res.ok;
}

/** Removes templates created by a test run (names start with the given prefix). */
export async function deleteTestTemplates(prefix: string): Promise<void> {
  await api(`/rest/v1/work_order_templates?name=like.${encodeURIComponent(prefix)}*`, { method: "DELETE" });
}

/** Marks the project completed (its work orders then appear in "Past work orders"). */
export async function finishTestProject(id: string): Promise<void> {
  await api(`/rest/v1/projects?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) });
}

/** True once the library migration has been applied to the dev project. */
export async function libraryFunctionsExist(): Promise<boolean> {
  // Only signed-in employees may run it; any answer other than "not found" means it exists.
  const res = await api("/rest/v1/rpc/search_work_order_library", { method: "POST", body: JSON.stringify({ p_limit: 1 }) });
  return res.status !== 404;
}

/** True once the loading checklist migration has been applied to the dev project. */
export async function checklistsTableExists(): Promise<boolean> {
  const res = await api("/rest/v1/loading_checklists?select=id&limit=1");
  return res.ok;
}

/** Sets fields on a test project (e.g. its project manager). */
export async function updateTestProject(id: string, fields: Record<string, unknown>): Promise<void> {
  const res = await api(`/rest/v1/projects?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(fields) });
  if (!res.ok) throw new Error(`update project failed: ${res.status} ${await res.text()}`);
}

export async function employeeId(u: RoleUser): Promise<string> {
  const res = await api(`/rest/v1/employees?select=id&email=eq.${encodeURIComponent(u.email)}`);
  return ((await res.json()) as { id: string }[])[0].id;
}

/**
 * Publishes a work order (or a new revision of it) as a project manager, the
 * way the app does: signs in through Supabase Auth and calls the same table
 * and function, so Row Level Security applies.
 */
export async function publishAsOffice(
  pm: RoleUser,
  projectId: string,
  content: object,
  opts: { fwoId?: string; changeSummary?: string } = {},
): Promise<string> {
  const url = process.env.E2E_SUPABASE_URL!;
  const key = process.env.E2E_SUPABASE_KEY!;
  const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: pm.email, password: pm.password }),
  });
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const as = (path: string, init: RequestInit = {}) =>
    fetch(`${url}${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json", ...init.headers } });
  let fwoId = opts.fwoId;
  if (!fwoId) {
    const r = await as("/rest/v1/field_work_orders", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ project_id: projectId, title: "Work order" }) });
    if (!r.ok) throw new Error(`create work order failed: ${r.status} ${await r.text()}`);
    fwoId = ((await r.json()) as { id: string }[])[0].id;
    await as("/rest/v1/fwo_drafts", { method: "POST", body: JSON.stringify({ fwo_id: fwoId, content }) });
  } else {
    await as(`/rest/v1/fwo_drafts?fwo_id=eq.${fwoId}`, { method: "PATCH", body: JSON.stringify({ content }) });
  }
  const p = await as("/rest/v1/rpc/publish_fwo", { method: "POST", body: JSON.stringify({ p_fwo_id: fwoId, p_change_summary: opts.changeSummary ?? null }) });
  if (!p.ok) throw new Error(`publish failed: ${p.status} ${await p.text()}`);
  return fwoId;
}

/** True once the product library migration has been applied to the dev project. */
export async function productLibraryExists(): Promise<boolean> {
  const res = await api("/rest/v1/products?select=id&limit=1");
  return res.ok;
}

/**
 * Hides library test data (names starting with the prefix). Uploaded data
 * sheet versions are permanent by design, so test products and documents are
 * archived rather than deleted.
 */
export async function archiveTestLibrary(prefix: string): Promise<void> {
  const like = encodeURIComponent(`${prefix}*`);
  await api(`/rest/v1/products?name=like.${like}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) });
  await api(`/rest/v1/documents?name=like.${like}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) });
}

/** Signs in through Supabase Auth and returns a fetch that acts as that person (RLS applies). */
export async function sessionFetch(u: RoleUser): Promise<(path: string, init?: RequestInit) => Promise<Response>> {
  const url = process.env.E2E_SUPABASE_URL!;
  const key = process.env.E2E_SUPABASE_KEY!;
  const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: u.email, password: u.password }),
  });
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  return (path, init = {}) =>
    fetch(`${url}${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json", ...init.headers } });
}

/**
 * Adds a product (approved or draft) with optional TDS/SDS, or a standalone SDS,
 * as an office admin, uploading real PDF files. Returns the document version ids.
 */
export async function addLibraryItem(
  admin: RoleUser,
  item:
    | { kind: "product"; name: string; approved: boolean; specs?: Record<string, unknown>; tds?: Buffer; sds?: Buffer }
    | { kind: "sds"; name: string; pdf: Buffer },
): Promise<{ productId?: string; tds?: string; sds?: string }> {
  const as = await sessionFetch(admin);
  const json = async (r: Response) => {
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  };
  const upload = async (documentId: string, pdf: Buffer, name: string) => {
    const path = `${documentId}/${randomBytes(6).toString("hex")}-${name}.pdf`;
    const up = await as(`/storage/v1/object/product-docs/${path}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: new Uint8Array(pdf) });
    if (!up.ok) throw new Error(`upload failed: ${up.status} ${await up.text()}`);
    const [v] = (await json(
      await as("/rest/v1/document_versions", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ document_id: documentId, storage_path: path, file_name: `${name}.pdf`, file_size: pdf.length }),
      }),
    )) as { id: string }[];
    return v.id;
  };
  const newDoc = async (body: object) =>
    ((await json(await as("/rest/v1/documents", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) }))) as { id: string }[])[0].id;

  if (item.kind === "sds") {
    const docId = await newDoc({ doc_type: "sds", name: item.name });
    return { sds: await upload(docId, item.pdf, "sds") };
  }
  const [prod] = (await json(
    await as("/rest/v1/products", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ name: item.name, spec_status: item.approved ? "approved" : "draft", ...item.specs }),
    }),
  )) as { id: string }[];
  const out: { productId?: string; tds?: string; sds?: string } = { productId: prod.id };
  if (item.tds) out.tds = await upload(await newDoc({ doc_type: "tds", product_id: prod.id }), item.tds, "tds");
  if (item.sds) out.sds = await upload(await newDoc({ doc_type: "sds", product_id: prod.id }), item.sds, "sds");
  return out;
}

/** Adds a site contact to the project. */
/** Uploads a newer version of the same data sheet (identified by any existing version id). Returns the new version id. */
export async function addDocumentVersion(admin: RoleUser, existingVersionId: string, pdf: Buffer): Promise<string> {
  const as = await sessionFetch(admin);
  const r = await as(`/rest/v1/document_versions?select=document_id&id=eq.${existingVersionId}`);
  const [{ document_id }] = (await r.json()) as { document_id: string }[];
  const path = `${document_id}/${randomBytes(6).toString("hex")}-new.pdf`;
  const up = await as(`/storage/v1/object/product-docs/${path}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: new Uint8Array(pdf) });
  if (!up.ok) throw new Error(`upload failed: ${up.status} ${await up.text()}`);
  const v = await as("/rest/v1/document_versions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ document_id, storage_path: path, file_name: "new.pdf", file_size: pdf.length }),
  });
  if (!v.ok) throw new Error(`new version failed: ${v.status} ${await v.text()}`);
  return ((await v.json()) as { id: string }[])[0].id;
}

export async function addTestContact(projectId: string, contact: { name: string; title?: string; phone?: string }): Promise<void> {
  const res = await api("/rest/v1/project_contacts", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ project_id: projectId, is_primary: true, ...contact }),
  });
  if (!res.ok) throw new Error(`add contact failed: ${res.status} ${await res.text()}`);
}

/**
 * Deletes the project (its assignments and saved calculations go with it).
 * A project with a published work order can't be deleted (published revisions
 * are permanent), so those are closed and marked as test data instead.
 */
export async function deleteTestProject(id: string): Promise<void> {
  const res = await api(`/rest/v1/projects?id=eq.${id}`, { method: "DELETE" });
  if (!res.ok) {
    await api(`/rest/v1/projects?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "closed", scope_summary: "Automated test data (published work order kept permanently)." }),
    });
  }
}
