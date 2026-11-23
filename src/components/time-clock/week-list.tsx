import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, MessageSquare, TriangleAlert } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { dailyTotals, hoursMinutes, segmentFlags } from "@/domain/time/totals";
import { addDays, localDate } from "@/domain/time/zoned";
import type { WeekRow } from "@/lib/time/timesheet";

/** A week's timesheets, one row per person: hours, flags, open requests and status. */
export async function WeekList({
  rows,
  weekStart,
  weekEnd,
  tz,
  now,
  personHref,
  weekHref,
}: {
  rows: WeekRow[];
  weekStart: number;
  weekEnd: number;
  tz: string;
  now: number;
  personHref: (employeeId: string, week: string) => string;
  weekHref: (week: string) => string;
}) {
  const t = await getTranslations("timeClock");
  const locale = await getLocale();
  const fmt = (ms: number) => new Intl.DateTimeFormat(locale, { timeZone: tz, month: "short", day: "numeric" }).format(ms);
  const week = localDate(weekStart, tz);
  const duration = (ms: number) => {
    const { h, m } = hoursMinutes(ms);
    return h > 0 ? t("hoursMinutes", { h, m }) : t("minutes", { m });
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Link href={weekHref(addDays(week, -7))} className={buttonClasses("ghost", "md")} aria-label={t("sheet.prevWeek")}>
          <ChevronLeft aria-hidden className="size-6" />
        </Link>
        <p className="text-base font-semibold">{t("sheet.weekOf", { range: `${fmt(weekStart)} – ${fmt(weekEnd - 1)}` })}</p>
        <Link href={weekHref(addDays(week, 7))} className={buttonClasses("ghost", "md")} aria-label={t("sheet.nextWeek")}>
          <ChevronRight aria-hidden className="size-6" />
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white p-4 text-base text-neutral-600">{t("sheet.nobody")}</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-2xl border border-neutral-200 bg-white shadow-sm">
          {rows.map((r) => {
            const total = dailyTotals(r.segments, now, tz, weekStart, weekEnd).reduce((s, d) => s + d.ms.total, 0);
            const flags = r.segments.reduce((n, s) => n + segmentFlags(s, now).length, 0);
            return (
              <li key={r.employeeId}>
                <Link href={personHref(r.employeeId, week)} className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 hover:bg-neutral-50">
                  <span className="font-semibold">{r.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    {flags > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-950">
                        <TriangleAlert aria-hidden className="size-4" />
                        {t("sheet.flagCount", { count: flags })}
                      </span>
                    )}
                    {r.openRequests > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 font-semibold text-brand-900">
                        <MessageSquare aria-hidden className="size-4" />
                        {t("sheet.requestCount", { count: r.openRequests })}
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${r.status === "approved" ? "bg-green-100 text-green-900" : r.status === "submitted" ? "bg-brand-100 text-brand-900" : "bg-neutral-100 text-neutral-800"}`}>
                      {t(`sheet.status.${r.status}`)}
                    </span>
                    <span className="text-base font-semibold tabular-nums">{duration(total)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
