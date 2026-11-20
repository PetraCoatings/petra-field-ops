import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AcceptLink } from "./accept-link";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("finishingSignIn") };
}

export default function AcceptPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <AcceptLink />
      </div>
    </main>
  );
}
