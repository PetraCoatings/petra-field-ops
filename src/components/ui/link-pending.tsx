"use client";
import { useLinkStatus } from "next/link";
import { ChevronLeft, LoaderCircle } from "lucide-react";

/** Inside a back link: the arrow turns into a spinner the moment it's tapped. */
export function BackLinkIcon() {
  const { pending } = useLinkStatus();
  return pending ? <LoaderCircle aria-hidden className="size-5 motion-safe:animate-spin" /> : <ChevronLeft aria-hidden className="size-5" />;
}
