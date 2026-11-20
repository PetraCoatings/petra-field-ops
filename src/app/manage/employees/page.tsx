import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/dal";
import type { EmployeeRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employees");
  return { title: t("title") };
}

export default async function EmployeesPage() {
  await requireRole("office_admin");
  const t = await getTranslations();
  const supabase = await createClient();
  const { data } = await supabase
    .from("employees")
    .select("*")
    .order("is_active", { ascending: false })
    .order("last_name")
    .order("first_name");
  const employees = (data ?? []) as EmployeeRow[];

  return (
    <>
      <PageHeader
        title={t("employees.title")}
        actions={
          <LinkButton href="/manage/employees/new">
            <UserPlus aria-hidden className="size-5" />
            {t("employees.add")}
          </LinkButton>
        }
      />
      {employees.length === 0 ? (
        <p className="text-neutral-700">{t("employees.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-base">
            <thead className="bg-neutral-50 text-sm text-neutral-700">
              <tr>
                <th className="px-4 py-3">{t("employees.lastName")}, {t("employees.firstName")}</th>
                <th className="px-4 py-3">{t("employees.role")}</th>
                <th className="px-4 py-3">{t("employees.flsaStatus")}</th>
                <th className="px-4 py-3">{t("employees.account")}</th>
                <th className="px-4 py-3">{t("employees.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {employees.map((e) => (
                <tr key={e.id} className={e.is_active ? "" : "text-neutral-500"}>
                  <td className="px-4 py-3">
                    <Link href={`/manage/employees/${e.id}`} className="font-semibold text-brand-700 underline">
                      {e.last_name}, {e.first_name}
                    </Link>
                    <div className="text-sm text-neutral-600">{e.email}</div>
                  </td>
                  <td className="px-4 py-3">{t(`roles.${e.role}`)}</td>
                  <td className="px-4 py-3 text-sm">{t(`employees.${e.flsa_status}`)}</td>
                  <td className="px-4 py-3 text-sm">
                    {e.user_id ? t("employees.accountLinked") : t("employees.accountNotLinked")}
                  </td>
                  <td className="px-4 py-3 text-sm">{e.is_active ? t("employees.active") : t("employees.inactive")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
