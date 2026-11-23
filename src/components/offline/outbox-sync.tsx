"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CloudUpload, TriangleAlert } from "lucide-react";
import { outboxItems, subscribeOutbox, syncOutbox } from "@/lib/offline/outbox";
import { photoCounts, syncPhotos } from "@/lib/offline/photo-queue";

const snapshotFor = (owner: string) => () => {
  const items = outboxItems().filter((i) => i.owner === owner);
  const photos = photoCounts(owner);
  return `${items.filter((i) => i.state === "pending" || i.state === "sending").length + photos.pending}|${items.filter((i) => i.state === "failed").length + photos.failed}`;
};

/**
 * Sends the phone's waiting Time Clock presses, daily report saves and
 * photos whenever signal comes back,
 * the app is reopened, or every 30 seconds; shows a badge in the header while
 * anything is waiting or was refused.
 */
export function OutboxSync({ owner }: { owner: string }) {
  const t = useTranslations("sync");
  const router = useRouter();
  const [snapshot] = useState(() => snapshotFor(owner));
  const counts = useSyncExternalStore(subscribeOutbox, snapshot, () => "0|0");
  const [waiting, failed] = counts.split("|").map(Number);
  useEffect(() => {
    const run = () => {
      if (navigator.onLine === false) return;
      void Promise.all([syncOutbox(owner), syncPhotos(owner)]).then(([a, b]) => {
        if (a + b > 0) router.refresh(); // only when something was actually sent
      });
    };
    run();
    const id = setInterval(run, 30_000);
    const onVisible = () => document.visibilityState === "visible" && run();
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [owner, router]);
  if (!waiting && !failed) return null;
  return (
    <Link
      href="/sync"
      className={`inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold ${failed ? "bg-red-600 text-white" : "bg-white/15 text-white"}`}
      aria-label={failed ? t("badgeFailed", { count: failed }) : t("badgeWaiting", { count: waiting })}
    >
      {failed ? <TriangleAlert aria-hidden className="size-5" /> : <CloudUpload aria-hidden className="size-5" />}
      {failed || waiting}
    </Link>
  );
}
