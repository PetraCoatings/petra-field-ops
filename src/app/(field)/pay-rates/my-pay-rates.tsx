"use client";
import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Eye, EyeOff, Lock } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { revealMyRates, type MyRates } from "@/lib/actions/pay-rates";
import { TIME_CATEGORIES } from "@/domain/time/totals";
import { localDate } from "@/domain/time/zoned";

const SHOW_SECONDS = 30;

export function MyPayRates({ tz }: { tz: string }) {
  const t = useTranslations("payRates");
  const tc = useTranslations("timeClock");
  const locale = useLocale();
  const [password, setPassword] = useState("");
  const [rates, setRates] = useState<MyRates | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // Hide after 30 seconds, or as soon as the app goes to the background.
  useEffect(() => {
    if (!rates) return;
    const hide = () => setRates(null);
    const id = setInterval(() => setLeft((s) => (s <= 1 ? (hide(), 0) : s - 1)), 1000);
    const onHidden = () => document.visibilityState === "hidden" && hide();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", hide);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", hide);
    };
  }, [rates]);

  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(n);
  const date = (d: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium" }).format(new Date(`${d}T12:00:00Z`));
  const [today, setToday] = useState("");

  if (rates) {
    const current = TIME_CATEGORIES.map((c) => ({ c, r: [...rates].reverse().find((x) => x.category === c && x.effectiveFrom <= today) }));
    const upcoming = rates.filter((r) => r.effectiveFrom > today);
    return (
      <div className="space-y-4">
        <section aria-label={t("current")} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <dl className="grid grid-cols-3 gap-2 text-center">
            {current.map(({ c, r }) => (
              <div key={c} className="rounded-xl bg-neutral-100 p-3">
                <dt className="text-sm font-semibold text-neutral-700">{tc(`categories.${c}`)}</dt>
                <dd className="text-xl font-bold tabular-nums">{r ? money(r.rate) : "—"}</dd>
                <dd className="text-xs text-neutral-600">{t("perHour")}</dd>
              </div>
            ))}
          </dl>
          {upcoming.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {upcoming.map((r) => (
                <li key={`${r.category}${r.effectiveFrom}`}>{t("upcoming", { category: tc(`categories.${r.category}`), rate: money(r.rate), date: date(r.effectiveFrom) })}</li>
              ))}
            </ul>
          )}
        </section>
        <div className="flex items-center justify-between gap-2">
          <p role="timer" className="text-sm text-neutral-700">{t("hidingIn", { seconds: left })}</p>
          <button type="button" onClick={() => setRates(null)} className={buttonClasses("secondary", "md")}>
            <EyeOff aria-hidden className="size-5" />
            {t("hide")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await revealMyRates(password).catch(() => ({ ok: false as const, error: "generic" as const }));
          setPassword("");
          if (!r.ok) return setError(t(`errors.${r.error}`));
          setLeft(SHOW_SECONDS);
          setToday(localDate(Date.now(), tz));
          setRates(r.rates);
        });
      }}
      className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
    >
      <p className="flex gap-2 text-base text-neutral-800">
        <Lock aria-hidden className="size-6 shrink-0 text-brand-700" />
        {t("privacy")}
      </p>
      <label className="block space-y-1">
        <span className="block text-sm font-semibold">{t("password")}</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 px-3 text-base" />
      </label>
      {error && <p role="alert" className="text-base font-medium text-red-900">{error}</p>}
      <button type="submit" disabled={busy || !password} className={`${buttonClasses("primary", "lg")} w-full`}>
        <Eye aria-hidden className="size-6" />
        {busy ? t("checking") : t("show")}
      </button>
    </form>
  );
}
