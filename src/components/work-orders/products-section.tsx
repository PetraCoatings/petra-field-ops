"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { mixRatioLabel } from "@/domain/library/product";
import type { ProductRef, WorkOrderContent } from "@/domain/work-orders/content";
import type { PickerProduct } from "@/lib/library/picker-types";
import { RowList } from "./row-list";

/**
 * "Products and data sheets" in the work order editor. Adding a product pins
 * the TDS and SDS versions current right now; a newer upload later shows
 * "newer version available" and is only used if the office updates it here.
 * In the template editor (`pin` false) products are listed without versions.
 */
export function ProductsSection({
  c,
  set,
  products,
  pin,
}: {
  c: WorkOrderContent;
  set: <K extends keyof WorkOrderContent>(key: K, value: WorkOrderContent[K]) => void;
  products: PickerProduct[];
  pin: boolean;
}) {
  const t = useTranslations("workOrders.editor.productsSection");
  const [chosen, setChosen] = useState("");
  const byId = new Map(products.map((p) => [p.id, p]));
  const available = products.filter((p) => !c.products.some((x) => x.productId === p.id));

  const add = () => {
    const p = byId.get(chosen);
    if (!p) return;
    const ref: ProductRef = {
      productId: p.id,
      name: p.name,
      ...(p.manufacturer ? { manufacturer: p.manufacturer } : {}),
      ...(pin && p.tdsVersionId ? { tdsVersionId: p.tdsVersionId } : {}),
      ...(pin && p.sdsVersionId ? { sdsVersionId: p.sdsVersionId } : {}),
    };
    set("products", [...c.products, ref]);
    // Fill in its mix ratio, unless one is already listed for this product.
    const ratio = mixRatioLabel({ mix_ratio_a: p.mixRatioA, mix_ratio_b: p.mixRatioB, mix_ratio_text: p.mixRatioText });
    if (ratio && !c.mixRatios.some((m) => m.product.trim().toLowerCase().startsWith(p.name.trim().toLowerCase()))) {
      set("mixRatios", [...c.mixRatios, { product: p.name, ratio: p.ratioBasis === "weight" ? `${ratio} (${t("byWeight")})` : ratio }]);
    }
    setChosen("");
  };

  const update = (i: number) => {
    const ref = c.products[i];
    const p = byId.get(ref.productId);
    if (!p) return;
    const next = [...c.products];
    next[i] = {
      ...ref,
      ...(p.tdsVersionId ? { tdsVersionId: p.tdsVersionId } : {}),
      ...(p.sdsVersionId ? { sdsVersionId: p.sdsVersionId } : {}),
    };
    set("products", next);
  };

  return (
    <div className="space-y-3">
      {c.products.length > 0 && (
        <RowList<ProductRef>
          rows={c.products}
          onChange={(rows) => set("products", rows)}
          newRow={() => c.products[0]}
          canAdd={false}
          addLabel=""
          rowLabel={(i) => c.products[i]?.name ?? ""}
          renderRow={(ref, _u, i) => {
            const live = byId.get(ref.productId);
            const newer =
              pin && live && ((live.tdsVersionId && live.tdsVersionId !== ref.tdsVersionId) || (live.sdsVersionId && live.sdsVersionId !== ref.sdsVersionId));
            return (
              <div className="space-y-1 p-1">
                <p className="font-semibold">
                  {ref.name}
                  {ref.manufacturer && <span className="font-normal text-neutral-600"> · {ref.manufacturer}</span>}
                </p>
                {pin && (
                  <p className="flex flex-wrap gap-3 text-sm">
                    <span className={`inline-flex items-center gap-1 ${ref.tdsVersionId ? "text-green-800" : "text-neutral-500"}`}>
                      <FileText aria-hidden className="size-4" />
                      {ref.tdsVersionId ? t("tdsPinned") : t("noTds")}
                    </span>
                    <span className={`inline-flex items-center gap-1 ${ref.sdsVersionId ? "text-green-800" : "text-neutral-500"}`}>
                      <ShieldAlert aria-hidden className="size-4" />
                      {ref.sdsVersionId ? t("sdsPinned") : t("noSds")}
                    </span>
                  </p>
                )}
                {newer && (
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-amber-900">
                    {t("newerAvailable")}
                    <button type="button" onClick={() => update(i)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-brand-700 underline">
                      <RefreshCw aria-hidden className="size-4" />
                      {t("useNewer")}
                    </button>
                  </p>
                )}
                {!live && <p className="text-sm text-neutral-600">{t("notInLibrary")}</p>}
              </div>
            );
          }}
        />
      )}
      {products.length === 0 ? (
        <p className="text-sm text-neutral-600">{t("noProducts")}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor="wo-add-product" className="block text-xs font-semibold uppercase tracking-wide text-neutral-600">
              {t("choose")}
            </label>
            <select
              id="wo-add-product"
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              className="block min-h-11 w-full rounded-lg border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
            >
              <option value="">{t("chooseOption")}</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.manufacturer ? `${p.name} (${p.manufacturer})` : p.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={add} disabled={!chosen} className={buttonClasses("secondary", "md")}>
            <Plus aria-hidden className="size-5" />
            {t("add")}
          </button>
        </div>
      )}
    </div>
  );
}
