import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/dal";
import { directoryNames } from "@/lib/db/queries";
import { createClient } from "@/lib/supabase/server";
import { changedFields } from "@/lib/audit/diff";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("audit");
  return { title: t("title") };
}

type AuditRow = {
  id: number;
  occurred_at: string;
  table_name: string;
  row_id: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  actor_employee_id: string | null;
};

const TABLES = ["public.employees", "public.projects", "public.project_assignments", "public.app_settings"];

export default async function AuditPage({ searchParams }: PageProps<"/manage/audit">) {
  await requireRole("office_admin");
  const t = await getTranslations("audit");
  const format = await getFormatter();
  const { table } = await searchParams;
  const filter = typeof table === "string" && TABLES.includes(table) ? table : null;

  const supabase = await createClient();
  let query = supabase.from("audit_log").select("*").order("id", { ascending: false }).limit(200);
  if (filter) query = query.eq("table_name", filter);
  const { data } = await query;
  const rows = (data ?? []) as AuditRow[];
  const names = await directoryNames(rows.map((r) => r.actor_employee_id));

  return (
    <>
      <PageHeader title={t("title")} />
      <p className="mb-4 text-base text-neutral-700">{t("help")}</p>
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <select
          name="table"
          defaultValue={filter ?? ""}
          aria-label={t("what")}
          className="min-h-11 rounded-xl border-2 border-neutral-300 bg-white px-3"
        >
          <option value="">{t("allTables")}</option>
          {TABLES.map((tb) => (
            <option key={tb} value={tb}>
              {tb.replace("public.", "")}
            </option>
          ))}
        </select>
        <button type="submit" className="min-h-11 rounded-xl bg-brand-700 px-4 font-semibold text-white">
          {t("filter")}
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="text-neutral-700">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-neutral-700">
              <tr>
                <th className="px-3 py-2">{t("when")}</th>
                <th className="px-3 py-2">{t("who")}</th>
                <th className="px-3 py-2">{t("what")}</th>
                <th className="px-3 py-2">{t("action")}</th>
                <th className="px-3 py-2">{t("changes")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 align-top">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2">
                    {format.dateTime(new Date(r.occurred_at), { dateStyle: "short", timeStyle: "medium" })}
                  </td>
                  <td className="px-3 py-2">
                    {r.actor_employee_id ? (names.get(r.actor_employee_id)?.display_name ?? "—") : t("system")}
                  </td>
                  <td className="px-3 py-2">
                    {r.table_name.replace("public.", "")}
                    <div className="font-mono text-xs text-neutral-500">{r.row_id?.slice(0, 8)}</div>
                  </td>
                  <td className="px-3 py-2">{t(`actions.${r.action}`)}</td>
                  <td className="px-3 py-2">
                    <ul className="space-y-0.5">
                      {changedFields(r.old_data, r.new_data).map((c) => (
                        <li key={c.field} className="break-all">
                          <span className="font-semibold">{c.field}</span>:{" "}
                          {c.before !== undefined && <span className="text-red-800 line-through">{c.before}</span>}{" "}
                          {c.after !== undefined && <span className="text-green-800">{c.after}</span>}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
