import { useTranslations } from "next-intl";

const colors = {
  draft: "bg-neutral-200 text-neutral-800",
  published: "bg-green-100 text-green-900",
  void: "bg-neutral-700 text-white",
} as const;

export function WorkOrderStatusBadge({ status }: { status: keyof typeof colors }) {
  const t = useTranslations("workOrders.status");
  return <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${colors[status]}`}>{t(status)}</span>;
}
