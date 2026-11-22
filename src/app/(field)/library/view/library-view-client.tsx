"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PdfViewer } from "@/components/library/pdf-viewer";
import { PageHeader } from "@/components/ui/page-header";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function LibraryViewClient() {
  const t = useTranslations("libraryView");
  const sp = useSearchParams();
  const v = sp.get("v");
  const versionId = v && UUID_RE.test(v) ? v : null;
  const name = (sp.get("name") ?? "").slice(0, 200);
  const rawBack = sp.get("back") ?? "";
  const back = /^\/[A-Za-z0-9/_?=&.%+-]*$/.test(rawBack) && !rawBack.startsWith("//") ? rawBack : "/sds";
  return (
    <>
      <PageHeader title={name || t("title")} backHref={back} backLabel={t("back")} />
      {versionId ? (
        <PdfViewer key={versionId} versionId={versionId} title={name || t("title")} offerSave={sp.get("type") === "sds"} />
      ) : (
        <p className="text-lg">{t("notFound")}</p>
      )}
    </>
  );
}
