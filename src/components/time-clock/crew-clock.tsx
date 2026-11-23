"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Coffee, LogIn, LogOut, MapPin, Repeat, UserPlus } from "lucide-react";
import { Segmented } from "@/components/calculators/segmented";
import { buttonClasses } from "@/components/ui/button-styles";
import { hoursMinutes, TIME_CATEGORIES, type TimeCategory } from "@/domain/time/totals";
import { submitPress, type ClockPayload } from "@/lib/offline/outbox";
import type { ClockJob, ClockSettings, CrewPerson, CrewStatus } from "@/lib/time/my-time";
import { readGps } from "./gps";

type Action = ClockPayload["action"];
type Outcome = { name: string; ok: boolean; error?: string };

/**
 * Crew clock-in. The lead picks the job and who is here, then clocks them all
 * in, switches them, starts or ends lunch, or clocks them out in one press.
 * Each person's record shows the lead did it; GPS comes from the lead's phone.
 */
export function CrewClock({
  me,
  jobs,
  settings,
  people,
  crews,
  status,
  serverNow,
}: {
  me: string;
  jobs: ClockJob[];
  settings: ClockSettings;
  people: CrewPerson[];
  crews: Record<string, string[]>;
  status: CrewStatus[];
  serverNow: number;
}) {
  const t = useTranslations("timeClock");
  const tc = useTranslations("timeClock.crew");
  const locale = useLocale();
  const tz = settings.timezone;
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const statusOf = useMemo(() => new Map(status.map((s) => [s.employeeId, s])), [status]);
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const mine = statusOf.get(me);
  const firstJob = mine?.projectId ?? jobs.find((j) => crews[j.id]?.includes(me))?.id ?? jobs[0]?.id ?? "";
  const [projectId, setProjectId] = useState(firstJob);
  const crewFor = (job: string) => [me, ...(crews[job] ?? []).filter((id) => id !== me && nameOf.has(id))];
  // People shown in the list (the job's crew plus anyone added), and who is ticked.
  const [listed, setListed] = useState<string[]>(() => crewFor(firstJob));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(crewFor(firstJob)));
  const [category, setCategory] = useState<TimeCategory>(mine?.category ?? "job");
  const [adding, setAdding] = useState("");
  const [busy, startTransition] = useTransition();
  const [confirmOut, setConfirmOut] = useState(false);
  const [outcome, setOutcome] = useState<{ action: Action; time: string; rows: Outcome[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const time = (ms: number) => new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(ms);
  const duration = (ms: number) => {
    const { h, m } = hoursMinutes(Math.max(0, ms));
    return h > 0 ? t("hoursMinutes", { h, m }) : t("minutes", { m });
  };
  const jobName = (id: string | null) => (id ? (jobs.find((j) => j.id === id)?.name ?? t("unknownJob")) : null);

  const chooseJob = (job: string) => {
    setProjectId(job);
    const crew = crewFor(job);
    setListed((l) => [...crew, ...l.filter((id) => !crew.includes(id) && selected.has(id))]);
    setSelected(new Set(crew));
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const addPerson = (id: string) => {
    if (!id) return;
    setListed((l) => (l.includes(id) ? l : [...l, id]));
    setSelected((s) => new Set(s).add(id));
    setAdding("");
  };
  const others = people.filter((p) => !listed.includes(p.id));
  const chosen = listed.filter((id) => selected.has(id));

  const press = (action: Action) => {
    setConfirmOut(false);
    if (chosen.length === 0) return;
    const deviceTs = new Date().toISOString();
    const id = crypto.randomUUID();
    const sendsCategory = action === "clock_in" || action === "switch";
    const needsGps = action === "clock_in" || action === "clock_out" || settings.gpsOnSwitch;
    startTransition(async () => {
      setError(null);
      setOutcome(null);
      const gps: ClockPayload["gps"] = needsGps ? await readGps() : { status: "not_requested" };
      const item = await submitPress(me, {
        id,
        action,
        category: sendsCategory ? category : null,
        projectId: sendsCategory && projectId ? projectId : null,
        deviceTs,
        gps,
        employeeIds: chosen,
      });
      if (item.state === "pending" || item.state === "sending") return setError(t("savedOnPhone", { time: time(Date.parse(deviceTs)) }));
      if (item.state === "failed" && !item.results) return setError(t(`errors.${(item.error ?? "generic") as "generic"}`));
      setOutcome({
        action,
        time: time(Date.parse(deviceTs)),
        rows: (item.results ?? []).map((x) => ({ name: nameOf.get(x.employeeId) ?? "?", ok: x.ok, error: x.error })),
      });
      router.refresh();
    });
  };

  const statusLine = (id: string) => {
    const s = statusOf.get(id);
    if (!s) return t("notClockedIn");
    const what = s.kind === "lunch" ? t("onLunch") : t("onTheClock", { category: t(`categories.${s.category ?? "job"}`) });
    const job = s.kind === "work" ? jobName(s.projectId) : null;
    return `${what}${job ? ` · ${job}` : ""} · ${t("since", { time: time(s.start), duration: duration(now - s.start) })}`;
  };

  return (
    <div className="space-y-4">
      <p className="text-base text-neutral-700">{tc("intro")}</p>

      <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="space-y-1">
          <label htmlFor="crew-job" className="block text-sm font-semibold text-neutral-800">
            {t("job")}
          </label>
          <select
            id="crew-job"
            value={projectId}
            onChange={(e) => chooseJob(e.target.value)}
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

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-neutral-800">{tc("who", { count: chosen.length })}</legend>
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200">
            {listed.map((id) => (
              <li key={id}>
                <label className="flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2">
                  <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} className="size-6 shrink-0 accent-brand-700" />
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {nameOf.get(id)}
                      {id === me && <span className="font-normal text-neutral-600"> ({tc("you")})</span>}
                    </span>
                    <span className="block text-sm text-neutral-600">{statusLine(id)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {others.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <label htmlFor="crew-add" className="block text-xs font-semibold uppercase tracking-wide text-neutral-600">
                  {tc("addSomeone")}
                </label>
                <select
                  id="crew-add"
                  value={adding}
                  onChange={(e) => setAdding(e.target.value)}
                  className="block min-h-11 w-full rounded-lg border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
                >
                  <option value="">{tc("choosePerson")}</option>
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" disabled={!adding} onClick={() => addPerson(adding)} className={buttonClasses("secondary", "md")}>
                <UserPlus aria-hidden className="size-5" />
                {tc("add")}
              </button>
            </div>
          )}
        </fieldset>

        <Segmented label={t("whatDoing")} value={category} onChange={setCategory} options={TIME_CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))} />

        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" disabled={busy || chosen.length === 0} onClick={() => press("clock_in")} className={`${buttonClasses("primary", "lg")} w-full`}>
            <LogIn aria-hidden className="size-6" />
            {tc("clockIn", { count: chosen.length })}
          </button>
          <button type="button" disabled={busy || chosen.length === 0} onClick={() => press("switch")} className={`${buttonClasses("secondary", "lg")} w-full`}>
            <Repeat aria-hidden className="size-6" />
            {t("switchButton", { category: t(`categories.${category}`) })}
          </button>
          <button type="button" disabled={busy || chosen.length === 0} onClick={() => press("break_start")} className={`${buttonClasses("secondary", "lg")} w-full`}>
            <Coffee aria-hidden className="size-6" />
            {t("startLunch")}
          </button>
          <button type="button" disabled={busy || chosen.length === 0} onClick={() => press("break_end")} className={`${buttonClasses("secondary", "lg")} w-full`}>
            <Coffee aria-hidden className="size-6" />
            {tc("endLunch")}
          </button>
          <button type="button" disabled={busy || chosen.length === 0} onClick={() => setConfirmOut(true)} className={`${buttonClasses("secondary", "lg")} w-full sm:col-span-2`}>
            <LogOut aria-hidden className="size-6" />
            {tc("clockOut", { count: chosen.length })}
          </button>
        </div>
        {confirmOut && (
          <div role="alertdialog" aria-labelledby="crew-confirm" className="space-y-2 rounded-xl border-2 border-red-700 bg-red-50 p-3">
            <p id="crew-confirm" className="text-base font-semibold text-red-950">
              {tc("confirmClockOut", { names: chosen.map((id) => nameOf.get(id)).join(", ") })}
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
        {busy && <p className="text-base text-neutral-700">{t("working")}</p>}
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-red-900">
            {error}
          </p>
        )}
        {outcome && (
          <div role="status" className="space-y-1 rounded-xl bg-neutral-50 px-4 py-3">
            <p className="font-semibold">{tc(`done.${outcome.action}`, { time: outcome.time })}</p>
            <ul className="space-y-1">
              {outcome.rows.map((r) => (
                <li key={r.name} className={r.ok ? "text-green-900" : "text-red-900"}>
                  {r.ok ? `✓ ${r.name}` : `✗ ${r.name}: ${t(`errors.${(r.error ?? "generic") as "generic"}`)}`}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="flex gap-2 text-sm text-neutral-700">
          <MapPin aria-hidden className="size-5 shrink-0" />
          {tc("gpsExplain")}
        </p>
      </div>

      <p className="rounded-xl border-l-4 border-accent-600 bg-amber-50 px-4 py-3 text-base text-amber-950">{t("travelReminder")}</p>
    </div>
  );
}
