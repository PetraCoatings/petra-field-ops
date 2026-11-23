import { expect, type Page } from "@playwright/test";
import type { RoleUser } from "./role-users";
import { totp } from "./totp";

/** Signs in through the sign-in page; office admins also enter their authenticator code. */
export async function signInAs(page: Page, u: Pick<RoleUser, "email" | "password" | "totpSecret">): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (u.totpSecret) {
    await expect(page).toHaveURL(/\/two-step$/);
    await page.getByLabel("6-digit code").fill(totp(u.totpSecret));
    await page.getByRole("button", { name: "Confirm" }).click();
  }
}
