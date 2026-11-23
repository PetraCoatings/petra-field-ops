"use client";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CircleCheck, CloudUpload, RefreshCw, TriangleAlert } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { dismissOutboxItem, outboxItems, retryOutboxItem, subscribeOutbox, syncOutbox, type OutboxItem } from "@/lib/offline/outbox";
import { queuedPhotos, removeQueuedPhoto, retryQueuedPhoto, syncPhotos, type QueuedPhoto } from "@/lib/offline/photo-queue";

const snap = () => JSON.stringify(outboxItems());

/** Everything this phone is holding: Time Clock presses, daily report saves and photos, waiting, sent, or refused. */
export function SyncList({ owner }: { owner: string }) {
  const t = useTranslations("sync");
  const tc = useTranslations("timeClock");
  const locale = useLocale();
  const items = (JSON.parse(useSyncExternalStore(subscribeOutbox, snap, () => "[]")) as OutboxItem[]).sort((a, b) => b.payload.deviceTs.localeCompare(a.payload.deviceTs));
  const [photos, setPhotos] = useState<(QueuedPhoto & { url: string })[]>([]);
  const [busy, start] = useTransition();
  useEffect(() => {
    let urls: string[] = [];
    const load = async () => {
      const list = (await queuedPhotos()).filter((p) => p.owner === owner);
      urls.forEach((u) => URL.revokeObjectURL(u));
      const withUrls = list.map((p) => ({ ...p, url: URL.createObjectURL(p.thumb) }));
      urls = withUrls.map((p) => p.url);
      setPhotos(withUrls);
    };
    void load();
    const unsub = subscribeOutbox(() => void load());
    return () => {
      unsub();
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [owner]);
  const when = (s: string) => new Intl.DateTimeFormat(locale, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(s));
  const mine = items.filter((i) => i.owner === owner);
  const others = items.filter((i) => i.owner !== owner && i.state !== "synced");
  const waiting = mine.filter((i) => i.state === "pending" || i.state === "sending").length + photos.filter((p) => p.state === "pending").length;
  const sendAll = () =>
    start(async () => {
      await syncOutbox(owner);
      await syncPhotos(owner);
    });
  const tone = (state: string) => (state === "synced" ? "border-green-700 bg-green-50" : state === "failed" ? "border-red-700 bg-red-50" : "border-neutral-400 bg-neutral-50");
  const icon = (state: string) =>
    state === "synced" ? <CircleCheck aria-hidden className="size-5 text-green-700" /> : state === "failed" ? <TriangleAlert aria-hidden className="size-5 text-red-700" /> : <CloudUpload aria-hidden className="size-5" />;
  const reportError = (e?: string) => (e === "conflict" ? t("reportConflict") : e === "submitted" ? t("reportSubmitted") : t("reportRefused"));

  return (
    <div className="space-y-4">
      <p className="text-base text-neutral-700">{t("intro")}</p>
      {waiting > 0 && (
        <button type="button" disabled={busy} onClick={sendAll} className={buttonClasses("primary", "md")}>
          <RefreshCw aria-hidden className="size-5" />
          {busy ? t("sending") : t("sendNow")}
        </button>
      )}
      {mine.length === 0 && photos.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-4">
          <CircleCheck aria-hidden className="size-6 text-green-700" />
          {t("allSent")}
        </p>
      ) : (
        <ul className="space-y-2" aria-label={t("listLabel")}>
          {photos.map((p) => (
            <li key={p.clientId} className={`flex gap-3 rounded-xl border-l-4 px-4 py-3 ${tone(p.state)}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- photo still on this phone */}
              <img src={p.url} alt="" className="size-14 shrink-0 rounded object-cover" />
              <div className="min-w-0 space-y-1">
                <p className="flex items-center gap-2 font-semibold">
                  {icon(p.state)}
                  {t("photo")}
                </p>
                <p className="text-sm">
                  {t("takenAt", { when: when(p.takenAt) })} · {p.state === "failed" ? t("states.failed") : t("states.pending")}
                </p>
                {p.state === "failed" && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void retryQueuedPhoto(p.clientId)} className={buttonClasses("secondary", "md")}>
                      {t("tryAgain")}
                    </button>
                    <button type="button" onClick={() => void removeQueuedPhoto(p.clientId)} className={buttonClasses("ghost", "md")}>
                      {t("dismiss")}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
          {mine.map((i) => (
            <li key={i.id} className={`space-y-1 rounded-xl border-l-4 px-4 py-3 ${tone(i.state)}`}>
              <p className="flex items-center gap-2 font-semibold">
                {icon(i.state)}
                {i.kind === "clock" ? (
                  <>
                    {tc(`actions.${i.payload.action}`)}
                    {i.payload.category ? ` (${tc(`categories.${i.payload.category}`)})` : ""}
                    {i.payload.employeeIds && i.payload.employeeIds.length > 1 ? ` · ${t("people", { count: i.payload.employeeIds.length })}` : ""}
                  </>
                ) : (
                  <>
                    {i.payload.submit ? t("reportSubmit") : t("reportSave")} · {i.payload.label}
                  </>
                )}
              </p>
              <p className="text-sm">
                {t("pressedAt", { when: when(i.payload.deviceTs) })} · {t(`states.${i.state}`)}
              </p>
              {i.state === "failed" && (
                <p className="text-sm text-red-900">
                  {i.kind === "clock" ? t("refused", { reason: tc(`errors.${(i.error ?? "generic") as "generic"}`) }) : reportError(i.error)}
                </p>
              )}
              {i.kind === "report" && (
                <Link href={i.payload.href} className="text-sm font-semibold text-brand-700 underline">
                  {t("openReport")}
                </Link>
              )}
              {i.state === "failed" && (
                <div className="flex flex-wrap gap-2">
                  {i.kind === "clock" && (
                    <button type="button" onClick={() => retryOutboxItem(i.id)} className={buttonClasses("secondary", "md")}>
                      {t("tryAgain")}
                    </button>
                  )}
                  <button type="button" onClick={() => dismissOutboxItem(i.id)} className={buttonClasses("ghost", "md")}>
                    {t("dismiss")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && <p className="rounded-xl bg-amber-50 px-4 py-3 text-amber-950">{t("otherAccount", { count: others.length })}</p>}
      <p className="text-sm text-neutral-600">{t("howItWorks")}</p>
    </div>
  );
}
