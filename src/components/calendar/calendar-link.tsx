"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CalendarPlus, Copy, Link2Off, RefreshCw } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { newCalendarLink, revokeCalendarLink } from "@/lib/actions/calendar";

/**
 * "Add to my calendar": a private link that Apple Calendar, Outlook or Google
 * Calendar subscribe to. Only shown right after it's made (it isn't stored).
 */
export function CalendarLink({ hasLink, createdLabel, canChooseAll }: { hasLink: boolean; createdLabel: string | null; canChooseAll: boolean }) {
  const t = useTranslations("calendar.link");
  const [url, setUrl] = useState<string | null>(null);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [busy, start] = useTransition();
  const make = () =>
    start(async () => {
      setError(false);
      setCopied(false);
      const r = await newCalendarLink(scope).catch(() => ({ ok: false as const }));
      if (r.ok) setUrl(r.url);
      else setError(true);
    });
  const webcal = url?.replace(/^https?:/, "webcal:");
  const enc = (s: string) => encodeURIComponent(s);
  return (
    <section aria-labelledby="cal-link" className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 id="cal-link" className="flex items-center gap-2 text-lg font-bold">
        <CalendarPlus aria-hidden className="size-6 text-brand-700" />
        {t("title")}
      </h2>
      <p className="text-base text-neutral-700">{t("intro")}</p>
      {canChooseAll && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-semibold">{t("scope")}</legend>
          {(["mine", "all"] as const).map((s) => (
            <label key={s} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="cal-scope" checked={scope === s} onChange={() => setScope(s)} className="size-5 accent-brand-700" />
              {t(`scopes.${s}`)}
            </label>
          ))}
        </fieldset>
      )}
      {!url && (
        <>
          {hasLink && createdLabel && <p className="text-sm text-neutral-700">{t("active", { when: createdLabel })}</p>}
          <button type="button" disabled={busy} onClick={make} className={buttonClasses(hasLink ? "secondary" : "primary", "md")}>
            {hasLink ? <RefreshCw aria-hidden className="size-5" /> : <CalendarPlus aria-hidden className="size-5" />}
            {busy ? t("making") : hasLink ? t("makeNew") : t("make")}
          </button>
          {hasLink && <p className="text-sm text-neutral-600">{t("makeNewHelp")}</p>}
        </>
      )}
      {error && <p role="alert" className="text-red-900">{t("failed")}</p>}
      {url && webcal && (
        <div className="space-y-3 rounded-xl border-2 border-brand-600 bg-brand-50 p-3">
          <p className="font-semibold">{t("ready")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <a href={webcal} className={buttonClasses("primary", "md")}>
              {t("apple")}
            </a>
            <a href={`https://calendar.google.com/calendar/r?cid=${enc(webcal)}`} target="_blank" rel="noreferrer" className={buttonClasses("secondary", "md")}>
              {t("google")}
            </a>
            <a href={`https://outlook.office.com/calendar/0/addfromweb?url=${enc(url)}&name=${enc("Petra Field Ops")}`} target="_blank" rel="noreferrer" className={buttonClasses("secondary", "md")}>
              {t("outlookWork")}
            </a>
            <a href={`https://outlook.live.com/calendar/0/addfromweb?url=${enc(url)}&name=${enc("Petra Field Ops")}`} target="_blank" rel="noreferrer" className={buttonClasses("secondary", "md")}>
              {t("outlookPersonal")}
            </a>
          </div>
          <label className="block space-y-1">
            <span className="block text-sm font-semibold">{t("orCopy")}</span>
            <input readOnly value={url} onFocus={(e) => e.target.select()} className="block min-h-11 w-full rounded-lg border-2 border-neutral-300 bg-white px-3 text-sm" />
          </label>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            }}
            className={buttonClasses("secondary", "md")}
          >
            <Copy aria-hidden className="size-5" />
            {copied ? t("copied") : t("copy")}
          </button>
          <p className="text-sm text-neutral-700">{t("private")}</p>
          <p className="text-sm text-neutral-700">{t("refresh")}</p>
        </div>
      )}
      {(hasLink || url) && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              await revokeCalendarLink();
              setUrl(null);
            })
          }
          className={buttonClasses("ghost", "md")}
        >
          <Link2Off aria-hidden className="size-5" />
          {t("turnOff")}
        </button>
      )}
    </section>
  );
}
