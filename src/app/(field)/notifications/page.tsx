import type { Metadata } from "next";
import { Bell, ClipboardList } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClasses } from "@/components/ui/button-styles";
import { PageHeader } from "@/components/ui/page-header";
import { markAllNotificationsRead, openNotification } from "@/lib/actions/work-orders";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications");
  return { title: t("title") };
}

type Row = {
  id: string;
  type: "fwo_published";
  data: { fwoNumber?: number; title?: string; revision?: number; projectName?: string };
  read_at: string | null;
  created_at: string;
};

export default async function NotificationsPage() {
  await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, type, data, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as Row[];
  const t = await getTranslations("notifications");
  const format = await getFormatter();
  const unread = rows.some((r) => !r.read_at);
  return (
    <>
      <PageHeader
        title={t("title")}
        backHref="/"
        backLabel={t("home")}
        actions={
          unread ? (
            <form action={markAllNotificationsRead}>
              <button type="submit" className={buttonClasses("secondary", "md")}>
                {t("markAllRead")}
              </button>
            </form>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <p className="flex flex-col items-center gap-3 rounded-2xl bg-white p-8 text-center text-lg text-neutral-700">
          <Bell aria-hidden className="size-10 text-neutral-400" />
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <li key={n.id}>
              <form action={openNotification}>
                <input type="hidden" name="id" value={n.id} />
                <button
                  type="submit"
                  className={`flex w-full items-start gap-3 rounded-2xl border-2 p-4 text-left ${n.read_at ? "border-neutral-200 bg-white" : "border-accent-500 bg-amber-50"}`}
                >
                  <ClipboardList aria-hidden className="mt-0.5 size-6 shrink-0 text-brand-700" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-bold">
                      {(n.data.revision ?? 1) > 1
                        ? t("fwoUpdated", { n: n.data.fwoNumber ?? 0, revision: n.data.revision ?? 1 })
                        : t("fwoNew", { n: n.data.fwoNumber ?? 0 })}
                    </span>
                    <span className="block text-base text-neutral-800">
                      {n.data.title} · {n.data.projectName}
                    </span>
                    <span className="block text-sm text-neutral-600">
                      {format.dateTime(new Date(n.created_at), { dateStyle: "medium", timeStyle: "short" })}
                      {!n.read_at && <span className="ml-2 font-semibold text-amber-900">{t("unread")}</span>}
                    </span>
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
