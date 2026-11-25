import { getTranslations } from "next-intl/server";

/** A grey placeholder card, shown while a section's data loads. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm motion-safe:animate-pulse">
      <div className="h-5 w-1/3 rounded bg-neutral-200" />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 rounded bg-neutral-100" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

/**
 * Shown the instant a link (or Back) is tapped, until the next screen is
 * ready, so a tap never looks like it did nothing.
 */
export async function PageLoading() {
  const t = await getTranslations("common");
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <p className="sr-only">{t("loadingPage")}</p>
      <div aria-hidden className="h-8 w-2/3 rounded-lg bg-neutral-200 motion-safe:animate-pulse" />
      <CardSkeleton lines={4} />
      <CardSkeleton />
      <CardSkeleton lines={2} />
    </div>
  );
}
