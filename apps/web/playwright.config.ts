import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/tests/e2e",

  // Global setup validates that services are fresh and Phase 3.1-aware
  // before any test runs. This prevents stale compiled bundles from
  // silently passing tests that exercise old behaviour.
  globalSetup: "./playwright.setup.ts",

  // Serial execution: both services start once; tests run sequentially.
  fullyParallel: false,
  // CI: forbid .only / .fixme.  Locally: allowed during development.
  forbidOnly: !!process.env.CI,
  // CI: 1 retry to absorb transient timing issues.
  // Release gate ("zero retries" proof run): set PLAYWRIGHT_RETRIES=0.
  retries: process.env.CI ? (process.env.PLAYWRIGHT_RETRIES !== undefined ? Number(process.env.PLAYWRIGHT_RETRIES) : 1) : 0,
  workers: 1,
  reporter: [
    ["html", { open: "never" }],
    ["list"],
  ],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      // Desktop Chromium: runs all tests EXCEPT those tagged @mobile
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@mobile/,
    },
    {
      // Mobile Chrome: runs ONLY tests tagged @mobile
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
      grep: /@mobile/,
    },
  ],
  webServer: [
    {
      // FastAPI backend — must be ready before Next.js makes API calls.
      // In CI: always start fresh (reuseExistingServer=false).
      // Locally: reuse if the global setup validates the server as current.
      command: "npm run start:api",
      url: "http://localhost:8000/health/readiness",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stderr: "pipe",
      stdout: "pipe",
    },
    {
      // Next.js frontend.
      // In CI: always start fresh.
      // Locally: reuse if the global setup validates the server as current.
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stderr: "pipe",
      stdout: "pipe",
    },
  ],
});
