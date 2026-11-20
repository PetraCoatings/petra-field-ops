import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";

/** Centered card layout for sign-in and password pages. */
export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("common");
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Image
            src="/brand/logo-wide.png"
            alt="Petra Coatings LLC"
            width={900}
            height={215}
            priority
            unoptimized
            className="mx-auto mb-4 h-auto w-full max-w-72"
          />
          <p className="text-xl font-bold text-neutral-950">{t("appName")}</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">{children}</div>
        <div className="flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </main>
  );
}
