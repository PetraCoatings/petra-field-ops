"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BookmarkPlus, CircleCheck } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import type { CalculationType } from "@/domain/calculators/saved";
import { listSaveTargets, saveCalculation, type SaveTarget } from "@/lib/actions/saved-calculations";

type Phase =
  | { step: "closed" }
  | { step: "loading" }
  | { step: "choose"; targets: SaveTarget[] }
  | { step: "saved"; projectId: string; projectName: string };

type ErrorKey = "offline" | "invalid" | "forbidden" | "generic";

/**
 * "Save to job…" under a calculator result. `inputs` is null until the
 * calculator has a complete, valid result. Only inputs are sent; the server
 * recomputes the result before saving it.
 */
export function SaveToJob({ type, inputs }: { type: CalculationType; inputs: object | null }) {
  const t = useTranslations("calculators.save");
  const [phase, setPhase] = useState<Phase>({ step: "closed" });
  const [projectId, setProjectId] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, startTransition] = useTransition();

  const open = () => {
    setError(null);
    if (!navigator.onLine) {
      setError("offline");
      return;
    }
    setPhase({ step: "loading" });
    startTransition(async () => {
      try {
        const targets = await listSaveTargets();
        setProjectId((cur) => (targets.some((p) => p.id === cur) ? cur : targets.length === 1 ? targets[0].id : ""));
        setPhase({ step: "choose", targets });
      } catch {
        setError(navigator.onLine ? "generic" : "offline");
        setPhase({ step: "closed" });
      }
    });
  };

  const save = () => {
    if (!inputs || !projectId) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await saveCalculation({ projectId, type, inputs, label });
        if (r.ok) {
          setPhase({ step: "saved", projectId: r.projectId, projectName: r.projectName });
          setLabel("");
        } else setError(r.error);
      } catch {
        setError(navigator.onLine ? "generic" : "offline");
      }
    });
  };

  const errorBox = error && (
    <p role="alert" className="rounded-xl border-l-4 border-red-700 bg-red-50 px-4 py-3 text-base font-medium text-red-900">
      {t(`errors.${error}`)}
    </p>
  );

  if (phase.step === "saved") {
    return (
      <div role="status" className="space-y-3 rounded-2xl border-2 border-green-700 bg-green-50 p-4">
        <p className="flex items-center gap-2 text-lg font-bold text-green-950">
          <CircleCheck aria-hidden className="size-6 shrink-0 text-green-700" />
          {t("saved", { project: phase.projectName })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/jobs/${phase.projectId}`} className={buttonClasses("secondary", "md")}>
            {t("openJob")}
          </Link>
          <button type="button" onClick={() => setPhase({ step: "closed" })} className={buttonClasses("ghost", "md")}>
            {t("done")}
          </button>
        </div>
      </div>
    );
  }

  if (phase.step === "choose") {
    const { targets } = phase;
    return (
      <section aria-labelledby="save-to-job-title" className="space-y-3 rounded-2xl border-2 border-brand-600 bg-white p-4 shadow-sm">
        <h2 id="save-to-job-title" className="text-lg font-bold">
          {t("title")}
        </h2>
        {targets.length === 0 ? (
          <p className="text-base text-neutral-800">{t("noJobs")}</p>
        ) : (
          <>
            <div className="space-y-1">
              <label htmlFor="save-project" className="block text-sm font-semibold text-neutral-800">
                {t("job")}
              </label>
              <select
                id="save-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-lg text-neutral-950 focus:border-brand-600 focus:outline-none"
              >
                <option value="">{t("chooseJob")}</option>
                {targets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.jobNumber ? `${p.jobNumber} · ${p.name}` : p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="save-label" className="block text-sm font-semibold text-neutral-800">
                {t("label")}
              </label>
              <input
                id="save-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={120}
                placeholder={t("labelPlaceholder")}
                className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-lg text-neutral-950 placeholder:text-neutral-500 focus:border-brand-600 focus:outline-none"
              />
            </div>
          </>
        )}
        {errorBox}
        <div className="flex flex-wrap gap-2">
          {targets.length > 0 && (
            <button type="button" onClick={save} disabled={!projectId || !inputs || pending} className={buttonClasses("primary", "lg")}>
              {pending ? t("saving") : t("save")}
            </button>
          )}
          <button type="button" onClick={() => setPhase({ step: "closed" })} className={buttonClasses("secondary", "lg")}>
            {t("cancel")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={open}
        disabled={!inputs || phase.step === "loading"}
        className={buttonClasses("secondary", "lg", "w-full")}
      >
        <BookmarkPlus aria-hidden className="size-5" />
        {phase.step === "loading" ? t("loading") : t("button")}
      </button>
      {!inputs && <p className="text-center text-sm text-neutral-600">{t("needsResult")}</p>}
      {errorBox}
    </div>
  );
}
