import Link from "next/link";
import { Bell } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";

/** Bell in the field header with the number of unread notifications. */
export async function NotificationsBell() {
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  const t = await getTranslations("notifications");
  const unread = count ?? 0;
  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? t("bellUnread", { count: unread }) : t("title")}
      className="relative flex size-11 items-center justify-center rounded-xl hover:bg-white/10"
    >
      <Bell aria-hidden className="size-6" />
      {unread > 0 && (
        <span aria-hidden className="absolute right-0.5 top-0.5 flex min-w-5 items-center justify-center rounded-full bg-accent-400 px-1 text-xs font-bold text-neutral-950">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
