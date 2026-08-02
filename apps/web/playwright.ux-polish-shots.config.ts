import { defineConfig, devices } from "@playwright/test";

/**
 * Review-screenshot capture for the UX / organization / polish pass.
 *
 * Same shape as playwright.rtt-screenshots.config.ts and deliberately outside
 * the main config's `testDir`, and not named *.spec.ts, so it can never run as
 * part of `npm run test:e2e` or in CI. It writes PNGs into the repo, which is
 * not an assertion about product behaviour.
 *
 * Reduced motion is NOT forced at the context level here (unlike the RTT
 * capture config): this pass has to inspect the motion design, and one required
 * frame is specifically the reduced-motion state. Individual captures call
 * `page.emulateMedia({ reducedMotion })` where it matters.
 *
 * Ports 8011 / 3001 — 3001 must stay a CORS-allowed origin (see
 * apps/api/app/core/config.py DEBUG list). 8011 avoids colliding with the e2e
 * suite (8000) and the RTT capture config (8010).
 *
 * Usage (from apps/web):
 *   npx playwright test --config=playwright.ux-polish-shots.config.ts
 */
const API_PORT = 8011;
const WEB_PORT = 3001;

export default defineConfig({
  testDir: "./src/tests/tools",
  testMatch: /capture-ux-polish-shots\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  reporter: "line",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
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
        `PEAK3_COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED=true ` +
        `PEAK3_ENABLE_EXTERNAL_ASSET_URLS=false ` +
        `uvicorn app.main:app --port ${API_PORT}`,
      url: `http://localhost:${API_PORT}/health/readiness`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // PRODUCTION build, not `npm run dev`.
      //
      // The first capture run used the dev server, and every one of the 38
      // frames carried Next's floating dev indicator — a black disc bottom-left
      // that sat on top of product content in five of them (a component-bar row
      // at 390px, the flagship card icon at 768px, a section heading on the
      // catalog). Review screenshots that show a development overlay are not
      // evidence of what ships.
      command:
        `NEXT_PUBLIC_API_URL=http://localhost:${API_PORT} npm run build && ` +
        `NEXT_PUBLIC_API_URL=http://localhost:${API_PORT} npm run start -- --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      // A cold production build plus server start; the dev server needed 120s.
      timeout: 300_000,
    },
  ],
});
