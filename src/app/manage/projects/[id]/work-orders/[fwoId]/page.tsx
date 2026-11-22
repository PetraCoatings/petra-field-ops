import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, Clock } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { WorkOrderStatusBadge } from "@/components/work-orders/status-badge";
import { readContent } from "@/domain/work-orders/content";
import { requireRole } from "@/lib/auth/dal";
import { parseDateOnly } from "@/lib/dates";
import { directoryNames } from "@/lib/db/queries";
import { formatAddress } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { crewIds, loadFwo, loadRevisions } from "@/lib/work-orders/queries";
import { WorkOrderEditor } from "./work-order-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workOrders");
  return { title: t("editor.pageTitle") };
}

export default async function WorkOrderEditorPage({ params, searchParams }: PageProps<"/manage/projects/[id]/work-orders/[fwoId]">) {
  await requireRole("project_manager", "office_admin");
  const { id, fwoId } = await params;
  const { created } = await searchParams;
  const fwo = await loadFwo(id, fwoId);
  if (!fwo) notFound();

  const supabase = await createClient();
  const [{ data: draft }, { data: project }, revisions, crew, { data: templateRows }] = await Promise.all([
    supabase.from("fwo_drafts").select("content, updated_at").eq("fwo_id", fwoId).maybeSingle(),
    supabase
      .from("projects")
      .select("name, status, scheduled_start, site_street, site_city, site_state, site_postal_code, customers(name), project_contacts(name, title, phone)")
      .eq("id", id)
      .maybeSingle(),
    loadRevisions(fwoId),
    crewIds(id),
    supabase.from("work_order_templates").select("id, name, description, content").eq("is_active", true).order("name"),
  ]);
  const templates = (templateRows ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    content: readContent(r.content),
  }));
  const current = revisions[0];
  const { data: acks } = current
    ? await supabase.from("fwo_acknowledgments").select("employee_id, acknowledged_at").eq("fwo_revision_id", current.id)
    : { data: [] };
  const names = await directoryNames([...crew, ...revisions.map((r) => r.published_by)]);
  const t = await getTranslations("workOrders");
  const format = await getFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const name = (eid: string | null) => (eid && names.get(eid)?.display_name) || t("formerEmployee");
  const ackBy = new Map((acks ?? []).map((a) => [a.employee_id as string, a.acknowledged_at as string]));
  const unpublished = Boolean(current && draft && new Date(draft.updated_at as string) > new Date(current.published_at));

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t("view.workOrderN", { n: fwo.fwo_number })} · ${fwo.title}`}
        backHref={`/manage/projects/${id}`}
        backLabel={(project?.name as string) ?? t("editor.backToProject")}
      />
      {created && <Alert tone="success">{t("editor.jobCreated")}</Alert>}

      {project && (
        <section aria-label={t("editor.jobDetails")} className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{t("editor.jobDetails")}</h2>
            <Link href={`/manage/projects/${id}`} className="font-semibold text-brand-700 underline">
              {t("editor.editJobDetails")}
            </Link>
          </div>
          <p className="text-base text-neutral-800">
            {[
              (project.customers as unknown as { name: string } | null)?.name,
              formatAddress(project as unknown as Parameters<typeof formatAddress>[0]),
              project.scheduled_start && format.dateTime(parseDateOnly(project.scheduled_start as string), { dateStyle: "medium" }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="text-sm text-neutral-700">
            {[
              ...((project.project_contacts as { name: string; phone: string | null }[] | null) ?? []).map((c) => [c.name, c.phone].filter(Boolean).join(" ")),
              t("editor.crewCount", { count: crew.length }),
            ].join(" · ")}
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <WorkOrderStatusBadge status={fwo.status} />
        {current && (
          <span className="text-base font-semibold text-neutral-700">{t("editor.currentRevision", { n: current.revision_number })}</span>
        )}
        {unpublished && <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-950">{t("editor.unpublished")}</span>}
      </div>

      {current && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title={t("editor.acknowledgments", { n: current.revision_number })}>
            {crew.length === 0 ? (
              <p className="text-neutral-700">{t("editor.noCrew")}</p>
            ) : (
              <ul className="divide-y divide-neutral-200">
                {crew
                  .map((eid) => ({ eid, name: name(eid) }))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(({ eid, name: n }) => {
                    const at = ackBy.get(eid);
                    return (
                      <li key={eid} className="flex items-center justify-between gap-2 py-2">
                        <span className="text-base">{n}</span>
                        {at ? (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-800">
                            <CircleCheck aria-hidden className="size-5" />
                            {when(at)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-800">
                            <Clock aria-hidden className="size-5" />
                            {t("editor.notYet")}
                          </span>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}
          </Card>
          <Card title={t("editor.history")}>
            <ul className="divide-y divide-neutral-200">
              {revisions.map((r) => (
                <li key={r.id} className="py-2">
                  <Link href={`/jobs/${id}/work-orders/${fwoId}?rev=${r.revision_number}`} className="font-semibold text-brand-700 underline">
                    {t("view.revisionN", { n: r.revision_number })}
                  </Link>
                  <span className="text-sm text-neutral-600">
                    {" "}
                    · {when(r.published_at)} · {name(r.published_by)}
                  </span>
                  {r.change_summary && <p className="text-sm text-neutral-800">{r.change_summary}</p>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <WorkOrderEditor
        projectId={id}
        fwoId={fwoId}
        initialTitle={fwo.title}
        initialContent={readContent(draft?.content)}
        hasRevisions={revisions.length > 0}
        nextRevision={(current?.revision_number ?? 0) + 1}
        templates={templates}
      />
    </div>
  );
}
