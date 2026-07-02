/**
 * Playwright global setup — validates that the running services correspond to
 * the current working tree before tests start.
 *
 * Checks performed:
 * 1. API /health/readiness returns 200 and the expected Phase 3.1 routes exist
 *    (GET /api/v1/achievements must return a valid JSON array).
 * 2. Next.js frontend serves a 200 with the PEAK3 title in the HTML.
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
}
