import { defineConfig, devices } from "@playwright/test";

/**
 * Review-screenshot capture for the auth / daily-reset / RUN THE TABLE pass.
 *
 * Same shape as playwright.ux-polish-shots.config.ts and playwright.rtt-
 * screenshots.config.ts: deliberately outside the main config's `testDir` and
 * not named *.spec.ts, so it can never run as part of `npm run test:e2e` or in
 * CI. It writes PNGs into the repo, which is not an assertion about product
 * behaviour.
 *
 * Ports 8012 / 3002 — 3002 must stay a CORS-allowed origin (see
 * apps/api/app/core/config.py's DEBUG list). 8012/3002 avoid colliding with the
 * e2e suite (8000/3000), the RTT capture config (8010), and the UX-polish
 * capture config (8011/3001).
 *
 * Auth note: this pass's journeys include signed-in surfaces. Google is not
 * enabled on the development Supabase project and no mailbox is reachable from
 * here, so the signed-in frames are captured through the existing e2e test-auth
 * channel (`window.__peak3TestAuth`, dead-code-eliminated in production
 * builds) rather than a live provider round-trip. Frames captured that way are
 * labelled as such in the manifest — a screenshot review is worthless if a
 * frame might be something other than what its filename claims.
 *
 * Because that channel is compiled out of a production build, this config runs
 * the DEV server, unlike the UX-polish config. The dev indicator is suppressed
 * via devIndicators in next.config.ts if present; where it is not, the affected
 * frames are noted in the manifest.
 *
 * Usage (from apps/web):
 *   npx playwright test --config=playwright.auth-daily-shots.config.ts
 */
const API_PORT = 8012;
const WEB_PORT = 3002;

const E2E_JWT_SECRET = "e2e-ranked-test-secret-do-not-use-in-prod";

export default defineConfig({
  testDir: "./src/tests/tools",
  testMatch: /capture-auth-daily-shots\.ts$/,
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
        `PEAK3_ENABLE_EXTERNAL_ASSET_URLS=false ` +
        // Rate limits raised so a capture sweep is not throttled mid-sheet.
        `PEAK3_DAILY_GRID_BOARD_RATE_LIMIT=100000 PEAK3_DAILY_GRID_SEARCH_RATE_LIMIT=100000 ` +
        `PEAK3_DAILY_GRID_ANSWER_RATE_LIMIT=100000 PEAK3_DAILY_GRID_RESULT_RATE_LIMIT=100000 ` +
        `PEAK3_DAILY_GRID_DATE_ENUMERATION_LIMIT=100000 ` +
        // The test-auth channel mints HS256 tokens; the API keeps its legacy
        // symmetric path for exactly this case while the hosted project's real
        // tokens are verified via JWKS.
        `PEAK3_SUPABASE_JWT_SECRET=${E2E_JWT_SECRET} ` +
        `uvicorn app.main:app --port ${API_PORT}`,
      url: `http://localhost:${API_PORT}/health/readiness`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        `NEXT_PUBLIC_API_URL=http://localhost:${API_PORT} npm run dev -- --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
