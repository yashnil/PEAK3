/**
 * Review-screenshot capture for the Daily Grid freshness / Daily Grid
 * walkthrough / RUN THE TABLE depth / head-to-head PvP / footer + legal pass
 * (spec §10, "Browser verification").
 *
 * NOT a spec (deliberately not named *.spec.ts) and outside the main config's
 * testDir, so it can never run as part of `npm run test:e2e` or in CI. It
 * writes files into the repo, which is not an assertion about product
 * behaviour.
 *
 * Reachable only via (from apps/web):
 *   npx playwright test --config=playwright.daily-rtt-pvp-shots.config.ts
 *   PEAK3_SHOTS_MODE=dev npx playwright test --config=playwright.daily-rtt-pvp-shots.config.ts
 *
 * Design rules, inherited verbatim from capture-auth-daily-shots.ts and
 * capture-ux-polish-shots.ts, which learned every one of them the hard way
 * ---------------------------------------------------------------------------
 * 1. Each capture is its own `test()` so one unreachable surface cannot silence
 *    the rest of the sheet.
 * 2. A capture that cannot reach its surface FAILS LOUDLY rather than writing a
 *    misleading frame of the wrong screen. Every shot is preceded by an
 *    assertion about something specific on the page. A screenshot review is
 *    worthless if a frame might be something other than what its filename
 *    claims.
 * 3. Every frame records an MD5 of its own bytes into the manifest, and
 *    `afterAll` throws on a collision. A previous pass silently produced pairs
 *    of byte-identical frames under different names; the hash makes that
 *    impossible to miss.
 * 4. A filename never claims an outcome the harness did not observe. The two
 *    RUN THE TABLE receipts are named from the DOM's own `data-outcome`
 *    attribute, so "table-clear" can only appear on a frame the engine called a
 *    table clear.
 *
 * What is captured where
 * ---------------------------------------------------------------------------
 * Everything that does not need an account is captured against the PRODUCTION
 * build (`next build` + `next start`), as the spec asks. The head-to-head
 * frames need an authenticated identity, and the only one available here is the
 * e2e test-auth bridge, which `auth-context.tsx` deletes under
 * `NODE_ENV === "production"` — so those frames are captured against the dev
 * server in a second run and are labelled `server: "dev-server"` and
 * `authMethod: "e2e-test-channel"` in the manifest. See the config's header.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  DAILY_GRID_TOUR,
  RUN_THE_TABLE_TOUR_ID,
  RUN_THE_TABLE_TOUR_VERSION,
} from "@/components/ui/tour-steps";
import { TOUR_STORAGE_KEY, TOUR_STORAGE_SCHEMA_VERSION } from "@/lib/tour-state";
import {
  RUN_THE_TABLE_SCHEMA_VERSION,
  RUN_THE_TABLE_STORAGE_KEY,
} from "@/types/run-the-table";

/** The API this sheet is captured against. Matches the Playwright config. */
const API_BASE = "http://localhost:8013";

const OUT = path.resolve(__dirname, "../../../../../docs/implementation/daily-rtt-pvp-review");
const MANIFEST = path.join(OUT, "screenshot-manifest.json");

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/** Which web server this run is driving. Set by the Playwright config's env. */
const MODE: "prod" | "dev" = process.env.PEAK3_SHOTS_MODE === "dev" ? "dev" : "prod";
const SERVER = MODE === "dev" ? "dev-server" : "production-build";

fs.mkdirSync(OUT, { recursive: true });

type AuthMethod = "guest" | "e2e-test-channel";

interface ManifestEntry {
  file: string;
  journey: string;
  viewport: string;
  url: string;
  title: string;
  note: string;
  authMethod: AuthMethod;
  reducedMotion: boolean;
  /** "production-build" or "dev-server". Never inferred later — recorded here. */
  server: string;
  h1: string | null;
  md5: string;
}

const entries: ManifestEntry[] = [];

async function shot(
  page: Page,
  file: string,
  opts: {
    journey: string;
    note: string;
    authMethod?: AuthMethod;
    reducedMotion?: boolean;
    fullPage?: boolean;
  },
) {
  const target = path.join(OUT, file);
  // Scroll to the top before a full-page shot.
  //
  // NOT cosmetic. This app pins the global nav and RUN THE TABLE's two side
  // rails with `position: sticky`, and a full-page capture taken while the page
  // is scrolled paints them at their SCROLLED offset — the first version of
  // 11b came out with the nav bar and half the run map stamped across the
  // middle of the page, which reads as a layout bug the product does not have.
  if (opts.fullPage ?? false) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
  }
  // `animations: "disabled"` is not cosmetic. Playwright waits for the page to
  // settle before capturing, and both the Daily Grid (a one-second play clock)
  // and RUN THE TABLE (Motion layout animations) will otherwise keep a
  // full-page shot waiting until the test times out.
  await page.screenshot({
    path: target,
    fullPage: opts.fullPage ?? false,
    animations: "disabled",
    caret: "hide",
    timeout: 30_000,
  });

  const bytes = fs.readFileSync(target);

  // Manifest metadata must never be able to fail the capture it describes: the
  // PNG is already on disk, and a busy main thread could otherwise hang
  // `page.title()` past the test timeout and destroy a perfectly good frame.
  const withTimeout = async <T>(work: Promise<T>, fallback: T): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(fallback), 5_000);
        }),
      ]);
    } catch {
      return fallback;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const title = await withTimeout(page.title(), "(unavailable)");
  const h1 = await withTimeout(
    page.locator("h1").first().textContent({ timeout: 3_000 }),
    null,
  );
  const size = page.viewportSize();

  entries.push({
    file,
    journey: opts.journey,
    viewport: size ? `${size.width}x${size.height}` : "unknown",
    url: page.url(),
    title,
    note: opts.note,
    authMethod: opts.authMethod ?? "guest",
    reducedMotion: opts.reducedMotion ?? false,
    server: SERVER,
    h1: h1 ? h1.trim().slice(0, 160) : null,
    md5: crypto.createHash("md5").update(bytes).digest("hex"),
  });
}

async function settle(page: Page) {
  // Bounded explicitly. Both game surfaces run a timer and never reach
  // `networkidle`, so its own 30 s default would burn most of a test's budget.
  await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Auth (dev-server runs only)
// ---------------------------------------------------------------------------

/**
 * Sign in through the e2e test-auth channel.
 *
 * The same mechanism `ranked.spec.ts` uses: it injects a Supabase-shaped HS256
 * token that the API verifies with its legacy symmetric path. Recorded as
 * `e2e-test-channel` in the manifest so nobody mistakes these frames for a live
 * provider round-trip.
 */
async function signInViaTestChannel(page: Page, sub: string, email: string) {
  const { mintTestAccessToken } = await import("../e2e/helpers/test-jwt");
  const token = mintTestAccessToken(sub, email);

  await page.waitForFunction(
    () => Boolean((window as never as { __peak3TestAuth?: unknown }).__peak3TestAuth),
    { timeout: 15_000 },
  );
  await page.evaluate(
    ([t, s, e]) => {
      const api = (
        window as never as {
          __peak3TestAuth: { setSession: (token: string, user: { id: string; email: string }) => void };
        }
      ).__peak3TestAuth;
      api.setSession(t, { id: s, email: e });
    },
    [token, sub, email] as const,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  return token;
}

/**
 * Attach the Supabase bearer token to RUN THE TABLE API calls.
 *
 * THIS IS A HARNESS SHIM STANDING IN FOR A PRODUCT BUG, and every frame taken
 * with it says so. `lib/run-the-table-api.ts`'s `rttFetch` sends
 * `credentials: "include"` and no `Authorization` header, so every RUN THE
 * TABLE request resolves its owner from the anonymous `peak3_anon` cookie even
 * when a real account is signed in. The consequence for this pass is total:
 * an accepted head-to-head mints a run owned by the ACCOUNT, and the browser
 * then cannot load it (`403 run_not_owned`), so the second half of a PvP match
 * cannot be played through the UI at all.
 *
 * The shim adds the one header the client is missing. It fabricates nothing:
 * the run, the board, the battles and the settlement are all the real server's.
 */
async function attachRttBearer(page: Page, token: string) {
  await page.addInitScript((jwt: string) => {
    const original = window.fetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/v1/run-the-table")) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${jwt}`);
        return original(input, { ...init, headers });
      }
      return original(input, init);
    };
  }, token);
}

// ---------------------------------------------------------------------------
// RUN THE TABLE driver
//
// A direct port of the driver in `src/tests/e2e/run-the-table.spec.ts`. It is
// copied rather than imported because a capture tool must never be able to
// change a test spec's behaviour by editing a shared helper.
// ---------------------------------------------------------------------------

const RTT_ROUTE = "/arena/run-the-table";

const SURFACE_IDS = [
  "rtt-result",
  "rtt-opening-reveal",
  "rtt-boss-reveal",
  "rtt-system-select",
  "rtt-node-choice",
  "rtt-draft-room",
  "rtt-trade-desk",
  "rtt-scout-prepare",
  "rtt-choice-node",
  "rtt-boss-preview",
  "rtt-battle-reveal",
] as const;

type SurfaceId = (typeof SURFACE_IDS)[number];

const SURFACE_SELECTOR = SURFACE_IDS.map((id) => `[data-testid="${id}"]`).join(", ");

/** Mark the RUN THE TABLE tour as already seen, as a returning player's browser
 *  would have it — otherwise it auto-opens over the first decision. */
async function suppressRttTour(page: Page): Promise<void> {
  await page.evaluate(
    ({ key, schema, tourId, version }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          schema_version: schema,
          tours: { [tourId]: { version, status: "completed", at: "2026-01-01T00:00:00.000Z" } },
          coachmarks: {},
        }),
      );
    },
    {
      key: TOUR_STORAGE_KEY,
      schema: TOUR_STORAGE_SCHEMA_VERSION,
      tourId: RUN_THE_TABLE_TOUR_ID,
      version: RUN_THE_TABLE_TOUR_VERSION,
    },
  );
}

/** Land on the route with no stored run, so the Start gate is what renders. */
async function rttFreshGate(page: Page, route: string = RTT_ROUTE): Promise<void> {
  await page.goto(route, { waitUntil: "load" });
  await page.evaluate((key) => window.localStorage.removeItem(key), RUN_THE_TABLE_STORAGE_KEY);
  await suppressRttTour(page);
  await page.goto(route, { waitUntil: "load" });
  await expect(page.locator('[data-testid="rtt-start-gate"]')).toBeVisible({ timeout: 20_000 });
}

async function rttStartRun(page: Page, testId = "rtt-start-standard"): Promise<void> {
  const button = page.locator(`[data-testid="${testId}"]`);
  await button.waitFor({ state: "visible", timeout: 20_000 });
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/run-the-table/runs") &&
        r.request().method() === "POST" &&
        r.status() === 200,
    ),
    button.click(),
  ]);
  await expect(page.locator('[data-testid="rtt-shell"]')).toBeVisible({ timeout: 20_000 });
}

async function currentSurface(page: Page): Promise<SurfaceId> {
  await page.waitForSelector(SURFACE_SELECTOR, { state: "visible", timeout: 25_000 });
  for (const id of SURFACE_IDS) {
    if ((await page.locator(`[data-testid="${id}"]`).count()) > 0) return id;
  }
  throw new Error("no known RUN THE TABLE surface is mounted");
}

/**
 * Two strategies, so the sheet can show two different endings.
 *
 * `pass` never spends: it declines every card and every trade, which starves
 * the roster and is the shortest honest route to running out of lives.
 * `buy` takes the first enabled offer everywhere, which is the closest a blind
 * driver gets to playing well.
 *
 * NEITHER PICKS A WINNER. The outcome is whatever the engine returns, and the
 * frame is named from the DOM afterwards.
 */
type Strategy = "pass" | "buy" | "best";

/** Click the draft offer with the highest PEAK3 prime score among the ones the
 *  server has marked selectable, then place it. Returns false if it could not
 *  buy anything, so the caller can fall through to passing. */
async function buyStrongestOffer(page: Page, strongest: boolean): Promise<boolean> {
  // A blocked offer carries `aria-disabled`, not `disabled` — that is
  // deliberate, so a keyboard user can still reach the reason — which is why
  // the selector has to exclude it explicitly.
  const offers = page.locator(
    '[data-testid^="rtt-offer-"]:not([aria-disabled="true"]):not([disabled])',
  );
  const count = await offers.count();
  if (count === 0) return false;

  let pick = 0;
  if (strongest) {
    let bestScore = -Infinity;
    for (let i = 0; i < count; i++) {
      const raw = await offers
        .nth(i)
        .locator('[data-testid="rtt-card-prime-score"]')
        .first()
        .innerText()
        .catch(() => "");
      const score = Number.parseFloat(raw.replace(/[^\d.]/g, ""));
      if (Number.isFinite(score) && score > bestScore) {
        bestScore = score;
        pick = i;
      }
    }
  }

  const offer = offers.nth(pick);
  await offer.click();
  // Selecting an offer opens the slot picker; the purchase is the SLOT press.
  const slots = page.locator(
    '[data-testid="rtt-draft-slot-picker"] [data-testid^="rtt-draft-slot-"]:not([disabled])',
  );
  if ((await slots.count()) === 0) {
    await offer.click(); // deselect, so the surface is left as it was found
    return false;
  }
  await slots.first().click();
  return true;
}

async function stepOnce(page: Page, surface: SurfaceId, strategy: Strategy): Promise<void> {
  switch (surface) {
    case "rtt-opening-reveal":
    case "rtt-boss-reveal": {
      const kind = surface === "rtt-opening-reveal" ? "roster" : "boss";
      await page.locator(`[data-testid="rtt-reveal-start-${kind}"]`).click();
      const skip = page.locator(`[data-testid="rtt-reveal-skip-${kind}"]`);
      await skip.waitFor({ state: "visible", timeout: 20_000 });
      await skip.click();
      break;
    }
    case "rtt-scout-prepare": {
      // `rtt-scout-flip-<lane>` is the engine's own "preparing this lane would
      // turn it from a loss into a win" marker. Playing well means taking it;
      // the weaker strategies deliberately do not look.
      if (strategy === "best") {
        const flip = page.locator('[data-testid^="rtt-scout-flip-"]').first();
        if (await flip.count()) {
          const lane = ((await flip.getAttribute("data-testid")) ?? "").replace(
            "rtt-scout-flip-",
            "",
          );
          const prep = page.getByTestId(`rtt-scout-prepare-${lane}`);
          if (await prep.count()) {
            await prep.click();
            break;
          }
        }
      }
      await page
        .locator('[data-testid="rtt-scout-prepare"] [data-testid^="rtt-scout-prepare-"]')
        .first()
        .click();
      break;
    }
    case "rtt-system-select":
      await page.locator('[data-testid="rtt-system-select"] button').first().click();
      break;
    case "rtt-node-choice":
      await page.locator('[data-testid="rtt-node-choice"] button').first().click();
      break;
    case "rtt-draft-room": {
      if (strategy !== "pass" && (await buyStrongestOffer(page, strategy === "best"))) break;
      await page.locator('[data-testid="rtt-draft-pass"]').click();
      break;
    }
    case "rtt-trade-desk": {
      // Always declined. A trade needs a card selected on each side before
      // `rtt-trade-confirm` enables, and a driver that guesses at that would be
      // choosing a roster rather than exercising the surface.
      await page.locator('[data-testid="rtt-trade-decline"]').click();
      break;
    }
    case "rtt-choice-node":
      await page.locator('[data-testid="rtt-choice-node"] button:not([disabled])').first().click();
      break;
    case "rtt-boss-preview":
      await page.locator('[data-testid="rtt-resolve-boss"]').click();
      break;
    case "rtt-battle-reveal":
      await page.locator('[data-testid="rtt-battle-skip"]').click();
      await page.locator('[data-testid="rtt-battle-advance"]').click();
      break;
    case "rtt-result":
      return;
  }
  await expect(page.locator(`[data-testid="${surface}"]`)).toHaveCount(0, { timeout: 25_000 });
}

/** Drive until `stop` says to halt, or until the receipt. Returns the surface
 *  it stopped on, so the caller can assert it got what it asked for. */
async function driveUntil(
  page: Page,
  stop: (surface: SurfaceId) => boolean,
  strategy: Strategy = "pass",
  maxSteps = 120,
): Promise<SurfaceId> {
  for (let i = 0; i < maxSteps; i++) {
    const surface = await currentSurface(page);
    if (stop(surface) || surface === "rtt-result") return surface;
    await stepOnce(page, surface, strategy);
  }
  throw new Error(`RUN THE TABLE did not reach the requested surface within ${maxSteps} steps`);
}

/** The engine's own verdict for the finished run: `table_cleared`,
 *  `ended_at_final_boss` or `ended_in_act`. Read from the DOM, never assumed. */
async function resultOutcome(page: Page): Promise<string> {
  const verdict = page.locator('[data-testid="rtt-result-verdict"]');
  await verdict.waitFor({ state: "visible", timeout: 25_000 });
  return (await verdict.getAttribute("data-outcome")) ?? "unknown";
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP);
});

test.afterAll(async () => {
  // Merge with whatever is already on disk before rewriting.
  //
  // Two reasons, both learned from the previous pass: Playwright restarts the
  // worker when a test times out (which resets this array), and this sheet is
  // deliberately captured in TWO runs — production build then dev server. A
  // manifest that silently under-reports is worse than none, because it reads
  // as "these are the frames".
  try {
    const prior = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    const known = new Set(entries.map((e) => e.file));
    for (const frame of prior.frames ?? []) {
      if (!known.has(frame.file) && fs.existsSync(path.join(OUT, frame.file))) {
        entries.push(frame);
      }
    }
  } catch {
    // No prior manifest, or an unreadable one: this run is the whole truth.
  }

  entries.sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        generated_by: "apps/web/src/tests/tools/capture-daily-rtt-pvp-shots.ts",
        pass: "Daily Grid freshness + walkthrough / RUN THE TABLE depth / head-to-head PvP / footer + legal",
        api: "FastAPI on :8013",
        database:
          "Local Supabase Postgres (container supabase_db_PEAK3, " +
          "postgresql://postgres@127.0.0.1:54422/postgres) — the API logs " +
          "'Repository registry: postgres (20/20 domains)'. The hosted project in " +
          "apps/api/.env was NOT used: its password is stale and it produces only " +
          "asyncpg errors.",
        web: "Production build (next build + next start) for every frame except the " +
          "head-to-head ones, which need the e2e test-auth channel that " +
          "auth-context.tsx removes under NODE_ENV=production and are therefore " +
          "captured against the dev server. Every frame records which in `server`.",
        note:
          "Signed-in frames use the e2e test-auth channel: Google is not enabled on " +
          "the development Supabase project and no mailbox is reachable from this " +
          "environment, so no live provider round-trip could be captured.",
        count: entries.length,
        frames: entries,
      },
      null,
      2,
    ) + "\n",
  );

  const hashes = new Map<string, string>();
  for (const e of entries) {
    const prior = hashes.get(e.md5);
    if (prior) {
      throw new Error(
        `Duplicate frame bytes: ${e.file} is byte-identical to ${prior}. ` +
          `One of them is a screenshot of the wrong screen.`,
      );
    }
    hashes.set(e.md5, e.file);
  }
});

// ===========================================================================
// A. Daily Grid — start gate, walkthrough, timer, freshness
// ===========================================================================

test("01 daily grid first-time start gate", async ({ page }) => {
  test.skip(MODE !== "prod", "production-build frame");
  await page.goto("/daily/grid", { waitUntil: "domcontentloaded" });

  const gate = page.getByTestId("daily-grid-start-gate");
  await gate.waitFor({ state: "visible", timeout: 45_000 });

  // The three actions the spec names, each asserted before the shutter, so this
  // frame cannot silently become a two-button gate.
  await expect(page.getByTestId("start-daily-grid")).toBeVisible();
  await expect(page.getByTestId("daily-grid-gate-how-to-play")).toBeVisible();
  await expect(page.getByTestId("daily-grid-gate-skip-tour")).toBeVisible();
  // The board must NOT be behind the gate, and the clock must not exist yet.
  await expect(page.getByTestId("daily-grid-board")).toHaveCount(0);
  await expect(page.getByTestId("daily-grid-timer")).toHaveCount(0);

  await settle(page);
  await shot(page, "01-daily-grid-start-gate.png", {
    journey: "Daily Grid start gate",
    note:
      "First-time gate: How to Play / Start Timed Grid / Skip Tour and Start. No board " +
      "is rendered behind it and no timer tile exists yet — asserted, not eyeballed.",
    fullPage: true,
  });
});

test("02 how to play does not start the clock", async ({ page }) => {
  test.skip(MODE !== "prod", "production-build frame");
  await page.goto("/daily/grid", { waitUntil: "domcontentloaded" });
  await page.getByTestId("daily-grid-start-gate").waitFor({ state: "visible", timeout: 45_000 });

  await page.getByTestId("daily-grid-gate-how-to-play").click();
  await page.getByTestId("daily-grid-tour").waitFor({ state: "visible", timeout: 15_000 });
  // The gate is still up and no clock has been created: this is the "timer has
  // NOT started" half of spec §10.4.
  await expect(page.getByTestId("daily-grid-start-gate")).toBeVisible();
  await expect(page.getByTestId("daily-grid-timer")).toHaveCount(0);

  await settle(page);
  await shot(page, "02-daily-grid-tour-opened-from-gate-no-timer.png", {
    journey: "Daily Grid walkthrough is untimed",
    note:
      "The walkthrough opened from the gate's How to Play. The gate is still up and no " +
      "timer tile exists — reading the rules costs the player nothing.",
    fullPage: true,
  });
});

test("03 the timer starts on Start Timed Grid", async ({ page }) => {
  test.skip(MODE !== "prod", "production-build frame");
  await page.goto("/daily/grid", { waitUntil: "domcontentloaded" });
  await page.getByTestId("daily-grid-start-gate").waitFor({ state: "visible", timeout: 45_000 });
  await page.getByTestId("start-daily-grid").click();

  const timer = page.getByTestId("daily-grid-timer");
  await timer.waitFor({ state: "visible", timeout: 45_000 });
  await expect(page.getByTestId("daily-grid-objective")).toBeVisible();
  // Let the clock actually advance, so the frame shows a RUNNING timer rather
  // than a zero that could equally be a stopped one.
  await page.waitForTimeout(3_500);
  const reading = (await timer.innerText()).trim();
  expect(reading).not.toMatch(/0:00\s*$/);

  await settle(page);
  await shot(page, "03-daily-grid-board-timer-running.png", {
    journey: "Daily Grid timer",
    note:
      `Today's board after Start Timed Grid. The Time tile reads "${reading.replace(/\s+/g, " ")}" — ` +
      "asserted to be past 0:00, so this frame shows a clock that is genuinely running. " +
      "The permanent ? help control sits beside How to Play in the header.",
    fullPage: true,
  });
});

test("04 all seven walkthrough steps, replayed from the permanent ? control", async ({ page }) => {
  test.skip(MODE !== "prod", "production-build frame");
  test.setTimeout(240_000);
  await page.goto("/daily/grid", { waitUntil: "domcontentloaded" });
  await page.getByTestId("daily-grid-start-gate").waitFor({ state: "visible", timeout: 45_000 });
  // Dismiss the gate the way a player who does not want the tour would, so the
  // tour that follows is unambiguously a REPLAY rather than a first showing.
  await page.getByTestId("daily-grid-gate-skip-tour").click();
  await page.getByTestId("daily-grid-objective").waitFor({ state: "visible", timeout: 45_000 });

  const launcher = page.getByTestId("daily-grid-tour-launcher");
  await expect(launcher).toBeVisible();
  await launcher.click();

  const tour = page.getByTestId("daily-grid-tour");
  await tour.waitFor({ state: "visible", timeout: 15_000 });

  // Seven steps, named from the tour definition itself — if a step is ever
  // added or removed, this loop changes with it and the sheet cannot go stale.
  expect(DAILY_GRID_TOUR.length).toBe(7);
  for (let i = 0; i < DAILY_GRID_TOUR.length; i++) {
    const step = DAILY_GRID_TOUR[i];
    const title = page.getByTestId("guided-tour-title");
    await expect(title).toHaveText(step.title, { timeout: 10_000 });
    await settle(page);
    // The clock is recorded on every step. The walkthrough is explicitly NOT
    // supposed to pause it (it is a replay over a live board), so a Time tile
    // that never moves across seven steps is a finding, not a formality.
    const clock = (await page.getByTestId("daily-grid-timer").innerText())
      .replace(/\s+/g, " ")
      .trim();
    await shot(
      page,
      `04${"abcdefg"[i]}-daily-grid-tour-step-${i + 1}-${step.id}.png`,
      {
        journey: "Daily Grid walkthrough, replayed via the ? control",
        note:
          `Step ${i + 1} of ${DAILY_GRID_TOUR.length} — "${step.title}". This run of the ` +
          "tour was opened from the permanent ? control on the board, after the gate " +
          `was dismissed with Skip Tour and Start, so it is a replay. Time tile: "${clock}".`,
      },
    );
    if (i < DAILY_GRID_TOUR.length - 1) {
      await page.getByTestId("guided-tour-next").click();
    }
  }
  // The last step's button says Done, not Next — proof the loop really did walk
  // to the end of the tour rather than stopping early.
  await expect(page.getByTestId("guided-tour-next")).toHaveText("Done");
});

test("05 the same board on the other side of a simulated midnight PT", async ({ page }) => {
  test.skip(MODE !== "prod", "production-build frame");
  test.setTimeout(240_000);
  // Playwright's clock has to be installed before the page reads Date.now(),
  // because `useDailyReset` anchors its deadline once, at mount.
  await page.clock.install();
  await page.goto("/daily/grid", { waitUntil: "domcontentloaded" });
  await page.getByTestId("daily-grid-start-gate").waitFor({ state: "visible", timeout: 45_000 });
  // Start the attempt first. An UNTOUCHED board is swapped silently at the
  // boundary (correct: there is nothing to lose); it is a board with state on
  // it that must raise the prompt instead of being taken away.
  await page.getByTestId("start-daily-grid").click();
  await page.getByTestId("daily-grid-objective").waitFor({ state: "visible", timeout: 45_000 });

  const before = (await page.getByTestId("daily-grid-date").innerText()).trim();

  // `fastForward` jumps rather than replaying every tick, and fires each due
  // timer at most once — `runFor` would execute the one-second interval tens of
  // thousands of times and never finish.
  await page.clock.fastForward(13 * 60 * 60 * 1000);

  const prompt = page.getByTestId("daily-grid-rollover-prompt");
  await prompt.waitFor({ state: "visible", timeout: 30_000 });
  await expect(page.getByTestId("daily-grid-rollover-switch")).toBeVisible();
  await expect(page.getByTestId("daily-grid-rollover-stay")).toBeVisible();

  await settle(page);
  await shot(page, "05-daily-grid-after-simulated-midnight-pt.png", {
    journey: "Daily Grid freshness across the reset",
    note:
      `The ${before} board with the browser clock fast-forwarded 13 h past midnight PT. ` +
      "The board is NOT taken away: a prompt offers 'Play today's grid' or 'Finish this " +
      "board'. The Time tile reads the fast-forwarded elapsed time, which is the fake " +
      "clock showing through and not a product defect.",
    fullPage: true,
  });
});

test("06 the previous day's board is a different board", async ({ page }) => {
  test.skip(MODE !== "prod", "production-build frame");
  // Adjacent-day evidence through the product's own ?date= route. The API
  // confirms these are genuinely different boards: 2026-08-01 is "Modern Era",
  // 2026-07-31 is "Two-Way Night".
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const key = yesterday.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  await page.goto(`/daily/grid?date=${key}`, { waitUntil: "domcontentloaded" });
  // The gate is keyed on "has this browser seen the rules", not on which board
  // is being opened, so an archive route shows it too. Dismiss it the way a
  // player would; an archive board starts no timed attempt either way.
  await page.getByTestId("daily-grid-start-gate").waitFor({ state: "visible", timeout: 45_000 });
  await page.getByTestId("daily-grid-gate-skip-tour").click();

  const banner = page.getByTestId("daily-grid-archive-banner");
  await banner.waitFor({ state: "visible", timeout: 45_000 });
  await expect(page.getByTestId("daily-grid-date")).toHaveText(key);

  const theme = (await page.getByTestId("daily-grid-theme").innerText()).trim();
  await settle(page);
  await shot(page, "06-daily-grid-previous-day-archive.png", {
    journey: "Daily Grid freshness across the reset",
    note:
      `The previous Pacific day (${key}, theme "${theme}") reached through ?date=. It is ` +
      "labelled an archive board, is excluded from the streak, and carries a different " +
      "theme and board from today's — the adjacent-day evidence the spec asks for.",
    fullPage: true,
  });
});

// ===========================================================================
// B. RUN THE TABLE — reveal, map, Scout & Prepare, market, outcomes
// ===========================================================================

test("07 run the table start gate states the run's shape", async ({ page }) => {
  test.skip(MODE !== "prod", "production-build frame");
  await rttFreshGate(page);
  await expect(page.getByTestId("rtt-gate-acts")).toHaveText(/5 acts/i);
  await expect(page.getByTestId("rtt-gate-lives")).toContainText(/3 lives/i);
  await expect(page.getByTestId("rtt-gate-credit-sinks")).toBeVisible();
  await settle(page);
  await shot(page, "07-rtt-start-gate.png", {
    journey: "RUN THE TABLE start gate",
    note:
      "The gate states the run's shape from GET /run-the-table/meta — five acts, three " +
      "lives — and lists the four published credit sinks with their prices.",
    fullPage: true,
  });
});

test("08 opening roster reveal, partial and complete", async ({ page }) => {
  test.skip(MODE !== "prod", "production-build frame");
  test.setTimeout(240_000);
  await rttFreshGate(page);
  await rttStartRun(page);

  const reveal = page.getByTestId("rtt-opening-reveal");
  await reveal.waitFor({ state: "visible", timeout: 30_000 });
  // Reveal ONE card so the frame is genuinely partial: some slots named, the
  // rest still face down.
  await page.getByTestId("rtt-reveal-start-roster").click();
  await page.getByTestId("rtt-reveal-skip-roster").waitFor({ state: "visible", timeout: 20_000 });
  const partialProgress = (await page.getByTestId("rtt-reveal-progress-roster").innerText()).trim();
  await settle(page);
  await shot(page, "08a-rtt-opening-reveal-partial.png", {
    journey: "RUN THE TABLE opening reveal",
    note:
      `Opening roster reveal, partially revealed (${partialProgress.replace(/\s+/g, " ")}). ` +
      "The reveal is user-triggered: nothing is shown until the player asks for it.",
    fullPage: true,
  });

  // Skip reveals the remainder in one server round trip.
  // THE FULLY-REVEALED REEL IS NOT A SCREEN THAT EXISTS.
  //
  // `needsOpeningReveal()` is `... && !roster.complete`, so the instant the last
  // slot turns over the reel unmounts and the perk chooser takes the slot. The
  // first version of this capture waited for `data-reveal-complete="true"` and
  // timed out on an element that had already gone — which is the correct
  // failure, and the reason this frame is named for what it actually shows
  // rather than for what the sheet was asked to contain.
  const progress = page.getByTestId("rtt-reveal-progress-roster");
  // `innerText` returns RENDERED text, and this line is `uppercase`, so it
  // arrives as "1 OF 7 REVEALED". The first version of this parse was
  // case-sensitive and read a total of zero.
  const total = Number.parseInt(
    ((await progress.innerText()).match(/of\s+(\d+)/i) ?? [])[1] ?? "0",
    10,
  );
  expect(total).toBeGreaterThan(1);
  for (let revealed = 1; revealed < total - 1; revealed++) {
    await page.getByTestId("rtt-reveal-start-roster").click();
    await expect(progress).toHaveText(new RegExp(`^${revealed + 1} of ${total}`, "i"), {
      timeout: 20_000,
    });
  }
  await settle(page);
  await shot(page, "08b-rtt-opening-reveal-all-but-final-card.png", {
    journey: "RUN THE TABLE opening reveal",
    note:
      `${total - 1} of ${total} slots turned over — the LAST state of this screen a player ` +
      "can ever see. Revealing the final card completes the track, and `needsOpeningReveal` " +
      "then unmounts the reel in the same render, so a fully-revealed reel is not a screen " +
      "that exists. See the report's R4.",
    fullPage: true,
  });

  await page.getByTestId("rtt-reveal-start-roster").click();
  await expect(page.getByTestId("rtt-opening-reveal")).toHaveCount(0, { timeout: 25_000 });
  // The tray marks itself with `data-tour-id`, not a testid.
  const tray = page.locator('[data-tour-id="rtt-roster"]');
  await expect(tray.first()).toBeVisible({ timeout: 25_000 });
  await settle(page);
  await shot(page, "08c-rtt-roster-complete-after-reveal.png", {
    journey: "RUN THE TABLE opening reveal",
    note:
      "The frame immediately after the final card: the reel is gone, the perk chooser has " +
      "the decision column and the COMPLETE opening roster is in the run tray. This is where " +
      "a player actually sees all seven.",
    fullPage: true,
  });
});

test("09 the five-act run map", async ({ page }) => {
  test.skip(MODE !== "prod", "production-build frame");
  test.setTimeout(300_000);
  await rttFreshGate(page);
  await rttStartRun(page);
  // Drive a few acts in so the map shows done / current / locked rows rather
  // than a rail that is entirely grey.
  await driveUntil(page, (s) => s === "rtt-boss-preview" || s === "rtt-boss-reveal");

  const map = page.getByTestId("rtt-run-map");
  await expect(map).toBeVisible();
  const rows = await map.locator("ol > li").count();
  const acts = new Set((await map.innerText()).match(/act\s+\d+/gi) ?? []).size;
  await settle(page);
  await shot(page, "09-rtt-five-act-run-map.png", {
    journey: "RUN THE TABLE five-act map",
    note:
      `The run map rail at a boss node: ${rows} rows across ${acts} act headings. It is a ` +
      "vertical list, so a longer run grows the page rather than overflowing the column.",
    fullPage: true,
  });
});

test("10 scout and prepare offers three choices", async ({ page }) => {
  test.skip(MODE !== "prod", "production-build frame");
  test.setTimeout(300_000);
  await rttFreshGate(page);
  await rttStartRun(page);
  const surface = await driveUntil(page, (s) => s === "rtt-scout-prepare");
  expect(surface).toBe("rtt-scout-prepare");

  const branches = page.getByTestId("rtt-scout-branches");
  await expect(branches).toBeVisible();
  const count = await branches.locator('[data-testid^="rtt-scout-branch-"]').count();
  expect(count).toBe(3);
  const labels = (await branches.innerText()).replace(/\s+/g, " ").slice(0, 200);
  await settle(page);
  await shot(page, "10-rtt-scout-prepare-three-choices.png", {
    journey: "RUN THE TABLE Scout & Prepare",
    note: `All three Scout & Prepare branches on one screen. Branch text: "${labels}".`,
    fullPage: true,
  });
});

test("11 market refresh, before and after", async ({ page }) => {
  test.skip(MODE !== "prod", "production-build frame");
  test.setTimeout(300_000);
  await rttFreshGate(page);
  await rttStartRun(page);
  await driveUntil(page, (s) => s === "rtt-draft-room" || s === "rtt-trade-desk");

  const sink = page.getByTestId("rtt-sink-market_refresh");
  await expect(sink).toBeVisible();
  await expect(sink).toHaveAttribute("data-sink-selectable", "true");
  const cost = (await page.getByTestId("rtt-sink-cost-market_refresh").innerText()).trim();
  await settle(page);
  await shot(page, "11a-rtt-market-before-refresh.png", {
    journey: "RUN THE TABLE credit sinks",
    note: `A market with Market Refresh offered and affordable (${cost}), before it is spent.`,
    fullPage: true,
  });

  await sink.click();
  // The refreshed board is a server response; wait for the control to lock
  // itself (one refresh per node) rather than for a fixed delay.
  await expect(sink).toHaveAttribute("data-sink-selectable", "false", { timeout: 25_000 });
  const blocked = page.getByTestId("rtt-sink-blocked-market_refresh");
  await expect(blocked).toBeVisible();
  const reason = (await blocked.innerText()).trim();
  await settle(page);
  await shot(page, "11b-rtt-market-after-refresh.png", {
    journey: "RUN THE TABLE credit sinks",
    note:
      `The same node after spending ${cost} on Market Refresh: new offers, and the control ` +
      `is now shown-but-locked with its reason ("${reason}") rather than hidden. ` +
      "CAPTURE ARTIFACT, NOT A LAYOUT BUG: the global nav and the two sticky side rails are " +
      "painted part-way down this frame. Chromium's full-page capture resolves " +
      "`position: sticky` against the expanded viewport, and this page is captured after an " +
      "interaction that scrolled it. Compare 11a, which is the identical layout captured " +
      "before the click and sits correctly at the top of the page.",
    fullPage: true,
  });
});

/** Seeds tried while hunting an EARLY elimination — a run that ends inside an
 *  act rather than at the final boss. */
const EARLY_ELIMINATION_SEED_HUNT = [11, 22, 33, 44, 55, 66] as const;

test("12 a run played without spending, hunting an early elimination", async ({ page }) => {
  test.skip(MODE !== "prod", "production-build frame");
  test.setTimeout(900_000);

  // A standard run with no `?seed=` gets a server-assigned random seed, which
  // is why the outcome moved between two runs of this sheet. Fixed seeds make
  // the search reproducible; the outcome is still whatever the engine returns.
  let last: { seed: number; outcome: string; verdict: string } | null = null;
  for (const seed of EARLY_ELIMINATION_SEED_HUNT) {
    await rttFreshGate(page, `${RTT_ROUTE}?seed=${seed}`);
    await rttStartRun(page);
    await driveUntil(page, () => false, "pass");
    const outcome = await resultOutcome(page);
    const verdict = (await page.getByTestId("rtt-result-verdict").innerText()).trim();
    last = { seed, outcome, verdict };
    if (outcome === "ended_in_act") break;
  }

  expect(last).not.toBeNull();
  const { seed, outcome, verdict } = last!;
  await settle(page);
  // Named from the DOM. A filename can only say "ended-in-act" if the engine did.
  await shot(page, `12-rtt-receipt-${outcome.replace(/_/g, "-")}.png`, {
    journey: "RUN THE TABLE outcome",
    note:
      `Seed ${seed}, driven with the never-spend strategy (pass every card, decline every ` +
      `trade). The engine's outcome was \`${outcome}\` — verdict "${verdict}". ` +
      (outcome === "ended_in_act"
        ? "This is the spec's early-elimination frame: three lives gone before act 5."
        : `No seed in [${EARLY_ELIMINATION_SEED_HUNT.join(", ")}] ran out of lives before the ` +
          "final act under this strategy."),
    fullPage: true,
  });
});

/**
 * Seeds tried in order while hunting for a TABLE CLEAR.
 *
 * `?seed=` is the product's own free-play replay parameter and the board is a
 * pure function of it, so this is a search over boards, not over luck. The
 * driver always buys the highest PEAK3 prime score it can afford — the closest
 * a blind harness gets to playing well — and the search stops at the first seed
 * that clears.
 */
const TABLE_CLEAR_SEED_HUNT = [
  101, 202, 303, 404, 505, 606, 707, 808, 909, 1234, 4242, 7777,
] as const;

test("13 a run played to the strongest roster it can buy, hunting a table clear", async ({
  page,
}) => {
  test.skip(MODE !== "prod", "production-build frame");
  test.setTimeout(900_000);

  let last: { seed: number; outcome: string; verdict: string } | null = null;
  for (const seed of TABLE_CLEAR_SEED_HUNT) {
    await rttFreshGate(page, `${RTT_ROUTE}?seed=${seed}`);
    await rttStartRun(page);
    await driveUntil(page, () => false, "best");
    const outcome = await resultOutcome(page);
    const verdict = (await page.getByTestId("rtt-result-verdict").innerText()).trim();
    last = { seed, outcome, verdict };
    if (outcome === "table_cleared") break;
  }

  expect(last).not.toBeNull();
  const { seed, outcome, verdict } = last!;
  await settle(page);
  // Named from the DOM's `data-outcome`. "table-cleared" can only appear on a
  // frame the engine called a table clear.
  await shot(page, `13-rtt-receipt-${outcome.replace(/_/g, "-")}.png`, {
    journey: "RUN THE TABLE outcome",
    note:
      `Seed ${seed}, driven with the buy-the-strongest-affordable-card strategy. The engine's ` +
      `outcome was \`${outcome}\` — verdict "${verdict}". ` +
      (outcome === "table_cleared"
        ? "This is the spec's Table Clear frame."
        : `No seed in [${TABLE_CLEAR_SEED_HUNT.join(", ")}] produced a table clear under this ` +
          "strategy, so the sheet has no Table Clear frame. Nothing was staged to manufacture " +
          "one."),
    fullPage: true,
  });
});

// ===========================================================================
// C. Footer and the beta legal / provenance pages
// ===========================================================================

test("14 footer, desktop and mobile", async ({ page }) => {
  test.skip(MODE !== "prod", "production-build frame");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const footer = page.locator("footer");
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole("link", { name: "Terms of Use" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Accessibility" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Data Sources" })).toBeVisible();
  await settle(page);
  await footer.screenshot({ path: path.join(OUT, "14a-footer-desktop.png"), animations: "disabled" });
  {
    const bytes = fs.readFileSync(path.join(OUT, "14a-footer-desktop.png"));
    entries.push({
      file: "14a-footer-desktop.png",
      journey: "Global footer",
      viewport: `${DESKTOP.width}x${DESKTOP.height}`,
      url: page.url(),
      title: await page.title(),
      note:
        "Element shot of the footer at 1440px: three columns (Play / Learn / Legal) side by " +
        "side, with the NBA affiliation disclaimer beneath.",
      authMethod: "guest",
      reducedMotion: false,
      server: SERVER,
      h1: null,
      md5: crypto.createHash("md5").update(bytes).digest("hex"),
    });
  }

  await page.setViewportSize(MOBILE);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const mobileFooter = page.locator("footer");
  await mobileFooter.scrollIntoViewIfNeeded();
  await expect(mobileFooter.getByRole("link", { name: "Privacy" })).toBeVisible();
  await settle(page);
  await mobileFooter.screenshot({
    path: path.join(OUT, "14b-footer-mobile.png"),
    animations: "disabled",
  });
  {
    const bytes = fs.readFileSync(path.join(OUT, "14b-footer-mobile.png"));
    entries.push({
      file: "14b-footer-mobile.png",
      journey: "Global footer",
      viewport: `${MOBILE.width}x${MOBILE.height}`,
      url: page.url(),
      title: await page.title(),
      note:
        "Element shot of the same footer at 390px: `sm:grid-cols-3` collapses to one column, " +
        "so the three groups stack.",
      authMethod: "guest",
      reducedMotion: false,
      server: SERVER,
      h1: null,
      md5: crypto.createHash("md5").update(bytes).digest("hex"),
    });
  }
});

const LEGAL_PAGES: ReadonlyArray<[string, string, string, string]> = [
  ["15-terms.png", "/terms", "Terms of Use", "Beta Terms of Use."],
  ["16-privacy.png", "/privacy", "Privacy", "Beta privacy notice."],
  ["17-accessibility.png", "/accessibility", "Accessibility", "Accessibility statement."],
  ["18-data-sources.png", "/data-sources", "Data Sources", "Data provenance page."],
  [
    "19-contact.png",
    "/contact",
    "Contact",
    "Contact page. The deployment has no contact address set; the placeholder must render " +
      "as a stated 'no address set' block, NOT as a live mailto link.",
  ],
];

for (const [file, route, heading, note] of LEGAL_PAGES) {
  test(`legal page ${route}`, async ({ page }) => {
    test.skip(MODE !== "prod", "production-build frame");
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${route} must not 404`).toBeLessThan(400);
    await expect(page.locator("h1").first()).toHaveText(heading, { timeout: 15_000 });
    await settle(page);
    await shot(page, file, {
      journey: "Footer / legal pages",
      note,
      fullPage: true,
    });
  });
}

// ===========================================================================
// D. Head-to-head PvP  (dev server + e2e test-auth channel)
// ===========================================================================

const PLAYER_A = { sub: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", email: "player-a@example.test" };
const PLAYER_B = { sub: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", email: "player-b@example.test" };

/**
 * Play a complete RUN THE TABLE run as a guest, then sign in and let
 * `/auth/complete` claim it.
 *
 * THIS IS THE PRODUCT'S OWN PATH, and it is the only one that works: because
 * `rttFetch` sends no bearer token, a run created while signed in is owned by
 * the anonymous cookie subject and `POST /h2h` rejects it with 403
 * `not_your_run`. Playing first and claiming at sign-in is what puts the run
 * under the account.
 */
async function guestRunThenClaim(page: Page, who: { sub: string; email: string }) {
  await rttFreshGate(page);
  await rttStartRun(page);
  await driveUntil(page, () => false, "pass");
  await resultOutcome(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const token = await signInViaTestChannel(page, who.sub, who.email);
  await page.goto("/auth/complete?next=%2Farena%2Frun-the-table%2Fh2h", {
    waitUntil: "domcontentloaded",
  });
  // The claim either shows a summary or redirects straight through. Either way
  // the hub is where it lands.
  await page.waitForURL(/\/arena\/run-the-table\/h2h/, { timeout: 30_000 });
  return token;
}

test("20 head-to-head challenge creation", async ({ page }) => {
  test.skip(MODE !== "dev", "needs the e2e test-auth channel, which production builds remove");
  test.setTimeout(400_000);
  await guestRunThenClaim(page, PLAYER_A);

  const create = page.getByRole("button", { name: /create a head-to-head/i });
  await expect(create).toBeVisible({ timeout: 20_000 });
  await create.click();

  const created = page.getByTestId("h2h-created");
  await created.waitFor({ state: "visible", timeout: 30_000 });
  await expect(created).toContainText("/arena/run-the-table/h2h/invite/");
  await settle(page);
  await shot(page, "20-h2h-challenge-created.png", {
    journey: "Head-to-head challenge creation",
    note:
      "A created head-to-head, with the invite link and a Copy link control. The run behind " +
      "it was played as a guest and claimed at sign-in — a run created while already signed " +
      "in is owned by the anonymous cookie subject and is refused here with 403 not_your_run " +
      "(see the report's R1).",
    authMethod: "e2e-test-channel",
    fullPage: true,
  });
});

test("21 invite landing, signed out and signed in", async ({ browser }) => {
  test.skip(MODE !== "dev", "needs the e2e test-auth channel, which production builds remove");
  test.setTimeout(400_000);

  // Player A: play, claim, create.
  const aContext = await browser.newContext({ viewport: DESKTOP });
  const a = await aContext.newPage();
  await guestRunThenClaim(a, PLAYER_A);
  await a.getByRole("button", { name: /create a head-to-head/i }).click();
  await a.getByTestId("h2h-created").waitFor({ state: "visible", timeout: 30_000 });
  const invitePath = (await a.locator("code").first().innerText()).trim().replace(/^https?:\/\/[^/]+/, "");
  expect(invitePath).toContain("/arena/run-the-table/h2h/invite/");

  // A stranger with the link, signed out.
  const guestContext = await browser.newContext({ viewport: DESKTOP });
  const guest = await guestContext.newPage();
  await guest.goto(invitePath, { waitUntil: "domcontentloaded" });
  await expect(guest.getByTestId("invite-status")).toBeVisible({ timeout: 30_000 });
  await expect(guest.locator("h1")).toContainText(/challenged you to RUN THE TABLE/i);
  await settle(guest);
  await shot(guest, "21a-h2h-invite-landing-signed-out.png", {
    journey: "Head-to-head invite landing",
    note:
      "The invite as a signed-out recipient sees it: who challenged them, the status and the " +
      "expiry, and no spoiler at all about the creator's run. NOTE the 'Sign in to accept' " +
      "sign-in CTA now points at /signin (was /auth/sign-in, a 404 — report R2, fixed).",
    fullPage: true,
  });

  // Player B, signed in, sees the accept control.
  const bContext = await browser.newContext({ viewport: DESKTOP });
  const b = await bContext.newPage();
  await b.goto("/", { waitUntil: "domcontentloaded" });
  await signInViaTestChannel(b, PLAYER_B.sub, PLAYER_B.email);
  await b.goto(invitePath, { waitUntil: "domcontentloaded" });
  const accept = b.getByRole("button", { name: /accept challenge/i });
  await expect(accept).toBeVisible({ timeout: 30_000 });
  await settle(b);
  await shot(b, "21b-h2h-invite-landing-signed-in.png", {
    journey: "Head-to-head invite landing",
    note: "The same invite with an account signed in: the Accept challenge control is offered.",
    authMethod: "e2e-test-channel",
    fullPage: true,
  });

  await aContext.close();
  await guestContext.close();
  await bContext.close();
});

test("22 side-by-side PvP result", async ({ browser }) => {
  test.skip(MODE !== "dev", "needs the e2e test-auth channel, which production builds remove");
  test.setTimeout(600_000);

  // --- player A: play a run as a guest, claim it, create the challenge ------
  const aContext = await browser.newContext({ viewport: DESKTOP });
  const a = await aContext.newPage();
  await guestRunThenClaim(a, PLAYER_A);
  await a.getByRole("button", { name: /create a head-to-head/i }).click();
  await a.getByTestId("h2h-created").waitFor({ state: "visible", timeout: 30_000 });
  const invitePath = (await a.locator("code").first().innerText())
    .trim()
    .replace(/^https?:\/\/[^/]+/, "");
  const matchHref = await a.getByRole("link", { name: /open the match/i }).getAttribute("href");
  expect(matchHref).toBeTruthy();

  // A's run is already finished, so their side can be submitted immediately.
  await a.goto(matchHref!, { waitUntil: "domcontentloaded" });
  await a.getByRole("button", { name: /submit my finished run/i }).click();
  await expect(a.getByTestId("h2h-awaiting")).toBeVisible({ timeout: 30_000 });
  await settle(a);
  await shot(a, "22a-h2h-match-awaiting-opponent.png", {
    journey: "Head-to-head match",
    note:
      "The creator's match screen after submitting: the opponent's status is literally " +
      "'Hidden until you have both finished', and the server omits their result from the " +
      "payload entirely rather than relying on the client to hide it.",
    authMethod: "e2e-test-channel",
    fullPage: true,
  });

  // --- player B: accept, then play the pinned board -------------------------
  // The bearer shim is installed BEFORE any navigation. Without it the run the
  // accept just created is unreachable: it is owned by B's account and the RUN
  // THE TABLE client authenticates with the anonymous cookie only.
  const bContext = await browser.newContext({ viewport: DESKTOP });
  const b = await bContext.newPage();
  await b.goto("/", { waitUntil: "domcontentloaded" });
  const bToken = await signInViaTestChannel(b, PLAYER_B.sub, PLAYER_B.email);
  await attachRttBearer(b, bToken);
  await b.goto(invitePath, { waitUntil: "domcontentloaded" });
  await b.getByRole("button", { name: /accept challenge/i }).click();
  await b.waitForURL(/\/arena\/run-the-table\/h2h\/[0-9a-f-]+$/i, { timeout: 30_000 });
  const bMatchUrl = b.url();

  // Point the game at the run the accept minted. `?run=` is not read by the
  // route (report R3), so the harness writes the breadcrumb the resume path
  // actually consults.
  // MatchScreen fetches its view after mount, so the link does not exist at the
  // moment the redirect lands. Wait for it rather than reading an empty DOM.
  const continueLink = b.getByRole("link", { name: /continue your run/i });
  await continueLink.waitFor({ state: "visible", timeout: 30_000 });
  const bRunId = decodeURIComponent(
    ((await continueLink.getAttribute("href")) ?? "").split("run=")[1] ?? "",
  );
  expect(bRunId, "the match screen must name the opponent's run").toBeTruthy();
  await b.goto(RTT_ROUTE, { waitUntil: "load" });
  // `loadActiveRun()` validates the breadcrumb: schema version, run id, a
  // finite seed and a known run type, and drops it whole if any is missing. So
  // the run has to be read back from the API before it can be written.
  await b.evaluate(
    async ({ key, runId, schema, jwt, api }) => {
      const res = await fetch(`${api}/api/v1/run-the-table/runs/${runId}`, {
        headers: { Authorization: `Bearer ${jwt}` },
        credentials: "include",
      });
      const run = (await res.json()) as { seed: number; run_type: string; date: string | null };
      window.localStorage.setItem(
        key,
        JSON.stringify({
          schema_version: schema,
          run_id: runId,
          seed: run.seed,
          run_type: run.run_type,
          run_date: run.date ?? null,
          updated_at: new Date().toISOString(),
        }),
      );
    },
    {
      key: RUN_THE_TABLE_STORAGE_KEY,
      runId: bRunId,
      schema: RUN_THE_TABLE_SCHEMA_VERSION,
      jwt: bToken,
      api: API_BASE,
    },
  );
  await suppressRttTour(b);
  await b.goto(RTT_ROUTE, { waitUntil: "load" });
  await expect(b.locator('[data-testid="rtt-shell"]')).toBeVisible({ timeout: 30_000 });
  await driveUntil(b, () => false, "buy");
  await resultOutcome(b);

  await b.goto(bMatchUrl, { waitUntil: "domcontentloaded" });
  await b.getByRole("button", { name: /submit my finished run/i }).click();
  await b.getByTestId("h2h-outcome").waitFor({ state: "visible", timeout: 30_000 });
  await expect(b.getByTestId("h2h-decided-by")).toBeVisible();
  await settle(b);
  await shot(b, "22b-h2h-side-by-side-result.png", {
    journey: "Head-to-head side-by-side result",
    note:
      "The settled match: both runs, the outcome and the tie-break level that decided it, " +
      "from GET /h2h/{id}/receipt. The opponent's half of this match could only be played " +
      "because the harness attaches the bearer token the RUN THE TABLE client omits and " +
      "seeds the resume breadcrumb the ?run= link does not set — see report R1 and R3. " +
      "Every number on screen is the server's; nothing here is fabricated.",
    authMethod: "e2e-test-channel",
    fullPage: true,
  });

  // The creator's view of the same settled match, from the other side.
  await a.goto(matchHref!, { waitUntil: "domcontentloaded" });
  await a.getByTestId("h2h-outcome").waitFor({ state: "visible", timeout: 30_000 });
  await settle(a);
  await shot(a, "22c-h2h-side-by-side-result-creator-view.png", {
    journey: "Head-to-head side-by-side result",
    note: "The same settled match seen by the creator, whose run was submitted first.",
    authMethod: "e2e-test-channel",
    fullPage: true,
  });

  await aContext.close();
  await bContext.close();
});
