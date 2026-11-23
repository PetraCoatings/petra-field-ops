import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/dal";
import type { EmployeeRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { makeSignUpLink, resendInvite, sendInvite, updateEmployee } from "../actions";
import { SignUpLink } from "../sign-up-link";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmployeeForm } from "../employee-form";
import { InviteButton } from "../invite-button";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employees");
  return { title: t("editTitle") };
}

export default async function EditEmployeePage({ params, searchParams }: PageProps<"/manage/employees/[id]">) {
  await requireRole("office_admin");
  const { id } = await params;
  const { created, invite } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("employees").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const employee = data as EmployeeRow;
  const t = await getTranslations();
  const format = await getFormatter();
  const account = employee.user_id ? await accountStatus(employee.user_id) : null;

  return (
    <div className="space-y-4">
      <PageHeader title={employee.display_name} backHref="/manage/employees" backLabel={t("employees.title")} />
      {created && <Alert tone="success">{t("employees.created")}</Alert>}
      {invite === "sent" && <Alert tone="success">{t("employees.inviteSent", { email: employee.email })}</Alert>}
      {invite === "failed" && (
        <Alert tone="warning">{t("employees.inviteRetry")}</Alert>
      )}
      <Card title={t("employees.editTitle")}>
        <EmployeeForm action={updateEmployee.bind(null, employee.id)} employee={employee} />
      </Card>
      <Card title={t("employees.account")}>
        {employee.user_id && account?.lastSignInAt ? (
          <p className="text-base">{t("employees.accountLinked")}</p>
        ) : employee.user_id ? (
          <div className="space-y-3">
            <p className="text-base text-neutral-700">
              {account?.invitedAt
                ? t("employees.invitedNotSignedIn", { when: format.dateTime(new Date(account.invitedAt), { dateStyle: "medium", timeStyle: "short" }) })
                : t("employees.notSignedIn")}
            </p>
            <InviteButton action={resendInvite.bind(null, employee.id)} label={t("employees.resendEmail")} />
            <SignUpLink action={makeSignUpLink.bind(null, employee.id)} name={employee.first_name} />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-base text-neutral-700">{t("employees.accountNotLinked")}</p>
            <InviteButton action={sendInvite.bind(null, employee.id)} />
            <SignUpLink action={makeSignUpLink.bind(null, employee.id)} name={employee.first_name} />
          </div>
        )}
      </Card>
    </div>
  );
}

/** Has this person ever signed in? (Read with the server-only secret key; office admins only reach this page.) */
async function accountStatus(userId: string): Promise<{ invitedAt: string | null; lastSignInAt: string | null } | null> {
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data } = await createAdminClient().auth.admin.getUserById(userId);
  return data.user ? { invitedAt: data.user.invited_at ?? null, lastSignInAt: data.user.last_sign_in_at ?? null } : null;
}
