import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/dal";
import { SyncList } from "./sync-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sync");
  return { title: t("title") };
}

/** Sync: what this phone is holding to send, what was sent, and anything the server refused. */
export default async function SyncPage() {
  const profile = await requireProfile();
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t("sync.title")} backHref="/time-clock" backLabel={t("home.modules.timeClock")} />
      <SyncList owner={profile.employeeId} />
    </>
  );
}
