import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { WeekList } from "@/components/time-clock/week-list";
import { requireManagePath } from "@/lib/auth/dal";
import { hoursMinutes, MISSING_CLOCK_OUT_MS } from "@/domain/time/totals";
import { createClient } from "@/lib/supabase/server";
import { clockSettings, serverNow } from "@/lib/time/my-time";
import { loadWeekRows, weekParam } from "@/lib/time/timesheet";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("manage.nav");
  return { title: t("time") };
}

/** Office: who is on the clock now, forgotten clock-outs, and every timesheet for the week. */
export default async function ManageTimePage({ searchParams }: PageProps<"/manage/time">) {
  await requireManagePath("/manage/time");
  const sp = await searchParams;
  const t = await getTranslations();
  const locale = await getLocale();
  const settings = await clockSettings();
  const now = serverNow();
  const supabase = await createClient();
  const { data: open } = await supabase
    .from("time_segments")
    .select("id, employee_id, kind, category, start_at, projects(name)")
    .eq("status", "active")
    .is("end_at", null)
    .order("start_at");
  const { data: dir } = await supabase.from("employee_directory").select("id, display_name");
  const names = new Map((dir ?? []).map((d) => [d.id as string, d.display_name as string]));
  const { rows, weekStart, weekEnd } = await loadWeekRows(weekParam(sp.week, settings.timezone), settings);
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat(locale, { timeZone: settings.timezone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(ms);
  const duration = (ms: number) => {
    const { h, m } = hoursMinutes(Math.max(0, ms));
    return h > 0 ? t("timeClock.hoursMinutes", { h, m }) : t("timeClock.minutes", { m });
  };
  const onClock = (open ?? []) as unknown as { id: string; employee_id: string; kind: "work" | "lunch"; category: string | null; start_at: string; projects: { name: string } | null }[];

  return (
    <>
      <PageHeader title={t("manage.nav.time")} />
      <section aria-labelledby="on-clock" className="mb-6 space-y-2">
        <h2 id="on-clock" className="text-lg font-bold">
          {t("timeClock.office.onClock", { count: onClock.length })}
        </h2>
        {onClock.length === 0 ? (
          <p className="text-base text-neutral-600">{t("timeClock.office.nobodyOn")}</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-2xl border border-neutral-200 bg-white shadow-sm">
            {onClock.map((s) => {
              const start = Date.parse(s.start_at);
              const forgot = now - start > MISSING_CLOCK_OUT_MS;
              return (
                <li key={s.id} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${forgot ? "bg-red-50" : ""}`}>
                  <Link href={`/manage/time/${s.employee_id}`} className="font-semibold text-brand-700 underline">
                    {names.get(s.employee_id) ?? "?"}
                  </Link>
                  <span className="text-sm">
                    {s.kind === "lunch" ? t("timeClock.lunch") : t(`timeClock.categories.${(s.category ?? "job") as "job"}`)}
                    {s.projects?.name && ` · ${s.projects.name}`} · {t("timeClock.since", { time: fmt(start), duration: duration(now - start) })}
                  </span>
                  {forgot && (
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-red-900">
                      <TriangleAlert aria-hidden className="size-4" />
                      {t("timeClock.office.forgot")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section aria-labelledby="week" className="space-y-2">
        <h2 id="week" className="text-lg font-bold">
          {t("timeClock.office.timesheets")}
        </h2>
        <WeekList
          rows={rows}
          weekStart={weekStart}
          weekEnd={weekEnd}
          tz={settings.timezone}
          now={now}
          personHref={(id, week) => `/manage/time/${id}?week=${week}`}
          weekHref={(week) => `/manage/time?week=${week}`}
        />
      </section>
    </>
  );
}
