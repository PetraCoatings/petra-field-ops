import { useTranslations } from "next-intl";
import { CircleCheck, OctagonAlert, TriangleAlert } from "lucide-react";
import type { DfrContent } from "@/domain/reports/dfr";
import { SPREAD_VARIANCE_FLAG_PCT } from "@/domain/reports/dfr";

/** A submitted daily report, read-only. */
export function DfrView({ content }: { content: DfrContent }) {
  const t = useTranslations("reports");
  const n1 = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return (
    <div className="space-y-3">
      {content.crew.length > 0 && <Block title={t("crew")}>{content.crew.map((c) => c.name).join(", ")}</Block>}
      {content.workPerformed && <Block title={t("workPerformed")}>{content.workPerformed}</Block>}
      {(content.areas || content.sqftCompleted !== undefined) && (
        <Block title={t("areas")}>
          {[content.areas, content.sqftCompleted !== undefined ? t("sqftValue", { sqft: content.sqftCompleted.toLocaleString("en-US") }) : null].filter(Boolean).join(" · ")}
        </Block>
      )}
      {content.readings.length > 0 && (
        <Block title={t("readings")}>
          <ul className="space-y-2">
            {content.readings.map((r, i) => (
              <li key={i} className="space-y-1">
                <p>
                  {r.time && <span className="font-semibold">{r.time} · </span>}
                  {t("readingLine", { air: `${n1(r.airTemp)} °${r.unit}`, rh: `${n1(r.relativeHumidity)}%` })}
                  {r.substrateTemp !== undefined && ` · ${t("surface", { temp: `${n1(r.substrateTemp)} °${r.unit}` })}`}
                  {r.productName && ` · ${r.productName}`}
                </p>
                {r.result && <ReadingBadge result={r.result} unit={r.unit} />}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {content.materials.length > 0 && (
        <Block title={t("materials")}>
          <ul className="space-y-2">
            {content.materials.map((m, i) => (
              <li key={i}>
                <p className="font-semibold">
                  {m.product}
                  {m.lot && <span className="font-normal"> · {t("lotValue", { lot: m.lot })}</span>}
                </p>
                <p>
                  {t("materialLine", { gallons: n1(m.gallons), area: m.areaSqft.toLocaleString("en-US"), coats: m.coats ?? 1 })}
                  {m.result && ` · ${t("actualRate", { rate: n1(m.result.actualSpreadRate) })}`}
                  {m.result?.targetSpreadRate !== undefined && ` (${t("targetRate", { rate: n1(m.result.targetSpreadRate), pct: `${m.result.variancePct! > 0 ? "+" : ""}${m.result.variancePct}` })})`}
                </p>
                {m.result?.variancePct !== undefined && Math.abs(m.result.variancePct) > SPREAD_VARIANCE_FLAG_PCT && (
                  <p className="font-semibold text-amber-900">{t("spreadFlag", { pct: SPREAD_VARIANCE_FLAG_PCT })}</p>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {content.notes && <Block title={t("notes")}>{content.notes}</Block>}
      {content.nextSteps && <Block title={t("nextSteps")}>{content.nextSteps}</Block>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-600">{title}</h3>
      <div className="whitespace-pre-wrap text-base">{children}</div>
    </section>
  );
}

export function ReadingBadge({ result, unit }: { result: NonNullable<DfrContent["readings"][number]["result"]>; unit: "F" | "C" }) {
  const t = useTranslations("reports");
  const deg = `°${unit}`;
  const tone = !result.status ? "bg-neutral-100 text-neutral-900" : result.status === "ok" ? "bg-green-50 text-green-950" : result.status === "belowMargin" ? "bg-amber-50 text-amber-950" : "bg-red-50 text-red-950";
  const Icon = !result.status || result.status === "ok" ? CircleCheck : result.status === "belowMargin" ? TriangleAlert : OctagonAlert;
  return (
    <p className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${tone}`} role={result.status && result.status !== "ok" ? "alert" : undefined}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        {t("dewPointLine", { dp: `${result.dewPoint} ${deg}` })}
        {result.status &&
          ` · ${t(`status.${result.status}`, { spread: `${Math.abs(result.spread ?? 0).toFixed(1)} ${deg}`, margin: `${result.margin} ${deg}` })}`}
        {` · ${result.marginSource === "product" ? t("marginProduct", { margin: `${result.marginF} °F` }) : t("marginCompany", { margin: `${result.marginF} °F` })}`}
      </span>
    </p>
  );
}
