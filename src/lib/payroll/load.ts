import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { gustoWeek, payPeriod, payPeriodContaining, PAYROLL_ENGINE_VERSION, type GustoWeek, type PayException, type RateRow } from "@/domain/payroll/engine";
import type { Segment, TimeCategory } from "@/domain/time/totals";
import { localDate, startOfLocalDate } from "@/domain/time/zoned";
import { clockSettings } from "@/lib/time/my-time";

export type PayWeekRow = {
  weekStart: string; // YYYY-MM-DD
  status: "open" | "submitted" | "approved";
  gusto: GustoWeek;
  exceptions: PayException[];
};
export type PayRow = { employeeId: string; name: string; exempt: boolean; weeks: PayWeekRow[] };
export type Blocker =
  | { kind: "not_approved"; employeeId: string; name: string; weekStart: string; status: "open" | "submitted" }
  | { kind: "open_entry"; employeeId: string; name: string; weekStart: string }
  | { kind: "missing_rate"; employeeId: string; name: string; weekStart: string; category: TimeCategory };
export type Warning = { kind: "below_minimum_wage"; employeeId: string; name: string; category: TimeCategory; cents: number };
export type PayrollRun = { id: string; enteredAt: string; enteredBy: string | null; inputHash: string; voidedAt: string | null; voidReason: string | null; voidedBy: string | null };
export type Payroll = {
  period: { start: string; end: string; next: string; prev: string };
  weekStarts: string[];
  tz: string;
  rows: PayRow[];
  blockers: Blocker[];
  warnings: Warning[];
  inputHash: string;
  runs: PayrollRun[];
  names: Record<string, string>;
  anchorSet: boolean;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Everything for one pay period, computed on the server. Office admins only (RLS). */
export async function loadPayroll(periodParam: string | undefined, now = Date.now()): Promise<Payroll> {
  const supabase = await createClient();
  const settings = await clockSettings();
  const tz = settings.timezone;
  const { data: cfg } = await supabase.from("app_settings").select("pay_period_anchor, pay_period_weeks, minimum_wage").single();
  const anchor = (cfg?.pay_period_anchor as string | null) ?? "2026-11-16";
  const weeks = Number(cfg?.pay_period_weeks ?? 2);
  const minimumWageCents = Math.round(Number(cfg?.minimum_wage ?? 7.25) * 100);
  const period = payPeriodContaining(periodParam && DATE.test(periodParam) ? periodParam : localDate(now, tz), anchor, weeks);
  const from = startOfLocalDate(period.start, tz);
  const to = startOfLocalDate(period.next, tz);

  const [{ data: emps }, { data: segs }, { data: rates }, { data: sheets }, { data: runs }] = await Promise.all([
    supabase.from("employees").select("id, display_name, flsa_status"),
    supabase
      .from("time_segments")
      .select("id, employee_id, kind, category, project_id, start_at, end_at")
      .eq("status", "active")
      .lt("start_at", new Date(to).toISOString())
      .or(`end_at.is.null,end_at.gt.${new Date(from).toISOString()}`),
    supabase.from("pay_rates").select("id, employee_id, category, hourly_rate, effective_from"),
    supabase.from("timesheets").select("employee_id, week_start, status").gte("week_start", new Date(from).toISOString()).lt("week_start", new Date(to).toISOString()),
    supabase.from("payroll_runs").select("id, entered_at, entered_by, input_hash, voided_at, void_reason, voided_by").eq("period_start", period.start).order("entered_at", { ascending: false }),
  ]);

  const byEmployee = new Map<string, Segment[]>();
  for (const r of segs ?? []) {
    const list = byEmployee.get(r.employee_id as string) ?? [];
    list.push({
      id: r.id as string,
      kind: r.kind as Segment["kind"],
      category: (r.category as TimeCategory | null) ?? null,
      projectId: (r.project_id as string | null) ?? null,
      start: Date.parse(r.start_at as string),
      end: r.end_at ? Date.parse(r.end_at as string) : null,
    });
    byEmployee.set(r.employee_id as string, list);
  }
  const names: Record<string, string> = Object.fromEntries((emps ?? []).map((e) => [e.id as string, e.display_name as string]));
  const sheetStatus = (emp: string, weekStart: number) =>
    ((sheets ?? []).find((t) => t.employee_id === emp && Date.parse(t.week_start as string) === weekStart)?.status as PayWeekRow["status"]) ?? "open";

  const rows: PayRow[] = [];
  const blockers: Blocker[] = [];
  const warnings: Warning[] = [];
  let weekStarts: string[] = [];
  for (const e of emps ?? []) {
    const segments = byEmployee.get(e.id as string);
    if (!segments?.length) continue;
    const exempt = e.flsa_status === "exempt";
    const name = e.display_name as string;
    const empRates: RateRow[] = (rates ?? [])
      .filter((r) => r.employee_id === e.id)
      .map((r) => ({ id: r.id as string, category: r.category as TimeCategory, cents: Math.round(Number(r.hourly_rate) * 100), effectiveFrom: r.effective_from as string }));
    const p = payPeriod({ segments, rates: empRates, tz, workweek: settings.workweek, periodStart: from, weeks, exempt, minimumWageCents });
    weekStarts = p.weeks.map((w) => localDate(w.weekStart, tz));
    const weekRows: PayWeekRow[] = p.weeks.map((w) => {
      const weekStart = localDate(w.weekStart, tz);
      const status = sheetStatus(e.id as string, w.weekStart);
      const gusto = gustoWeek(w, exempt);
      if (!exempt && gusto.totalHundredths > 0 && status !== "approved") blockers.push({ kind: "not_approved", employeeId: e.id as string, name, weekStart, status });
      for (const x of w.exceptions) {
        if (x.kind === "open_entry") blockers.push({ kind: "open_entry", employeeId: e.id as string, name, weekStart });
        if (x.kind === "missing_rate" && !blockers.some((b) => b.kind === "missing_rate" && b.employeeId === e.id && b.category === x.category && b.weekStart === weekStart))
          blockers.push({ kind: "missing_rate", employeeId: e.id as string, name, weekStart, category: x.category });
        if (x.kind === "below_minimum_wage" && !warnings.some((v) => v.employeeId === e.id && v.category === x.category))
          warnings.push({ kind: "below_minimum_wage", employeeId: e.id as string, name, category: x.category, cents: x.cents });
      }
      return { weekStart, status, gusto, exceptions: w.exceptions };
    });
    rows.push({ employeeId: e.id as string, name, exempt, weeks: weekRows });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  if (weekStarts.length === 0) {
    weekStarts = Array.from({ length: weeks }, (_, i) => {
      const d = new Date(`${period.start}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i * 7);
      return d.toISOString().slice(0, 10);
    });
  }
  const runList: PayrollRun[] = (runs ?? []).map((r) => ({
    id: r.id as string,
    enteredAt: r.entered_at as string,
    enteredBy: (r.entered_by as string | null) ?? null,
    inputHash: r.input_hash as string,
    voidedAt: (r.voided_at as string | null) ?? null,
    voidReason: (r.void_reason as string | null) ?? null,
    voidedBy: (r.voided_by as string | null) ?? null,
  }));
  return { period, weekStarts, tz, rows, blockers, warnings, inputHash: hashRows(rows), runs: runList, names, anchorSet: Boolean(cfg?.pay_period_anchor) };
}

/** Fingerprint of what would be entered: changes if any hours, rate or person changes. */
export function hashRows(rows: PayRow[]): string {
  const canonical = rows.map((r) => [r.employeeId, r.exempt, r.weeks.map((w) => [w.weekStart, w.gusto.entries.map((e) => [e.category, e.cents, e.hundredths])])]);
  return createHash("sha256").update(JSON.stringify([PAYROLL_ENGINE_VERSION, canonical])).digest("hex");
}

/** The lines saved when the period is marked entered in Gusto. */
export function snapshotLines(p: Payroll) {
  return p.rows.flatMap((r) =>
    r.weeks.map((w) => ({
      employee_id: r.employeeId,
      employee_name: r.name,
      exempt: r.exempt,
      week_start: w.weekStart,
      entries: w.gusto.entries.map((e) => ({ category: e.category, rate_cents: e.cents, hours: e.hundredths / 100 })),
      total_hours: w.gusto.totalHundredths / 100,
      regular_hours: w.gusto.regularHundredths / 100,
      overtime_hours: w.gusto.overtimeHundredths / 100,
      check_gross_cents: w.gusto.checkGrossCents,
      details: { status: w.status, exceptions: w.exceptions },
    })),
  );
}
