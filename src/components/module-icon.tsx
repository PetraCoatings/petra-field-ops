import { Calculator, CalendarDays, Clock, FileText, FolderOpen, ShieldAlert } from "lucide-react";
import type { FieldModuleKey } from "@/lib/auth/roles";

const ICONS: Record<FieldModuleKey, typeof Clock> = {
  timeClock: Clock,
  calculators: Calculator,
  calendar: CalendarDays,
  jobCenter: FolderOpen,
  productData: FileText,
  safetyData: ShieldAlert,
};

export function ModuleIcon({ module, className }: { module: FieldModuleKey; className?: string }) {
  const Icon = ICONS[module];
  return <Icon aria-hidden className={className} />;
}
