import { FileDown } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonClasses } from "@/components/ui/button-styles";

/** "Download PDF" for a published work order revision (opens in a new tab: print, save or share from there). */
export async function PdfLink({ fwoId, revision, variant = "secondary" }: { fwoId: string; revision?: number; variant?: "secondary" | "ghost" }) {
  const t = await getTranslations("workOrders.view");
  const href = `/jobs/library/${fwoId}/pdf${revision ? `?rev=${revision}` : ""}`;
  return (
    <a href={href} target="_blank" rel="noopener" className={buttonClasses(variant, "md")}>
      <FileDown aria-hidden className="size-5" />
      {t("downloadPdf")}
    </a>
  );
}
