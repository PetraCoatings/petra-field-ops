"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CloudOff, Download, Minus, Plus, Trash2 } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { PdfLink } from "@/components/work-orders/pdf-link";
import { fileUrl, listSaved, loadDocBytes, removeDoc, saveDoc } from "@/lib/offline/saved-documents";
import { PDFJS_STANDARD_FONTS_URL, PDFJS_WORKER_URL } from "@/lib/pdfjs";

type Status = "loading" | "ready" | "offline-missing" | "error";

/**
 * Shows a data sheet PDF inside the app (with the app's header and back link),
 * page by page, using PDF.js. Works offline for documents saved on the phone.
 */
export function PdfViewer({ versionId, title, offerSave }: { versionId: string; title: string; offerSave: boolean }) {
  const t = useTranslations("libraryView");
  const pagesRef = useRef<HTMLDivElement>(null);
  const bytesRef = useRef<ArrayBuffer | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fromPhone, setFromPhone] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const render = useCallback(async (bytes: ArrayBuffer, scaleFactor: number) => {
    const host = pagesRef.current;
    if (!host) return;
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), standardFontDataUrl: PDFJS_STANDARD_FONTS_URL }).promise;
    setPageCount(doc.numPages);
    host.replaceChildren();
    const width = host.clientWidth || 360;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const cssWidth = width * scaleFactor;
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${(cssWidth / base.width) * base.height}px`;
      canvas.className = "mx-auto mb-3 block bg-white shadow";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", t("pageOf", { n, total: doc.numPages }));
      host.appendChild(canvas);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflects what's saved on this phone
    setSaved(listSaved().some((d) => d.versionId === versionId));
    void (async () => {
      const got = await loadDocBytes(versionId);
      if (cancelled) return;
      if (!got) {
        setStatus(navigator.onLine ? "error" : "offline-missing");
        return;
      }
      bytesRef.current = got.bytes;
      setFromPhone(got.fromPhone);
      try {
        await render(got.bytes, 1);
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [versionId, render]);

  const changeZoom = (next: number) => {
    const z = Math.min(3, Math.max(0.6, Math.round(next * 10) / 10));
    setZoom(z);
    if (bytesRef.current) void render(bytesRef.current, z);
  };

  const toggleSave = async () => {
    setSaving(true);
    if (saved) {
      await removeDoc(versionId);
      setSaved(false);
    } else {
      setSaved(await saveDoc(versionId, title, bytesRef.current ?? undefined));
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {offerSave && status === "ready" && (
          <button type="button" onClick={toggleSave} disabled={saving} aria-pressed={saved} className={buttonClasses(saved ? "primary" : "secondary", "md")}>
            {saved ? <Trash2 aria-hidden className="size-5" /> : <Download aria-hidden className="size-5" />}
            {saved ? t("removeFromPhone") : t("saveOnPhone")}
          </button>
        )}
        {status === "ready" && <PdfLink href={fileUrl(versionId)} />}
      </div>
      {saved && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-green-50 px-3 py-2 text-sm font-semibold text-green-900">
          <CloudOff aria-hidden className="size-5" />
          {t("savedNote")}
        </p>
      )}
      {fromPhone && <p className="rounded-xl bg-neutral-200 px-3 py-2 text-sm font-semibold">{t("fromPhone")}</p>}

      {status === "ready" && (
        <div className="sticky top-14 z-[5] flex items-center justify-between gap-2 rounded-xl bg-white/95 px-2 py-1 shadow-sm backdrop-blur">
          <span className="px-2 text-sm text-neutral-700">{t("pages", { count: pageCount })}</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => changeZoom(zoom - 0.25)} aria-label={t("zoomOut")} className="flex size-11 items-center justify-center rounded-lg hover:bg-neutral-100">
              <Minus aria-hidden className="size-5" />
            </button>
            <button type="button" onClick={() => changeZoom(1)} className="min-h-11 rounded-lg px-2 text-sm font-semibold tabular-nums hover:bg-neutral-100">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={() => changeZoom(zoom + 0.25)} aria-label={t("zoomIn")} className="flex size-11 items-center justify-center rounded-lg hover:bg-neutral-100">
              <Plus aria-hidden className="size-5" />
            </button>
          </div>
        </div>
      )}

      {status === "loading" && <p className="rounded-2xl bg-white p-6 text-center text-lg text-neutral-700">{t("loading")}</p>}
      {status === "offline-missing" && <p className="rounded-2xl bg-white p-6 text-center text-lg text-neutral-700">{t("offlineMissing")}</p>}
      {status === "error" && (
        <p role="alert" className="rounded-2xl bg-white p-6 text-center text-lg text-neutral-700">
          {t("error")}{" "}
          <a href={fileUrl(versionId)} className="font-semibold text-brand-700 underline">
            {t("openDirectly")}
          </a>
        </p>
      )}
      <div ref={pagesRef} className="-mx-4 overflow-x-auto bg-neutral-200 px-2 py-3" aria-label={title} />
    </div>
  );
}
