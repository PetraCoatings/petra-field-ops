import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { cancelTimeOff } from "@/lib/actions/time-off";
import { localDate } from "@/domain/time/zoned";
import { clockSettings, serverNow } from "@/lib/time/my-time";
import { Decide } from "./decide";
import { RequestForm } from "./request-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("timeOff");
  return { title: t("title") };
}

const KNOWN_TYPES = ["Vacation", "Sick", "Personal", "Unpaid"] as const;
type KnownType = (typeof KNOWN_TYPES)[number];

type Req = {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  partial_hours: string | null;
  notes: string | null;
  status: "pending_lead" | "pending_office" | "approved" | "rejected" | "cancelled";
  created_at: string;
  lead_decision_by: string | null;
  lead_decision_note: string | null;
  office_decision_by: string | null;
  office_decision_note: string | null;
  leave_types: { name: string } | null;
};

/**
 * Time off: ask for days off; see your requests; crew leads and project
 * managers approve their crew's first; office admins give the final approval.
 */
export default async function TimeOffPage() {
  const profile = await requireProfile();
  const t = await getTranslations();
  const locale = await getLocale();
  const settings = await clockSettings();
  const today = localDate(serverNow(), settings.timezone);
  const supabase = await createClient();
  const [{ data: types }, { data: reqs }, { data: dir }] = await Promise.all([
    supabase.from("leave_types").select("id, name").eq("is_active", true).order("sort"),
    supabase
      .from("time_off_requests")
      .select("id, employee_id, start_date, end_date, partial_hours, notes, status, created_at, lead_decision_by, lead_decision_note, office_decision_by, office_decision_note, leave_types(name)")
      .order("start_date", { ascending: false })
      .limit(200),
    supabase.from("employee_directory").select("id, display_name"),
  ]);
  const all = (reqs ?? []) as unknown as Req[];
  const names = new Map((dir ?? []).map((d) => [d.id as string, d.display_name as string]));
  const admin = profile.role === "office_admin";
  const mine = all.filter((r) => r.employee_id === profile.employeeId);
  // RLS only returns others' requests to their crew lead / PM or office admins.
  const waiting = all
    .filter((r) => r.employee_id !== profile.employeeId && (r.status === "pending_lead" || (admin && r.status === "pending_office")))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const upcoming = all.filter((r) => r.employee_id !== profile.employeeId && r.status === "approved" && r.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));

  const d = (s: string) => new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${s}T12:00:00Z`));
  const range = (r: Req) => (r.start_date === r.end_date ? d(r.start_date) : `${d(r.start_date)} – ${d(r.end_date)}`) + (r.partial_hours ? ` (${Number(r.partial_hours)} h)` : "");
  const typeName = (r: Req) => {
    const n = r.leave_types?.name ?? "";
    return KNOWN_TYPES.includes(n as KnownType) ? t(`timeOff.types.${n as KnownType}`) : n;
  };
  const statusText = (r: Req) => {
    switch (r.status) {
      case "pending_lead":
        return t("timeOff.status.pending_lead");
      case "pending_office":
        return r.lead_decision_by ? t("timeOff.status.pending_office_after", { name: names.get(r.lead_decision_by) ?? "?" }) : t("timeOff.status.pending_office");
      case "approved":
        return t("timeOff.status.approved", { name: names.get(r.office_decision_by ?? "") ?? "?" });
      case "rejected": {
        const by = r.office_decision_by ?? r.lead_decision_by;
        return t("timeOff.status.rejected", { name: names.get(by ?? "") ?? "?", reason: r.office_decision_note ?? r.lead_decision_note ?? "" });
      }
      default:
        return t("timeOff.status.cancelled");
    }
  };
  const tone = (r: Req) =>
    r.status === "approved" ? "border-green-700 bg-green-50" : r.status === "rejected" ? "border-red-700 bg-red-50" : r.status === "cancelled" ? "border-neutral-300 bg-neutral-50" : "border-accent-600 bg-amber-50";
  const canCancel = (r: Req) => r.status === "pending_lead" || r.status === "pending_office" || (r.status === "approved" && r.start_date > today);

  return (
    <>
      <PageHeader title={t("timeOff.title")} backHref="/calendar" backLabel={t("home.modules.calendar")} />
      <div className="space-y-4">
        {waiting.length > 0 && (
          <section aria-labelledby="to-waiting" className="space-y-3 rounded-2xl border-2 border-accent-600 bg-white p-4 shadow-sm">
            <h2 id="to-waiting" className="text-lg font-bold">
              {t("timeOff.waiting", { count: waiting.length })}
            </h2>
            <ul className="space-y-4">
              {waiting.map((r) => (
                <li key={r.id} className="space-y-2 border-b border-neutral-200 pb-4 last:border-0 last:pb-0">
                  <p className="text-base font-semibold">
                    {names.get(r.employee_id)} · {typeName(r)} · {range(r)}
                  </p>
                  {r.notes && <p className="text-base text-neutral-700">“{r.notes}”</p>}
                  <p className="text-sm text-neutral-600">{statusText(r)}</p>
                  <Decide id={r.id} final={admin} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="to-new" className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 id="to-new" className="text-lg font-bold">
            {t("timeOff.newTitle")}
          </h2>
          <p className="text-sm text-neutral-700">{t("timeOff.how")}</p>
          <RequestForm types={(types ?? []) as { id: string; name: string }[]} today={today} />
        </section>

        <section aria-labelledby="to-mine" className="space-y-2">
          <h2 id="to-mine" className="text-lg font-bold">
            {t("timeOff.mine")}
          </h2>
          {mine.length === 0 ? (
            <p className="text-neutral-600">{t("timeOff.none")}</p>
          ) : (
            <ul className="space-y-2">
              {mine.map((r) => (
                <li key={r.id} className={`space-y-1 rounded-xl border-l-4 px-4 py-3 ${tone(r)}`}>
                  <p className="font-semibold">
                    {typeName(r)} · {range(r)}
                  </p>
                  <p className="text-sm">{statusText(r)}</p>
                  {canCancel(r) && (
                    <form action={cancelTimeOff}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="text-sm font-semibold text-red-800 underline">
                        {t("timeOff.cancel")}
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {upcoming.length > 0 && (
          <section aria-labelledby="to-crew" className="space-y-2">
            <h2 id="to-crew" className="text-lg font-bold">
              {admin ? t("timeOff.everyoneUpcoming") : t("timeOff.crewUpcoming")}
            </h2>
            <ul className="space-y-1">
              {upcoming.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2">
                  <span>
                    <span className="font-semibold">{names.get(r.employee_id)}</span> · {typeName(r)} · {range(r)}
                  </span>
                  {admin && (
                    <form action={cancelTimeOff}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="text-sm font-semibold text-red-800 underline">
                        {t("timeOff.cancel")}
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
