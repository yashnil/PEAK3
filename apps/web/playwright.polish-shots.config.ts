import { defineConfig, devices } from "@playwright/test";

/**
 * Manual-acceptance screenshot capture for the gameplay + visual polish pass.
 *
 * Same arrangement as `playwright.rescue-shots.config.ts`, and for the same
 * reasons: outside the main config's `testDir` and not named `*.spec.ts`, so it
 * can never run as part of `npm run test:e2e` or in CI. It writes PNGs into a
 * gitignored review directory, which is evidence for a human review rather than
 * an assertion about behaviour.
 *
 * A DEV SERVER, WITH THE DEV INDICATOR OFF. Both halves were learned
 * expensively by earlier capture passes in this repository and are inherited
 * deliberately:
 *
 *   * NOT a production build. `AuthProvider`'s test-session bridge is guarded
 *     by `if (process.env.NODE_ENV === "production") return;`, so
 *     `window.__peak3TestAuth` is dead-code-eliminated from a production
 *     bundle. Every Arena capture starts by signing in, so against `next start`
 *     every one of them waits out its own timeout. Weakening that guard to take
 *     screenshots would trade the one thing keeping the bridge out of a deploy
 *     for a convenience.
 *   * `devIndicators: false` (set in next.config.ts) removes Next's floating
 *     dev badge, which otherwise sits on top of product content. A review frame
 *     showing a development overlay is not evidence of what ships.
 *
 * Ports 8013 / 3003 — clear of the e2e suite (8000/3000), the RTT capture
 * (8010/3000), the UX-polish capture (8011/3001) and the rescue capture
 * (8012/3002), so a capture run and a test run can coexist. 3003 must stay a
 * CORS-allowed origin; see `apps/api/app/core/config.py`'s DEBUG list.
 *
 * The Arena flags mirror `scripts/ci/e2e-tests.sh`, INCLUDING the two that stay
 * off: ratings and the public leaderboard are deliberately not part of this
 * release, and a screenshot run must not be the thing that quietly turns them
 * on.
 *
 * PEAK3_ENABLE_EXTERNAL_ASSET_URLS stays FALSE, which is the honest posture for
 * a review sheet: it is the production default, no licensing review has
 * happened, and the frames must therefore show the medallion fallback that real
 * users will actually see rather than a headshot sheet that does not ship.
 *
 * Usage (from apps/web):
 *   npx playwright test --config=playwright.polish-shots.config.ts
 */
/** Exported so the capture can reach the API DIRECTLY. `NEXT_PUBLIC_API_URL`
 *  below is set for the Next process, not for the Playwright process, so a
 *  capture reading it from `process.env` gets `undefined` and falls back to a
 *  port nothing is listening on. One constant, imported. */
export const API_PORT = 8013;
const WEB_PORT = 3003;
const JWT_SECRET = "e2e-ranked-test-secret-do-not-use-in-prod";

export default defineConfig({
  testDir: "./src/tests/tools",
  testMatch: /capture-polish-shots\.ts$/,
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
        `cd ../api && PEAK3_ARENA_ENABLED=true PEAK3_ARENA_BOTS_ENABLED=true ` +
        `PEAK3_ARENA_PUBLIC_QUEUE_ENABLED=true ` +
        `PEAK3_ARENA_READINESS_LEVEL=closed_alpha ` +
        `PEAK3_ARENA_RATINGS_ENABLED=false ` +
        `PEAK3_ARENA_LEADERBOARD_ENABLED=false ` +
        `PEAK3_DAILY_GRID_SEARCH_RATE_LIMIT=100000 ` +
        `PEAK3_DAILY_GRID_ANSWER_RATE_LIMIT=100000 ` +
        `PEAK3_DAILY_GRID_BOARD_RATE_LIMIT=100000 ` +
        `PEAK3_DAILY_GRID_RESULT_RATE_LIMIT=100000 ` +
        `PEAK3_DAILY_GRID_DATE_ENUMERATION_LIMIT=100000 ` +
        `PEAK3_SUPABASE_JWT_SECRET=${JWT_SECRET} ` +
        `PEAK3_TEST_JWT_SECRET=${JWT_SECRET} ` +
        `PEAK3_ENABLE_EXTERNAL_ASSET_URLS=false ` +
        `uvicorn app.main:app --port ${API_PORT}`,
      url: `http://localhost:${API_PORT}/health/readiness`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        `NEXT_PUBLIC_API_URL=http://localhost:${API_PORT} ` +
        `NEXT_PUBLIC_PEAK3_E2E_AUTH=1 npx next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
