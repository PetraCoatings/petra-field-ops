"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Save, Send, Trash2, TriangleAlert } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { parseDecimal } from "@/components/calculators/number";
import { materialResult, readingResult, SPREAD_VARIANCE_FLAG_PCT, type ComputeContext, type DfrContent } from "@/domain/reports/dfr";
import { saveDailyReport, type SaveResult } from "@/lib/actions/daily-reports";
import { queueReport, queuedReport } from "@/lib/offline/outbox";
import type { PickerProduct } from "@/lib/library/picker-types";
import { ReadingBadge } from "./dfr-view";

type ReadingRow = { time: string; unit: "F" | "C"; air: string; rh: string; substrate: string; productId: string };
type MaterialRow = { productId: string; product: string; lot: string; gallons: string; area: string; coats: string };
type State = {
  crew: { employeeId?: string; name: string }[];
  workPerformed: string;
  areas: string;
  sqft: string;
  readings: ReadingRow[];
  materials: MaterialRow[];
  notes: string;
  nextSteps: string;
};

const str = (n: number | undefined) => (n === undefined ? "" : String(n));
const num = (s: string) => {
  const n = parseDecimal(s);
  return n === null || !Number.isFinite(n) ? undefined : n;
};

function fromContent(c: Partial<DfrContent>, crewDefault: { employeeId?: string; name: string }[]): State {
  return {
    crew: c.crew?.length ? c.crew : crewDefault,
    workPerformed: c.workPerformed ?? "",
    areas: c.areas ?? "",
    sqft: str(c.sqftCompleted),
    readings: (c.readings ?? []).map((r) => ({ time: r.time ?? "", unit: r.unit, air: str(r.airTemp), rh: str(r.relativeHumidity), substrate: str(r.substrateTemp), productId: r.productId ?? "" })),
    materials: (c.materials ?? []).map((m) => ({ productId: m.productId ?? "", product: m.product, lot: m.lot ?? "", gallons: str(m.gallons), area: str(m.areaSqft), coats: str(m.coats ?? 1) })),
    notes: c.notes ?? "",
    nextSteps: c.nextSteps ?? "",
  };
}

/** What gets sent: empty rows are left out; numbers parsed. */
function toPayload(s: State, products: Map<string, PickerProduct>) {
  return {
    v: 1,
    crew: s.crew.filter((c) => c.name.trim()),
    workPerformed: s.workPerformed,
    areas: s.areas,
    ...(num(s.sqft) !== undefined ? { sqftCompleted: num(s.sqft) } : {}),
    readings: s.readings
      .filter((r) => r.air.trim() || r.rh.trim())
      .map((r) => ({
        ...(r.time ? { time: r.time } : {}),
        unit: r.unit,
        airTemp: num(r.air) ?? Number.NaN,
        relativeHumidity: num(r.rh.replace(/%\s*$/, "")) ?? Number.NaN,
        ...(num(r.substrate) !== undefined ? { substrateTemp: num(r.substrate) } : {}),
        ...(r.productId ? { productId: r.productId, productName: products.get(r.productId)?.name } : {}),
      })),
    materials: s.materials
      .filter((m) => m.product.trim() || m.gallons.trim() || m.area.trim())
      .map((m) => ({
        ...(m.productId ? { productId: m.productId } : {}),
        product: m.product,
        ...(m.lot.trim() ? { lot: m.lot.trim() } : {}),
        gallons: num(m.gallons) ?? Number.NaN,
        areaSqft: num(m.area) ?? Number.NaN,
        coats: Math.max(1, Math.round(num(m.coats) ?? 1)),
      })),
    notes: s.notes,
    nextSteps: s.nextSteps,
  };
}

export function DfrEditor({
  id,
  initial,
  version: initialVersion,
  jobCrew,
  products,
  companyMarginF,
  correctionNote,
  owner,
  reportLabel,
}: {
  id: string;
  initial: Partial<DfrContent>;
  version: number;
  jobCrew: { id: string; name: string }[];
  products: PickerProduct[];
  companyMarginF: number;
  correctionNote: string | null;
  owner: string;
  reportLabel: string;
}) {
  const t = useTranslations("reports");
  const router = useRouter();
  const crewDefault = jobCrew.map((c) => ({ employeeId: c.id, name: c.name }));
  const [s, setS] = useState<State>(() => fromContent(initial, crewDefault));
  const [version, setVersion] = useState(initialVersion);
  // Unsaved typing and saves made with no signal are kept on this phone.
  const localKey = `petra.dfr.${id}`;
  const [restored, setRestored] = useState<"queued" | "typing" | "stale" | null>(null);
  const [stale, setStale] = useState<State | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- restoring what this phone kept, once, after the first render (not available on the server) */
  useEffect(() => {
    const q = queuedReport(id);
    if (q && (q.state === "pending" || q.state === "sending")) {
      setS(fromContent(q.payload.content as Partial<DfrContent>, crewDefault));
      setRestored("queued");
      return;
    }
    try {
      const raw = window.localStorage.getItem(localKey);
      if (!raw) return;
      const local = JSON.parse(raw) as { basedOn: number; state: State };
      if (local.basedOn === initialVersion) {
        setS(local.state);
        setRestored("typing");
      } else {
        setStale(local.state);
        setRestored("stale");
      }
    } catch {
      // ignore
    }
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(localKey, JSON.stringify({ basedOn: version, state: s, at: new Date().toISOString() }));
      } catch {
        // storage full: the queue still keeps saves
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [s, version, localKey]);
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "saved"; text: string } | null>(null);
  const [conflict, setConflict] = useState<Extract<SaveResult, { error: "conflict" }>["server"] | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [extraName, setExtraName] = useState("");
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const ctx: ComputeContext = useMemo(
    () => ({ companyMarginF, products: new Map(products.map((p) => [p.id, { dewPointMarginF: p.dewPointMarginF, coverage: p.coverage }])) }),
    [products, companyMarginF],
  );
  const set = (patch: Partial<State>) => setS((x) => ({ ...x, ...patch }));
  const setReading = (i: number, patch: Partial<ReadingRow>) => setS((x) => ({ ...x, readings: x.readings.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const setMaterial = (i: number, patch: Partial<MaterialRow>) => setS((x) => ({ ...x, materials: x.materials.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));

  const save = (submit: boolean, basedOn = version) =>
    start(async () => {
      setMessage(null);
      setConfirmSubmit(false);
      const content = toPayload(s, byId);
      let r: SaveResult;
      try {
        r = await saveDailyReport({ id, content, basedOn, submit });
      } catch {
        // No signal: keep it on this phone and send it when signal returns.
        queueReport(owner, { reportId: id, href: window.location.pathname, label: reportLabel, content, basedOn, submit, deviceTs: new Date().toISOString() });
        setMessage({ kind: "saved", text: submit ? t("queuedSubmit") : t("queuedSave") });
        return;
      }
      if (r.ok) {
        setConflict(null);
        setVersion(r.version);
        setRestored(null);
        try {
          window.localStorage.removeItem(localKey);
        } catch {
          // ignore
        }
        if (r.submittedVersion) {
          router.refresh();
          return;
        }
        setMessage({ kind: "ok", text: t("saved", { time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }) });
        return;
      }
      if (r.error === "conflict") return setConflict(r.server);
      setMessage({ kind: "error", text: r.error === "invalid" ? t("errors.invalid", { where: t(`fields.${r.path.split(".")[0] as "readings"}`) }) : t(`errors.${r.error}`) });
    });

  const input = "block min-h-11 w-full rounded-lg border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none";
  const label = "block text-sm font-semibold text-neutral-800";
  const card = "space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm";

  return (
    <div className="space-y-4">
      {restored === "queued" && <p role="status" className="rounded-xl border-2 border-dashed border-neutral-400 bg-neutral-50 px-4 py-3">{t("restoredQueued")}</p>}
      {restored === "typing" && <p role="status" className="rounded-xl bg-neutral-100 px-4 py-3">{t("restoredTyping")}</p>}
      {restored === "stale" && stale && (
        <div role="alert" className="space-y-2 rounded-xl border-2 border-accent-600 bg-amber-50 px-4 py-3">
          <p>{t("staleTyping")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setS(stale);
                setRestored("typing");
              }}
              className={buttonClasses("secondary", "md")}
            >
              {t("useMyTyping")}
            </button>
            <button
              type="button"
              onClick={() => {
                setRestored(null);
                try {
                  window.localStorage.removeItem(localKey);
                } catch {
                  // ignore
                }
              }}
              className={buttonClasses("ghost", "md")}
            >
              {t("discardTyping")}
            </button>
          </div>
        </div>
      )}
      {correctionNote && (
        <p role="alert" className="flex gap-2 rounded-xl border-l-4 border-red-700 bg-red-50 px-4 py-3 text-red-950">
          <TriangleAlert aria-hidden className="size-6 shrink-0" />
          {t("correctionAsked", { note: correctionNote })}
        </p>
      )}

      <section aria-label={t("crew")} className={card}>
        <h2 className="text-lg font-bold">{t("crew")}</h2>
        <ul className="space-y-1">
          {[...crewDefault, ...s.crew.filter((c) => !c.employeeId)].map((c) => {
            const checked = s.crew.some((x) => (c.employeeId ? x.employeeId === c.employeeId : x.name === c.name));
            return (
              <li key={c.employeeId ?? c.name}>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => set({ crew: checked ? s.crew.filter((x) => (c.employeeId ? x.employeeId !== c.employeeId : x.name !== c.name)) : [...s.crew, c] })}
                    className="size-6 accent-brand-700"
                  />
                  {c.name}
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-2">
          <input aria-label={t("addPerson")} placeholder={t("addPerson")} value={extraName} onChange={(e) => setExtraName(e.target.value)} className={input} />
          <button
            type="button"
            disabled={!extraName.trim()}
            onClick={() => {
              set({ crew: [...s.crew, { name: extraName.trim() }] });
              setExtraName("");
            }}
            className={buttonClasses("secondary", "md")}
          >
            <Plus aria-hidden className="size-5" />
            {t("add")}
          </button>
        </div>
      </section>

      <section className={card}>
        <label className="block space-y-1">
          <span className={label}>{t("workPerformed")}</span>
          <textarea rows={4} value={s.workPerformed} onChange={(e) => set({ workPerformed: e.target.value })} placeholder={t("workExample")} className={`${input} py-2`} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className={label}>{t("areas")}</span>
            <input value={s.areas} onChange={(e) => set({ areas: e.target.value })} placeholder={t("areasExample")} className={input} />
          </label>
          <label className="block space-y-1">
            <span className={label}>{t("sqft")}</span>
            <input inputMode="decimal" value={s.sqft} onChange={(e) => set({ sqft: e.target.value })} className={input} />
          </label>
        </div>
      </section>

      <section aria-label={t("readings")} className={card}>
        <h2 className="text-lg font-bold">{t("readings")}</h2>
        <p className="text-sm text-neutral-700">{t("readingsHelp")}</p>
        {s.readings.map((r, i) => {
          const air = num(r.air);
          const rh = num(r.rh.replace(/%\s*$/, ""));
          const sub = num(r.substrate);
          const live =
            air !== undefined && rh !== undefined && rh > 0 && rh <= 100
              ? readingResult({ unit: r.unit, airTemp: air, relativeHumidity: rh, substrateTemp: sub, productId: r.productId || undefined }, ctx)
              : null;
          return (
            <fieldset key={i} className="space-y-2 rounded-xl border border-neutral-200 p-3">
              <legend className="px-1 text-sm font-semibold">{t("readingN", { n: i + 1 })}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <label className="block space-y-1">
                  <span className={label}>{t("time")}</span>
                  <input type="time" value={r.time} onChange={(e) => setReading(i, { time: e.target.value })} className={input} />
                </label>
                <label className="block space-y-1">
                  <span className={label}>{t("unit")}</span>
                  <select value={r.unit} onChange={(e) => setReading(i, { unit: e.target.value as "F" | "C" })} className={input}>
                    <option value="F">°F</option>
                    <option value="C">°C</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className={label}>{t("air")}</span>
                  <input inputMode="decimal" value={r.air} onChange={(e) => setReading(i, { air: e.target.value })} className={input} />
                </label>
                <label className="block space-y-1">
                  <span className={label}>{t("rh")}</span>
                  <input inputMode="decimal" value={r.rh} onChange={(e) => setReading(i, { rh: e.target.value })} className={input} />
                </label>
                <label className="block space-y-1">
                  <span className={label}>{t("surfaceTemp")}</span>
                  <input inputMode="decimal" value={r.substrate} onChange={(e) => setReading(i, { substrate: e.target.value })} className={input} />
                </label>
              </div>
              <label className="block space-y-1">
                <span className={label}>{t("forProduct")}</span>
                <select value={r.productId} onChange={(e) => setReading(i, { productId: e.target.value })} className={input}>
                  <option value="">{t("noProduct", { margin: companyMarginF })}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {live && <ReadingBadge result={live} unit={r.unit} />}
              <button type="button" onClick={() => set({ readings: s.readings.filter((_, j) => j !== i) })} className={buttonClasses("ghost", "md")}>
                <Trash2 aria-hidden className="size-5" />
                {t("remove")}
              </button>
            </fieldset>
          );
        })}
        <button
          type="button"
          onClick={() =>
            set({
              readings: [
                ...s.readings,
                { time: new Date().toTimeString().slice(0, 5), unit: s.readings.at(-1)?.unit ?? "F", air: "", rh: "", substrate: "", productId: s.readings.at(-1)?.productId ?? "" },
              ],
            })
          }
          className={buttonClasses("secondary", "md")}
        >
          <Plus aria-hidden className="size-5" />
          {t("addReading")}
        </button>
      </section>

      <section aria-label={t("materials")} className={card}>
        <h2 className="text-lg font-bold">{t("materials")}</h2>
        {s.materials.map((m, i) => {
          const g = num(m.gallons);
          const a = num(m.area);
          const live = g && a && g > 0 && a > 0 ? materialResult({ productId: m.productId || undefined, product: m.product, gallons: g, areaSqft: a, coats: Math.max(1, Math.round(num(m.coats) ?? 1)) }, ctx) : null;
          return (
            <fieldset key={i} className="space-y-2 rounded-xl border border-neutral-200 p-3">
              <legend className="px-1 text-sm font-semibold">{t("materialN", { n: i + 1 })}</legend>
              <label className="block space-y-1">
                <span className={label}>{t("product")}</span>
                <select
                  value={m.productId}
                  onChange={(e) => setMaterial(i, { productId: e.target.value, product: byId.get(e.target.value)?.name ?? (e.target.value ? m.product : "") })}
                  className={input}
                >
                  <option value="">{t("otherProduct")}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {!m.productId && (
                <label className="block space-y-1">
                  <span className={label}>{t("productName")}</span>
                  <input value={m.product} onChange={(e) => setMaterial(i, { product: e.target.value })} className={input} />
                </label>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="block space-y-1">
                  <span className={label}>{t("lot")}</span>
                  <input value={m.lot} onChange={(e) => setMaterial(i, { lot: e.target.value })} className={input} />
                </label>
                <label className="block space-y-1">
                  <span className={label}>{t("gallons")}</span>
                  <input inputMode="decimal" value={m.gallons} onChange={(e) => setMaterial(i, { gallons: e.target.value })} className={input} />
                </label>
                <label className="block space-y-1">
                  <span className={label}>{t("areaSqft")}</span>
                  <input inputMode="decimal" value={m.area} onChange={(e) => setMaterial(i, { area: e.target.value })} className={input} />
                </label>
                <label className="block space-y-1">
                  <span className={label}>{t("coats")}</span>
                  <input inputMode="numeric" value={m.coats} onChange={(e) => setMaterial(i, { coats: e.target.value })} className={input} />
                </label>
              </div>
              {live && (
                <p className={`rounded-lg px-3 py-2 text-sm ${live.variancePct !== undefined && Math.abs(live.variancePct) > SPREAD_VARIANCE_FLAG_PCT ? "bg-amber-50 text-amber-950" : "bg-neutral-100"}`}>
                  {t("actualRate", { rate: live.actualSpreadRate })}
                  {live.targetSpreadRate !== undefined && ` · ${t("targetRate", { rate: live.targetSpreadRate, pct: `${live.variancePct! > 0 ? "+" : ""}${live.variancePct}` })}`}
                </p>
              )}
              <button type="button" onClick={() => set({ materials: s.materials.filter((_, j) => j !== i) })} className={buttonClasses("ghost", "md")}>
                <Trash2 aria-hidden className="size-5" />
                {t("remove")}
              </button>
            </fieldset>
          );
        })}
        <button type="button" onClick={() => set({ materials: [...s.materials, { productId: "", product: "", lot: "", gallons: "", area: "", coats: "1" }] })} className={buttonClasses("secondary", "md")}>
          <Plus aria-hidden className="size-5" />
          {t("addMaterial")}
        </button>
      </section>

      <section className={card}>
        <label className="block space-y-1">
          <span className={label}>{t("notes")}</span>
          <textarea rows={3} value={s.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={t("notesExample")} className={`${input} py-2`} />
        </label>
        <label className="block space-y-1">
          <span className={label}>{t("nextSteps")}</span>
          <textarea rows={2} value={s.nextSteps} onChange={(e) => set({ nextSteps: e.target.value })} className={`${input} py-2`} />
        </label>
      </section>

      {conflict && (
        <div role="alert" className="space-y-2 rounded-2xl border-2 border-red-700 bg-red-50 p-4">
          <p className="font-semibold text-red-950">{t("conflict", { name: conflict.savedBy ?? "?", time: conflict.savedAt ? new Date(conflict.savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "" })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => save(false, conflict.version)} className={buttonClasses("primary", "md")}>
              {t("keepMine")}
            </button>
            <button
              type="button"
              onClick={() => {
                setS(fromContent(conflict.content as Partial<DfrContent>, crewDefault));
                setVersion(conflict.version);
                setConflict(null);
              }}
              className={buttonClasses("secondary", "md")}
            >
              {t("useSaved")}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`rounded-xl px-4 py-3 font-medium ${message.kind === "error" ? "bg-red-50 text-red-900" : message.kind === "saved" ? "bg-neutral-100 text-neutral-900" : "bg-green-50 text-green-900"}`}>
          {message.text}
        </p>
      )}
      <div className="sticky bottom-2 flex flex-wrap gap-2 rounded-2xl border border-neutral-200 bg-white/95 p-3 shadow-lg">
        <button type="button" disabled={busy} onClick={() => save(false)} className={buttonClasses("secondary", "lg")}>
          <Save aria-hidden className="size-6" />
          {busy ? t("saving") : t("saveDraft")}
        </button>
        {!confirmSubmit ? (
          <button type="button" disabled={busy} onClick={() => setConfirmSubmit(true)} className={buttonClasses("primary", "lg")}>
            <Send aria-hidden className="size-6" />
            {t("submit")}
          </button>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{t("confirmSubmit")}</span>
            <button type="button" disabled={busy} onClick={() => save(true)} className={buttonClasses("primary", "md")}>
              {t("yesSubmit")}
            </button>
            <button type="button" onClick={() => setConfirmSubmit(false)} className={buttonClasses("ghost", "md")}>
              {t("cancel")}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
