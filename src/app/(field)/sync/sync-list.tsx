"use client";
import { useSyncExternalStore, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CircleCheck, CloudUpload, RefreshCw, TriangleAlert } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { dismissOutboxItem, outboxItems, retryOutboxItem, subscribeOutbox, syncOutbox, type OutboxItem } from "@/lib/offline/outbox";

const snap = () => JSON.stringify(outboxItems());

/** Everything this phone is holding: waiting, sent, or refused by the server. */
export function SyncList({ owner }: { owner: string }) {
  const t = useTranslations("sync");
  const tc = useTranslations("timeClock");
  const locale = useLocale();
  const items = (JSON.parse(useSyncExternalStore(subscribeOutbox, snap, () => "[]")) as OutboxItem[]).sort((a, b) => b.payload.deviceTs.localeCompare(a.payload.deviceTs));
  const [busy, start] = useTransition();
  const when = (s: string) => new Intl.DateTimeFormat(locale, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(s));
  const mine = items.filter((i) => i.owner === owner);
  const others = items.filter((i) => i.owner !== owner && i.state !== "synced");
  const waiting = mine.filter((i) => i.state === "pending" || i.state === "sending").length;
  return (
    <div className="space-y-4">
      <p className="text-base text-neutral-700">{t("intro")}</p>
      {waiting > 0 && (
        <button type="button" disabled={busy} onClick={() => start(() => syncOutbox(owner))} className={buttonClasses("primary", "md")}>
          <RefreshCw aria-hidden className="size-5" />
          {busy ? t("sending") : t("sendNow")}
        </button>
      )}
      {mine.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-4">
          <CircleCheck aria-hidden className="size-6 text-green-700" />
          {t("allSent")}
        </p>
      ) : (
        <ul className="space-y-2" aria-label={t("listLabel")}>
          {mine.map((i) => (
            <li key={i.id} className={`space-y-1 rounded-xl border-l-4 px-4 py-3 ${i.state === "synced" ? "border-green-700 bg-green-50" : i.state === "failed" ? "border-red-700 bg-red-50" : "border-neutral-400 bg-neutral-50"}`}>
              <p className="flex items-center gap-2 font-semibold">
                {i.state === "synced" ? <CircleCheck aria-hidden className="size-5 text-green-700" /> : i.state === "failed" ? <TriangleAlert aria-hidden className="size-5 text-red-700" /> : <CloudUpload aria-hidden className="size-5" />}
                {tc(`actions.${i.payload.action}`)}
                {i.payload.category ? ` (${tc(`categories.${i.payload.category}`)})` : ""}
                {i.payload.employeeIds && i.payload.employeeIds.length > 1 ? ` · ${t("people", { count: i.payload.employeeIds.length })}` : ""}
              </p>
              <p className="text-sm">
                {t("pressedAt", { when: when(i.payload.deviceTs) })} · {t(`states.${i.state}`)}
              </p>
              {i.state === "failed" && <p className="text-sm text-red-900">{t("refused", { reason: tc(`errors.${(i.error ?? "generic") as "generic"}`) })}</p>}
              {i.state === "failed" && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => retryOutboxItem(i.id)} className={buttonClasses("secondary", "md")}>
                    {t("tryAgain")}
                  </button>
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
