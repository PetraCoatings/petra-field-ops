import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CircleAlert } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { createClient } from "@/lib/supabase/server";
import { resolveIssue } from "@/lib/actions/issues";
import { directoryNames } from "@/lib/db/queries";
import { jobPhotos } from "@/lib/photos/load";
import { ReportIssueForm } from "./report-issue-form";

/** "Jobsite issues" on the job screen: open ones first (needs-attention at the top), report a new one, resolve. */
export async function IssuesCard({ projectId, canResolve, canReport = true }: { projectId: string; canResolve: boolean; canReport?: boolean }) {
  const t = await getTranslations("issues");
  const format = await getFormatter();
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobsite_issues")
    .select("id, type, description, requires_attention, status, reported_by, created_at, resolved_by, resolved_at, resolution_note")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(30);
  const issues = (data ?? []) as {
    id: string;
    type: string;
    description: string;
    requires_attention: boolean;
    status: "open" | "resolved";
    reported_by: string | null;
    created_at: string;
    resolved_by: string | null;
    resolved_at: string | null;
    resolution_note: string | null;
  }[];
  issues.sort((a, b) => (a.status === b.status ? Number(b.requires_attention) - Number(a.requires_attention) : a.status === "open" ? -1 : 1));
  const names = await directoryNames(issues.flatMap((i) => [i.reported_by, i.resolved_by]));
  const { photos } = issues.length ? await jobPhotos(projectId, { stage: "issue", limit: 60 }) : { photos: [] };
  const open = issues.filter((i) => i.status === "open").length;
  return (
    <section id="issues" aria-labelledby="issues-card" className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 id="issues-card" className="flex items-center gap-2 text-lg font-bold">
        <CircleAlert aria-hidden className="size-6 text-brand-700" />
        {t("title")}
        {open > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-sm text-red-900">{t("openCount", { count: open })}</span>}
      </h2>
      {canReport && <ReportIssueForm projectId={projectId} />}
      {issues.length > 0 && (
        <ul className="space-y-2">
          {issues.map((i) => {
            const pics = photos.filter((p) => p.issue_id === i.id);
            return (
              <li key={i.id} className={`space-y-1 rounded-xl border-l-4 px-3 py-2 ${i.status === "resolved" ? "border-neutral-300 bg-neutral-50" : i.requires_attention ? "border-red-700 bg-red-50" : "border-accent-600 bg-amber-50"}`}>
                <p className="font-semibold">
                  {t(`types.${i.type as "concrete"}`)}
                  {i.requires_attention && i.status === "open" && <span className="ml-2 text-red-900">· {t("needsAttention")}</span>}
                  {i.status === "resolved" && <span className="ml-2 text-neutral-600">· {t("resolved")}</span>}
                </p>
                <p className="whitespace-pre-wrap">{i.description}</p>
                <p className="text-sm text-neutral-600">{t("reportedBy", { name: names.get(i.reported_by ?? "")?.display_name ?? "?", when: format.dateTime(new Date(i.created_at), { dateStyle: "medium", timeStyle: "short" }) })}</p>
                {pics.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {pics.map((p) => (
                      <Link key={p.id} href={`/jobs/${projectId}/photos/${p.id}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from Storage */}
                        {p.thumbUrl && <img src={p.thumbUrl} alt={t("photoAlt")} className="size-16 rounded object-cover" />}
                      </Link>
                    ))}
                  </div>
                )}
                {i.status === "resolved" ? (
                  <p className="text-sm">{t("resolvedBy", { name: names.get(i.resolved_by ?? "")?.display_name ?? "?", note: i.resolution_note ?? "" })}</p>
                ) : (
                  canResolve && (
                    <form action={resolveIssue} className="flex flex-wrap items-end gap-2 pt-1">
                      <input type="hidden" name="id" value={i.id} />
                      <input name="note" aria-label={t("resolveNote")} placeholder={t("resolveNote")} className="min-h-11 min-w-0 flex-1 rounded-lg border-2 border-neutral-300 bg-white px-3 text-base" />
                      <button type="submit" className={buttonClasses("secondary", "md")}>
                        {t("markResolved")}
                      </button>
                    </form>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
