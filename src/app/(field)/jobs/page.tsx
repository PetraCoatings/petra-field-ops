import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { requireProfile } from "@/lib/auth/dal";
import { canAccessManagement } from "@/lib/auth/roles";
import type { ProjectRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { parseDateOnly } from "@/lib/dates";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home.modules");
  return { title: t("jobCenter") };
}

const ORDER: Record<string, number> = { in_progress: 0, scheduled: 1, on_hold: 2, draft: 3, completed: 4, closed: 5 };

/** Job Center list. RLS returns only the projects this person may see. */
export default async function JobsPage() {
  const profile = await requireProfile();
  const office = canAccessManagement(profile.role);
  const t = await getTranslations();
  const format = await getFormatter();
  const supabase = await createClient();

  let query = supabase
    .from("projects")
    .select("id, job_number, name, status, scheduled_start, site_city, customers(name)")
    .neq("status", "closed");
  if (!office) query = query.neq("status", "draft");
  const { data } = await query;

  type Row = Pick<ProjectRow, "id" | "job_number" | "name" | "status" | "scheduled_start" | "site_city"> & {
    customers: { name: string } | null;
  };
  const jobs = ((data ?? []) as unknown as Row[]).sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""),
  );

  return (
    <>
      <PageHeader
        title={office ? t("jobs.allJobsTitle") : t("jobs.title")}
        backHref="/"
        backLabel={t("common.home")}
      />
      {jobs.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-lg text-neutral-700">{t("jobs.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/jobs/${job.id}`}
                className="flex items-center gap-3 rounded-2xl border-2 border-neutral-200 bg-white p-4 hover:border-brand-600"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-lg font-bold leading-snug">{job.name}</p>
                  <p className="text-base text-neutral-700">
                    {[job.customers?.name, job.site_city].filter(Boolean).join(" · ")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <ProjectStatusBadge status={job.status} />
                    {job.scheduled_start && (
                      <span className="text-sm text-neutral-700">
                        {format.dateTime(parseDateOnly(job.scheduled_start), { dateStyle: "medium" })}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight aria-hidden className="size-6 shrink-0 text-neutral-500" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
