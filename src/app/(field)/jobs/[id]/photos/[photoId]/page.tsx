import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button-styles";
import { requireProfile } from "@/lib/auth/dal";
import { canAccessManagement } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { deletePhoto, updatePhoto } from "@/lib/actions/photos";
import { directoryNames } from "@/lib/db/queries";
import { PHOTO_STAGES } from "@/domain/reports/field";
import { serverNow } from "@/lib/time/my-time";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("photos");
  return { title: t("photo") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One photo, full size, with its stage and note; remove (office, or the person who took it the same day). */
export default async function PhotoPage({ params }: PageProps<"/jobs/[id]/photos/[photoId]">) {
  const profile = await requireProfile();
  const { id, photoId } = await params;
  if (!UUID.test(id) || !UUID.test(photoId)) notFound();
  const t = await getTranslations("photos");
  const format = await getFormatter();
  const supabase = await createClient();
  const { data: p } = await supabase.from("photos").select("*").eq("id", photoId).eq("project_id", id).maybeSingle();
  if (!p) notFound();
  const { data: signed } = await supabase.storage.from("job-photos").createSignedUrl(p.storage_path as string, 3600);
  const { data: download } = await supabase.storage.from("job-photos").createSignedUrl(p.storage_path as string, 3600, { download: `photo-${(p.taken_at as string | null)?.slice(0, 10) ?? "job"}.jpg` });
  const names = await directoryNames([p.uploaded_by as string | null]);
  const office = canAccessManagement(profile.role);
  const mine = p.uploaded_by === profile.employeeId;
  const canEdit = office || mine;
  const canDelete = office || (mine && serverNow() - Date.parse(p.created_at as string) < 24 * 3_600_000);
  return (
    <>
      <PageHeader title={t(`stages.${p.stage as "before"}`)} backHref={`/jobs/${id}/photos`} backLabel={t("title")} />
      <div className="space-y-4">
        {signed?.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from Storage
          <img src={signed.signedUrl} alt={t("alt", { stage: t(`stages.${p.stage as "before"}`) })} className="max-h-[75vh] w-full rounded-2xl bg-neutral-900 object-contain" />
        ) : (
          <p className="text-neutral-600">{t("missing")}</p>
        )}
        <p className="text-sm text-neutral-700">
          {t("takenBy", {
            name: names.get(p.uploaded_by as string)?.display_name ?? "?",
            when: format.dateTime(new Date((p.taken_at as string | null) ?? (p.created_at as string)), { dateStyle: "medium", timeStyle: "short" }),
          })}
          {p.width && ` · ${p.width} × ${p.height}`}
        </p>
        {download?.signedUrl && (
          <a href={download.signedUrl} className={buttonClasses("secondary", "md")}>
            {t("download")}
          </a>
        )}
        {canEdit ? (
          <form action={updatePhoto} className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-4">
            <input type="hidden" name="id" value={photoId} />
            <label className="block space-y-1">
              <span className="block text-sm font-semibold">{t("stage")}</span>
              <select name="stage" defaultValue={p.stage as string} className="block min-h-11 w-full rounded-lg border-2 border-neutral-300 bg-white px-3 text-base">
                {PHOTO_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {t(`stages.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="block text-sm font-semibold">{t("notes")}</span>
              <input name="notes" defaultValue={(p.notes as string | null) ?? ""} maxLength={500} className="block min-h-11 w-full rounded-lg border-2 border-neutral-300 px-3 text-base" />
            </label>
            <button type="submit" className={buttonClasses("secondary", "md")}>
              {t("save")}
            </button>
          </form>
        ) : (
          p.notes && <p className="rounded-2xl border border-neutral-200 bg-white p-4">{p.notes as string}</p>
        )}
        {canDelete && (
          <form action={deletePhoto}>
            <input type="hidden" name="id" value={photoId} />
            <button type="submit" className="min-h-11 font-semibold text-red-800 underline">
              {t("remove")}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
