/**
 * Runs on the phone: turns a picked photo into a high-quality JPEG of at most
 * 4096 px on the long edge plus a small thumbnail (owner decision Q12), with
 * the camera's rotation applied. The capture time comes from the file (phones
 * set it to when the photo was taken).
 */
export const MAX_EDGE = 4096;
export const THUMB_EDGE = 480;

export type PreparedPhoto = { full: Blob; thumb: Blob; width: number; height: number; takenAt: string };

/** Fits w×h inside a square of `max`, keeping the shape; never enlarges. */
export function fit(w: number, h: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

async function toJpeg(bitmap: ImageBitmap, max: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fit(bitmap.width, bitmap.height, max);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("could not encode");
  return { blob, width, height };
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const full = await toJpeg(bitmap, MAX_EDGE, 0.88);
    const thumb = await toJpeg(bitmap, THUMB_EDGE, 0.75);
    return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height, takenAt: new Date(file.lastModified || Date.now()).toISOString() };
  } finally {
    bitmap.close();
  }
}
