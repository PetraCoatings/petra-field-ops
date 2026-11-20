import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("manage.dashboard");
  return { title: t("title") };
}

export default async function ManageDashboard() {
  const profile = await requireRole("project_manager", "office_admin");
  const t = await getTranslations("manage.dashboard");
  const supabase = await createClient();
  const count = { count: "exact" as const, head: true };
  const [active, drafts, employees] = await Promise.all([
    supabase.from("projects").select("id", count).in("status", ["scheduled", "in_progress", "on_hold"]),
    supabase.from("projects").select("id", count).eq("status", "draft"),
    supabase.from("employee_directory").select("id", count).eq("is_active", true),
  ]);
  const stats = [
    { label: t("activeProjects"), value: active.count ?? 0, href: "/manage/projects" },
    { label: t("draftProjects"), value: drafts.count ?? 0, href: "/manage/projects?status=draft" },
    {
      label: t("activeEmployees"),
      value: employees.count ?? 0,
      href: profile.role === "office_admin" ? "/manage/employees" : undefined,
    },
  ];
  return (
    <>
      <PageHeader title={t("title")} />
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => {
          const body = (
            <>
              <p className="text-sm font-semibold text-neutral-600">{s.label}</p>
              <p className="text-4xl font-bold tabular-nums text-neutral-950">{s.value}</p>
            </>
          );
          const cls = "block rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm";
          return s.href ? (
            <Link key={s.label} href={s.href} className={`${cls} hover:border-brand-600`}>
              {body}
            </Link>
          ) : (
            <div key={s.label} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-base text-neutral-700">{t("phaseNote")}</p>
    </>
  );
}
