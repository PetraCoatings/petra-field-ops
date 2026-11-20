import Image from "next/image";

/**
 * The Petra logo. On dark headers it sits on a white tile so the blue diamond
 * stays visible against the navy background.
 */
export function BrandMark({ size, onDark = false }: { size: number; onDark?: boolean }) {
  const img = <Image src="/icons/logo.png" alt="" width={size} height={size} priority unoptimized />;
  if (!onDark) return <span aria-hidden className="inline-flex">{img}</span>;
  return (
    <span aria-hidden className="inline-flex items-center justify-center rounded-lg bg-white p-1">
      {img}
    </span>
  );
}
