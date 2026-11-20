"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/dal";
import { dbErrorKey } from "@/lib/db/errors";
import { PROJECT_STATUSES } from "@/lib/db/types";
import { type FormState, decimalString, isEmail, positiveInt, str } from "@/lib/forms/form-state";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optionalId = (v: string | null) => (v && UUID_RE.test(v) ? v : null);

/** Validate the project form. Customer can be an existing id or a new name. */
function parseProject(fd: FormData) {
  const errors: Record<string, string> = {};
  const name = str(fd, "name");
  if (!name) errors.name = "validation.required";
  const sqft = decimalString(str(fd, "total_sqft"));
  if (sqft === "invalid") errors.total_sqft = "validation.number";
  const days = positiveInt(str(fd, "estimated_duration_days"));
  if (days === "invalid") errors.estimated_duration_days = "validation.positiveNumber";
  const status = str(fd, "status") ?? "draft";
  if (!PROJECT_STATUSES.includes(status as never)) errors.status = "validation.required";
  const start = str(fd, "scheduled_start");
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) errors.scheduled_start = "validation.required";

  return {
    errors,
    newCustomer: str(fd, "new_customer"),
    values: {
      name: name ?? "",
      job_number: str(fd, "job_number"),
      customer_id: optionalId(str(fd, "customer_id")),
      site_street: str(fd, "site_street"),
      site_city: str(fd, "site_city"),
      site_state: str(fd, "site_state"),
      site_postal_code: str(fd, "site_postal_code"),
      project_manager_id: optionalId(str(fd, "project_manager_id")),
      crew_lead_id: optionalId(str(fd, "crew_lead_id")),
      scheduled_start: start,
      estimated_duration_days: days === "invalid" ? null : days,
      scope_summary: str(fd, "scope_summary"),
      total_sqft: sqft === "invalid" ? null : sqft,
      flooring_system: str(fd, "flooring_system"),
      status,
    },
  };
}

async function resolveCustomer(newCustomer: string | null, customerId: string | null) {
  if (!newCustomer) return { id: customerId };
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").insert({ name: newCustomer }).select("id").single();
  return error ? { error } : { id: data.id as string };
}

function failure(error: { code?: string; message?: string }): FormState {
  const key = dbErrorKey(error, { unique: "projects.jobNumberTaken" });
  return key === "projects.jobNumberTaken"
    ? { status: "error", fieldErrors: { job_number: key } }
    : { status: "error", message: key };
}

export async function createProject(_prev: FormState, fd: FormData): Promise<FormState> {
  const profile = await requireRole("project_manager", "office_admin");
  const { errors, values, newCustomer } = parseProject(fd);
  if (Object.keys(errors).length) return { status: "error", fieldErrors: errors };
  const customer = await resolveCustomer(newCustomer, values.customer_id);
  if ("error" in customer && customer.error) return failure(customer.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({ ...values, customer_id: customer.id, created_by: profile.employeeId })
    .select("id")
    .single();
  if (error) return failure(error);
  revalidatePath("/manage/projects");
  redirect(`/manage/projects/${data.id}?created=1`);
}

export async function updateProject(projectId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await requireRole("project_manager", "office_admin");
  const { errors, values, newCustomer } = parseProject(fd);
  if (Object.keys(errors).length) return { status: "error", fieldErrors: errors };
  const customer = await resolveCustomer(newCustomer, values.customer_id);
  if ("error" in customer && customer.error) return failure(customer.error);

  const supabase = await createClient();
  const { error } = await supabase.from("projects").update({ ...values, customer_id: customer.id }).eq("id", projectId);
  if (error) return failure(error);
  revalidatePath(`/manage/projects/${projectId}`);
  revalidatePath("/manage/projects");
  return { status: "success", message: "common.saved" };
}

export async function addAssignment(projectId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await requireRole("project_manager", "office_admin");
  const employeeId = optionalId(str(fd, "employee_id"));
  if (!employeeId) return { status: "error", fieldErrors: { employee_id: "validation.required" } };
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_assignments")
    .insert({ project_id: projectId, employee_id: employeeId });
  if (error && error.code !== "23505") return { status: "error", message: "common.genericError" };
  revalidatePath(`/manage/projects/${projectId}`);
  return { status: "success" };
}

export async function removeAssignment(projectId: string, assignmentId: string) {
  await requireRole("project_manager", "office_admin");
  const supabase = await createClient();
  await supabase.from("project_assignments").delete().eq("id", assignmentId).eq("project_id", projectId);
  revalidatePath(`/manage/projects/${projectId}`);
}

export async function addContact(projectId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await requireRole("project_manager", "office_admin");
  const name = str(fd, "contact_name");
  const email = str(fd, "contact_email");
  const errors: Record<string, string> = {};
  if (!name) errors.contact_name = "validation.required";
  if (email && !isEmail(email)) errors.contact_email = "validation.email";
  if (Object.keys(errors).length) return { status: "error", fieldErrors: errors };
  const supabase = await createClient();
  const { error } = await supabase.from("project_contacts").insert({
    project_id: projectId,
    name,
    title: str(fd, "contact_title"),
    phone: str(fd, "contact_phone"),
    email,
  });
  if (error) return { status: "error", message: "common.genericError" };
  revalidatePath(`/manage/projects/${projectId}`);
  return { status: "success" };
}

export async function removeContact(projectId: string, contactId: string) {
  await requireRole("project_manager", "office_admin");
  const supabase = await createClient();
  await supabase.from("project_contacts").delete().eq("id", contactId).eq("project_id", projectId);
  revalidatePath(`/manage/projects/${projectId}`);
}
