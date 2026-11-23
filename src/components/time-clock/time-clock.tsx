"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Car, Clock, Coffee, HardHat, LogIn, LogOut, MapPin, Repeat, TriangleAlert, Users } from "lucide-react";
import { Segmented } from "@/components/calculators/segmented";
import { buttonClasses } from "@/components/ui/button-styles";
import { dailyTotals, hoursMinutes, isPaidLunch, segmentFlags, weekTotals, TIME_CATEGORIES, type TimeCategory } from "@/domain/time/totals";
import { localDate, startOfLocalDate, addDays } from "@/domain/time/zoned";
import { outboxItems, predictOpen, submitPress, subscribeOutbox, type ClockPayload, type OutboxItem } from "@/lib/offline/outbox";
import type { ClockJob, ClockSegment, ClockSettings } from "@/lib/time/my-time";
import { readGps } from "./gps";

type Action = ClockPayload["action"];
const ICONS: Record<TimeCategory, typeof HardHat> = { job: HardHat, drive: Car, ride: Users };

export function TimeClock({
  segments,
  jobs,
  settings,
  serverNow,
  me,
}: {
  segments: ClockSegment[];
  jobs: ClockJob[];
  settings: ClockSettings;
  serverNow: number;
  me: string;
}) {
  const t = useTranslations("timeClock");
  const locale = useLocale();
  const tz = settings.timezone;
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const router = useRouter();
  // Presses saved on this phone that the server hasn't confirmed yet.
  const outbox = useSyncExternalStore(subscribeOutbox, outboxSnapshot, emptySnapshot);
  const waiting = parseSnapshot(outbox).filter(
    (i): i is Extract<OutboxItem, { kind: "clock" }> => i.kind === "clock" && i.owner === me && (i.state === "pending" || i.state === "sending"),
  );
  const serverOpen = segments.find((s) => s.end === null) ?? null;
  const predicted = predictOpen(serverOpen ? { kind: serverOpen.kind, category: serverOpen.category, projectId: serverOpen.projectId, start: serverOpen.start } : null, waiting.map((i) => i.payload));
  const open = waiting.length ? (predicted ? { ...predicted, id: "pending", end: null } : null) : serverOpen;
  const [category, setCategory] = useState<TimeCategory>(open?.category ?? "job");
  const [projectId, setProjectId] = useState<string>(open?.projectId ?? (jobs.length === 1 ? jobs[0].id : ""));
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "saved"; text: string } | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  // A press that didn't reach the server keeps its id and time, so trying
  // again can never record it twice.

  const time = (ms: number) => new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(ms);
  const dayName = (date: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(startOfLocalDate(date, tz) + 12 * 3_600_000);
  const duration = (ms: number) => {
    // A phone clock a few seconds behind the server mustn't show "-1 min".
    const { h, m } = hoursMinutes(Math.max(0, ms));
    return h > 0 ? t("hoursMinutes", { h, m }) : t("minutes", { m });
  };
  const catLabel = (c: TimeCategory | null) => t(`categories.${c ?? "job"}`);
  const jobName = (id: string | null) => (id ? (jobs.find((j) => j.id === id)?.name ?? segments.find((s) => s.projectId === id)?.projectName ?? t("unknownJob")) : null);

  const press = (action: Action) => {
    setConfirmOut(false);
    const deviceTs = new Date().toISOString();
    const id = crypto.randomUUID();
    const sendsCategory = action === "clock_in" || action === "switch";
    const needsGps = action === "clock_in" || action === "clock_out" || settings.gpsOnSwitch;
    startTransition(async () => {
      setMessage(null);
      const gps: ClockPayload["gps"] = needsGps ? await readGps() : { status: "not_requested" };
      const item = await submitPress(me, {
        id,
        action,
        category: sendsCategory ? category : null,
        projectId: sendsCategory && projectId ? projectId : null,
        deviceTs,
        gps,
      });
      const at = time(Date.parse(deviceTs));
      if (item.state === "pending" || item.state === "sending") {
        setMessage({ kind: "saved", text: t("savedOnPhone", { time: at }) });
        return;
      }
      if (item.state === "failed") {
        setMessage({ kind: "error", text: t(`errors.${(item.error ?? "generic") as "generic"}`) });
        return;
      }
      const gpsNote = gps.status !== "captured" && gps.status !== "not_requested" ? ` ${t(`gpsNote.${gps.status}`)}` : "";
      setMessage({ kind: "ok", text: t(`done.${action}`, { time: at, category: catLabel(category) }) + gpsNote });
      router.refresh();
    });
  };

  // ---- Today and this week
  const today = localDate(now, tz);
  const todayStart = startOfLocalDate(today, tz);
  const todaySegments = segments.filter((s) => (s.end ?? now) > todayStart);
  const [todayTotals] = dailyTotals(segments, now, tz, todayStart, startOfLocalDate(addDays(today, 1), tz));
  const week = weekTotals(segments, now, tz, now, settings.workweek);
  const forgot = open && segmentFlags(open, now).includes("missing_clock_out");
  const changed = open?.kind === "work" && (category !== open.category || (projectId || null) !== open.projectId);

  const StatusIcon = open ? (open.kind === "lunch" ? Coffee : ICONS[open.category ?? "job"]) : Clock;

  return (
    <div className="space-y-4">
      <section aria-labelledby="tc-status" aria-live="polite" className="rounded-2xl border-2 border-brand-700 bg-brand-800 p-4 text-white shadow-lg">
        <h2 id="tc-status" className="text-sm font-semibold uppercase tracking-wide text-brand-100">
          {t("status")}
        </h2>
        <p className="flex items-center gap-2 text-3xl font-bold">
          <StatusIcon aria-hidden className="size-8 shrink-0" />
          {!open ? t("notClockedIn") : open.kind === "lunch" ? t("onLunch") : t("onTheClock", { category: catLabel(open.category) })}
        </p>
        {open && (
          <>
            {open.kind === "work" && jobName(open.projectId) && <p className="text-lg font-semibold">{jobName(open.projectId)}</p>}
            <p className="text-base text-brand-100 tabular-nums">{t("since", { time: time(open.start), duration: duration(now - open.start) })}</p>
          </>
        )}
      </section>

      {waiting.length > 0 && (
        <div role="status" className="space-y-1 rounded-xl border-2 border-dashed border-neutral-400 bg-neutral-50 px-4 py-3">
          <p className="font-semibold">{t("waitingTitle", { count: waiting.length })}</p>
          <ul className="text-sm">
            {waiting.map((i) => (
              <li key={i.id}>
                {time(Date.parse(i.payload.deviceTs))} · {t(`actions.${i.payload.action}`)}
                {i.payload.category ? ` (${catLabel(i.payload.category)})` : ""}
              </li>
            ))}
          </ul>
          <Link href="/sync" className="text-sm font-semibold text-brand-700 underline">
            {t("seeSync")}
          </Link>
        </div>
      )}

      {forgot && (
        <p role="alert" className="flex gap-2 rounded-xl border-l-4 border-red-700 bg-red-50 px-4 py-3 text-base font-medium text-red-950">
          <TriangleAlert aria-hidden className="size-6 shrink-0" />
          {t("forgotClockOut", { day: dayName(localDate(open!.start, tz)), time: time(open!.start) })}
        </p>
      )}

      <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        {open?.kind !== "lunch" && (
          <>
            <Segmented
              label={open ? t("switchTo") : t("whatDoing")}
              value={category}
              onChange={setCategory}
              options={TIME_CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))}
            />
            <div className="space-y-1">
              <label htmlFor="tc-job" className="block text-sm font-semibold text-neutral-800">
                {t("job")}
              </label>
              <select
                id="tc-job"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
              >
                <option value="">{t("noJob")}</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.jobNumber ? `${j.name} (#${j.jobNumber})` : j.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {!open && (
          <button type="button" disabled={busy} onClick={() => press("clock_in")} className={`${buttonClasses("primary", "lg")} w-full`}>
            <LogIn aria-hidden className="size-6" />
            {busy ? t("working") : t("clockIn")}
          </button>
        )}
        {open?.kind === "work" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={busy || !changed} onClick={() => press("switch")} className={`${buttonClasses("primary", "lg")} w-full sm:col-span-2`}>
              <Repeat aria-hidden className="size-6" />
              {t("switchButton", { category: catLabel(category) })}
            </button>
            <button type="button" disabled={busy} onClick={() => press("break_start")} className={`${buttonClasses("secondary", "lg")} w-full`}>
              <Coffee aria-hidden className="size-6" />
              {t("startLunch")}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirmOut(true)} className={`${buttonClasses("secondary", "lg")} w-full`}>
              <LogOut aria-hidden className="size-6" />
              {t("clockOut")}
            </button>
          </div>
        )}
        {open?.kind === "lunch" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={busy} onClick={() => press("break_end")} className={`${buttonClasses("primary", "lg")} w-full`}>
              <Coffee aria-hidden className="size-6" />
              {t("endLunch", { category: catLabel(open.category) })}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirmOut(true)} className={`${buttonClasses("secondary", "lg")} w-full`}>
              <LogOut aria-hidden className="size-6" />
              {t("clockOut")}
            </button>
          </div>
        )}
        {confirmOut && (
          <div role="alertdialog" aria-labelledby="tc-confirm" className="space-y-2 rounded-xl border-2 border-red-700 bg-red-50 p-3">
            <p id="tc-confirm" className="text-base font-semibold text-red-950">
              {t("confirmClockOut")}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => press("clock_out")} className={buttonClasses("danger", "md")}>
                <LogOut aria-hidden className="size-5" />
                {t("yesClockOut")}
              </button>
              <button type="button" onClick={() => setConfirmOut(false)} className={buttonClasses("ghost", "md")}>
                {t("cancel")}
              </button>
            </div>
          </div>
        )}
        {message && (
          <p role={message.kind === "error" ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-base font-medium ${message.kind === "error" ? "bg-red-50 text-red-900" : message.kind === "saved" ? "bg-neutral-100 text-neutral-900" : "bg-green-50 text-green-900"}`}>
            {message.text}
          </p>
        )}
        <p className="flex gap-2 text-sm text-neutral-700">
          <MapPin aria-hidden className="size-5 shrink-0" />
          {settings.gpsOnSwitch ? t("gpsExplainSwitch") : t("gpsExplain")}
        </p>
      </div>

      <p className="rounded-xl border-l-4 border-accent-600 bg-amber-50 px-4 py-3 text-base text-amber-950">{t("travelReminder")}</p>

      <section aria-labelledby="tc-today" className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="tc-today" className="text-lg font-bold">
            {t("today")}
          </h2>
          <p className="text-base font-semibold tabular-nums">{duration(todayTotals?.ms.total ?? 0)}</p>
        </div>
        {todaySegments.length === 0 ? (
          <p className="text-base text-neutral-600">{t("nothingToday")}</p>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {todaySegments.map((s) => {
              const end = s.end ?? now;
              const lunch = s.kind === "lunch";
              return (
                <li key={s.id} className={`flex flex-wrap items-baseline justify-between gap-x-3 py-2 ${lunch ? "text-neutral-600" : ""}`}>
                  <span className="tabular-nums">
                    {time(s.start)} – {s.end ? time(s.end) : t("now")}
                  </span>
                  <span className="min-w-0 flex-1 font-semibold">
                    {lunch ? t("lunch") : catLabel(s.category)}
                    {!lunch && jobName(s.projectId) && <span className="font-normal text-neutral-600"> · {jobName(s.projectId)}</span>}
                    {lunch && s.end && <span className="font-normal"> · {isPaidLunch(s) ? t("paidLunch") : t("unpaidLunch")}</span>}
                  </span>
                  <span className="tabular-nums">{duration(end - s.start)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="tc-week" className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="tc-week" className="text-lg font-bold">
            {t("thisWeek")}
          </h2>
          <p className="text-base font-semibold tabular-nums">{duration(week.ms.total)}</p>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {TIME_CATEGORIES.map((c) => (
            <div key={c} className="rounded-xl bg-neutral-100 p-2">
              <dt className="text-sm font-semibold text-neutral-700">{catLabel(c)}</dt>
              <dd className="text-base font-bold tabular-nums">{duration(week.ms[c])}</dd>
            </div>
          ))}
        </dl>
        {week.days.length > 0 && (
          <ul className="divide-y divide-neutral-200">
            {week.days.map((d) => (
              <li key={d.date} className="flex justify-between gap-2 py-2">
                <span>{dayName(d.date)}</span>
                <span className="tabular-nums">{duration(d.ms.total)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-neutral-600">{t("weekNote", { day: dayName(localDate(week.weekStart, tz)) })}</p>
      </section>
    </div>
  );
}

// useSyncExternalStore needs a stable value: the queue as a JSON string.
function outboxSnapshot(): string {
  return JSON.stringify(outboxItems());
}
function emptySnapshot(): string {
  return "[]";
}
function parseSnapshot(s: string): OutboxItem[] {
  try {
    return JSON.parse(s) as OutboxItem[];
  } catch {
    return [];
  }
}
