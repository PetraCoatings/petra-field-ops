import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClipboardList, ExternalLink, Phone } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { SavedCalculations } from "@/components/calculators/saved-calculations";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { WorkOrderOnJob } from "@/components/work-orders/work-order-on-job";
import { requireProfile } from "@/lib/auth/dal";
import { parseDateOnly } from "@/lib/dates";
import { directoryNames } from "@/lib/db/queries";
import { type AssignmentRow, type ProjectContactRow, type ProjectRow, formatAddress } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import type { ProjectSnapshot } from "@/lib/work-orders/snapshot";

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

/**
 * The job screen: the job's details and contacts, then its work order (the
 * crew reads and confirms it right here), the crew, and saved calculations.
 */
export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const profile = await requireProfile();
  const job = await loadJob((await params).id);
  if (!job) notFound();

  const t = await getTranslations();
  const format = await getFormatter();
  const supabase = await createClient();
  const { data: fwoRows } = await supabase
    .from("field_work_orders")
    .select("id, fwo_number, title, current_revision_id")
    .eq("project_id", job.id)
    .eq("status", "published")
    .order("fwo_number");
  const fwos = (fwoRows ?? []) as { id: string; fwo_number: number; title: string; current_revision_id: string }[];
  const { data: revRows } = fwos.length
    ? await supabase
        .from("fwo_revisions")
        .select("id, revision_number, content, project_snapshot, change_summary, published_at")
        .in("id", fwos.map((f) => f.current_revision_id))
    : { data: [] };
  const revisions = new Map(
    ((revRows ?? []) as { id: string; revision_number: number; content: unknown; project_snapshot: ProjectSnapshot; change_summary: string | null; published_at: string }[]).map(
      (r) => [r.id, r],
    ),
  );

  const names = await directoryNames([job.project_manager_id, job.crew_lead_id, ...job.project_assignments.map((a) => a.employee_id)]);
  const name = (id: string | null) => (id ? names.get(id)?.display_name : undefined) ?? t("common.notSet");
  const address = formatAddress(job);
  const contacts = [...job.project_contacts].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const facts = [
    job.scheduled_start && {
      label: t("jobs.startDate"),
      value: [
        format.dateTime(parseDateOnly(job.scheduled_start), { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
        job.estimated_duration_days ? t("jobs.durationDays", { days: job.estimated_duration_days }) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
    job.total_sqft && { label: t("jobs.sqft"), value: t("jobs.sqftValue", { value: format.number(Number(job.total_sqft)) }) },
    job.flooring_system && { label: t("jobs.flooringSystem"), value: job.flooring_system },
    job.crew_lead_id && { label: t("jobs.crewLead"), value: name(job.crew_lead_id) },
    job.project_manager_id && { label: t("jobs.projectManager"), value: name(job.project_manager_id) },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-4">
      <PageHeader title={job.name} backHref="/jobs" backLabel={t("home.modules.jobCenter")} />

      {/* Job header: the details crews need on the way and at the door */}
      <section aria-label={t("jobs.details")} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <ProjectStatusBadge status={job.status} />
          {job.job_number && <span className="text-base font-semibold text-neutral-700">{t("jobs.jobNumber")} {job.job_number}</span>}
        </div>
        {job.customers?.name && <p className="text-lg font-semibold">{job.customers.name}</p>}
        {address && (
          <a
            className="inline-flex items-center gap-1 text-base font-semibold text-brand-700 underline"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {address}
            <ExternalLink aria-hidden className="size-4" />
            <span className="sr-only">({t("jobs.openInMaps")})</span>
          </a>
        )}
        {contacts.length > 0 && (
          <ul className="space-y-2">
            {contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-base">
                  <span className="font-semibold">{c.name}</span>
                  {c.title && <span className="text-neutral-700"> ({c.title})</span>}
                </span>
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
        {facts.length > 0 && (
          <dl className="grid gap-x-6 gap-y-2 border-t border-neutral-200 pt-3 sm:grid-cols-2">
            {facts.map((f) => (
              <div key={f.label}>
                <dt className="text-sm font-semibold text-neutral-600">{f.label}</dt>
                <dd className="text-base text-neutral-950">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {fwos.length === 0 ? (
        <p className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-neutral-300 bg-white p-4 text-base text-neutral-700">
          <ClipboardList aria-hidden className="size-6 shrink-0 text-neutral-500" />
          {t("jobs.noWorkOrder")}
        </p>
      ) : (
        fwos.map((f) => {
          const rev = revisions.get(f.current_revision_id);
          return rev ? (
            <WorkOrderOnJob key={f.id} projectId={job.id} fwo={f} revision={rev} profile={profile} showTitle={fwos.length > 1} />
          ) : null;
        })
      )}

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

      <SavedCalculations projectId={job.id} profile={profile} />
    </div>
  );
}
