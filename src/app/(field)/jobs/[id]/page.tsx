import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink, Phone } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { SavedCalculations } from "@/components/calculators/saved-calculations";
import { Card, DefinitionList } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { requireProfile } from "@/lib/auth/dal";
import { parseDateOnly } from "@/lib/dates";
import { directoryNames } from "@/lib/db/queries";
import { type AssignmentRow, type ProjectContactRow, type ProjectRow, formatAddress } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

type JobDetail = ProjectRow & {
  customers: { name: string } | null;
  project_contacts: ProjectContactRow[];
  project_assignments: AssignmentRow[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadJob(id: string): Promise<JobDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const supabase = await createClient();
  // RLS returns nothing if this person isn't allowed to see the project.
  const { data } = await supabase
    .from("projects")
    .select("*, customers(name), project_contacts(*), project_assignments(*)")
    .eq("id", id)
    .maybeSingle();
  return data as JobDetail | null;
}

export async function generateMetadata({ params }: PageProps<"/jobs/[id]">): Promise<Metadata> {
  const job = await loadJob((await params).id);
  return { title: job?.name };
}

/** Job file (read-only in Phase 1). */
export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const profile = await requireProfile();
  const job = await loadJob((await params).id);
  if (!job) notFound();

  const t = await getTranslations();
  const format = await getFormatter();
  const names = await directoryNames([
    job.project_manager_id,
    job.crew_lead_id,
    ...job.project_assignments.map((a) => a.employee_id),
  ]);
  const name = (id: string | null) => (id ? names.get(id)?.display_name : undefined) ?? t("common.notSet");
  const address = formatAddress(job);
  const notSet = <span className="text-neutral-500">{t("common.notSet")}</span>;

  return (
    <div className="space-y-4">
      <PageHeader title={job.name} backHref="/jobs" backLabel={t("home.modules.jobCenter")} />
      <div className="flex flex-wrap items-center gap-2">
        <ProjectStatusBadge status={job.status} />
        {job.job_number && (
          <span className="text-base font-semibold text-neutral-700">
            {t("jobs.jobNumber")} {job.job_number}
          </span>
        )}
      </div>

      <Card>
        <DefinitionList
          items={[
            { label: t("jobs.customer"), value: job.customers?.name ?? notSet },
            {
              label: t("jobs.address"),
              value: address ? (
                <a
                  className="inline-flex items-center gap-1 font-semibold text-brand-700 underline"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {address}
                  <ExternalLink aria-hidden className="size-4" />
                  <span className="sr-only">({t("jobs.openInMaps")})</span>
                </a>
              ) : (
                notSet
              ),
            },
            {
              label: t("jobs.startDate"),
              value: job.scheduled_start
                ? format.dateTime(parseDateOnly(job.scheduled_start), { dateStyle: "full" })
                : notSet,
            },
            {
              label: t("jobs.duration"),
              value: job.estimated_duration_days
                ? t("jobs.durationDays", { days: job.estimated_duration_days })
                : notSet,
            },
            {
              label: t("jobs.sqft"),
              value: job.total_sqft
                ? t("jobs.sqftValue", { value: format.number(Number(job.total_sqft)) })
                : notSet,
            },
            { label: t("jobs.flooringSystem"), value: job.flooring_system ?? notSet },
            { label: t("jobs.projectManager"), value: name(job.project_manager_id) },
            { label: t("jobs.crewLead"), value: name(job.crew_lead_id) },
          ]}
        />
      </Card>

      {job.scope_summary && (
        <Card title={t("jobs.scope")}>
          <p className="whitespace-pre-wrap text-base">{job.scope_summary}</p>
        </Card>
      )}

      <Card title={t("jobs.crew")}>
        {job.project_assignments.length === 0 ? (
          <p className="text-neutral-700">{t("projects.crewEmpty")}</p>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {job.project_assignments.map((a) => (
              <li key={a.id} className="py-2 text-base">
                {name(a.employee_id)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("jobs.contacts")}>
        {job.project_contacts.length === 0 ? (
          <p className="text-neutral-700">{t("jobs.noContacts")}</p>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {job.project_contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-semibold">{c.name}</p>
                  {c.title && <p className="text-sm text-neutral-700">{c.title}</p>}
                </div>
                {c.phone && (
                  <a
                    href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-brand-600 px-4 font-semibold text-brand-700"
                  >
                    <Phone aria-hidden className="size-5" />
                    {c.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SavedCalculations projectId={job.id} profile={profile} />

      <p className="text-sm text-neutral-600">{t("jobs.upcomingSections")}</p>
    </div>
  );
}
