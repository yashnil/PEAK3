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
    // ── Desktop, split by SEMANTIC ISOLATION ────────────────────────────────
    //
    // Not by test count. The three desktop projects below partition the same
    // set the single `chromium` project used to run, and the union is proved
    // mechanically by `scripts/ci/assert-e2e-inventory.sh` rather than by a
    // number anyone maintains by hand.
    //
    // WHY SPLIT AT ALL. Every desktop test shared ONE browser and ONE
    // API+web service pair for ~50 minutes, with `workers: 1` and
    // `fullyParallel: false`. The Arena's multiplayer specs are the stateful
    // ones — real matches, real bots, in-memory server repositories that only
    // grow — and they were being run at minute 45 of that lifecycle, behind
    // CourtBuilder's ~16-minute spec. Failures moved between Rankings,
    // navigation, RTT, CourtBuilder and Showdown across runs while each
    // individual fix stayed green, which is the signature of a shared
    // resource degrading rather than of five unrelated bugs.
    //
    // Isolation is the point: the multiplayer shard now starts with a fresh
    // API (fresh in-memory repositories) and a fresh browser, and it no longer
    // waits behind anything.
    {
      name: "chromium-multiplayer",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@mobile/,
      testMatch: /(arena-multiplayer|showdown-two-tab|prime-cut|find-the-prime)\.spec\.ts/,
    },
    {
      // CourtBuilder is ~16 minutes on its own and is independent of the rest.
      name: "chromium-courtbuilder",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@mobile/,
      testMatch: /courtbuilder\.spec\.ts/,
    },
    {
      // Everything else: navigation, rankings, accessibility, daily, RTT, auth.
      name: "chromium-core",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@mobile/,
      testIgnore: /(arena-multiplayer|showdown-two-tab|prime-cut|find-the-prime|courtbuilder)\.spec\.ts/,
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
      //
      // `dev:e2e`, not `dev`: it sets NEXT_PUBLIC_PEAK3_E2E_AUTH=1, which is
      // the single switch that makes the account surface render without a
      // hosted Supabase project (see lib/supabase/config.ts). Without it a
      // clean checkout compiles the sign-in page, the header account control
      // and the mobile account section out of the bundle entirely, and ten
      // auth assertions fail as "element(s) not found" — which is exactly how
      // this suite passed on a developer machine with `.env.local` and failed
      // in CI. `playwright.setup.ts` re-checks the running server rather than
      // trusting this line, so a manually started `npm run dev` that gets
      // reused locally still fails loudly instead of mysteriously.
      //
      // In CI: always start fresh.
      // Locally: reuse if the global setup validates the server as current.
      // PRODUCTION SERVER WHEN `PEAK3_E2E_PROD=1`, dev otherwise.
      //
      // `next dev` compiles routes ON DEMAND, and that cost lands inside test
      // budgets: a CI trace measured `GET /arena?_rsc=...` returning 200 after
      // 3902ms on a cold two-core runner, which is what failed a navigation
      // assertion that had been given the 5s `expect` default. The same class
      // of cold compile is visible in the RTT history test (four route
      // compiles at 4.0-5.8s each) and in every "it passed locally" report,
      // because a developer's `.next` is warm.
      //
      // The production build removes that variable entirely and is also what
      // actually ships. `NEXT_PUBLIC_*` values are inlined AT BUILD TIME, so
      // the E2E auth flag has to be set for the build rather than for the
      // server — `npm run build:e2e` does that, and `playwright.setup.ts`
      // still probes the running server rather than trusting either.
      command: process.env.PEAK3_E2E_PROD === "1" ? "npm run start:e2e" : "npm run dev:e2e",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stderr: "pipe",
      stdout: "pipe",
    },
  ],
});
