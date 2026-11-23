import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, MapPin, PartyPopper } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button-styles";
import { CalendarLink } from "@/components/calendar/calendar-link";
import { HolidayForm } from "@/components/calendar/holiday-form";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { deleteHoliday } from "@/lib/actions/calendar";
import { addDays, isoDow, localDate } from "@/domain/time/zoned";
import { clockSettings, serverNow } from "@/lib/time/my-time";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home.modules");
  return { title: t("calendar") };
}

type View = "month" | "week" | "day";
type Event = { kind: "job" | "holiday"; day: string; title: string | null; start_text: string | null; project_id: string | null; project_name: string | null; address: string | null };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const monday = (d: string) => addDays(d, -(isoDow(d) - 1));

/** Calendar: my job days (from work order schedules) and company holidays, by month, week or day. */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
  const settings = await clockSettings();
  const today = localDate(serverNow(), settings.timezone);
  const view: View = sp.view === "week" || sp.view === "day" ? sp.view : "month";
  const date = typeof sp.date === "string" && DATE.test(sp.date) ? sp.date : today;

  let from: string;
  let to: string;
  let prev: string;
  let next: string;
  if (view === "month") {
    const first = `${date.slice(0, 7)}-01`;
    const nextMonth = addDays(first, 32).slice(0, 7) + "-01";
    from = monday(first);
    to = addDays(monday(addDays(nextMonth, -1)), 6);
    prev = addDays(first, -1).slice(0, 7) + "-01";
    next = nextMonth;
  } else if (view === "week") {
    from = monday(date);
    to = addDays(from, 6);
    prev = addDays(from, -7);
    next = addDays(from, 7);
  } else {
    from = to = date;
    prev = addDays(date, -1);
    next = addDays(date, 1);
  }

  const supabase = await createClient();
  const [{ data }, { data: feed }] = await Promise.all([
    supabase.rpc("my_calendar", { p_from: from, p_to: to }),
    supabase.from("calendar_feeds").select("created_at").eq("employee_id", profile.employeeId).maybeSingle(),
  ]);
  const events = (data ?? []) as Event[];
  const byDay = new Map<string, Event[]>();
  for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);

  const d = (s: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...o, timeZone: "UTC" }).format(new Date(`${s}T12:00:00Z`));
  const title =
    view === "month"
      ? d(date, { month: "long", year: "numeric" })
      : view === "week"
        ? `${d(from, { month: "short", day: "numeric" })} – ${d(to, { month: "short", day: "numeric", year: "numeric" })}`
        : d(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const href = (v: View, at: string) => `/calendar?view=${v}&date=${at}`;
  const admin = profile.role === "office_admin";
  const label = (e: Event) =>
    e.kind === "holiday" ? t("calendar.holiday", { name: e.title ?? "" }) : [e.project_name, e.title, e.start_text ? t("calendar.start", { time: e.start_text }) : null].filter(Boolean).join(" · ");

  const eventList = (list: Event[]) => (
    <ul className="space-y-2">
      {list.map((e, i) => (
        <li key={i} className={`rounded-xl border-l-4 px-3 py-2 ${e.kind === "holiday" ? "border-accent-600 bg-amber-50" : "border-brand-600 bg-brand-50"}`}>
          {e.kind === "job" && e.project_id ? (
            <Link href={`/jobs/${e.project_id}`} className="font-semibold text-brand-800 underline">
              {label(e)}
            </Link>
          ) : (
            <span className="flex items-center gap-2 font-semibold">
              <PartyPopper aria-hidden className="size-5" />
              {label(e)}
            </span>
          )}
          {e.address && (
            <a href={`https://maps.google.com/?q=${encodeURIComponent(e.address)}`} className="mt-1 flex items-center gap-1 text-sm text-neutral-700 underline">
              <MapPin aria-hidden className="size-4" />
              {e.address}
            </a>
          )}
          {e.kind === "holiday" && admin && (
            <form action={deleteHoliday} className="mt-1">
              <input type="hidden" name="date" value={e.day} />
              <button type="submit" className="text-sm font-semibold text-red-800 underline">
                {t("calendar.holidays.remove")}
              </button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader title={t("home.modules.calendar")} backHref="/" backLabel={t("common.home")} />
      <div className="space-y-4">
        <div role="group" aria-label={t("calendar.viewLabel")} className="flex rounded-xl border-2 border-neutral-300 bg-neutral-100 p-1">
          {(["month", "week", "day"] as const).map((v) => (
            <Link
              key={v}
              href={href(v, date)}
              aria-current={v === view ? "page" : undefined}
              className={`flex min-h-11 flex-1 items-center justify-center rounded-lg font-semibold ${v === view ? "bg-brand-700 text-white" : "text-neutral-800"}`}
            >
              {t(`calendar.views.${v}`)}
            </Link>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Link href={href(view, prev)} className={buttonClasses("ghost", "md")} aria-label={t("calendar.prev")}>
            <ChevronLeft aria-hidden className="size-6" />
          </Link>
          <div className="text-center">
            <h2 className="text-lg font-bold">{title}</h2>
            {date !== today && (
              <Link href={href(view, today)} className="text-sm font-semibold text-brand-700 underline">
                {t("calendar.today")}
              </Link>
            )}
          </div>
          <Link href={href(view, next)} className={buttonClasses("ghost", "md")} aria-label={t("calendar.next")}>
            <ChevronRight aria-hidden className="size-6" />
          </Link>
        </div>

        {view === "month" && (
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="grid grid-cols-7 border-b border-neutral-200 bg-neutral-50 text-center text-xs font-semibold uppercase text-neutral-600">
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="py-1">
                  {d(addDays("2026-11-23", i), { weekday: "short" })}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 }, (_, i) => addDays(from, i)).map((day) => {
                const list = byDay.get(day) ?? [];
                const inMonth = day.slice(0, 7) === date.slice(0, 7);
                return (
                  <Link
                    key={day}
                    href={href("day", day)}
                    aria-label={`${d(day, { weekday: "long", month: "long", day: "numeric" })}${list.length ? `, ${t("calendar.count", { count: list.length })}` : ""}`}
                    className={`min-h-16 border-b border-r border-neutral-100 p-1 text-left align-top sm:min-h-24 ${inMonth ? "" : "bg-neutral-50 text-neutral-400"}`}
                  >
                    <span className={`inline-flex size-6 items-center justify-center rounded-full text-sm font-semibold ${day === today ? "bg-brand-700 text-white" : ""}`}>{Number(day.slice(8))}</span>
                    <span className="mt-0.5 block space-y-0.5">
                      {list.slice(0, 2).map((e, i) => (
                        <span key={i} className={`block truncate rounded px-1 text-[11px] leading-4 ${e.kind === "holiday" ? "bg-amber-100 text-amber-950" : "bg-brand-100 text-brand-900"}`}>
                          {e.kind === "holiday" ? e.title : e.project_name}
                        </span>
                      ))}
                      {list.length > 2 && <span className="block text-[11px] text-neutral-600">+{list.length - 2}</span>}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {view !== "month" && (
          <div className="space-y-3">
            {Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => addDays(from, i)).map((day) => (
              <section key={day} aria-label={d(day, { weekday: "long", month: "long", day: "numeric" })} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                <h3 className={`mb-2 font-bold ${day === today ? "text-brand-700" : ""}`}>
                  {d(day, { weekday: "long", month: "short", day: "numeric" })}
                  {day === today && ` · ${t("calendar.today")}`}
                </h3>
                {(byDay.get(day) ?? []).length === 0 ? <p className="text-neutral-600">{t("calendar.nothing")}</p> : eventList(byDay.get(day)!)}
              </section>
            ))}
          </div>
        )}
        {view === "month" && events.length === 0 && <p className="text-neutral-600">{t("calendar.nothingMonth")}</p>}
        <p className="text-sm text-neutral-600">{t("calendar.where")}</p>

        <CalendarLink
          hasLink={Boolean(feed)}
          createdLabel={feed ? format.dateTime(new Date(feed.created_at as string), { dateStyle: "medium" }) : null}
          canChooseAll={profile.role === "project_manager" || profile.role === "office_admin"}
        />

        {admin && (
          <section aria-labelledby="holidays" className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 id="holidays" className="text-lg font-bold">
              {t("calendar.holidays.title")}
            </h2>
            <p className="text-sm text-neutral-700">{t("calendar.holidays.help")}</p>
            <HolidayForm />
          </section>
        )}
      </div>
    </>
  );
}
