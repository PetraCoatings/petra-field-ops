import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { RoleUser } from "./role-users";
import { totp } from "./totp";

// Supabase accepts only about 30 authenticator-code checks per few minutes
// from one address (a guard against guessing codes). The test admin signs in
// many times per run, so each test worker enters the code once and then reuses
// that two-step session's cookies, like a browser that stays signed in.
const twoStepCookies = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

/** Signs in through the sign-in page; office admins also enter their authenticator code. */
export async function signInAs(page: Page, u: Pick<RoleUser, "email" | "password" | "totpSecret">, opts: { fresh?: boolean } = {}): Promise<void> {
  const saved = u.totpSecret && !opts.fresh ? twoStepCookies.get(u.email) : undefined;
  if (saved) {
    await page.context().addCookies(saved);
    await page.goto("/");
    if (new URL(page.url()).pathname === "/") return;
    twoStepCookies.delete(u.email); // signed out since: sign in again
    await page.context().clearCookies();
  }
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (u.totpSecret) {
    await expect(page).toHaveURL(/\/two-step$/);
    // A code can be used only once, and parallel tests share the test admin:
    // if this window's code was just used, wait for the next one.
    for (let attempt = 0; ; attempt++) {
      await page.getByLabel("6-digit code").fill(totp(u.totpSecret));
      await page.getByRole("button", { name: "Confirm" }).click();
      const refused = page.getByRole("alert").filter({ hasText: "That code didn't work" });
      const outcome = await Promise.race([
        page.waitForURL((url) => !url.pathname.startsWith("/two-step"), { timeout: 15_000 }).then(() => "ok" as const),
        refused.waitFor({ timeout: 15_000 }).then(() => "refused" as const),
      ]);
      if (outcome === "ok") {
        const host = new URL(page.url()).hostname;
        twoStepCookies.set(u.email, (await page.context().cookies()).filter((c) => c.domain.replace(/^\./, "") === host && c.name.startsWith("sb-")));
        return;
      }
      if (attempt >= 2) throw new Error("authenticator code refused three times");
      await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 1_000);
    }
  }
}
