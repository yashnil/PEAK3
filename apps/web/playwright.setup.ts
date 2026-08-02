/**
 * Playwright global setup — validates that the running services correspond to
 * the current working tree before tests start.
 *
 * Checks performed:
 * 1. API /health/readiness returns 200 and the expected Phase 3.1 routes exist
 *    (GET /api/v1/achievements must return a valid JSON array).
 * 2. The API is serving a real generated dataset, not the synthetic fallback.
 * 3. Next.js frontend serves a 200 with the PEAK3 title in the HTML.
 * 4. The running frontend renders the AUTH SURFACE.
 *
 * WHY (4) EXISTS. The account surface — the sign-in and sign-up pages, the
 * header account control, the mobile account section — used to be gated on a
 * hosted Supabase project being configured. A developer with `.env.local` ran
 * an application that had it; CI, checking out clean, ran one that did not, and
 * compiled it out of the bundle entirely. Ten browser assertions about copy,
 * `returnTo` propagation, initials avatars and sign-out therefore passed
 * locally and failed in CI as "element(s) not found", 28 minutes into the run,
 * with nothing in the message pointing at configuration. This probe turns that
 * into one sentence in under a second, and it probes the *running server*
 * rather than `process.env`, so a reused, manually started `npm run dev` is
 * caught too.
 *
 * When PLAYWRIGHT_FRESH=1 (or CI=true) the checks are always run. The checks
 * fail fast with a clear message instead of letting stale code contaminate results.
 */
import http from "http";

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

export default async function globalSetup() {
  // ── 1. API health + Phase 3.1 route probe ───────────────────────────────
  let apiRes: { status: number; body: string };
  try {
    apiRes = await get("http://localhost:8000/api/v1/achievements");
  } catch (err) {
    throw new Error(
      `[playwright.setup] API is not reachable on port 8000.\n` +
        `  Start it with: npm run start:api\n  Error: ${err}`
    );
  }

  if (apiRes.status !== 200) {
    throw new Error(
      `[playwright.setup] GET /api/v1/achievements returned ${apiRes.status}.\n` +
        `This route was added in Phase 3.1 — the running API may be stale.\n` +
        `Stop it and restart: npm run start:api`
    );
  }

  let catalog: unknown[];
  try {
    catalog = JSON.parse(apiRes.body);
  } catch {
    throw new Error("[playwright.setup] /api/v1/achievements did not return valid JSON.");
  }

  if (!Array.isArray(catalog) || catalog.length < 15) {
    throw new Error(
      `[playwright.setup] Achievement catalog has ${Array.isArray(catalog) ? catalog.length : "??"} entries; expected ≥15.\n` +
        `The running API may be from before Phase 3.1.`
    );
  }

  // ── 1b. Generated dataset probe ─────────────────────────────────────────
  //
  // Rankings, board generation and every scorecard read from `data/web/`. When
  // it is absent the API serves synthetic stand-ins, and a suite that asserts
  // on real players fails one assertion at a time, deep into the run, with no
  // hint that the cause is a missing build step.
  let metaRes: { status: number; body: string };
  try {
    metaRes = await get("http://localhost:8000/api/v1/meta");
  } catch (err) {
    throw new Error(`[playwright.setup] GET /api/v1/meta failed.\n  Error: ${err}`);
  }

  let meta: { player_count?: number; source_artifacts?: string[] };
  try {
    meta = JSON.parse(metaRes.body);
  } catch {
    throw new Error("[playwright.setup] /api/v1/meta did not return valid JSON.");
  }

  if ((meta.player_count ?? 0) < 100 || meta.source_artifacts?.[0] === "fixture") {
    throw new Error(
      `[playwright.setup] The API is not serving the generated dataset ` +
        `(player_count=${meta.player_count}, source=${JSON.stringify(meta.source_artifacts)}).\n` +
        `  Fix: python scripts/build_web_dataset.py   (or: make build-dataset)`
    );
  }

  // ── 2. Frontend content probe ────────────────────────────────────────────
  let frontendRes: { status: number; body: string };
  try {
    frontendRes = await get("http://localhost:3000/");
  } catch (err) {
    throw new Error(
      `[playwright.setup] Next.js is not reachable on port 3000.\n` +
        `  Start it with: npm run dev\n  Error: ${err}`
    );
  }

  if (frontendRes.status !== 200) {
    throw new Error(
      `[playwright.setup] Frontend / returned HTTP ${frontendRes.status}; expected 200.`
    );
  }

  if (!frontendRes.body.includes("PEAK3")) {
    throw new Error(
      `[playwright.setup] Frontend does not contain expected "PEAK3" content.\n` +
        `The running server may be stale. Restart with: npm run dev`
    );
  }

  // ── 3. Auth surface probe ────────────────────────────────────────────────
  //
  // `/signin` server-renders exactly one of two markers: `signin-page` when the
  // account surface is enabled, `signin-unconfigured` when it is not. Reading
  // the marker off the wire proves what the browser will actually be given.
  let signinRes: { status: number; body: string };
  try {
    signinRes = await get("http://localhost:3000/signin");
  } catch (err) {
    throw new Error(`[playwright.setup] /signin is not reachable.\n  Error: ${err}`);
  }

  if (!signinRes.body.includes('data-testid="signin-page"')) {
    const unconfigured = signinRes.body.includes('data-testid="signin-unconfigured"');
    throw new Error(
      `[playwright.setup] The auth surface is NOT rendering` +
        `${unconfigured ? " (/signin served the 'not configured' page)" : ""}.\n` +
        `  auth.spec.ts asserts on the sign-in page, the header account control\n` +
        `  and the mobile account section; all of them are compiled out in this\n` +
        `  configuration, and every one of those assertions would fail as\n` +
        `  "element(s) not found" rather than as a configuration problem.\n\n` +
        `  Fix: start the frontend with\n` +
        `      npm run dev:e2e        (sets NEXT_PUBLIC_PEAK3_E2E_AUTH=1)\n` +
        `  or let Playwright start it — playwright.config.ts already does.\n` +
        `  A real NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY pair\n` +
        `  also satisfies this check; neither is required, and no test in this\n` +
        `  suite contacts a hosted project.`
    );
  }
}
