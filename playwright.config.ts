import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests. Phase 1 runs WITHOUT a real Supabase backend (pointed at an
 * unreachable placeholder) and covers everything that doesn't need a
 * signed-in session. Signed-in role tests are added once a hosted dev
 * Supabase project is connected (see docs/SETUP.md).
 */
const PORT = 3100;
const env = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54399",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.E2E_SUPABASE_KEY ?? "e2e-placeholder-key",
};

export default defineConfig({
  testDir: "e2e",
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
