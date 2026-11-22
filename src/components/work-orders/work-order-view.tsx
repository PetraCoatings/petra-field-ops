import { AlertTriangle, ChevronDown, ExternalLink, FileText, Phone } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import type { Step, WorkOrderContent } from "@/domain/work-orders/content";
import { parseDateOnly } from "@/lib/dates";
import { type ProjectSnapshot, snapshotAddress } from "@/lib/work-orders/snapshot";

/**
 * A work order as the crew reads it, laid out like Petra's paper work order:
 * job header with contacts, job summary, trailer and jobsite materials, mix
 * ratios, the day-by-day schedule and drawings, then optional sections.
 * Empty sections are not shown. Used on phones and for the office preview.
 */
export async function WorkOrderView({
  title,
  fwoNumber,
  content: c,
  project,
  fileUrls,
  showHeader = true,
}: {
  title: string;
  fwoNumber: number;
  content: WorkOrderContent;
  project: ProjectSnapshot;
  fileUrls: Map<string, string>;
  /** False on the job screen, which shows the job's live details above the work order. */
  showHeader?: boolean;
}) {
  const t = await getTranslations("workOrders.view");
  const format = await getFormatter();
  const address = snapshotAddress(project);
  const summary = c.summary.filter((r) => r.value.trim());
  const card = "rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm";
  const h2 = "mb-3 text-lg font-bold text-neutral-950";

  return (
    <article className="space-y-4">
      {/* Header: job, address, contacts */}
      {showHeader && (
      <header className={`${card} space-y-2`}>
        <p className="text-sm font-bold uppercase tracking-wide text-brand-700">
          {t("workOrderN", { n: fwoNumber })} · {title}
        </p>
        <h2 className="text-2xl font-bold leading-tight text-neutral-950">{project.name}</h2>
        {project.customer && <p className="text-base text-neutral-700">{project.customer}</p>}
        {address && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-base font-semibold text-brand-700 underline"
          >
            {address}
            <ExternalLink aria-hidden className="size-4" />
            <span className="sr-only">({t("openInMaps")})</span>
          </a>
        )}
        {project.contacts && project.contacts.length > 0 && (
          <ul className="space-y-2 pt-1">
            {project.contacts.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-base">
                  <span className="font-semibold">{p.name}</span>
                  {p.title && <span className="text-neutral-700"> ({p.title})</span>}
                </span>
                {p.phone && (
                  <a
                    href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-brand-600 px-4 font-semibold text-brand-700"
                  >
                    <Phone aria-hidden className="size-5" />
                    {p.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </header>
      )}

      {summary.length > 0 && (
        <section className={card} aria-labelledby="wo-summary">
          <h3 id="wo-summary" className="sr-only">
            {t("summary")}
          </h3>
          <dl className="divide-y divide-neutral-200">
            {summary.map((r, i) => (
              <div key={i} className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
                <dt className="text-sm font-semibold text-neutral-600">{r.label}</dt>
                <dd className="text-base font-semibold text-neutral-950">{r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {(c.trailerMaterials.length > 0 || c.jobsiteMaterials.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {c.trailerMaterials.length > 0 && (
            <section className={card} aria-labelledby="wo-trailer">
              <h3 id="wo-trailer" className={h2}>
                {t("trailer")}
              </h3>
              <ul className="divide-y divide-neutral-200">
                {c.trailerMaterials.map((m, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="text-base">{m.item}</span>
                    {m.qty && <span className="shrink-0 text-base font-bold tabular-nums">{m.qty}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {c.jobsiteMaterials.length > 0 && (
            <section className={card} aria-labelledby="wo-jobsite">
              <h3 id="wo-jobsite" className={h2}>
                {t("jobsite")}
              </h3>
              <ul className="divide-y divide-neutral-200">
                {c.jobsiteMaterials.map((m, i) => (
                  <li key={i} className="py-2">
                    <span className="block text-base">{m.item}</span>
                    {m.note && <span className="block text-sm text-neutral-700">{m.note}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {c.mixRatios.length > 0 && (
        <section className={card} aria-labelledby="wo-mix">
          <h3 id="wo-mix" className={h2}>
            {t("mixRatios")}
          </h3>
          <ul className="divide-y divide-neutral-200">
            {c.mixRatios.map((m, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                <span className="text-base">{m.product}</span>
                <span className="font-mono text-lg font-bold">{m.ratio}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.schedule.length > 0 && (
        <section aria-labelledby="wo-schedule" className="space-y-2">
          <h3 id="wo-schedule" className="px-1 text-lg font-bold text-neutral-950">
            {t("schedule")}
          </h3>
          {c.schedule.map((day, i) => (
            <details key={i} open className={`group ${card} p-0`}>
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-2 px-4 [&::-webkit-details-marker]:hidden">
                <span>
                  <span className="block text-lg font-bold">{day.title}</span>
                  {(day.date || day.startTime) && (
                    <span className="block text-sm font-semibold text-brand-700">
                      {[day.date && format.dateTime(parseDateOnly(day.date), { weekday: "long", month: "short", day: "numeric" }), day.startTime]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </span>
                <ChevronDown aria-hidden className="size-6 shrink-0 text-neutral-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-neutral-200 px-4 py-3">
                <Steps steps={day.steps} importantLabel={t("important")} />
              </div>
            </details>
          ))}
        </section>
      )}

      {c.attachments.length > 0 && (
        <section className={card} aria-labelledby="wo-files">
          <h3 id="wo-files" className={h2}>
            {t("attachments")}
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {c.attachments.map((a) => {
              const url = fileUrls.get(a.path);
              const label = a.caption || a.name;
              return (
                <li key={a.path} className="overflow-hidden rounded-xl border border-neutral-200">
                  {a.contentType === "application/pdf" || !url ? (
                    <a
                      href={url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-16 items-center gap-3 p-3 font-semibold text-brand-700"
                    >
                      <FileText aria-hidden className="size-8 shrink-0" />
                      <span className="min-w-0 break-words">{label}</span>
                    </a>
                  ) : (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from Storage */}
                      <img src={url} alt={label} className="max-h-80 w-full bg-neutral-100 object-contain" loading="lazy" />
                      <span className="block p-2 text-sm font-semibold text-brand-700">
                        {label} · {t("tapToZoom")}
                      </span>
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {c.safety.length > 0 && (
        <section className={`${card} border-l-8 border-l-accent-500`} aria-labelledby="wo-safety">
          <h3 id="wo-safety" className={h2}>
            {t("safety")}
          </h3>
          <Steps steps={c.safety} importantLabel={t("important")} bullets />
        </section>
      )}

      {c.qcTests.length > 0 && (
        <section className={card} aria-labelledby="wo-qc">
          <h3 id="wo-qc" className={h2}>
            {t("qcTests")}
          </h3>
          <ul className="divide-y divide-neutral-200">
            {c.qcTests.map((q, i) => (
              <li key={i} className="py-2">
                <span className="block text-base font-semibold">{q.test}</span>
                {q.target && <span className="block text-sm text-neutral-700">{t("target", { target: q.target })}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.notes.trim() && (
        <section className={card} aria-labelledby="wo-notes">
          <h3 id="wo-notes" className={h2}>
            {t("notes")}
          </h3>
          <p className="whitespace-pre-wrap text-base">{c.notes}</p>
        </section>
      )}

      {c.customSections.map((s, i) => (
        <section key={i} className={card} aria-labelledby={`wo-custom-${i}`}>
          <h3 id={`wo-custom-${i}`} className={h2}>
            {s.title}
          </h3>
          <p className="whitespace-pre-wrap text-base">{s.body}</p>
        </section>
      ))}
    </article>
  );
}

function Steps({ steps, importantLabel, bullets = false }: { steps: Step[]; importantLabel: string; bullets?: boolean }) {
  const List = bullets ? "ul" : "ol";
  return (
    <List className="space-y-2">
      {steps.map((s, i) => (
        <li key={i} className={`flex gap-3 ${s.important ? "rounded-lg bg-red-50 p-2" : ""}`}>
          <span className={`shrink-0 text-base font-bold tabular-nums ${s.important ? "text-red-800" : "text-neutral-500"}`}>
            {bullets ? "•" : `${i + 1}.`}
          </span>
          <span className={`text-base ${s.important ? "font-bold text-red-900" : "text-neutral-950"}`}>
            {s.important && (
              <>
                <AlertTriangle aria-hidden className="mr-1 inline size-5 align-text-bottom text-red-700" />
                <span className="sr-only">{importantLabel}: </span>
              </>
            )}
            {s.text}
          </span>
        </li>
      ))}
    </List>
  );
}
