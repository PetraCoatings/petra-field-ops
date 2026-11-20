import { getTranslations } from "next-intl/server";
import { ModuleIcon } from "@/components/module-icon";
import { PageHeader } from "@/components/ui/page-header";
import type { FieldModuleKey } from "@/lib/auth/roles";

type DescribedModule = Exclude<FieldModuleKey, "jobCenter">;

/** Placeholder screen for modules scheduled in later phases. */
export async function ComingSoon({ module, phase }: { module: DescribedModule; phase: number }) {
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t(`home.modules.${module}`)} backHref="/" backLabel={t("common.home")} />
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-8 text-center">
        <ModuleIcon module={module} className="size-14 text-brand-700" />
        <p className="text-lg text-neutral-800">{t(`modules.${module}`)}</p>
        <p className="text-base font-semibold text-neutral-600">{t("common.comingInPhase", { phase })}</p>
      </div>
    </>
  );
}
