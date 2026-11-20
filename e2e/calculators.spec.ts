import { expect, test } from "@playwright/test";
import { readRoleUsers, signedInTestsEnabled } from "./support/role-users";

/**
 * Calculators, driven like a crew member on a phone. Needs a signed-in user
 * (dev Supabase project), so it is skipped without the E2E_SUPABASE_* variables.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

test("an installer uses the calculators", async ({ page }) => {
  // One sign-in per run on two screen sizes keeps us under Supabase's sign-in rate limit.
  test.skip(test.info().project.name === "android", "phone and desktop cover the calculators");
  const u = readRoleUsers().find((x) => x.role === "installer")!;
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("link", { name: "Calculators" }).click();
  await expect(page.getByRole("heading", { name: "Calculators", level: 1 })).toBeVisible();

  // --- Square footage: 120' × 80' floor, office 20' 6" × 15', minus 6 columns 2' × 2'.
  await page.getByRole("link", { name: /Square Footage/ }).click();
  await expect(page.getByRole("heading", { name: "Square Footage", level: 1 })).toBeVisible();
  await page.getByLabel("Length, feet").fill("120");
  await page.getByLabel("Width, feet").fill("80");
  await expect(page.getByText("9,600.00 SF").first()).toBeVisible();

  await page.getByRole("button", { name: "Add area" }).click();
  await page.getByLabel("Length, feet").nth(1).fill("20");
  await page.getByLabel("Length, inches").nth(1).fill("6");
  await page.getByLabel("Width, feet").nth(1).fill("15");

  await page.getByRole("button", { name: "Deduction" }).click();
  await page.getByLabel("Length, feet").nth(2).fill("2");
  await page.getByLabel("Width, feet").nth(2).fill("2");
  await page.getByLabel("How many").nth(2).fill("6");

  const result = page.getByRole("region", { name: "Net area" });
  await expect(result).toContainText("9,883.50 SF");
  await expect(result).toContainText("9,907.50 added − 24.00 subtracted");

  // Inches of 12 or more in a ft + in entry is caught, and the area isn't counted.
  await page.getByLabel("Length, inches").nth(1).fill("14");
  await expect(page.getByText("Inches must be less than 12.")).toBeVisible();
  await expect(result).toContainText("1 area isn't counted yet");
  await page.getByLabel("Length, inches").nth(1).fill("6");

  // Entries survive leaving and coming back (screen lock, app switch).
  await page.reload();
  await expect(result).toContainText("9,883.50 SF");

  await page.getByText("Show the math").click();
  await expect(page.getByText("Area 2:")).toBeVisible();
  await expect(page.getByText("20' 6\" × 15' 0\" = 307.50")).toBeVisible();

  await page.getByRole("button", { name: "Start over" }).click();
  await expect(result).toContainText("0.00 SF");

  // --- Dew point: 70 °F, 50 % RH → 50.5 °F. Surface 60 °F is OK; 54 °F is not.
  await page.getByRole("link", { name: "Calculators" }).click();
  await page.getByRole("link", { name: /Dew Point/ }).click();
  await expect(page.getByRole("heading", { name: "Dew Point", level: 1 })).toBeVisible();
  await page.getByLabel("Air temperature").fill("70");
  await page.getByLabel("Relative humidity").fill("50");
  await expect(page.getByText("50.5 °F", { exact: true })).toBeVisible();
  await page.getByLabel("Surface (substrate) temperature").fill("60");
  await expect(page.getByText("OK to coat")).toBeVisible();
  await page.getByLabel("Surface (substrate) temperature").fill("54");
  await expect(page.getByText("Do not coat", { exact: true })).toBeVisible();
  await expect(page.getByText("only 3.5 °F above the dew point")).toBeVisible();
  await page.getByLabel("Surface (substrate) temperature").fill("50");
  await expect(page.getByText("Do not coat: moisture forming")).toBeVisible();

  // Switching to Celsius converts the readings already typed.
  await page.getByRole("button", { name: "°C" }).click();
  await expect(page.getByLabel("Air temperature")).toHaveValue("21.1");
  await expect(page.getByLabel("Surface (substrate) temperature")).toHaveValue("10");

  await page.getByLabel("Relative humidity").fill("150");
  await expect(page.getByText("Humidity must be more than 0 and at most 100%.")).toBeVisible();

  // --- Spread rate / mils: owner decision Q15 examples (200 SF/gal → 8.02 mils; 10 mils → 160.4 SF/gal).
  await page.getByRole("link", { name: "Calculators" }).click();
  await page.getByRole("link", { name: /Spread Rate/ }).click();
  await expect(page.getByRole("heading", { name: "Spread Rate / Mils", level: 1 })).toBeVisible();
  const sr = page.getByRole("region", { name: "Wet film thickness" });
  await page.getByLabel("Spread rate", { exact: true }).fill("200");
  await expect(sr).toContainText("8.02 mils");
  await expect(sr).toContainText("Enter volume solids to see dry film.");
  await page.getByLabel("Volume solids").fill("75");
  await expect(sr).toContainText("Dry film: 6.02 mils");

  await page.getByRole("button", { name: "Mil thickness" }).click();
  const cov = page.getByRole("region", { name: "Theoretical coverage" });
  await page.getByLabel("Wet film target").fill("10");
  await expect(cov).toContainText("160.4 SF/gal");
  await expect(cov).toContainText("Wet 10.00 mils · Dry 7.50 mils");
  await page.getByLabel("Loss (optional)").fill("15");
  await expect(cov).toContainText("Practical: 136.4 SF/gal with 15% loss");

  // A dry film target needs volume solids: 6 mils dry at 60% → 10 wet → 160.4.
  await page.getByRole("button", { name: "Dry (DFT)" }).click();
  await page.getByLabel("Volume solids").fill("");
  await page.getByLabel("Dry film target").fill("6");
  await expect(cov).toContainText("Required for a dry film target.");
  await page.getByLabel("Volume solids").fill("60");
  await expect(cov).toContainText("160.4 SF/gal");

  // --- Material quantity: 2,000 SF at 200 SF/gal, 2 coats, 10% waste, 3-gal kits → 22 gal, 8 kits.
  await page.getByRole("link", { name: "Calculators" }).click();
  await page.getByRole("link", { name: /Material Quantity/ }).click();
  await expect(page.getByRole("heading", { name: "Material Quantity", level: 1 })).toBeVisible();
  const mq = page.getByRole("region", { name: "Total material needed" });
  await page.getByLabel("Area").fill("2000");
  await page.getByLabel("Spread rate", { exact: true }).fill("200");
  await page.getByLabel("Coats").fill("2");
  // Waste must be entered explicitly before a total is shown.
  await expect(mq).toContainText("Enter a waste % (0 for none).");
  await page.getByLabel("Waste").fill("10");
  await expect(mq).toContainText("22.00 gal");
  await expect(mq).toContainText("20.00 gal + 2.00 gal waste (10%)");
  await page.getByLabel("Kit size (optional)").fill("3");
  await expect(mq).toContainText("8 kits of 3 gal (2.00 gal left over)");

  // Coverage from a wet mil target: 10 mils = 160.4 SF/gal.
  await page.getByRole("button", { name: "Wet mils" }).click();
  await page.getByLabel("Wet film per coat").fill("10");
  await expect(mq).toContainText("27.43 gal"); // 2000 × 2 ÷ 160.4167 × 1.10

  // --- Mix ratio: 2:1 by volume, 3 gal batch → 2 gal A + 1 gal B.
  await page.getByRole("link", { name: "Calculators" }).click();
  await page.getByRole("link", { name: /Mix Ratio/ }).click();
  await expect(page.getByRole("heading", { name: "Mix Ratio", level: 1 })).toBeVisible();
  const mr = page.getByRole("region", { name: "Mix by volume" });
  await page.getByLabel("Part A", { exact: true }).fill("2");
  await page.getByLabel("Part B", { exact: true }).fill("1");
  await page.getByLabel("Batch size, gal").fill("3");
  await expect(mr).toContainText("2 gal 0.0 fl oz");
  await expect(mr).toContainText("1 gal 0.0 fl oz");
  await expect(mr).toContainText("Total batch: 3 gal 0.0 fl oz");

  // Rounded parts always add up: 2:1 of 100 fl oz → 66.7 + 33.3.
  await page.getByLabel("Batch size, gal").fill("");
  await page.getByLabel("Batch size, fl oz").fill("100");
  await expect(mr).toContainText("66.7 fl oz");
  await expect(mr).toContainText("33.3 fl oz");
  await expect(mr).toContainText("Total batch: 100.0 fl oz");

  // By weight, from the Part B on hand: 4:1, 5 lb of B → 20 lb of A.
  await page.getByRole("button", { name: "Weight" }).click();
  await page.getByRole("button", { name: "Part B amount" }).click();
  await page.getByLabel("Part A", { exact: true }).fill("4");
  await page.getByLabel("Part B on hand, lb").fill("5");
  await page.getByLabel("Part B on hand, oz").fill("");
  const mw = page.getByRole("region", { name: "Mix by weight" });
  await expect(mw).toContainText("20 lb 0.0 oz");
  await expect(mw).toContainText("Total batch: 25 lb 0.0 oz");
  await expect(page.getByText("This ratio is by weight. Use a scale")).toBeVisible();
});
