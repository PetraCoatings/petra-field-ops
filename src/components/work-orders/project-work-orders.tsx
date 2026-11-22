import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonClasses } from "@/components/ui/button-styles";
import { Card } from "@/components/ui/card";
import { createWorkOrder } from "@/lib/actions/work-orders";
import { createClient } from "@/lib/supabase/server";
import { WorkOrderStatusBadge } from "./status-badge";

/** "Work orders" card on the Management project page. */
export async function ProjectWorkOrders({ projectId }: { projectId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("field_work_orders")
    .select("id, fwo_number, title, status, fwo_revisions!fwo_revisions_fwo_id_fkey(revision_number)")
    .eq("project_id", projectId)
    .order("fwo_number");
  const rows = (data ?? []) as unknown as {
    id: string;
    fwo_number: number;
    title: string;
    status: "draft" | "published" | "void";
    fwo_revisions: { revision_number: number }[];
  }[];
  const t = await getTranslations("workOrders");
  return (
    <Card title={t("title")}>
      {rows.length > 0 && (
        <ul className="mb-4 divide-y divide-neutral-200">
          {rows.map((w) => {
            const rev = Math.max(0, ...w.fwo_revisions.map((r) => r.revision_number));
            return (
              <li key={w.id}>
                <Link href={`/manage/projects/${projectId}/work-orders/${w.id}`} className="flex items-center gap-3 py-3 hover:bg-brand-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {t("view.workOrderN", { n: w.fwo_number })} · {w.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <WorkOrderStatusBadge status={w.status} />
                      {rev > 0 && <span className="text-sm text-neutral-700">{t("view.revisionN", { n: rev })}</span>}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-5 text-neutral-500" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <form action={createWorkOrder.bind(null, projectId)} className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 space-y-1">
          <span className="block text-sm font-semibold text-neutral-800">{t("newTitle")}</span>
          <input
            name="title"
            required
            maxLength={200}
            placeholder={t("newTitlePlaceholder")}
            className="block min-h-11 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
          />
        </label>
        <button type="submit" className={buttonClasses("primary", "md")}>
          <Plus aria-hidden className="size-5" />
          {t("create")}
        </button>
      </form>
    </Card>
  );
}
