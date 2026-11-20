import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/lib/auth/dal";
import { parseDateOnly } from "@/lib/dates";
import { PROJECT_STATUSES, type ProjectRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("projects");
  return { title: t("title") };
}

export default async function ManageProjectsPage({ searchParams }: PageProps<"/manage/projects">) {
  await requireRole("project_manager", "office_admin");
  const t = await getTranslations();
  const format = await getFormatter();
  const { status } = await searchParams;
  const filter = typeof status === "string" && PROJECT_STATUSES.includes(status as never) ? status : null;

  const supabase = await createClient();
  let query = supabase
    .from("projects")
    .select("id, job_number, name, status, scheduled_start, site_city, customers(name)")
    .order("scheduled_start", { ascending: false, nullsFirst: true });
  if (filter) query = query.eq("status", filter);
  const { data } = await query;
  type Row = Pick<ProjectRow, "id" | "job_number" | "name" | "status" | "scheduled_start" | "site_city"> & {
    customers: { name: string } | null;
  };
  const projects = (data ?? []) as unknown as Row[];

  const chip = (value: string | null, label: string) => (
    <Link
      key={value ?? "all"}
      href={value ? `/manage/projects?status=${value}` : "/manage/projects"}
      aria-current={filter === value ? "page" : undefined}
      className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
        filter === value ? "bg-brand-700 text-white" : "bg-white text-neutral-800 ring-1 ring-neutral-300"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title={t("projects.title")}
        actions={
          <LinkButton href="/manage/projects/new">
            <Plus aria-hidden className="size-5" />
            {t("projects.new")}
          </LinkButton>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {chip(null, t("projects.allStatuses"))}
        {PROJECT_STATUSES.map((s) => chip(s, t(`jobs.status.${s}`)))}
      </div>
      {projects.length === 0 ? (
        <p className="text-neutral-700">{t("projects.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-base">
            <thead className="bg-neutral-50 text-sm text-neutral-700">
              <tr>
                <th className="px-4 py-3">{t("projects.name")}</th>
                <th className="px-4 py-3">{t("projects.customer")}</th>
                <th className="px-4 py-3">{t("projects.startDate")}</th>
                <th className="px-4 py-3">{t("projects.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {projects.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <Link href={`/manage/projects/${p.id}`} className="font-semibold text-brand-700 underline">
                      {p.name}
                    </Link>
                    {p.job_number && <div className="text-sm text-neutral-600">#{p.job_number}</div>}
                  </td>
                  <td className="px-4 py-3">{p.customers?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    {p.scheduled_start ? format.dateTime(parseDateOnly(p.scheduled_start), { dateStyle: "medium" }) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <ProjectStatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
