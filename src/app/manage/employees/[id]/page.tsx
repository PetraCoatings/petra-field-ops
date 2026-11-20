import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/dal";
import type { EmployeeRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { sendInvite, updateEmployee } from "../actions";
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
        {employee.user_id ? (
          <p className="text-base">{t("employees.accountLinked")}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-base text-neutral-700">{t("employees.accountNotLinked")}</p>
            <InviteButton action={sendInvite.bind(null, employee.id)} />
          </div>
        )}
      </Card>
    </div>
  );
}
