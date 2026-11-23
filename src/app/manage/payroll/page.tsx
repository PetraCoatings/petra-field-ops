import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, CircleCheck, Download, FileText, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button-styles";
import { requireManagePath } from "@/lib/auth/dal";
import { loadPayroll } from "@/lib/payroll/load";
import { serverNow } from "@/lib/time/my-time";
import { MarkEntered } from "./mark-entered";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("manage.nav");
  return { title: t("payroll") };
}

/**
 * Payroll for one pay period, laid out the way it's typed into Gusto: for
 * each person and week, hours per rate (Job, Drive, Ride). Gusto calculates
 * the overtime; the app's expected gross is a check figure only.
 */
export default async function PayrollPage({ searchParams }: PageProps<"/manage/payroll">) {
  await requireManagePath("/manage/payroll");
  const sp = await searchParams;
  const t = await getTranslations("payroll");
  const tc = await getTranslations("timeClock");
  const format = await getFormatter();
  const p = await loadPayroll(typeof sp.period === "string" ? sp.period : undefined, serverNow());
  const day = (d: string, withYear = false) =>
    format.dateTime(new Date(`${d}T12:00:00Z`), withYear ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
  const hours = (h: number) => (h / 100).toFixed(2);
  const money = (c: number) => format.number(c / 100, { style: "currency", currency: "USD" });
  const active = p.runs.find((r) => !r.voidedAt);
  const changed = active && active.inputHash !== p.inputHash;
  const weekLabel = (i: number) => t("weekN", { n: i + 1, from: day(p.weekStarts[i]), to: day(addDays(p.weekStarts[i], 6)) });
  const q = `period=${p.period.start}`;

  return (
    <>
      <PageHeader title={t("title")} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href={`/manage/payroll?period=${p.period.prev}`} className={buttonClasses("ghost", "md")} aria-label={t("prev")}>
            <ChevronLeft aria-hidden className="size-6" />
          </Link>
          <p className="text-lg font-bold">{t("period", { from: day(p.period.start), to: day(p.period.end, true) })}</p>
          <Link href={`/manage/payroll?period=${p.period.next}`} className={buttonClasses("ghost", "md")} aria-label={t("next")}>
            <ChevronRight aria-hidden className="size-6" />
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/manage/payroll/export?${q}&format=pdf`} className={buttonClasses("secondary", "md")}>
            <FileText aria-hidden className="size-5" />
            {t("downloadPdf")}
          </a>
          <a href={`/manage/payroll/export?${q}&format=csv`} className={buttonClasses("secondary", "md")}>
            <Download aria-hidden className="size-5" />
            {t("downloadCsv")}
          </a>
        </div>
      </div>

      <p className="mb-4 max-w-3xl text-base text-neutral-700">{t("intro")}</p>

      {active && (
        <div role="status" className={`mb-4 flex gap-2 rounded-xl border-l-4 px-4 py-3 ${changed ? "border-red-700 bg-red-50 text-red-950" : "border-green-700 bg-green-50 text-green-950"}`}>
          {changed ? <TriangleAlert aria-hidden className="size-6 shrink-0" /> : <CircleCheck aria-hidden className="size-6 shrink-0" />}
          <div>
            <p className="font-semibold">{t("entered", { name: p.names[active.enteredBy ?? ""] ?? "?", when: format.dateTime(new Date(active.enteredAt), { dateStyle: "medium", timeStyle: "short" }) })}</p>
            {changed && <p>{t("changedSince")}</p>}
          </div>
        </div>
      )}

      {p.blockers.length > 0 && (
        <section aria-labelledby="blockers" className="mb-4 rounded-xl border-l-4 border-red-700 bg-red-50 px-4 py-3 text-red-950">
          <h2 id="blockers" className="flex items-center gap-2 font-bold">
            <TriangleAlert aria-hidden className="size-5" />
            {t("blockersTitle", { count: p.blockers.length })}
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-6">
            {p.blockers.map((b, i) => (
              <li key={i}>
                <Link href={b.kind === "missing_rate" ? `/manage/employees/${b.employeeId}` : `/manage/time/${b.employeeId}?week=${b.weekStart}`} className="underline">
                  {b.kind === "not_approved"
                    ? t("blocker.not_approved", { name: b.name, week: day(b.weekStart), status: tc(`sheet.status.${b.status}`) })
                    : b.kind === "open_entry"
                      ? t("blocker.open_entry", { name: b.name, week: day(b.weekStart) })
                      : t("blocker.missing_rate", { name: b.name, category: tc(`categories.${b.category}`) })}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {p.warnings.map((w) => (
        <p key={`${w.employeeId}${w.category}`} className="mb-2 rounded-xl border-l-4 border-accent-600 bg-amber-50 px-4 py-2 text-amber-950">
          {t("belowMinimum", { name: w.name, category: tc(`categories.${w.category}`), rate: money(w.cents) })}
        </p>
      ))}

      {p.rows.length === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white p-4 text-base text-neutral-600">{t("noHours")}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead>
              <tr className="border-b-2 border-neutral-300 bg-neutral-50">
                <th rowSpan={2} className="px-3 py-2 align-bottom font-semibold">{t("employee")}</th>
                {p.weekStarts.map((_, i) => (
                  <th key={i} colSpan={5} className="border-l border-neutral-300 px-3 py-2 text-center font-semibold">
                    {weekLabel(i)}
                  </th>
                ))}
                <th rowSpan={2} className="border-l border-neutral-300 px-3 py-2 align-bottom text-right font-semibold">{t("check")}</th>
              </tr>
              <tr className="border-b border-neutral-300 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-600">
                {p.weekStarts.map((_, i) => (
                  <Cols key={i} labels={[tc("categories.job"), tc("categories.drive"), tc("categories.ride"), t("total"), t("overtime")]} />
                ))}
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => {
                const gross = r.exempt ? null : r.weeks.reduce((n, w) => n + (w.gusto.checkGrossCents ?? 0), 0);
                return (
                  <tr key={r.employeeId} className="border-b border-neutral-100 align-top">
                    <th scope="row" className="px-3 py-2 font-semibold">
                      {r.name}
                      {r.exempt && <span className="block text-xs font-normal text-neutral-600">{t("salaried")}</span>}
                    </th>
                    {r.weeks.map((w) => {
                      const cat = (c: "job" | "drive" | "ride") => w.gusto.entries.filter((e) => e.category === c);
                      return (
                        <WeekCells
                          key={w.weekStart}
                          cells={(["job", "drive", "ride"] as const).map((c) =>
                            cat(c).length === 0 ? "" : cat(c).map((e) => (r.exempt || cat(c).length === 1 ? hours(e.hundredths) : `${hours(e.hundredths)} @ ${money(e.cents)}`)).join("\n"),
                          )}
                          total={w.gusto.totalHundredths > 0 ? hours(w.gusto.totalHundredths) : ""}
                          overtime={w.gusto.overtimeHundredths > 0 ? hours(w.gusto.overtimeHundredths) : ""}
                          approved={w.status === "approved" || w.gusto.totalHundredths === 0}
                        />
                      );
                    })}
                    <td className="border-l border-neutral-300 px-3 py-2 text-right tabular-nums">{gross === null ? "—" : money(gross)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-sm text-neutral-600">{t("legend")}</p>

      {p.rows.length > 0 && (
        <MarkEntered period={p.period.start} inputHash={p.inputHash} blocked={p.blockers.length > 0} alreadyEntered={Boolean(active)} />
      )}

      {p.runs.filter((r) => r.voidedAt).length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-semibold">{t("history")}</summary>
          <ul className="mt-1 list-disc pl-6">
            {p.runs
              .filter((r) => r.voidedAt)
              .map((r) => (
                <li key={r.id}>
                  {t("replaced", {
                    entered: format.dateTime(new Date(r.enteredAt), { dateStyle: "medium", timeStyle: "short" }),
                    by: p.names[r.voidedBy ?? ""] ?? "?",
                    reason: r.voidReason ?? "",
                  })}
                </li>
              ))}
          </ul>
        </details>
      )}
    </>
  );
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function Cols({ labels }: { labels: string[] }) {
  return (
    <>
      {labels.map((l, i) => (
        <th key={l} className={`px-3 py-1 text-right font-semibold ${i === 0 ? "border-l border-neutral-300" : ""}`}>
          {l}
        </th>
      ))}
    </>
  );
}

function WeekCells({ cells, total, overtime, approved }: { cells: string[]; total: string; overtime: string; approved: boolean }) {
  return (
    <>
      {cells.map((c, i) => (
        <td key={i} className={`whitespace-pre-line px-3 py-2 text-right tabular-nums ${i === 0 ? "border-l border-neutral-300" : ""} ${approved ? "" : "bg-red-50"}`}>
          {c}
        </td>
      ))}
      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${approved ? "" : "bg-red-50"}`}>{total}</td>
      <td className={`px-3 py-2 text-right font-semibold tabular-nums text-amber-900 ${approved ? "" : "bg-red-50"}`}>{overtime}</td>
    </>
  );
}
