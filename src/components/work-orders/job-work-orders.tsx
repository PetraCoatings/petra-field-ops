import Link from "next/link";
import { ChevronRight, CircleCheck, ClipboardList } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import type { Profile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/** "Work orders" card on the Job Center job page. Crews see which revisions still need their OK. */
export async function JobWorkOrders({ projectId, profile }: { projectId: string; profile: Profile }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("field_work_orders")
    .select("id, fwo_number, title, current_revision_id")
    .eq("project_id", projectId)
    .eq("status", "published")
    .order("fwo_number");
  const rows = (data ?? []) as { id: string; fwo_number: number; title: string; current_revision_id: string }[];
  if (rows.length === 0) return null;
  const isCrew = profile.role === "installer" || profile.role === "crew_lead";
  const { data: acks } = isCrew
    ? await supabase
        .from("fwo_acknowledgments")
        .select("fwo_revision_id")
        .eq("employee_id", profile.employeeId)
        .in("fwo_revision_id", rows.map((r) => r.current_revision_id))
    : { data: [] };
  const acked = new Set((acks ?? []).map((a) => a.fwo_revision_id as string));
  const t = await getTranslations("workOrders");
  return (
    <Card title={t("title")}>
      <ul className="space-y-2">
        {rows.map((w) => {
          const needsOk = isCrew && !acked.has(w.current_revision_id);
          return (
            <li key={w.id}>
              <Link
                href={`/jobs/${projectId}/work-orders/${w.id}`}
                className={`flex min-h-16 items-center gap-3 rounded-xl border-2 p-3 ${needsOk ? "border-accent-500 bg-amber-50" : "border-neutral-200 hover:border-brand-600"}`}
              >
                <ClipboardList aria-hidden className="size-7 shrink-0 text-brand-700" />
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold">
                    {t("view.workOrderN", { n: w.fwo_number })} · {w.title}
                  </span>
                  {needsOk ? (
                    <span className="block text-sm font-semibold text-amber-900">{t("needsYourOk")}</span>
                  ) : (
                    isCrew && (
                      <span className="flex items-center gap-1 text-sm font-semibold text-green-800">
                        <CircleCheck aria-hidden className="size-4" />
                        {t("youConfirmed")}
                      </span>
                    )
                  )}
                </span>
                <ChevronRight aria-hidden className="size-6 shrink-0 text-neutral-500" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
