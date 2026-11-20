"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/dal";
import { isAppRole } from "@/lib/auth/roles";
import { dbErrorKey } from "@/lib/db/errors";
import { type FormState, bool, isEmail, str } from "@/lib/forms/form-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type EmployeeInput = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  role: string;
  flsa_status: "nonexempt" | "exempt";
  preferred_locale: "en" | "es";
  hire_date: string | null;
};

function parseEmployee(fd: FormData): { input?: EmployeeInput; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};
  const first = str(fd, "first_name");
  const last = str(fd, "last_name");
  const email = str(fd, "email");
  const role = str(fd, "role");
  const flsa = str(fd, "flsa_status");
  const locale = str(fd, "preferred_locale");
  const hire = str(fd, "hire_date");
  if (!first) errors.first_name = "validation.required";
  if (!last) errors.last_name = "validation.required";
  if (!isEmail(email)) errors.email = "validation.email";
  if (!isAppRole(role)) errors.role = "validation.required";
  if (flsa !== "nonexempt" && flsa !== "exempt") errors.flsa_status = "validation.required";
  if (hire && !/^\d{4}-\d{2}-\d{2}$/.test(hire)) errors.hire_date = "validation.required";
  if (Object.keys(errors).length) return { errors };
  return {
    input: {
      first_name: first!,
      last_name: last!,
      email: email!.toLowerCase(),
      phone: str(fd, "phone"),
      role: role!,
      flsa_status: flsa as "nonexempt" | "exempt",
      preferred_locale: locale === "es" ? "es" : "en",
      hire_date: hire,
    },
  };
}

async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}

/**
 * Send a Supabase invitation email and link the new auth account to the
 * employee. Uses the secret key ONLY for the invite call itself; the caller
 * has already been verified as an office admin.
 */
async function invite(employeeId: string): Promise<FormState> {
  const supabase = await createClient();
  const { data: emp } = await supabase
    .from("employees")
    .select("id, email, user_id")
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp) return { status: "error", message: "common.genericError" };
  if (emp.user_id) return { status: "success", message: "employees.accountLinked" };

  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { status: "error", message: "employees.inviteNotConfigured" };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(emp.email, {
    redirectTo: `${await siteOrigin()}/auth/accept?next=/set-password`,
  });
  if (error || !data.user) {
    return {
      status: "error",
      message: "employees.inviteFailed",
      messageValues: { reason: error?.message ?? "unknown" },
    };
  }
  // Link through the admin's own session so RLS still governs the write.
  const { error: linkError } = await supabase.from("employees").update({ user_id: data.user.id }).eq("id", emp.id);
  if (linkError) return { status: "error", message: "common.genericError" };
  return { status: "success", message: "employees.inviteSent", messageValues: { email: emp.email } };
}

export async function createEmployee(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireRole("office_admin");
  const { input, errors } = parseEmployee(fd);
  if (!input) return { status: "error", fieldErrors: errors };

  const supabase = await createClient();
  const { data, error } = await supabase.from("employees").insert(input).select("id").single();
  if (error) {
    const key = dbErrorKey(error, { unique: "employees.emailTaken" });
    return key === "employees.emailTaken"
      ? { status: "error", fieldErrors: { email: key } }
      : { status: "error", message: key };
  }
  revalidatePath("/manage/employees");
  let inviteResult = "";
  if (bool(fd, "send_invite")) {
    const r = await invite(data.id);
    inviteResult = r.status === "success" ? "sent" : "failed";
  }
  redirect(`/manage/employees/${data.id}?created=1${inviteResult ? `&invite=${inviteResult}` : ""}`);
}

export async function updateEmployee(employeeId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await requireRole("office_admin");
  const { input, errors } = parseEmployee(fd);
  if (!input) return { status: "error", fieldErrors: errors };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("employees")
    .select("user_id, email")
    .eq("id", employeeId)
    .maybeSingle();
  if (!current) return { status: "error", message: "common.genericError" };
  // The sign-in email of an existing account can't be changed from here.
  const email = current.user_id ? current.email : input.email;

  const { error } = await supabase
    .from("employees")
    .update({ ...input, email, is_active: bool(fd, "is_active") })
    .eq("id", employeeId);
  if (error) {
    const key = dbErrorKey(error, { unique: "employees.emailTaken", lastAdmin: "employees.lastAdmin" });
    return key === "employees.emailTaken"
      ? { status: "error", fieldErrors: { email: key } }
      : { status: "error", message: key };
  }
  revalidatePath("/manage/employees");
  revalidatePath(`/manage/employees/${employeeId}`);
  return { status: "success", message: "common.saved" };
}

export async function sendInvite(employeeId: string, _prev: FormState): Promise<FormState> {
  await requireRole("office_admin");
  const r = await invite(employeeId);
  revalidatePath(`/manage/employees/${employeeId}`);
  return r;
}
