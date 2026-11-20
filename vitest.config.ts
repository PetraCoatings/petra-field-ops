import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": src } },
  test: {
    projects: [
      {
        resolve: { alias: { "@": src } },
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        test: {
          name: "db",
          include: ["supabase/tests/db/**/*.test.ts"],
          globalSetup: ["supabase/tests/db/global-setup.ts"],
          // Tests share one database; run files one at a time.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
