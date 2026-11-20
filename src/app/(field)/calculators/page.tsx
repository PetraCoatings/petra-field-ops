import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Droplets, FlaskConical, Layers, PaintBucket, Ruler } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/dal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home.modules");
  return { title: t("calculators") };
}

/** The five calculators, in the order a job uses them. `href` is null until built. */
const CALCULATORS = [
  { key: "squareFootage", href: "/calculators/square-footage", Icon: Ruler },
  { key: "spreadRate", href: "/calculators/spread-rate", Icon: Layers },
  { key: "materialQuantity", href: "/calculators/material-quantity", Icon: PaintBucket },
  { key: "mixRatio", href: null, Icon: FlaskConical },
  { key: "dewPoint", href: "/calculators/dew-point", Icon: Droplets },
] as const;

export default async function CalculatorsPage() {
  await requireProfile();
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t("home.modules.calculators")} backHref="/" backLabel={t("common.home")} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {CALCULATORS.map(({ key, href, Icon }) => {
          const body = (
            <>
              <Icon aria-hidden className="size-9 shrink-0 text-brand-700" />
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-bold leading-tight text-neutral-950">{t(`calculators.${key}.title`)}</span>
                <span className="block text-sm text-neutral-700">
                  {href ? t(`calculators.${key}.summary`) : t("calculators.comingSoon")}
                </span>
              </span>
              {href && <ChevronRight aria-hidden className="size-6 shrink-0 text-neutral-500" />}
            </>
          );
          return (
            <li key={key}>
              {href ? (
                <Link
                  href={href}
                  className="flex min-h-20 items-center gap-4 rounded-2xl border-2 border-neutral-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-600 hover:bg-brand-50"
                >
                  {body}
                </Link>
              ) : (
                <div aria-disabled className="flex min-h-20 items-center gap-4 rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-4 opacity-70">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
