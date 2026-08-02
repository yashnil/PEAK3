import { defineConfig, devices } from "@playwright/test";

/**
 * Review-screenshot capture for the Daily Grid / RUN THE TABLE depth / PvP /
 * security / footer pass (spec §10).
 *
 * Same shape as playwright.auth-daily-shots.config.ts and
 * playwright.ux-polish-shots.config.ts: deliberately OUTSIDE the main config's
 * `testDir` and NOT named *.spec.ts, so it can never run as part of
 * `npm run test:e2e` or in CI. It writes PNGs into the repo, which is not an
 * assertion about product behaviour.
 *
 * ---------------------------------------------------------------------------
 * PORTS — 8013 / 3003
 * ---------------------------------------------------------------------------
 * 8000/3000 belong to the e2e suite, 8010 to the RTT capture config, 8011/3001
 * to the UX-polish config and 8012/3002 to the auth/daily config. This one
 * takes the next free pair.
 *
 * 3003 is NOT in `apps/api/app/core/config.py`'s DEBUG CORS list (which adds
 * only 3000, 3001 and 3002). Rather than edit product code — this config's
 * owner may not — the API is started with `PEAK3_CORS_ORIGINS` naming 3003
 * explicitly. `Settings.CORS_ORIGINS` is a normal pydantic-settings field with
 * the `PEAK3_` prefix, so the env var is the supported way to say this, and
 * `main.py` then appends its DEBUG defaults on top. Verified with a preflight-
 * shaped request: `access-control-allow-origin: http://localhost:3003`.
 *
 * ---------------------------------------------------------------------------
 * DATABASE — the LOCAL Supabase stack, not the hosted project
 * ---------------------------------------------------------------------------
 * `apps/api/.env` points `PEAK3_DATABASE_URL` at a hosted Supabase project
 * whose password is stale; starting the API with it produces roughly a hundred
 * asyncpg errors and no working repositories. The spec asks for a real
 * database, so this points at the local stack instead (container
 * `supabase_db_PEAK3`, every migration applied, including this pass's
 * `daily_grid_attempts` and `head_to_head` tables). The API logs
 * `Repository registry: postgres (20/20 domains)` on startup — that line is
 * the proof this is not the in-memory fallback.
 *
 * ---------------------------------------------------------------------------
 * TWO SERVER MODES — and why the sheet is captured in two runs
 * ---------------------------------------------------------------------------
 * The spec asks for a production build. Most of the sheet is captured that
 * way. The head-to-head frames are not reachable without an authenticated
 * identity, and the only identity channel available here is the e2e test-auth
 * bridge (`window.__peak3TestAuth`), which `auth-context.tsx` deletes when
 * `process.env.NODE_ENV === "production"` — i.e. it is dead-code-eliminated
 * from exactly the build the spec asks for. Google is not enabled on the
 * development Supabase project and no mailbox is reachable from here, so there
 * is no live provider round-trip to substitute.
 *
 * A single Playwright run cannot host both servers: `next dev` and `next start`
 * both own `.next/`, and `next.config.ts` (product code, not this file's to
 * edit) sets no `distDir`. So the mode is chosen by an env var and the sheet is
 * captured in two runs, with the manifest merged across them and every frame
 * labelled `server: "production-build"` or `server: "dev-server"`. Mixing them
 * silently would be worse than not capturing at all.
 *
 * Usage (from apps/web):
 *   npx playwright test --config=playwright.daily-rtt-pvp-shots.config.ts
 *   PEAK3_SHOTS_MODE=dev npx playwright test --config=playwright.daily-rtt-pvp-shots.config.ts
 */
const API_PORT = 8013;
const WEB_PORT = 3003;

/** Which web server this run drives. See the block comment above. */
const MODE = process.env.PEAK3_SHOTS_MODE === "dev" ? "dev" : "prod";

/** The local `supabase start` stack for this repo. */
const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54422/postgres";

/** The secret `src/tests/e2e/helpers/test-jwt.ts` mints against. */
const E2E_JWT_SECRET = "e2e-ranked-test-secret-do-not-use-in-prod";

/**
 * Feature flags and rate-limit raises, copied from `package.json`'s `start:api`
 * script. Without RUN THE TABLE's flags the mode 403s at readiness; without the
 * raises a capture sweep 429s halfway down the sheet.
 */
const API_ENV = [
  `PEAK3_DATABASE_URL=${LOCAL_DATABASE_URL}`,
  `PEAK3_CORS_ORIGINS='["http://localhost:${WEB_PORT}"]'`,
  "PEAK3_DAILY_GRID_SEARCH_RATE_LIMIT=100000",
  "PEAK3_DAILY_GRID_ANSWER_RATE_LIMIT=100000",
  "PEAK3_DAILY_GRID_BOARD_RATE_LIMIT=100000",
  "PEAK3_DAILY_GRID_RESULT_RATE_LIMIT=100000",
  "PEAK3_DAILY_GRID_DATE_ENUMERATION_LIMIT=100000",
  "PEAK3_PEAK_DUEL_RESULT_RATE_LIMIT=100000",
  "PEAK3_RUN_THE_TABLE_ENABLED=true",
  "PEAK3_RUN_THE_TABLE_DAILY_ENABLED=true",
  "PEAK3_RUN_THE_TABLE_READINESS_LEVEL=public_beta",
  "PEAK3_RANKED_ENABLED=true",
  "PEAK3_RANKED_MATCHMAKING_ENABLED=true",
  "PEAK3_RANKED_RATING_WRITES_ENABLED=true",
  "PEAK3_RANKED_READINESS_LEVEL=internal_alpha",
  "PEAK3_COURTBUILDER_ENABLED=true",
  "PEAK3_COURTBUILDER_TEAM_SPIN_ENABLED=true",
  "PEAK3_COURTBUILDER_READINESS_LEVEL=internal_dev",
  "PEAK3_COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED=true",
  `PEAK3_SUPABASE_JWT_SECRET=${E2E_JWT_SECRET}`,
].join(" ");

/**
 * WHY THE SERVER RUNS OUT OF A SYNCED SCRATCH COPY AND NOT `apps/web` ITSELF.
 *
 * `.next/` is a single directory owned by whichever Next process is running,
 * and `next.config.ts` (product code, not this file's to edit) sets no
 * `distDir`. A `next build` here while a `next dev` is already serving the repo
 * on :3000 — the normal state of this workspace, and the state a parallel agent
 * leaves it in — makes the two processes interleave writes into the same
 * manifests. The observed failure is a build that dies with
 * `SyntaxError: Unexpected end of JSON input`, which says nothing at all about
 * what actually went wrong.
 *
 * So each mode gets its own scratch checkout under TMPDIR: the sources are
 * rsynced (excluding `node_modules`, `.next` and Playwright output),
 * `node_modules` is symlinked back to the real one so nothing is re-installed,
 * and the server runs there. The capture script itself still runs from the real
 * repo, so the manifest and the PNGs land in `docs/implementation/` as normal.
 *
 * `--delete` keeps the copy honest: it is re-synced on every run, so a frame
 * can never be captured against stale sources.
 */
const SCRATCH = `\${TMPDIR:-/tmp/}peak3-daily-rtt-pvp-${MODE}`;
const SYNC =
  `mkdir -p "${SCRATCH}" && ` +
  `rsync -a --delete --exclude node_modules --exclude .next --exclude test-results ` +
  `--exclude playwright-report ./ "${SCRATCH}"/ && ` +
  `ln -sfn "$PWD/node_modules" "${SCRATCH}/node_modules" && cd "${SCRATCH}"`;

const WEB_COMMAND =
  MODE === "dev"
    ? `${SYNC} && NEXT_PUBLIC_API_URL=http://localhost:${API_PORT} npm run dev -- --port ${WEB_PORT}`
    : // NEXT_PUBLIC_* is inlined at BUILD time, so it has to be set for the
      // build as well as the server, or the bundle keeps its 8000 default.
      `${SYNC} && NEXT_PUBLIC_API_URL=http://localhost:${API_PORT} npm run build && ` +
      `NEXT_PUBLIC_API_URL=http://localhost:${API_PORT} npm run start -- --port ${WEB_PORT}`;

export default defineConfig({
  testDir: "./src/tests/tools",
  testMatch: /capture-daily-rtt-pvp-shots\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 420_000,
  reporter: "line",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `cd ../api && ${API_ENV} uvicorn app.main:app --port ${API_PORT}`,
      url: `http://localhost:${API_PORT}/health/readiness`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: WEB_COMMAND,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      // A cold `next build` is the long pole here, not the server start.
      timeout: 420_000,
    },
  ],
});
