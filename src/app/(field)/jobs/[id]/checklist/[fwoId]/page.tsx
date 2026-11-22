import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/dal";
import { directoryNames } from "@/lib/db/queries";
import { createClient } from "@/lib/supabase/server";
import { canLoadTrailer, loadChecklist } from "@/lib/work-orders/checklists";
import { loadFwo } from "@/lib/work-orders/queries";
import { ChecklistEditor } from "./checklist-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("checklist");
  return { title: t("title") };
}

/** The loading checklist for one work order. */
export default async function ChecklistPage({ params }: PageProps<"/jobs/[id]/checklist/[fwoId]">) {
  const profile = await requireProfile();
  const { id, fwoId } = await params;
  const fwo = await loadFwo(id, fwoId);
  if (!fwo || fwo.status !== "published" || !fwo.current_revision_id) notFound();
  const t = await getTranslations("checklist");
  const canEdit = canLoadTrailer(profile);
  const supabase = await createClient();

  // Crew leads and the office: make sure the checklist exists (built from the
  // work order the first time), THEN read it. Reading first and again after
  // creating would return the first, empty answer: Next.js reuses identical
  // requests within one page render.
  if (canEdit) await supabase.rpc("ensure_loading_checklist", { p_fwo_id: fwoId });
  const checklist = await loadChecklist(fwoId);
  const { data: project } = await supabase.from("projects").select("name").eq("id", id).maybeSingle();
  const [{ data: revs }] = await Promise.all([
    supabase.from("fwo_revisions").select("id, revision_number").eq("fwo_id", fwoId),
  ]);
  const revNumber = (rid: string | undefined) => (revs ?? []).find((r) => r.id === rid)?.revision_number as number | undefined;
  const names = await directoryNames((checklist?.items ?? []).map((i) => i.updated_by));

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} backHref={`/jobs/${id}`} backLabel={(project?.name as string) ?? t("backToJob")} />
      {!checklist ? (
        <p className="rounded-2xl bg-white p-6 text-center text-lg text-neutral-700">{t("notStarted")}</p>
      ) : (
        <ChecklistEditor
          where={{ projectId: id, fwoId }}
          checklistId={checklist.id}
          items={checklist.items.map((i) => ({ ...i, updatedByName: i.updated_by ? (names.get(i.updated_by)?.display_name ?? null) : null }))}
          canEdit={canEdit}
          checklistRevision={revNumber(checklist.revision_id) ?? 1}
          currentRevision={revNumber(fwo.current_revision_id) ?? 1}
        />
      )}
    </div>
  );
}
