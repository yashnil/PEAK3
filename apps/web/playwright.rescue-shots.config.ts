import { defineConfig, devices } from "@playwright/test";

/**
 * Manual-acceptance screenshot capture for the Arena games production rescue.
 *
 * Same shape as `playwright.ux-polish-shots.config.ts`, and outside the main
 * config's `testDir` and not named `*.spec.ts`, so it can never run as part of
 * `npm run test:e2e` or in CI. It writes PNGs into a review directory, which is
 * evidence rather than an assertion about behaviour.
 *
 * A DEV SERVER, WITH THE DEV INDICATOR TURNED OFF, and both halves of that are
 * deliberate.
 *
 * WHY NOT A PRODUCTION BUILD. The first version of this config used
 * `next build && next start`, following the UX-polish capture pass. The Arena
 * frames then hung for twenty-five minutes and produced nothing, and the reason
 * is a security boundary working exactly as designed: `AuthProvider`'s
 * test-session bridge is guarded by
 * `if (process.env.NODE_ENV === "production") return;`, so
 * `window.__peak3TestAuth` is dead-code-eliminated from a production bundle.
 * Every Arena capture starts by signing in, so every one of them waited out its
 * own timeout. Weakening that guard to take screenshots would trade the one
 * thing keeping the bridge out of a deploy for a convenience.
 *
 * WHY THE INDICATOR IS OFF. The UX-polish pass learned the other half the
 * expensive way: every frame from a dev server carried Next's floating dev
 * indicator, a black disc bottom-left that sat on top of product content in
 * five of thirty-eight frames. A review screenshot showing a development
 * overlay is not evidence of what ships. `devIndicators: false` in
 * `next.config.ts` removes it, so the frames show the product and nothing else.
 *
 * What a dev server does NOT change is the thing under review: the same
 * components, the same stylesheets, the same server, the same API.
 * `scripts/ci/e2e-tests.sh` already runs every Arena browser test this way.
 *
 * Ports 8012 / 3002 — clear of the e2e suite (8000/3000), the RTT capture
 * (8010/3000) and the UX-polish capture (8011/3001). 3002 must stay a
 * CORS-allowed origin; see `apps/api/app/core/config.py`'s DEBUG list.
 *
 * The Arena flags mirror `scripts/ci/e2e-tests.sh` exactly, INCLUDING the two
 * that stay off: ratings and the public leaderboard are deliberately not part
 * of this release, and a screenshot run must not be the thing that quietly
 * turns them on.
 *
 * Usage (from apps/web):
 *   npx playwright test --config=playwright.rescue-shots.config.ts
 */
/** Exported so the capture can reach the API DIRECTLY.
 *
 *  `NEXT_PUBLIC_API_URL` below is set for the Next process, not for the
 *  Playwright process, so a capture that read it from `process.env` got
 *  `undefined`, fell back to port 8000, and hit ECONNREFUSED against an API
 *  that was running perfectly on 8012. One constant, imported, rather than two
 *  strings that agree until they do not. */
export const API_PORT = 8012;
const WEB_PORT = 3002;
const JWT_SECRET = "e2e-ranked-test-secret-do-not-use-in-prod";

export default defineConfig({
  testDir: "./src/tests/tools",
  testMatch: /capture-rescue-shots\.ts$/,
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
