import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Larger than this, a PDF is stored and downloaded through a link (web responses are size-limited). */
const DIRECT_LIMIT = 4 * 1024 * 1024;

/**
 * Sends a generated PDF: directly when small, otherwise stored privately at
 * `fwo-files/<storagePath>` and downloaded through a 10-minute link.
 */
export async function deliverPdf(pdf: Buffer, fileName: string, storagePath: string, disposition: "inline" | "attachment" = "inline"): Promise<Response> {
  if (pdf.length > DIRECT_LIMIT && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    const admin = createAdminClient();
    const up = await admin.storage.from("fwo-files").upload(storagePath, pdf, { contentType: "application/pdf", upsert: true });
    if (!up.error) {
      const { data } = await admin.storage.from("fwo-files").createSignedUrl(storagePath, 600, disposition === "attachment" ? { download: fileName } : undefined);
      if (data?.signedUrl) return Response.redirect(data.signedUrl, 303);
    }
  }
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
