import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/dal";
import { createEmployee } from "../actions";
import { EmployeeForm } from "../employee-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employees");
  return { title: t("newTitle") };
}

export default async function NewEmployeePage() {
  await requireRole("office_admin");
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t("employees.newTitle")} backHref="/manage/employees" backLabel={t("employees.title")} />
      <Card>
        <EmployeeForm action={createEmployee} />
      </Card>
    </>
  );
}
