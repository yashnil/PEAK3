import { defineConfig, devices } from "@playwright/test";

/**
 * Separate config for regenerating the README screenshots in
 * docs/assets/readme/. Not part of the test suite.
 *
 * The capture spec lives outside the main config's `testDir`
 * (src/tests/e2e) on purpose: it writes files into the repo and is not an
 * assertion about product behaviour, so it must never run as part of `npm run
 * test:e2e` or in CI. This config is the only way to reach it.
 *
 * The API is started with external asset URLs explicitly off, so no ESPN/NBA
 * headshots or team logos can reach a committed image. The capture spec also
 * verifies that from the client side before writing any frame, and fails
 * rather than producing a questionable file.
 *
 * Usage (from apps/web):
 *   npx playwright test --config=playwright.screenshots.config.ts
 */
export default defineConfig({
  testDir: "./src/tests/tools",
  // The capture file is intentionally not named *.spec.ts (see its header), so
  // it needs an explicit match.
  testMatch: /capture-readme-shots\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://localhost:3000",
    // Context-level, so entrance animations are already resolved when a frame
    // is captured. See the capture file's header for why this is not done with
    // emulateMedia() mid-test.
    contextOptions: { reducedMotion: "reduce" },
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "cd ../api && PEAK3_COURTBUILDER_ENABLED=true PEAK3_COURTBUILDER_TEAM_SPIN_ENABLED=true " +
        "PEAK3_COURTBUILDER_READINESS_LEVEL=internal_dev PEAK3_ENABLE_EXTERNAL_ASSET_URLS=false " +
        "PEAK3_COURTBUILDER_LEADERBOARD_ENABLED=false uvicorn app.main:app --port 8000",
      url: "http://localhost:8000/health/readiness",
      // Never reuse: a server left running from other work may have external
      // asset URLs enabled, which is exactly the mistake this guards against.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
