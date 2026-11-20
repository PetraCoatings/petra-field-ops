import { getFormatter, getTranslations } from "next-intl/server";
import { Droplets, FlaskConical, Layers, PaintBucket, Ruler } from "lucide-react";
import { Card } from "@/components/ui/card";
import { splitUnits } from "@/domain/calculators/mix-ratio";
import type { CalculationType, SavedInputs, SavedOutputs } from "@/domain/calculators/saved";
import type { Profile } from "@/lib/auth/dal";
import { canAccessManagement } from "@/lib/auth/roles";
import { directoryNames } from "@/lib/db/queries";
import { createClient } from "@/lib/supabase/server";
import { DeleteSavedButton } from "./delete-saved-button";

type Row = {
  id: string;
  type: CalculationType;
  label: string | null;
  inputs: unknown;
  outputs: unknown;
  created_by: string | null;
  created_at: string;
};

const ICONS = { square_footage: Ruler, spread_rate: Layers, material_quantity: PaintBucket, mix_ratio: FlaskConical, dew_point: Droplets };
const TITLE_KEY = {
  square_footage: "squareFootage",
  spread_rate: "spreadRate",
  material_quantity: "materialQuantity",
  mix_ratio: "mixRatio",
  dew_point: "dewPoint",
} as const;

/** Calculator results saved on a project, newest first. RLS limits rows to people who can see the project. */
export async function SavedCalculations({ projectId, profile }: { projectId: string; profile: Profile }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("saved_calculations")
    .select("id, type, label, inputs, outputs, created_by, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as Row[];
  const t = await getTranslations("calculators");
  const format = await getFormatter();
  const names = await directoryNames(rows.map((r) => r.created_by));
  const office = canAccessManagement(profile.role);

  const n = (x: number, digits = 2) => format.number(x, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const pct = (x: number) => format.number(x, { maximumFractionDigits: 1 });

  function describe(r: Row): { headline: string; details: string[] } {
    switch (r.type) {
      case "square_footage": {
        const i = r.inputs as SavedInputs["square_footage"];
        const o = r.outputs as SavedOutputs["square_footage"];
        return {
          headline: t("saved.squareFootage.headline", { net: n(o.net) }),
          details: [t("saved.squareFootage.detail", { count: i.areas.length, added: n(o.added), subtracted: n(o.subtracted) })],
        };
      }
      case "spread_rate": {
        const i = r.inputs as SavedInputs["spread_rate"];
        const o = r.outputs as SavedOutputs["spread_rate"];
        if (i.mode === "fromRate") {
          return {
            headline: t("saved.spreadRate.fromRate", { rate: n(i.spreadRate, 1), wft: n(o.wft) }),
            details:
              o.dft !== undefined && i.volumeSolidsPct !== undefined
                ? [t("saved.spreadRate.dry", { dft: n(o.dft), pct: pct(i.volumeSolidsPct) })]
                : [],
          };
        }
        const headline =
          i.basis === "wft"
            ? t("saved.spreadRate.fromMilsWet", { mils: n(i.mils), rate: n(o.spreadRate, 1) })
            : t("saved.spreadRate.fromMilsDry", { mils: n(i.mils), pct: pct(i.volumeSolidsPct ?? 0), rate: n(o.spreadRate, 1) });
        const details: string[] = [];
        if (i.basis === "wft" && o.dft !== undefined && i.volumeSolidsPct !== undefined)
          details.push(t("saved.spreadRate.dry", { dft: n(o.dft), pct: pct(i.volumeSolidsPct) }));
        if (o.practicalSpreadRate !== undefined && i.lossPct !== undefined)
          details.push(t("saved.spreadRate.practical", { rate: n(o.practicalSpreadRate, 1), loss: pct(i.lossPct) }));
        return { headline, details };
      }
      case "material_quantity": {
        const i = r.inputs as SavedInputs["material_quantity"];
        const o = r.outputs as SavedOutputs["material_quantity"];
        const details = [
          t("saved.materialQuantity.detail", { area: n(i.areaSqft), coats: i.coats, rate: n(o.spreadRate, 1), waste: pct(i.wastePct) }),
        ];
        if (o.kits !== undefined && i.kitGallons !== undefined)
          details.push(t("materialQuantity.kits", { count: o.kits, size: pct(i.kitGallons), leftover: n(o.leftoverGallons ?? 0) }));
        return { headline: t("saved.materialQuantity.headline", { total: n(o.totalGallons) }), details };
      }
      case "mix_ratio": {
        const i = r.inputs as SavedInputs["mix_ratio"];
        const o = r.outputs as SavedOutputs["mix_ratio"];
        const large = i.basis === "volume" ? t("galUnit") : t("lbUnit");
        const small = i.basis === "volume" ? t("flOzUnit") : t("ozUnit");
        const both = (x: number) => {
          const s = splitUnits(x, i.basis);
          return s.large > 0 ? `${s.large} ${large} ${n(s.small, 1)} ${small}` : `${n(s.small, 1)} ${small}`;
        };
        return {
          headline: t("saved.mixRatio.headline", { a: both(o.a), b: both(o.b) }),
          details: [
            t("saved.mixRatio.detail", {
              ratioA: pct(i.ratioA),
              ratioB: pct(i.ratioB),
              basis: t(`mixRatio.bases.${i.basis}`).toLowerCase(),
              total: both(o.total),
            }),
          ],
        };
      }
      case "dew_point": {
        const i = r.inputs as SavedInputs["dew_point"];
        const o = r.outputs as SavedOutputs["dew_point"];
        const deg = (x: number) => `${n(x, 1)} °${i.unit}`;
        const details = [t("saved.dewPoint.detail", { air: deg(i.airTemp), rh: pct(i.relativeHumidity), margin: deg(o.margin) })];
        if (i.substrateTemp !== undefined && o.status)
          details.push(`${t("saved.dewPoint.surface", { surface: deg(i.substrateTemp) })} · ${t(`dewPoint.status.${o.status}.title`)}`);
        return { headline: t("saved.dewPoint.headline", { dp: deg(o.dewPoint) }), details };
      }
    }
  }

  return (
    <Card title={t("saved.title")}>
      {rows.length === 0 ? (
        <p className="text-neutral-700">{t("saved.empty")}</p>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {rows.map((r) => {
            const Icon = ICONS[r.type];
            const d = describe(r);
            const who = (r.created_by && names.get(r.created_by)?.display_name) || t("saved.formerEmployee");
            const canDelete = office || r.created_by === profile.employeeId;
            const title = t(`${TITLE_KEY[r.type]}.title`);
            return (
              <li key={r.id} className="flex gap-3 py-3">
                <Icon aria-hidden className="mt-1 size-6 shrink-0 text-brand-700" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-semibold uppercase tracking-wide text-neutral-600">
                    {title}
                    {r.label && <span className="normal-case tracking-normal text-neutral-900"> · {r.label}</span>}
                  </p>
                  <p className="text-lg font-bold tabular-nums text-neutral-950">{d.headline}</p>
                  {d.details.map((line, k) => (
                    <p key={k} className="text-sm text-neutral-700 tabular-nums">
                      {line}
                    </p>
                  ))}
                  <p className="text-sm text-neutral-500">
                    {t("saved.by", { name: who, when: format.dateTime(new Date(r.created_at), { dateStyle: "medium", timeStyle: "short" }) })}
                  </p>
                </div>
                {canDelete && (
                  <DeleteSavedButton
                    id={r.id}
                    projectId={projectId}
                    label={`${t("saved.delete")}: ${title}`}
                    confirm={t("saved.confirmDelete")}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
