"use client";

import { type ReactNode, useId } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";

/**
 * Generic editable list for the work order editor: one row per entry, with
 * move up / move down / remove, and an "Add" button underneath.
 */
export function RowList<T>({
  rows,
  onChange,
  newRow,
  addLabel,
  renderRow,
  rowLabel,
  movable = true,
  canAdd = true,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  newRow: () => T;
  addLabel: string;
  renderRow: (row: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
  /** Accessible name for a row, e.g. "Step 3". */
  rowLabel: (index: number) => string;
  movable?: boolean;
  canAdd?: boolean;
}) {
  const t = useTranslations("workOrders.editor");
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const iconButton =
    "flex size-10 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <ol className="space-y-2">
          {rows.map((row, i) => (
            <li key={i} className="flex items-start gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-2">
              <div className="min-w-0 flex-1">{renderRow(row, (patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r))), i)}</div>
              <div className="flex shrink-0 flex-col sm:flex-row">
                {movable && (
                  <>
                    <button type="button" className={iconButton} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${t("moveUp")}: ${rowLabel(i)}`}>
                      <ArrowUp aria-hidden className="size-5" />
                    </button>
                    <button type="button" className={iconButton} onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`${t("moveDown")}: ${rowLabel(i)}`}>
                      <ArrowDown aria-hidden className="size-5" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={`${iconButton} hover:bg-red-50 hover:text-red-700`}
                  onClick={() => onChange(rows.filter((_, k) => k !== i))}
                  aria-label={`${t("remove")}: ${rowLabel(i)}`}
                >
                  <X aria-hidden className="size-5" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {canAdd && (
      <button
        type="button"
        onClick={() => onChange([...rows, newRow()])}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 px-4 font-semibold text-brand-700 hover:border-brand-600 hover:bg-brand-50"
      >
        <Plus aria-hidden className="size-5" />
        {addLabel}
      </button>
      )}
    </div>
  );
}

/** Small labelled input used inside rows. */
export function RowInput({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  className = "",
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  maxLength?: number;
}) {
  const id = useId();
  const cls =
    "block w-full rounded-lg border-2 border-neutral-300 bg-white px-3 py-2 text-base text-neutral-950 placeholder:text-neutral-400 focus:border-brand-600 focus:outline-none";
  return (
    <div className={`space-y-1 ${className}`}>
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-wide text-neutral-600">
        {label}
      </label>
      {multiline ? (
        <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2} maxLength={maxLength} className={cls} />
      ) : (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength} className={`${cls} min-h-11`} />
      )}
    </div>
  );
}
