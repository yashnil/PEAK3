import { defineConfig, devices } from "@playwright/test";

/**
 * Review-screenshot capture for RUN THE TABLE.
 *
 * Mirrors playwright.screenshots.config.ts: the capture file lives outside the
 * main config's testDir and is not named *.spec.ts, so it can never run as part
 * of `npm run test:e2e` or in CI. It writes files into the repo, which is not
 * an assertion about product behaviour.
 *
 * External asset URLs are explicitly OFF so no third-party headshot or team
 * logo can reach a committed image.
 *
 * Runs the API on 8010 so it never collides with a dev server or the e2e
 * suite already using 8000. The web port must stay in the API's CORS allowlist,
 * so it is 3001 rather than an arbitrary high port.
 *
 * Usage (from apps/web):
 *   npx playwright test --config=playwright.rtt-screenshots.config.ts
 */
const API_PORT = 8010;
const WEB_PORT = 3001;  // must be a CORS-allowed origin (see apps/api core/config.py DEBUG list)

export default defineConfig({
  testDir: "./src/tests/tools",
  testMatch: /capture-run-the-table-shots\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: "line",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    // Context-level so entrance animations are already resolved when a frame is
    // captured, rather than racing them with emulateMedia() mid-test.
    contextOptions: { reducedMotion: "reduce" },
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        `cd ../api && PEAK3_RUN_THE_TABLE_ENABLED=true PEAK3_RUN_THE_TABLE_DAILY_ENABLED=true ` +
        `PEAK3_RUN_THE_TABLE_READINESS_LEVEL=public_beta ` +
        `PEAK3_COURTBUILDER_ENABLED=true PEAK3_COURTBUILDER_TEAM_SPIN_ENABLED=true ` +
        `PEAK3_COURTBUILDER_READINESS_LEVEL=internal_dev ` +
        `PEAK3_ENABLE_EXTERNAL_ASSET_URLS=false ` +
        `uvicorn app.main:app --port ${API_PORT}`,
      url: `http://localhost:${API_PORT}/health/readiness`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `NEXT_PUBLIC_API_URL=http://localhost:${API_PORT} npm run dev -- --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
