import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, toLocale } from "./locales";

/**
 * Language selection (no locale in the URL):
 *   1. The language cookie (set at sign-in from the employee's saved
 *      preference, or by the switch on the sign-in page).
 *   2. Otherwise the phone/browser language, if it is Spanish.
 *   3. Otherwise English.
 */
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  let locale = toLocale(cookieLocale);
  if (!cookieLocale) {
    const accept = (await headers()).get("accept-language") ?? "";
    if (/^es\b/i.test(accept.trim())) locale = "es";
  }
  return {
    locale,
    timeZone: "America/Chicago",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
