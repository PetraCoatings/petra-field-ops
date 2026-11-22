"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileDown, Printer, Share } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";

/**
 * Print / share / download a published work order revision WITHOUT leaving
 * the app. (Opening the PDF itself takes over the screen in the installed
 * phone app, with no way back.)
 *
 *   phones and tablets: "Print or share PDF" opens the share sheet over the
 *     app (Print, Mail, Messages, Save to Files…)
 *   computers: "Print" opens the print dialog on the page; "Download PDF"
 *     saves the file
 *
 * If the share sheet isn't available, falls back to opening the PDF in a new tab.
 */
export function PdfLink({ fwoId, revision, variant = "secondary" }: { fwoId: string; revision?: number; variant?: "secondary" | "ghost" }) {
  const t = useTranslations("workOrders.view");
  const href = `/jobs/library/${fwoId}/pdf${revision ? `?rev=${revision}` : ""}`;
  const [mode, setMode] = useState<"loading" | "share" | "print">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const touch = window.matchMedia("(pointer: coarse)").matches;
    let canShareFiles = false;
    try {
      canShareFiles = Boolean(navigator.canShare?.({ files: [new File([""], "x.pdf", { type: "application/pdf" })] }));
    } catch {
      canShareFiles = false;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser capabilities are only known after mounting
    setMode(touch && canShareFiles ? "share" : "print");
    return () => frame.current?.remove();
  }, []);

  async function fetchPdf(): Promise<File> {
    const res = await fetch(href, { credentials: "same-origin" });
    if (!res.ok) throw new Error(String(res.status));
    const disposition = res.headers.get("content-disposition") ?? "";
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "work-order.pdf";
    return new File([await res.blob()], name, { type: "application/pdf" });
  }

  async function share() {
    setError(false);
    setBusy(true);
    try {
      const file = await fetchPdf();
      await navigator.share({ files: [file], title: file.name.replace(/\.pdf$/, "") });
    } catch (e) {
      // Closing the share sheet isn't an error.
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function print() {
    setError(false);
    setBusy(true);
    try {
      const file = await fetchPdf();
      const url = URL.createObjectURL(file);
      frame.current?.remove();
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
      iframe.src = url;
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.open(url, "_blank", "noopener");
        }
      };
      document.body.appendChild(iframe);
      frame.current = iframe;
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {mode === "share" ? (
        <button type="button" onClick={share} disabled={busy} className={buttonClasses(variant, "md")}>
          <Share aria-hidden className="size-5" />
          {busy ? t("preparingPdf") : t("printOrShare")}
        </button>
      ) : (
        <>
          <button type="button" onClick={print} disabled={busy || mode === "loading"} className={buttonClasses(variant, "md")}>
            <Printer aria-hidden className="size-5" />
            {busy ? t("preparingPdf") : t("print")}
          </button>
          <a href={href} download className={buttonClasses(variant, "md")}>
            <FileDown aria-hidden className="size-5" />
            {t("downloadPdf")}
          </a>
        </>
      )}
      {error && (
        <span role="alert" className="text-sm font-semibold text-red-700">
          {t("pdfFailed")}{" "}
          <a href={href} target="_blank" rel="noopener" className="underline">
            {t("openPdf")}
          </a>
        </span>
      )}
    </div>
  );
}
