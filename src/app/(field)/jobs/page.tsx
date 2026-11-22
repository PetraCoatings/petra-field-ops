import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { requireProfile, type Profile } from "@/lib/auth/dal";
import { canAccessManagement } from "@/lib/auth/roles";
import { parseDateOnly } from "@/lib/dates";
import type { ProjectRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home.modules");
  return { title: t("jobCenter") };
}

/** Job Center: the crew's current jobs, and a date-ordered library of past work orders. */
export default async function JobCenterPage({ searchParams }: PageProps<"/jobs">) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const tab = sp.tab === "past" ? "past" : "mine";
  const t = await getTranslations("jobCenter");
  const tc = await getTranslations("common");
  const tabClass = (active: boolean) =>
    `flex-1 rounded-lg px-3 py-2.5 text-center text-base font-semibold ${active ? "bg-brand-700 text-white shadow" : "text-neutral-800 hover:bg-white"}`;
  return (
    <>
      <PageHeader title={t("title")} backHref="/" backLabel={tc("home")} />
      <nav aria-label={t("title")} className="mb-4 flex rounded-xl border-2 border-neutral-300 bg-neutral-100 p-1">
        <Link href="/jobs" aria-current={tab === "mine" ? "page" : undefined} className={tabClass(tab === "mine")}>
          {canAccessManagement(profile.role) ? t("tabs.current") : t("tabs.mine")}
        </Link>
        <Link href="/jobs?tab=past" aria-current={tab === "past" ? "page" : undefined} className={tabClass(tab === "past")}>
          {t("tabs.past")}
        </Link>
      </nav>
      {tab === "mine" ? <MyJobs profile={profile} /> : <PastWorkOrders q={str(sp.q)} year={str(sp.year)} month={str(sp.month)} />}
    </>
  );
}

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

const ORDER: Record<string, number> = { in_progress: 0, scheduled: 1, on_hold: 2, draft: 3, completed: 4, closed: 5 };

async function MyJobs({ profile }: { profile: Profile }) {
  const office = canAccessManagement(profile.role);
  const t = await getTranslations("jobCenter");
  const format = await getFormatter();
  const supabase = await createClient();
  // RLS returns only the jobs this person may see. Finished jobs live under "Past work orders".
  let query = supabase
    .from("projects")
    .select("id, job_number, name, status, scheduled_start, site_city, site_state, flooring_system, customers(name)")
    .not("status", "in", "(completed,closed)");
  if (!office) query = query.neq("status", "draft");
  const { data } = await query;
  type Row = Pick<ProjectRow, "id" | "job_number" | "name" | "status" | "scheduled_start" | "site_city" | "site_state" | "flooring_system"> & {
    customers: { name: string } | null;
  };
  const jobs = ((data ?? []) as unknown as Row[]).sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] ||
      (a.scheduled_start ?? "9999").localeCompare(b.scheduled_start ?? "9999") ||
      a.name.localeCompare(b.name),
  );

  // Which current work order revisions still need this person's OK?
  const needsOk = new Set<string>();
  if (!office && jobs.length > 0) {
    const { data: wos } = await supabase
      .from("field_work_orders")
      .select("project_id, current_revision_id")
      .eq("status", "published")
      .in("project_id", jobs.map((j) => j.id));
    const revs = (wos ?? []).map((w) => w.current_revision_id as string);
    const { data: acks } = revs.length
      ? await supabase.from("fwo_acknowledgments").select("fwo_revision_id").eq("employee_id", profile.employeeId).in("fwo_revision_id", revs)
      : { data: [] };
    const acked = new Set((acks ?? []).map((a) => a.fwo_revision_id as string));
    for (const w of wos ?? []) if (!acked.has(w.current_revision_id as string)) needsOk.add(w.project_id as string);
  }

  if (jobs.length === 0) return <p className="rounded-2xl bg-white p-6 text-center text-lg text-neutral-700">{t("emptyMine")}</p>;
  return (
    <ul className="space-y-3">
      {jobs.map((job) => (
        <li key={job.id}>
          <Link
            href={`/jobs/${job.id}`}
            className={`flex items-center gap-3 rounded-2xl border-2 bg-white p-4 ${needsOk.has(job.id) ? "border-accent-500" : "border-neutral-200 hover:border-brand-600"}`}
          >
            <div className="w-14 shrink-0 text-center">
              {job.scheduled_start ? (
                <>
                  <span className="block text-sm font-semibold uppercase text-brand-700">
                    {format.dateTime(parseDateOnly(job.scheduled_start), { month: "short" })}
                  </span>
                  <span className="block text-2xl font-bold leading-none">{format.dateTime(parseDateOnly(job.scheduled_start), { day: "numeric" })}</span>
                </>
              ) : (
                <span className="block text-sm text-neutral-500">{t("noDate")}</span>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-lg font-bold leading-snug">{job.name}</p>
              <p className="text-base text-neutral-700">
                {[job.site_city && [job.site_city, job.site_state].filter(Boolean).join(", "), job.flooring_system].filter(Boolean).join(" · ")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <ProjectStatusBadge status={job.status} />
                {needsOk.has(job.id) && (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-950">{t("needsOk")}</span>
                )}
              </div>
            </div>
            <ChevronRight aria-hidden className="size-6 shrink-0 text-neutral-500" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

type LibraryRow = {
  fwo_id: string;
  project_id: string;
  fwo_number: number;
  title: string;
  job_date: string;
  project_name: string | null;
  customer: string | null;
  city: string | null;
  state: string | null;
  system_install: string | null;
  total_sqft: string | null;
};

async function PastWorkOrders({ q, year, month }: { q: string; year: string; month: string }) {
  const t = await getTranslations("jobCenter");
  const format = await getFormatter();
  const supabase = await createClient();
  const y = /^\d{4}$/.test(year) ? Number(year) : null;
  const m = /^(1[0-2]|[1-9])$/.test(month) ? Number(month) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = y ? `${y}-${pad(m ?? 1)}-01` : null;
  const to = y ? (m ? new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) : `${y}-12-31`) : null;
  const { data } = await supabase.rpc("search_work_order_library", { p_query: q.trim() || null, p_from: from, p_to: to, p_limit: 300 });
  const rows = (data ?? []) as LibraryRow[];
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);
  const monthName = (n: number) => format.dateTime(new Date(Date.UTC(2026, n - 1, 15)), { month: "long" });

  // Group by month, newest first.
  const groups: { key: string; label: string; rows: LibraryRow[] }[] = [];
  for (const r of rows) {
    const key = r.job_date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: format.dateTime(parseDateOnly(`${key}-15`), { month: "long", year: "numeric" }), rows: [] };
      groups.push(g);
    }
    g.rows.push(r);
  }
  const select = "block min-h-11 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none";

  return (
    <div className="space-y-4">
      <form role="search" action="/jobs" className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
        <input type="hidden" name="tab" value="past" />
        <label htmlFor="library-q" className="sr-only">
          {t("searchLabel")}
        </label>
        <div className="flex gap-2">
          <input
            id="library-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder={t("searchPlaceholder")}
            className="block min-h-12 min-w-0 flex-1 rounded-xl border-2 border-neutral-300 bg-white px-3 text-lg focus:border-brand-600 focus:outline-none"
          />
          <button type="submit" aria-label={t("search")} className="flex min-h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white">
            <Search aria-hidden className="size-6" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="library-year" className="sr-only">
              {t("year")}
            </label>
            <select id="library-year" name="year" defaultValue={y ? String(y) : ""} className={select}>
              <option value="">{t("anyYear")}</option>
              {years.map((yy) => (
                <option key={yy} value={yy}>
                  {yy}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="library-month" className="sr-only">
              {t("month")}
            </label>
            <select id="library-month" name="month" defaultValue={m ? String(m) : ""} className={select}>
              <option value="">{t("anyMonth")}</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
                <option key={mm} value={mm}>
                  {monthName(mm)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-sm text-neutral-600">{t("filterHint")}</p>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-lg text-neutral-700">{q || y ? t("noMatches") : t("emptyPast")}</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-labelledby={`month-${g.key}`} className="space-y-2">
            <h2 id={`month-${g.key}`} className="sticky top-14 z-[5] bg-neutral-100 px-1 py-1 text-lg font-bold text-neutral-900">
              {g.label}
            </h2>
            <ul className="space-y-2">
              {g.rows.map((r) => (
                <li key={r.fwo_id}>
                  <Link href={`/jobs/library/${r.fwo_id}`} className="flex items-center gap-3 rounded-2xl border-2 border-neutral-200 bg-white p-3 hover:border-brand-600">
                    <div className="w-12 shrink-0 text-center">
                      <span className="block text-sm font-semibold uppercase text-brand-700">
                        {format.dateTime(parseDateOnly(r.job_date), { month: "short" })}
                      </span>
                      <span className="block text-2xl font-bold leading-none">{format.dateTime(parseDateOnly(r.job_date), { day: "numeric" })}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-bold leading-snug">
                        {r.project_name}
                        {r.fwo_number > 1 && <span className="font-semibold text-neutral-600"> · {r.title}</span>}
                      </p>
                      <p className="text-sm text-neutral-700">{[r.customer, [r.city, r.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</p>
                      {(r.system_install || r.total_sqft) && (
                        <p className="text-sm text-neutral-600">
                          {[r.system_install, r.total_sqft && !r.system_install?.includes("sf") ? t("sqft", { value: format.number(Number(r.total_sqft)) }) : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                    <ChevronRight aria-hidden className="size-5 shrink-0 text-neutral-500" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
