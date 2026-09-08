import { defineConfig, devices } from "@playwright/test";

/**
 * MANUAL QA DRIVER for the gameplay-responsiveness + visual-juice pass.
 *
 * Same shape and the same reasoning as `playwright.rescue-shots.config.ts`
 * (read its docstring for why this is a dev server rather than a production
 * build, and why the dev indicator is off): outside the main config's
 * `testDir` and not named `*.spec.ts`, so `npm run test:e2e` and CI can never
 * pick it up. It reproduces reported production defects, measures real input
 * latency and writes review PNGs — evidence for a human, not assertions.
 *
 * Ports 8013 / 3003 — clear of the e2e suite (8000/3000) and of the other
 * capture configs. 3003 is already a DEBUG-only CORS origin in
 * `apps/api/app/main.py`.
 *
 * Usage (from apps/web):
 *   npx playwright test --config=playwright.qa-juice.config.ts
 */
export const API_PORT = 8013;
const WEB_PORT = 3003;
const JWT_SECRET = "e2e-ranked-test-secret-do-not-use-in-prod";

export default defineConfig({
  testDir: "./src/tests/tools",
  testMatch: /qa-gameplay-juice\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
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
        `.venv/bin/uvicorn app.main:app --port ${API_PORT}`,
      url: `http://localhost:${API_PORT}/health/readiness`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command:
        `NEXT_PUBLIC_API_URL=http://localhost:${API_PORT} ` +
        `NEXT_PUBLIC_PEAK3_E2E_AUTH=1 npx next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: true,
      timeout: 240_000,
    },
  ],
});
