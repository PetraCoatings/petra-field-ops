"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useHydrated } from "@/lib/use-hydrated";
import { Upload } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { ensureDocument, recordDocumentVersion } from "@/lib/actions/library";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 30 * 1024 * 1024;

async function sha256(file: File): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
}

/** "Sika_200C_SDS-2026.pdf" → "Sika 200C SDS-2026" */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || "Safety data sheet";
}

/**
 * Uploads PDF data sheets. Each file becomes the next version of its document
 * (old versions are kept forever).
 *   target "product": a product's TDS or SDS (one file)
 *   target "document": a new version of an existing document (one file)
 *   target "standalone": each file becomes a new standalone SDS (several files)
 */
export function DocumentUploader({
  target,
  label,
}: {
  target: { kind: "product"; productId: string; docType: "tds" | "sds" } | { kind: "document"; documentId: string } | { kind: "standalone" };
  label: string;
}) {
  const t = useTranslations("library.upload");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [revisionDate, setRevisionDate] = useState("");
  const [status, setStatus] = useState<{ tone: "info" | "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const multiple = target.kind === "standalone";
  const id = `upload-${target.kind === "product" ? `${target.productId}-${target.docType}` : target.kind === "document" ? target.documentId : "standalone"}`;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setStatus(null);
    const supabase = createClient();
    let done = 0;
    const failed: string[] = [];
    for (const file of Array.from(files)) {
      if (file.type !== "application/pdf" || file.size > MAX_BYTES) {
        failed.push(file.name);
        continue;
      }
      setStatus({ tone: "info", text: t("uploading", { name: file.name }) });
      const slot =
        target.kind === "document"
          ? { ok: true as const, id: target.documentId }
          : await ensureDocument(target.kind === "product" ? { productId: target.productId, docType: target.docType } : { standaloneName: nameFromFile(file.name) });
      if (!slot.ok) {
        failed.push(file.name);
        continue;
      }
      const safe = file.name.replace(/[^\w.\- ]+/g, "_").slice(-80);
      const path = `${slot.id}/${crypto.randomUUID()}-${safe}`;
      const { error } = await supabase.storage.from("product-docs").upload(path, file, { contentType: "application/pdf", upsert: false });
      if (error) {
        failed.push(file.name);
        continue;
      }
      const r = await recordDocumentVersion(slot.id, { path, fileName: file.name, size: file.size, sha256: await sha256(file), revisionDate: revisionDate || undefined });
      if (r.ok) done += 1;
      else failed.push(file.name);
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    setRevisionDate("");
    setStatus(
      failed.length
        ? { tone: "error", text: t("failed", { names: failed.join(", ") }) }
        : { tone: "success", text: t("done", { count: done }) },
    );
    router.refresh();
  }

  const ready = useHydrated();
  return (
    <div className="space-y-2" data-ready={ready}>
      <div className="flex flex-wrap items-end gap-2">
        <input ref={input} id={id} type="file" accept="application/pdf" multiple={multiple} onChange={(e) => void upload(e.target.files)} className="sr-only" />
        <label htmlFor={id} className={buttonClasses("secondary", "md", `cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`)}>
          <Upload aria-hidden className="size-5" />
          {busy ? t("busy") : label}
        </label>
        {!multiple && (
          <div className="space-y-1">
            <label htmlFor={`${id}-date`} className="block text-xs font-semibold uppercase tracking-wide text-neutral-600">
              {t("revisionDate")}
            </label>
            <input
              id={`${id}-date`}
              type="date"
              value={revisionDate}
              onChange={(e) => setRevisionDate(e.target.value)}
              className="block min-h-11 rounded-lg border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
            />
          </div>
        )}
      </div>
      {status && (
        <p role={status.tone === "error" ? "alert" : "status"} className={`text-sm font-semibold ${status.tone === "error" ? "text-red-700" : status.tone === "success" ? "text-green-800" : "text-neutral-700"}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}
