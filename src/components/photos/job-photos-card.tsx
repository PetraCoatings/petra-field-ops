import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Images } from "lucide-react";
import { jobPhotos } from "@/lib/photos/load";
import { PhotoGrid } from "./photo-grid";
import { PhotoUploader } from "./photo-uploader";

/** "Photos" on the job screen: add photos and see the latest ones. */
export async function JobPhotosCard({ projectId }: { projectId: string }) {
  const t = await getTranslations("photos");
  const { photos, total } = await jobPhotos(projectId, { limit: 9 });
  return (
    <section aria-labelledby="photos-card" className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 id="photos-card" className="flex items-center gap-2 text-lg font-bold">
        <Images aria-hidden className="size-6 text-brand-700" />
        {t("title")}
      </h2>
      <PhotoUploader projectId={projectId} />
      {photos.length > 0 && <PhotoGrid projectId={projectId} photos={photos} />}
      {total > photos.length && (
        <Link href={`/jobs/${projectId}/photos`} className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline">
          {t("all", { count: total })}
        </Link>
      )}
    </section>
  );
}
