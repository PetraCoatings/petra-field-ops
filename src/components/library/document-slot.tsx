import { FileText } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { directoryNames } from "@/lib/db/queries";
import { parseDateOnly } from "@/lib/dates";
import { DocumentUploader } from "./document-uploader";

export type VersionRow = {
  id: string;
  version: number;
  file_name: string;
  file_size: number;
  revision_date: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
};

/** A product's TDS or SDS in the office: current version, history, and "Upload new version". */
export async function DocumentSlot({
  productId,
  docType,
  versions,
}: {
  productId: string;
  docType: "tds" | "sds";
  versions: VersionRow[];
}) {
  const t = await getTranslations("library");
  const format = await getFormatter();
  const names = await directoryNames(versions.map((v) => v.uploaded_by));
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const [current, ...older] = sorted;
  const describe = (v: VersionRow) =>
    [
      t("versionN", { n: v.version }),
      v.revision_date ? t("revisedOn", { date: format.dateTime(parseDateOnly(v.revision_date), { dateStyle: "medium" }) }) : null,
      t("uploadedBy", { name: (v.uploaded_by && names.get(v.uploaded_by)?.display_name) || t("someone"), when: format.dateTime(new Date(v.uploaded_at), { dateStyle: "medium" }) }),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <section aria-label={t(`docTypes.${docType}`)} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-bold">{t(`docTypes.${docType}`)}</h3>
      {current ? (
        <a href={`/documents/${current.id}`} target="_blank" rel="noopener" className="flex items-center gap-3 rounded-xl border-2 border-neutral-200 p-3 hover:border-brand-600">
          <FileText aria-hidden className="size-8 shrink-0 text-red-700" />
          <span className="min-w-0">
            <span className="block break-words font-semibold text-brand-700 underline">{current.file_name}</span>
            <span className="block text-sm text-neutral-700">{describe(current)}</span>
          </span>
        </a>
      ) : (
        <p className="text-neutral-700">{t("noFile")}</p>
      )}
      <DocumentUploader target={{ kind: "product", productId, docType }} label={current ? t("upload.newVersion") : t("upload.first")} />
      {older.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-neutral-700">{t("olderVersions", { count: older.length })}</summary>
          <ul className="mt-2 space-y-1">
            {older.map((v) => (
              <li key={v.id} className="text-sm">
                <a href={`/documents/${v.id}`} target="_blank" rel="noopener" className="font-semibold text-brand-700 underline">
                  {v.file_name}
                </a>{" "}
                <span className="text-neutral-600">{describe(v)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
