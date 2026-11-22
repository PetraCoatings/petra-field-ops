"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Plus, RefreshCw, TriangleAlert, X } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { addChecklistItem, setChecklistItem, syncChecklist } from "@/lib/actions/checklists";

type Status = "pending" | "loaded" | "missing";
type Item = {
  id: string;
  item: string;
  qty: string | null;
  source: "work_order" | "added";
  removed_from_work_order: boolean;
  status: Status;
  note: string | null;
  updatedByName: string | null;
};

export function ChecklistEditor({
  where,
  checklistId,
  items: initial,
  canEdit,
  checklistRevision,
  currentRevision,
}: {
  where: { projectId: string; fwoId: string };
  checklistId: string;
  items: Item[];
  canEdit: boolean;
  checklistRevision: number;
  currentRevision: number;
}) {
  const t = useTranslations("checklist");
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [hideLoaded, setHideLoaded] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [newItem, setNewItem] = useState({ item: "", qty: "" });
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // When the server sends fresh items (after adding or syncing), show them.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setItems(initial);
  }

  const active = items.filter((i) => !i.removed_from_work_order);
  const loaded = active.filter((i) => i.status === "loaded").length;
  const missing = active.filter((i) => i.status === "missing").length;
  const pct = active.length ? Math.round((loaded / active.length) * 100) : 0;
  const outdated = currentRevision > checklistRevision;

  const set = (id: string, status: Status, note?: string) => {
    setError(null);
    const before = items;
    setItems((list) => list.map((i) => (i.id === id ? { ...i, status, note: status === "missing" ? (note ?? i.note) : null } : i)));
    startTransition(async () => {
      const r = await setChecklistItem(where, id, status, status === "missing" ? note : undefined);
      if (!r.ok) {
        setItems(before);
        setError(t(navigator.onLine ? `errors.${r.error}` : "errors.offline"));
      }
    });
  };

  const tapMissing = (it: Item) => {
    if (it.status === "missing") {
      set(it.id, "pending");
      return;
    }
    setNoteFor(it.id);
    setNoteText(it.note ?? "");
    set(it.id, "missing", it.note ?? "");
  };

  const saveNote = (id: string) => {
    set(id, "missing", noteText);
    setNoteFor(null);
  };

  const add = () =>
    startTransition(async () => {
      setError(null);
      const r = await addChecklistItem(where, checklistId, newItem.item, newItem.qty);
      if (r.ok) {
        setNewItem({ item: "", qty: "" });
        router.refresh();
      } else setError(t(navigator.onLine ? `errors.${r.error}` : "errors.offline"));
    });

  const sync = () =>
    startTransition(async () => {
      const r = await syncChecklist(where, checklistId);
      if (r.ok) router.refresh();
      else setError(t(navigator.onLine ? `errors.${r.error}` : "errors.offline"));
    });

  const shown = items.filter((i) => !(hideLoaded && i.status === "loaded"));

  return (
    <div className="space-y-4">
      {outdated && (
        <div role="status" className="space-y-2 rounded-2xl border-l-8 border-accent-500 bg-amber-50 p-4">
          <p className="text-base font-bold text-amber-950">{t("outdated", { from: checklistRevision, to: currentRevision })}</p>
          {canEdit && (
            <button type="button" onClick={sync} className={buttonClasses("primary", "md")}>
              <RefreshCw aria-hidden className="size-5" />
              {t("sync")}
            </button>
          )}
        </div>
      )}

      <section aria-label={t("progressLabel")} className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="text-2xl font-bold tabular-nums">{t("progress", { loaded, total: active.length })}</p>
        <div className="h-3 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("progressLabel")}>
          <div className="h-full rounded-full bg-green-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {missing > 0 && (
          <p className="flex items-center gap-2 text-base font-semibold text-red-800">
            <TriangleAlert aria-hidden className="size-5" />
            {t("missingCount", { count: missing })}
          </p>
        )}
        {!canEdit && <p className="text-sm text-neutral-600">{t("viewOnly")}</p>}
        <label className="inline-flex min-h-10 items-center gap-2 text-base">
          <input type="checkbox" checked={hideLoaded} onChange={(e) => setHideLoaded(e.target.checked)} className="size-5 accent-brand-700" />
          {t("hideLoaded")}
        </label>
      </section>

      {error && (
        <p role="alert" className="rounded-xl border-l-4 border-red-700 bg-red-50 px-4 py-3 text-base font-medium text-red-900">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {shown.map((it) => {
          const tone =
            it.status === "loaded" ? "border-green-600 bg-green-50" : it.status === "missing" ? "border-red-600 bg-red-50" : "border-neutral-200 bg-white";
          return (
            <li key={it.id} className={`rounded-2xl border-2 p-3 ${tone} ${it.removed_from_work_order ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className={`text-lg font-semibold leading-snug ${it.status === "loaded" ? "text-green-900" : ""}`}>{it.item}</p>
                  <p className="text-sm text-neutral-700">
                    {[it.qty, it.source === "added" ? t("addedOnSite") : null, it.removed_from_work_order ? t("removed") : null].filter(Boolean).join(" · ")}
                  </p>
                  {it.status !== "pending" && it.updatedByName && (
                    <p className="text-xs text-neutral-600">{t(it.status === "loaded" ? "loadedBy" : "flaggedBy", { name: it.updatedByName })}</p>
                  )}
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => set(it.id, it.status === "loaded" ? "pending" : "loaded")}
                      aria-pressed={it.status === "loaded"}
                      aria-label={`${t("loaded")}: ${it.item}`}
                      className={`flex size-14 items-center justify-center rounded-xl border-2 ${it.status === "loaded" ? "border-green-700 bg-green-700 text-white" : "border-neutral-300 bg-white text-green-800"}`}
                    >
                      <Check aria-hidden className="size-7" />
                    </button>
                    <button
                      type="button"
                      onClick={() => tapMissing(it)}
                      aria-pressed={it.status === "missing"}
                      aria-label={`${t("missing")}: ${it.item}`}
                      className={`flex size-14 items-center justify-center rounded-xl border-2 ${it.status === "missing" ? "border-red-700 bg-red-700 text-white" : "border-neutral-300 bg-white text-red-800"}`}
                    >
                      <X aria-hidden className="size-7" />
                    </button>
                  </div>
                ) : (
                  <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${it.status === "loaded" ? "bg-green-700 text-white" : it.status === "missing" ? "bg-red-700 text-white" : "bg-neutral-200 text-neutral-800"}`}>
                    {t(`status.${it.status}`)}
                  </span>
                )}
              </div>
              {it.status === "missing" &&
                (canEdit && noteFor === it.id ? (
                  <div className="mt-2 flex gap-2">
                    <label htmlFor={`note-${it.id}`} className="sr-only">
                      {t("noteLabel", { item: it.item })}
                    </label>
                    <input
                      id={`note-${it.id}`}
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      maxLength={500}
                      placeholder={t("notePlaceholder")}
                      autoFocus
                      className="block min-h-11 min-w-0 flex-1 rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
                    />
                    <button type="button" onClick={() => saveNote(it.id)} className={buttonClasses("primary", "md")}>
                      {t("saveNote")}
                    </button>
                  </div>
                ) : (
                  (it.note || canEdit) && (
                    <p className="mt-2 text-base text-red-900">
                      {it.note ? <span className="font-semibold">{it.note}</span> : null}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => {
                            setNoteFor(it.id);
                            setNoteText(it.note ?? "");
                          }}
                          className="ml-2 font-semibold text-brand-700 underline"
                        >
                          {it.note ? t("editNote") : t("addNote")}
                        </button>
                      )}
                    </p>
                  )
                ))}
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <section aria-labelledby="add-item" className="space-y-2 rounded-2xl border-2 border-dashed border-neutral-300 bg-white p-4">
          <h2 id="add-item" className="text-base font-bold">
            {t("addTitle")}
          </h2>
          <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
            <div>
              <label htmlFor="new-item" className="sr-only">
                {t("newItem")}
              </label>
              <input
                id="new-item"
                value={newItem.item}
                onChange={(e) => setNewItem((v) => ({ ...v, item: e.target.value }))}
                maxLength={200}
                placeholder={t("newItem")}
                className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-qty" className="sr-only">
                {t("newQty")}
              </label>
              <input
                id="new-qty"
                value={newItem.qty}
                onChange={(e) => setNewItem((v) => ({ ...v, qty: e.target.value }))}
                maxLength={80}
                placeholder={t("newQty")}
                className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
              />
            </div>
            <button type="button" onClick={add} disabled={!newItem.item.trim()} className={buttonClasses("secondary", "lg")}>
              <Plus aria-hidden className="size-5" />
              {t("add")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
