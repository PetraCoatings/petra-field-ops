import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { readContent } from "@/domain/work-orders/content";
import { requireRole } from "@/lib/auth/dal";
import { pickerProducts } from "@/lib/library/picker-products";
import { createClient } from "@/lib/supabase/server";
import { TemplateEditor } from "./template-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("templates");
  return { title: t("editTitle") };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TemplatePage({ params }: PageProps<"/manage/templates/[id]">) {
  await requireRole("project_manager", "office_admin");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("work_order_templates").select("id, name, description, content, is_active").eq("id", id).maybeSingle();
  if (!data) notFound();
  const t = await getTranslations("templates");
  return (
    <div className="space-y-4">
      <PageHeader title={data.name as string} backHref="/manage/templates" backLabel={t("title")} />
      {!data.is_active && <Alert tone="warning">{t("archivedNote")}</Alert>}
      <Alert tone="info">{t("copyNote")}</Alert>
      <TemplateEditor
        id={id}
        initialName={data.name as string}
        initialDescription={(data.description as string | null) ?? ""}
        initialContent={readContent(data.content)}
        isActive={data.is_active as boolean}
        products={await pickerProducts()}
      />
    </div>
  );
}
