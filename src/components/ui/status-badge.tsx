import { useTranslations } from "next-intl";

const colors: Record<string, string> = {
  draft: "bg-neutral-200 text-neutral-800",
  scheduled: "bg-brand-100 text-brand-900",
  in_progress: "bg-green-100 text-green-900",
  on_hold: "bg-amber-100 text-amber-950",
  completed: "bg-emerald-700 text-white",
  closed: "bg-neutral-700 text-white",
};

export type ProjectStatus = "draft" | "scheduled" | "in_progress" | "on_hold" | "completed" | "closed";

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const t = useTranslations("jobs.status");
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${colors[status]}`}>
      {t(status)}
    </span>
  );
}
