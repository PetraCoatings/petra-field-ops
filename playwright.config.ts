import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests. Without E2E_SUPABASE_* variables the app points at an
 * unreachable placeholder and only the signed-out tests run. With them set to
 * a DEV Supabase project, e2e/roles.spec.ts also signs in as every role using
 * temporary logins that are created before and deleted after the run.
 */
const PORT = 3100;
const env = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54399",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.E2E_SUPABASE_KEY ?? "e2e-placeholder-key",
  // The server side must use the SAME project as the pages: the test project's
  // secret key (never a key for another project that happens to be set).
  SUPABASE_SECRET_KEY: process.env.E2E_SUPABASE_SECRET_KEY ?? "",
  SUPABASE_SERVICE_ROLE_KEY: "",
};

export default defineConfig({
  testDir: "e2e",
  // In GitHub Actions the tests use the free test project, which is slower to
  // answer than the live one: give each check a little longer there.
  expect: { timeout: process.env.CI ? 10_000 : 5_000 },
  globalSetup: "./e2e/support/global-setup.ts",
  globalTeardown: "./e2e/support/global-teardown.ts",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    // Use a pre-installed Chromium when provided (e.g. cloud dev containers).
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "phone", use: { ...devices["iPhone 13"], browserName: "chromium", defaultBrowserType: "chromium" } },
    { name: "android", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env,
  },
});
