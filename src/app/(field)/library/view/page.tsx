import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireProfile } from "@/lib/auth/dal";
import { LibraryViewClient } from "./library-view-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("libraryView");
  return { title: t("title") };
}

/**
 * /library/view?v=<version id>&name=<title>&back=<path>&type=sds
 * One page for every data sheet. Which sheet to show is read from the address
 * in the browser (not baked in by the server), so the phone's single offline
 * copy of this page works for every saved sheet.
 */
export default async function LibraryViewPage() {
  await requireProfile();
  return (
    <Suspense>
      <LibraryViewClient />
    </Suspense>
  );
}
