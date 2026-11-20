import { LogOut } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonClasses } from "@/components/ui/button-styles";
import { signOut } from "@/lib/actions/auth";

export async function SignOutButton() {
  const t = await getTranslations("common");
  return (
    <form action={signOut}>
      <button type="submit" className={buttonClasses("secondary", "md")}>
        <LogOut aria-hidden className="size-5" />
        {t("signOut")}
      </button>
    </form>
  );
}
