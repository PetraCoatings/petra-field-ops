"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, CircleCheck, Lock, MessageSquare, Pencil, Plus, Send, TriangleAlert, Undo2 } from "lucide-react";
import { Segmented } from "@/components/calculators/segmented";
import { buttonClasses } from "@/components/ui/button-styles";
import { dailyTotals, hoursMinutes, isPaidLunch, segmentFlags, TIME_CATEGORIES, type Segment, type TimeCategory } from "@/domain/time/totals";
import { addDays, localDate, localParts, startOfLocalDate } from "@/domain/time/zoned";
import { correctTime, requestTimeChange, resolveTimeChange, setWeekStatus, type SheetError } from "@/lib/actions/timesheets";
import type { ClockJob, ClockSettings } from "@/lib/time/my-time";
import type { Sheet, SheetSegment } from "@/lib/time/timesheet";

type Viewer = { id: string; role: "installer" | "crew_lead" | "project_manager" | "office_admin" };
type Draft = { segmentId: string | null; start: string; end: string; kind: "work" | "lunch"; category: TimeCategory; projectId: string; reason: string };

/**
 * One person's week. What the viewer can do mirrors the database rules (which
 * have the final say): fix own time within the self-edit window while the week
 * is open; a crew lead fixes and submits their crew's open weeks; an office
 * admin fixes until approved, approves, and reopens with a reason.
 */
export function Timesheet({
  sheet,
  jobs,
  settings,
  viewer,
  windowHours,
  serverNow,
  basePath,
}: {
  sheet: Sheet;
  jobs: ClockJob[];
  settings: ClockSettings;
  viewer: Viewer;
  windowHours: number;
  serverNow: number;
  basePath: string;
}) {
  const t = useTranslations("timeClock");
  const ts = useTranslations("timeClock.sheet");
  const locale = useLocale();
  const tz = settings.timezone;
  const now = serverNow;
  const self = viewer.id === sheet.employeeId;
  const admin = viewer.role === "office_admin";
  const lead = !self && (viewer.role === "crew_lead" || viewer.role === "project_manager");
  const st = sheet.status.status;
  const [busy, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null); // segment id or "" for the week
  const [askText, setAskText] = useState("");
  const [reopenText, setReopenText] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const time = (ms: number) => new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(ms);
  const day = (date: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long", month: "short", day: "numeric" }).format(startOfLocalDate(date, tz) + 12 * 3_600_000);
  const shortDay = (ms: number) => new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(ms);
  const duration = (ms: number) => {
    const { h, m } = hoursMinutes(Math.max(0, ms));
    return h > 0 ? t("hoursMinutes", { h, m }) : t("minutes", { m });
  };
  const toLocal = (ms: number) => {
    const p = localParts(ms, tz);
    const two = (n: number) => String(n).padStart(2, "0");
    return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
  };
  const name = (id: string | null) => (id ? (sheet.names[id] ?? "?") : "?");
  const jobName = (s: SheetSegment) => s.projectName ?? jobs.find((j) => j.id === s.projectId)?.name ?? null;

  const active = sheet.segments.filter((s) => s.status === "active");
  const history = sheet.segments.filter((s) => s.status !== "active");
  const byId = new Map(sheet.segments.map((s) => [s.id, s]));
  const asSegment = (s: SheetSegment): Segment => ({ id: s.id, kind: s.kind, category: s.category, projectId: s.projectId, start: s.start, end: s.end });
  const days = dailyTotals(active.map(asSegment), now, tz, sheet.weekStart, sheet.weekEnd);
  const week = { job: 0, drive: 0, ride: 0, total: 0 };
  for (const d of days) for (const k of ["job", "drive", "ride", "total"] as const) week[k] += d.ms[k];
  const hasOpen = active.some((s) => s.end === null);
  const flagged = active.flatMap((s) => segmentFlags(asSegment(s), now).map((f) => ({ s, f })));

  const canFix = (s: SheetSegment | null) => {
    if (admin) return st !== "approved";
    if (lead) return st === "open";
    if (self) return st === "open" && (s === null || now - s.start <= windowHours * 3_600_000);
    return false;
  };
  const canAdd = admin ? st !== "approved" : lead ? st === "open" : self && st === "open";
  const canSubmit = (viewer.role === "crew_lead" || viewer.role === "project_manager" || admin) && st === "open";
  const showError = (e: SheetError) => setError(ts(`errors.${e}`));

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: SheetError }>, ok: string, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      let r;
      try {
        r = await fn();
      } catch {
        setError(t("errors.offline"));
        return;
      }
      if (!r.ok) return showError(r.error);
      setNotice(ok);
      after?.();
    });

  const openEdit = (s: SheetSegment | null) => {
    setError(null);
    const dayStart = startOfLocalDate(localDate(Math.min(now, sheet.weekEnd - 1), tz), tz);
    setDraft(
      s
        ? { segmentId: s.id, start: toLocal(s.start), end: s.end ? toLocal(s.end) : "", kind: s.kind, category: s.category ?? "job", projectId: s.projectId ?? "", reason: "" }
        : { segmentId: null, start: toLocal(dayStart + 7 * 3_600_000), end: toLocal(dayStart + 15 * 3_600_000), kind: "work", category: "job", projectId: "", reason: "" },
    );
  };
  const save = (remove: boolean) => {
    if (!draft) return;
    if (draft.reason.trim().length < 3) return showError("reason");
    run(
      () =>
        correctTime({
          segmentId: draft.segmentId,
          employeeId: draft.segmentId ? null : sheet.employeeId,
          start: remove ? null : draft.start,
          end: remove || !draft.end ? null : draft.end,
          kind: draft.kind,
          category: draft.kind === "work" ? draft.category : (draft.category ?? null),
          projectId: draft.projectId || null,
          reason: draft.reason,
          remove,
        }),
      remove ? ts("removed") : ts("saved"),
      () => setDraft(null),
    );
  };

  const weekLabel = `${new Intl.DateTimeFormat(locale, { timeZone: tz, month: "short", day: "numeric" }).format(sheet.weekStart)} – ${new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    month: "short",
    day: "numeric",
  }).format(sheet.weekEnd - 1)}`;
  const weekHref = (offset: number) => {
    const d = addDays(localDate(sheet.weekStart, tz), offset * 7);
    const q = new URLSearchParams({ week: d });
    if (!self || basePath.startsWith("/manage")) q.set("employee", sheet.employeeId);
    return `${basePath}?${q.toString()}`;
  };

  const form = draft && (
    <div className="space-y-3 rounded-xl border-2 border-brand-600 bg-brand-50 p-3">
      <p className="font-semibold">{draft.segmentId ? ts("fixEntry") : ts("addEntry")}</p>
      <Segmented
        label={ts("type")}
        value={draft.kind}
        onChange={(kind) => setDraft({ ...draft, kind })}
        options={[
          { value: "work", label: ts("work") },
          { value: "lunch", label: t("lunch") },
        ]}
        size="sm"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="block text-sm font-semibold">{ts("start")}</span>
          <input type="datetime-local" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base" />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-semibold">{ts("end")}</span>
          <input type="datetime-local" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base" />
        </label>
      </div>
      {draft.kind === "work" && (
        <>
          <Segmented label={ts("category")} value={draft.category} onChange={(category) => setDraft({ ...draft, category })} options={TIME_CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))} size="sm" />
          <label className="block space-y-1">
            <span className="block text-sm font-semibold">{t("job")}</span>
            <select value={draft.projectId} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })} className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base">
              <option value="">{t("noJob")}</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className="block space-y-1">
        <span className="block text-sm font-semibold">{ts("reason")}</span>
        <input value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} maxLength={500} placeholder={ts("reasonExample")} className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => save(false)} className={buttonClasses("primary", "md")}>
          {ts("saveFix")}
        </button>
        {draft.segmentId && (
          <button type="button" disabled={busy} onClick={() => save(true)} className={buttonClasses("danger", "md")}>
            {ts("removeEntry")}
          </button>
        )}
        <button type="button" onClick={() => setDraft(null)} className={buttonClasses("ghost", "md")}>
          {t("cancel")}
        </button>
      </div>
      <p className="text-sm text-neutral-700">{ts("originalKept")}</p>
    </div>
  );

  const askForm = (segmentId: string | null) => (
    <div className="space-y-2 rounded-xl border-2 border-neutral-300 bg-neutral-50 p-3">
      <label className="block space-y-1">
        <span className="block text-sm font-semibold">{ts("askLabel")}</span>
        <textarea value={askText} onChange={(e) => setAskText(e.target.value)} rows={3} maxLength={1000} placeholder={ts("askExample")} className="block w-full rounded-xl border-2 border-neutral-300 bg-white p-3 text-base" />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || askText.trim().length < 3}
          onClick={() => run(() => requestTimeChange({ weekOf: sheet.weekStart, message: askText, segmentId }), ts("askSent"), () => {
            setAsking(null);
            setAskText("");
          })}
          className={buttonClasses("primary", "md")}
        >
          <Send aria-hidden className="size-5" />
          {ts("askSend")}
        </button>
        <button type="button" onClick={() => setAsking(null)} className={buttonClasses("ghost", "md")}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link href={weekHref(-1)} className={buttonClasses("ghost", "md")} aria-label={ts("prevWeek")}>
          <ChevronLeft aria-hidden className="size-6" />
        </Link>
        <div className="text-center">
          {!self && <p className="text-lg font-bold">{sheet.employeeName}</p>}
          <p className="text-base font-semibold">{ts("weekOf", { range: weekLabel })}</p>
        </div>
        <Link href={weekHref(1)} className={buttonClasses("ghost", "md")} aria-label={ts("nextWeek")}>
          <ChevronRight aria-hidden className="size-6" />
        </Link>
      </div>

      <section aria-label={ts("statusLabel")} className={`rounded-2xl border-l-8 p-4 ${st === "approved" ? "border-green-700 bg-green-50" : st === "submitted" ? "border-brand-600 bg-brand-50" : "border-neutral-400 bg-white"}`}>
        <p className="flex items-center gap-2 text-lg font-bold">
          {st === "approved" ? <Lock aria-hidden className="size-6" /> : st === "submitted" ? <CircleCheck aria-hidden className="size-6" /> : null}
          {ts(`status.${st}`)}
        </p>
        {st === "submitted" && sheet.status.submittedAt && <p className="text-base">{ts("submittedBy", { name: name(sheet.status.submittedBy), when: shortDay(sheet.status.submittedAt) })}</p>}
        {st === "approved" && sheet.status.approvedAt && <p className="text-base">{ts("approvedBy", { name: name(sheet.status.approvedBy), when: shortDay(sheet.status.approvedAt) })}</p>}
        {sheet.status.reopenReason && sheet.status.reopenedAt && (
          <p className="text-sm text-neutral-700">{ts("reopenedBy", { name: name(sheet.status.reopenedBy), when: shortDay(sheet.status.reopenedAt), reason: sheet.status.reopenReason })}</p>
        )}
        <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
          {(["job", "drive", "ride", "total"] as const).map((k) => (
            <div key={k} className="rounded-xl bg-white/70 p-2">
              <dt className="text-sm font-semibold text-neutral-700">{k === "total" ? ts("total") : t(`categories.${k}`)}</dt>
              <dd className="text-base font-bold tabular-nums">{duration(week[k])}</dd>
            </div>
          ))}
        </dl>
      </section>

      {flagged.length > 0 && (
        <ul aria-label={ts("needsReview")} className="space-y-1 rounded-xl border-l-4 border-accent-600 bg-amber-50 px-4 py-3 text-amber-950">
          {flagged.map(({ s, f }) => (
            <li key={`${s.id}-${f}`} className="flex gap-2">
              <TriangleAlert aria-hidden className="size-5 shrink-0" />
              {ts(`flags.${f}`, { when: shortDay(s.start) })}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-red-900">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-base font-medium text-green-900">
          {notice}
        </p>
      )}

      {draft && !draft.segmentId && form}

      <section aria-label={ts("entries")} className="space-y-3">
        {Array.from({ length: 7 }, (_, i) => addDays(localDate(sheet.weekStart, tz), i)).map((date) => {
          const dayStart = startOfLocalDate(date, tz);
          const dayEnd = startOfLocalDate(addDays(date, 1), tz);
          const segs = active.filter((s) => s.start < dayEnd && (s.end ?? now) > dayStart && localDate(s.start, tz) === date);
          const total = days.find((d) => d.date === date)?.ms.total ?? 0;
          if (segs.length === 0 && total === 0) return null;
          return (
            <div key={date} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-base font-bold">{day(date)}</h3>
                <p className="font-semibold tabular-nums">{duration(total)}</p>
              </div>
              <ul className="divide-y divide-neutral-200">
                {segs.map((s) => {
                  const was = s.supersedesId ? byId.get(s.supersedesId) : undefined;
                  return (
                    <li key={s.id} className="space-y-1 py-2">
                      <div className={`flex flex-wrap items-baseline justify-between gap-x-3 ${s.kind === "lunch" ? "text-neutral-600" : ""}`}>
                        <span className="tabular-nums">
                          {time(s.start)} – {s.end ? (localDate(s.end, tz) === date ? time(s.end) : shortDay(s.end)) : t("now")}
                        </span>
                        <span className="min-w-0 flex-1 font-semibold">
                          {s.kind === "lunch" ? t("lunch") : t(`categories.${s.category ?? "job"}`)}
                          {s.kind === "work" && jobName(s) && <span className="font-normal text-neutral-600"> · {jobName(s)}</span>}
                          {s.kind === "lunch" && s.end && <span className="font-normal"> · {isPaidLunch(asSegment(s)) ? t("paidLunch") : t("unpaidLunch")}</span>}
                        </span>
                        <span className="tabular-nums">{duration((s.end ?? now) - s.start)}</span>
                      </div>
                      {s.source === "correction" && (
                        <p className="text-sm text-neutral-700">
                          {ts("fixedBy", { name: name(s.correctedBy), when: shortDay(s.createdAt), reason: s.reason ?? "" })}
                          {was && ` ${ts("was", { range: `${time(was.start)} – ${was.end ? time(was.end) : t("now")}` })}`}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {canFix(s) ? (
                          <button type="button" onClick={() => openEdit(s)} className={buttonClasses("ghost", "md")}>
                            <Pencil aria-hidden className="size-5" />
                            {ts("fix")}
                          </button>
                        ) : (
                          self &&
                          !admin && (
                            <button type="button" onClick={() => setAsking(s.id)} className={buttonClasses("ghost", "md")}>
                              <MessageSquare aria-hidden className="size-5" />
                              {ts("askFix")}
                            </button>
                          )
                        )}
                      </div>
                      {draft?.segmentId === s.id && form}
                      {asking === s.id && askForm(s.id)}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {active.length === 0 && <p className="rounded-2xl border border-neutral-200 bg-white p-4 text-base text-neutral-600">{ts("noTime")}</p>}
      </section>

      <div className="flex flex-wrap gap-2">
        {canAdd && !draft && (
          <button type="button" onClick={() => openEdit(null)} className={buttonClasses("secondary", "md")}>
            <Plus aria-hidden className="size-5" />
            {ts("addMissed")}
          </button>
        )}
        {self && !admin && asking === null && (
          <button type="button" onClick={() => setAsking("")} className={buttonClasses("ghost", "md")}>
            <MessageSquare aria-hidden className="size-5" />
            {ts("askWeek")}
          </button>
        )}
      </div>
      {asking === "" && askForm(null)}
      {self && !admin && st === "open" && <p className="text-sm text-neutral-700">{ts("selfRule", { hours: windowHours })}</p>}

      {sheet.requests.length > 0 && (
        <section aria-label={ts("requests")} className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold">{ts("requests")}</h3>
          <ul className="divide-y divide-neutral-200">
            {sheet.requests.map((r) => (
              <li key={r.id} className="space-y-1 py-2">
                <p className="text-base">“{r.message}”</p>
                <p className="text-sm text-neutral-600">
                  {r.status === "open" ? ts("requestOpen", { when: shortDay(r.createdAt) }) : ts("requestResolved", { name: name(r.resolvedBy), note: r.note ?? "" })}
                </p>
                {r.status === "open" && !self && (admin || lead) && (
                  <div className="flex flex-wrap items-end gap-2">
                    <input
                      aria-label={ts("resolveNote")}
                      value={notes[r.id] ?? ""}
                      onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                      placeholder={ts("resolveNote")}
                      className="min-h-11 min-w-0 flex-1 rounded-lg border-2 border-neutral-300 px-3 text-base"
                    />
                    <button type="button" disabled={busy} onClick={() => run(() => resolveTimeChange({ id: r.id, note: notes[r.id] ?? "" }), ts("resolved"))} className={buttonClasses("secondary", "md")}>
                      <CircleCheck aria-hidden className="size-5" />
                      {ts("markResolved")}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(canSubmit || admin) && (
        <section aria-label={ts("weekActions")} className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          {hasOpen && st !== "approved" && <p className="text-base text-red-900">{ts("errors.open_entries")}</p>}
          <div className="flex flex-wrap gap-2">
            {canSubmit && !admin && (
              <button type="button" disabled={busy || hasOpen} onClick={() => run(() => setWeekStatus({ employeeId: sheet.employeeId, weekOf: sheet.weekStart, to: "submitted" }), ts("submittedNow"))} className={buttonClasses("primary", "lg")}>
                <Send aria-hidden className="size-6" />
                {ts("submit")}
              </button>
            )}
            {admin && st !== "approved" && (
              <button type="button" disabled={busy || hasOpen} onClick={() => run(() => setWeekStatus({ employeeId: sheet.employeeId, weekOf: sheet.weekStart, to: "approved" }), ts("approvedNow"))} className={buttonClasses("primary", "lg")}>
                <Lock aria-hidden className="size-6" />
                {ts("approve")}
              </button>
            )}
          </div>
          {admin && st !== "open" && (
            <div className="flex flex-wrap items-end gap-2">
              <input aria-label={ts("reopenReason")} value={reopenText} onChange={(e) => setReopenText(e.target.value)} placeholder={ts("reopenReason")} className="min-h-11 min-w-0 flex-1 rounded-lg border-2 border-neutral-300 px-3 text-base" />
              <button
                type="button"
                disabled={busy || reopenText.trim().length < 3}
                onClick={() => run(() => setWeekStatus({ employeeId: sheet.employeeId, weekOf: sheet.weekStart, to: "open", reason: reopenText }), ts("reopenedNow"), () => setReopenText(""))}
                className={buttonClasses("secondary", "md")}
              >
                <Undo2 aria-hidden className="size-5" />
                {ts("reopen")}
              </button>
            </div>
          )}
        </section>
      )}

      {history.length > 0 && (
        <details className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-base font-bold">{ts("history", { count: history.length })}</summary>
          <ul className="mt-2 divide-y divide-neutral-200 text-sm">
            {history.map((h) => {
              const replacement = sheet.segments.find((s) => s.supersedesId === h.id);
              return (
                <li key={h.id} className="py-2">
                  <span className="tabular-nums line-through">
                    {shortDay(h.start)} – {h.end ? time(h.end) : t("now")}
                  </span>{" "}
                  {h.kind === "lunch" ? t("lunch") : t(`categories.${h.category ?? "job"}`)}
                  {" · "}
                  {h.status === "void"
                    ? ts("historyRemoved", { name: name(h.correctedBy), reason: h.reason ?? "" })
                    : replacement
                      ? ts("historyReplaced", { name: name(replacement.correctedBy), reason: replacement.reason ?? "" })
                      : ts("historyReplacedPlain")}
                  {h.source === "events" && <span className="text-neutral-600"> ({ts("fromClock")})</span>}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
