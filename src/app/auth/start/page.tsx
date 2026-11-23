import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StartLink } from "./start-link";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.start");
  return { title: t("title") };
}

/**
 * Landing page for sign-in links the office texts to someone. The one-time
 * token is only used when the person taps "Continue", so a messaging app
 * opening the link to build a preview can't use it up.
 */
export default function StartPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <StartLink />
      </div>
    </main>
  );
}
