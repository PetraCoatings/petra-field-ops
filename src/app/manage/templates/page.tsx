import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { readContent } from "@/domain/work-orders/content";
import { templateSummary } from "@/domain/work-orders/templates";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { NewTemplateForm } from "./new-template-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("templates");
  return { title: t("title") };
}

type Row = { id: string; name: string; description: string | null; content: unknown; is_active: boolean; updated_at: string };

export default async function TemplatesPage() {
  await requireRole("project_manager", "office_admin");
  const supabase = await createClient();
  const { data } = await supabase.from("work_order_templates").select("id, name, description, content, is_active, updated_at").order("name");
  const rows = (data ?? []) as Row[];
  const t = await getTranslations("templates");
  const format = await getFormatter();
  const active = rows.filter((r) => r.is_active);
  const archived = rows.filter((r) => !r.is_active);

  const list = (items: Row[]) => (
    <ul className="divide-y divide-neutral-200">
      {items.map((r) => {
        const s = templateSummary(readContent(r.content));
        return (
          <li key={r.id}>
            <Link href={`/manage/templates/${r.id}`} className="flex items-center gap-3 py-3 hover:bg-brand-50">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{r.name}</span>
                {r.description && <span className="block text-sm text-neutral-700">{r.description}</span>}
                <span className="block text-sm text-neutral-600">
                  {t("contains", { days: s.days, steps: s.steps, materials: s.materials, mixRatios: s.mixRatios })} ·{" "}
                  {t("updated", { when: format.dateTime(new Date(r.updated_at), { dateStyle: "medium" }) })}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-neutral-500" />
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} />
      <p className="text-base text-neutral-700">{t("intro")}</p>
      <Card>
        <NewTemplateForm />
      </Card>
      <Card title={t("active")}>{active.length === 0 ? <p className="text-neutral-700">{t("empty")}</p> : list(active)}</Card>
      {archived.length > 0 && (
        <details className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-lg font-bold">{t("archived", { count: archived.length })}</summary>
          <div className="mt-2">{list(archived)}</div>
        </details>
      )}
    </div>
  );
}
