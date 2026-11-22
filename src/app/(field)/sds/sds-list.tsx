"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, CloudOff, Search, ShieldAlert } from "lucide-react";
import { viewUrl } from "@/lib/library/view-url";
import { listSaved, type SavedDoc } from "@/lib/offline/saved-documents";

export type SdsItem = { versionId: string; title: string; manufacturer: string | null; revisionDate: string | null };

/** Searchable SDS list; sheets saved on this phone are marked and listed first. */
export function SdsList({ items }: { items: SdsItem[] }) {
  const t = useTranslations("sds");
  const [q, setQ] = useState("");
  const [saved, setSaved] = useState<SavedDoc[]>([]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- what's saved is only known in the browser
  useEffect(() => setSaved(listSaved()), []);
  const savedIds = new Set(saved.map((s) => s.versionId));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = useMemo(
    () => items.filter((i) => words.every((w) => `${i.title} ${i.manufacturer ?? ""}`.toLowerCase().includes(w))),
    [items, words],
  );
  // Saved sheets that are no longer in the list (e.g. offline copy of an older page) still show.
  const savedOnly = saved.filter((s) => !items.some((i) => i.versionId === s.versionId) && words.every((w) => s.title.toLowerCase().includes(w)));

  const row = (versionId: string, title: string, sub: string | null, isSaved: boolean) => (
    <li key={versionId}>
      <Link
        href={viewUrl(versionId, title, "/sds", "sds")}
        className="flex min-h-16 items-center gap-3 rounded-2xl border-2 border-neutral-200 bg-white p-3 hover:border-brand-600"
      >
        <ShieldAlert aria-hidden className="size-7 shrink-0 text-red-700" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold leading-snug">{title}</span>
          {sub && <span className="block text-sm text-neutral-700">{sub}</span>}
        </span>
        {isSaved && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-900">
            <CloudOff aria-hidden className="size-4" />
            {t("onPhone")}
          </span>
        )}
        <ChevronRight aria-hidden className="size-5 shrink-0 text-neutral-500" />
      </Link>
    </li>
  );

  return (
    <div className="space-y-4">
      <p className="text-base text-neutral-700">{t("intro")}</p>
      <div className="relative">
        <label htmlFor="sds-q" className="sr-only">
          {t("search")}
        </label>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-neutral-500" />
        <input
          id="sds-q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white pl-10 pr-3 text-lg focus:border-brand-600 focus:outline-none"
        />
      </div>
      {saved.length > 0 && !q && (
        <section aria-labelledby="sds-saved" className="space-y-2">
          <h2 id="sds-saved" className="px-1 text-lg font-bold">
            {t("savedTitle", { count: saved.length })}
          </h2>
          <ul className="space-y-2">{saved.map((s) => row(s.versionId, s.title, null, true))}</ul>
        </section>
      )}
      <section aria-labelledby="sds-all" className="space-y-2">
        <h2 id="sds-all" className="px-1 text-lg font-bold">
          {t("allTitle", { count: matches.length })}
        </h2>
        {matches.length + savedOnly.length === 0 ? (
          <p className="rounded-2xl bg-white p-6 text-center text-lg text-neutral-700">{q ? t("noMatches") : t("empty")}</p>
        ) : (
          <ul className="space-y-2">
            {matches.map((i) => row(i.versionId, i.title, i.manufacturer, savedIds.has(i.versionId)))}
            {savedOnly.map((s) => row(s.versionId, s.title, null, true))}
          </ul>
        )}
      </section>
    </div>
  );
}
