import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Card, DefinitionList } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/dal";
import type { AppSettingsRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  await requireRole("office_admin");
  const t = await getTranslations("settings");
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("*").single();
  const settings = data as AppSettingsRow;
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} />
      <Card>
        <DefinitionList items={[{ label: t("timezone"), value: settings.company_timezone }]} />
      </Card>
      <Card>
        <SettingsForm settings={settings} />
      </Card>
    </div>
  );
}
