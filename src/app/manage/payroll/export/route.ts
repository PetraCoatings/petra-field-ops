import { getFormatter, getTranslations } from "next-intl/server";
import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth/dal";
import { loadPayroll } from "@/lib/payroll/load";
import { renderPayrollPdf } from "@/lib/payroll/pdf";

/** Payroll entry sheet as a spreadsheet (CSV) or PDF. Office admins only. */
export async function GET(request: NextRequest) {
  const profile = await getProfile();
  if (!profile || profile.role !== "office_admin") return new NextResponse("Not allowed", { status: 403 });
  const sp = request.nextUrl.searchParams;
  const p = await loadPayroll(sp.get("period") ?? undefined);
  const t = await getTranslations("payroll");
  const tc = await getTranslations("timeClock");
  const format = await getFormatter();
  const day = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const file = `payroll-${p.period.start}-to-${p.period.end}`;
  const headers = { "Cache-Control": "private, no-store" };

  if (sp.get("format") === "pdf") {
    const addDays = (d: string, n: number) => {
      const x = new Date(`${d}T12:00:00Z`);
      x.setUTCDate(x.getUTCDate() + n);
      return x.toISOString().slice(0, 10);
    };
    const pdf = await renderPayrollPdf({
      p,
      labels: {
        title: t("pdfTitle"),
        period: t("period", { from: day(p.period.start), to: day(p.period.end) }),
        employee: t("employee"),
        weeks: p.weekStarts.map((w, i) => t("weekN", { n: i + 1, from: day(w), to: day(addDays(w, 6)) })),
        job: tc("categories.job"),
        drive: tc("categories.drive"),
        ride: tc("categories.ride"),
        total: t("total"),
        overtime: t("overtime"),
        check: t("check"),
        salaried: t("salaried"),
        note: t("pdfNote"),
        blocked: p.blockers.length ? t("pdfBlocked", { count: p.blockers.length }) : null,
        generated: t("generated", { when: format.dateTime(new Date(), { dateStyle: "medium", timeStyle: "short", timeZone: p.tz }) }),
      },
    });
    return new NextResponse(new Uint8Array(pdf), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${file}.pdf"` } });
  }

  // CSV: one line per person, week and rate, in the order typed into Gusto.
  const cols = [t("employee"), t("csv.payType"), t("csv.week"), t("csv.weekStarts"), t("csv.kind"), t("csv.rate"), t("csv.hours"), t("csv.weekTotal"), t("csv.regular"), t("overtime"), t("csv.weekCheck")];
  const lines: string[][] = [];
  for (const r of p.rows) {
    r.weeks.forEach((w, i) => {
      const base = [r.name, r.exempt ? t("salaried") : t("csv.hourly"), String(i + 1), w.weekStart];
      const totals = [(w.gusto.totalHundredths / 100).toFixed(2), (w.gusto.regularHundredths / 100).toFixed(2), (w.gusto.overtimeHundredths / 100).toFixed(2), w.gusto.checkGrossCents === null ? "" : (w.gusto.checkGrossCents / 100).toFixed(2)];
      if (w.gusto.entries.length === 0) lines.push([...base, "", "", "0.00", ...totals]);
      for (const e of w.gusto.entries) lines.push([...base, tc(`categories.${e.category}`), r.exempt ? "" : (e.cents / 100).toFixed(2), (e.hundredths / 100).toFixed(2), ...totals]);
    });
  }
  const esc = (v: string) => (/[",\n]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` : v);
  const csv = "﻿" + [cols, ...lines].map((l) => l.map(esc).join(",")).join("\r\n") + "\r\n";
  return new NextResponse(csv, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}.csv"` } });
}
