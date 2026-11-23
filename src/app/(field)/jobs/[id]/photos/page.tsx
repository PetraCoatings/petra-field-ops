import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { PhotoGrid } from "@/components/photos/photo-grid";
import { PhotoUploader } from "@/components/photos/photo-uploader";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { jobPhotos } from "@/lib/photos/load";
import { PHOTO_STAGES } from "@/domain/reports/field";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("photos");
  return { title: t("title") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JobPhotosPage({ params, searchParams }: PageProps<"/jobs/[id]/photos">) {
  const profile = await requireProfile();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const stage = typeof sp.stage === "string" && (PHOTO_STAGES as readonly string[]).includes(sp.stage) ? sp.stage : undefined;
  const t = await getTranslations("photos");
  const supabase = await createClient();
  const { data: job } = await supabase.from("projects").select("id, name").eq("id", id).maybeSingle();
  if (!job) notFound();
  const { photos, total } = await jobPhotos(id, { stage, limit: 200 });
  return (
    <>
      <PageHeader title={t("title")} backHref={`/jobs/${id}`} backLabel={job.name as string} />
      <div className="space-y-4">
        <PhotoUploader projectId={id} owner={profile.employeeId} />
        <nav aria-label={t("filter")} className="flex flex-wrap gap-2">
          {[undefined, ...PHOTO_STAGES].map((s) => (
            <Link
              key={s ?? "all"}
              href={s ? `?stage=${s}` : "?"}
              aria-current={s === stage ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm font-semibold ${s === stage ? "border-brand-700 bg-brand-700 text-white" : "border-neutral-300 bg-white"}`}
            >
              {s ? t(`stages.${s}`) : t("allStages")}
            </Link>
          ))}
        </nav>
        {photos.length === 0 ? <p className="text-neutral-600">{t("none")}</p> : <PhotoGrid projectId={id} photos={photos} />}
        {total > photos.length && <p className="text-sm text-neutral-600">{t("showing", { shown: photos.length, total })}</p>}
      </div>
    </>
  );
}
