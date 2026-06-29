import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/tests/e2e",
  // Serial execution: both services start once; tests run sequentially.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: [
    {
      // FastAPI backend — must be ready before Next.js makes API calls
      command: "npm run start:api",
      url: "http://localhost:8000/health/readiness",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stderr: "pipe",
      stdout: "pipe",
    },
    {
      // Next.js frontend
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stderr: "pipe",
      stdout: "pipe",
    },
  ],
});
