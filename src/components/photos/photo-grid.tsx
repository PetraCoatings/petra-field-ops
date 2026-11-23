import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { PhotoRow } from "@/lib/photos/load";

export async function PhotoGrid({ projectId, photos }: { projectId: string; photos: PhotoRow[] }) {
  const t = await getTranslations("photos");
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((p) => (
        <li key={p.id}>
          <Link href={`/jobs/${projectId}/photos/${p.id}`} className="block overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
            {p.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from Storage
              <img src={p.thumbUrl} alt={t("alt", { stage: t(`stages.${p.stage as "before"}`) })} className="aspect-square w-full object-cover" loading="lazy" />
            ) : (
              <span className="flex aspect-square items-center justify-center text-xs text-neutral-500">{t("missing")}</span>
            )}
            <span className="block truncate px-1 py-0.5 text-xs">{t(`stages.${p.stage as "before"}`)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
