/**
 * RUN THE TABLE end-to-end gameplay tests.
 *
 * Requires FastAPI (port 8000) and Next.js (port 3000) — both auto-start via
 * playwright.config.ts — with PEAK3_RUN_THE_TABLE_ENABLED=true in the API's
 * environment. Mobile-specific tests are tagged @mobile and run only in the
 * mobile-chrome (Pixel 5) project, matching courtbuilder.spec.ts's convention.
 *
 * Conventions borrowed from courtbuilder.spec.ts:
 *   * every test that plays a whole run calls `test.setTimeout(FULL_RUN_TIMEOUT_MS)`
 *     as its first line — a run is ~20 sequential server round-trips and blows
 *     straight through Playwright's 30s default;
 *   * assertions are on END STATES (which surface is mounted, which seed is
 *     shown), never on an animation frame — the battle reveal is a timed
 *     sequence and racing it is what makes a suite flaky;
 *   * localStorage is only ever cleared after navigating to a same-origin page.
 *     `about:blank` has an opaque origin and throws on `localStorage` access,
 *     which fails the test for a reason that has nothing to do with the product.
 */
import { test, expect, Page } from "@playwright/test";

const ROUTE = "/arena/run-the-table";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const STORAGE_KEY = "peak3.run-the-table.active";

// A full run is: 1-2 System picks, 6 node choices, 6 node resolutions, 3 boss
// resolutions and 3 advances — ~20 sequential POSTs, each a real server
// round-trip. This is a fixed structural cost of the mode, not slow test code.
const FULL_RUN_TIMEOUT_MS = 60_000;

/** Every decision surface, in the order they are probed. `rtt-result` leads:
 *  it is the terminal state and the only one the driver stops on. */
const SURFACE_IDS = [
  "rtt-result",
  "rtt-system-select",
  "rtt-node-choice",
  "rtt-draft-room",
  "rtt-trade-desk",
  "rtt-choice-node",
  "rtt-boss-preview",
  "rtt-battle-reveal",
] as const;

const SURFACE_SELECTOR = SURFACE_IDS.map((id) => `[data-testid="${id}"]`).join(", ");

type SurfaceId = (typeof SURFACE_IDS)[number];

interface StoredRun {
  run_id: string;
  seed: number;
  run_type: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Land on the route with no stored run, so the Start gate is what renders.
 *  Navigates FIRST, then clears storage — see the file docstring. */
async function freshGate(page: Page, path: string = ROUTE): Promise<void> {
  await page.goto(path, { waitUntil: "load" });
  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
  await page.goto(path, { waitUntil: "load" });
  await expect(page.locator('[data-testid="rtt-start-gate"]')).toBeVisible({ timeout: 20_000 });
}

/** Press a start button and wait for a real board. Mirrors courtbuilder's
 *  `beginRun`: the run begins on an explicit click, never on a navigation, so
 *  every test goes through the gate rather than special-casing it once. */
async function startRun(page: Page, testId: string): Promise<void> {
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

/** Which decision surface is mounted right now. */
async function currentSurface(page: Page): Promise<SurfaceId> {
  await page.waitForSelector(SURFACE_SELECTOR, { state: "visible", timeout: 20_000 });
  for (const id of SURFACE_IDS) {
    if ((await page.locator(`[data-testid="${id}"]`).count()) > 0) return id;
  }
  throw new Error("no known RUN THE TABLE surface is mounted");
}

/**
 * Take the always-legal action on whatever surface is showing, and wait for it
 * to be replaced.
 *
 * Every transition in the mode lands on a DIFFERENT surface testid (a node
 * choice always opens a node, a node always closes into the next choice or a
 * boss, a battle always advances out of itself), so "the surface I just acted
 * on is gone" is an authoritative, endpoint-agnostic proof the action landed —
 * the same reasoning as courtbuilder.spec.ts's filled-slot-count wait, and
 * immune to the "response resolved before the listener attached" race.
 */
async function stepOnce(page: Page, surface: SurfaceId): Promise<void> {
  switch (surface) {
    case "rtt-system-select":
      await page.locator('[data-testid="rtt-system-select"] button').first().click();
      break;
    case "rtt-node-choice":
      await page.locator('[data-testid="rtt-node-choice"] button').first().click();
      break;
    case "rtt-draft-room":
      // Passing is unconditionally legal at a Draft Room, which is exactly why
      // the driver uses it: it never depends on what the board happens to hold
      // or on what the run can afford.
      await page.locator('[data-testid="rtt-draft-pass"]').click();
      break;
    case "rtt-trade-desk":
      await page.locator('[data-testid="rtt-trade-decline"]').click();
      break;
    case "rtt-choice-node":
      // Rest / Bank disables "recover a life" at full lives, so take the first
      // ENABLED choice rather than the first one.
      await page
        .locator('[data-testid="rtt-choice-node"] button:not([disabled])')
        .first()
        .click();
      break;
    case "rtt-boss-preview":
      await page.locator('[data-testid="rtt-resolve-boss"]').click();
      break;
    case "rtt-battle-reveal":
      // Skip the lane-by-lane reveal, then advance. Asserting the END state
      // instead of watching the animation is the whole point of the skip
      // affordance existing.
      await page.locator('[data-testid="rtt-battle-skip"]').click();
      await page.locator('[data-testid="rtt-battle-advance"]').click();
      break;
    case "rtt-result":
      return;
  }
  await expect(page.locator(`[data-testid="${surface}"]`)).toHaveCount(0, { timeout: 20_000 });
}

/** Drive the run to its receipt. A run ends either by finishing act 3 or by
 *  losing three battles; both land on `rtt-result`, so the driver stops on the
 *  surface rather than on a particular outcome. */
async function playToResult(page: Page, maxSteps = 60): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    const surface = await currentSurface(page);
    if (surface === "rtt-result") return;
    await stepOnce(page, surface);
  }
  throw new Error(`run did not reach a receipt within ${maxSteps} steps`);
}

async function storedRun(page: Page): Promise<StoredRun | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredRun) : null;
  }, STORAGE_KEY);
}

/** No horizontal page overflow. 4px of slack for sub-pixel layout rounding —
 *  a real overflow bug is tens of pixels, never four. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.body.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 4);
}

// ---------------------------------------------------------------------------
// Full runs
// ---------------------------------------------------------------------------

test.describe("RUN THE TABLE full run", () => {
  test("an anonymous visitor plays a whole standard run to a receipt", async ({ page }) => {
    test.setTimeout(FULL_RUN_TIMEOUT_MS);
    await freshGate(page);
    await startRun(page, "rtt-start-standard");

    // The run opens on the System choice — the one decision that is made
    // before anything else exists.
    expect(await currentSurface(page)).toBe("rtt-system-select");

    await playToResult(page);

    const result = page.locator('[data-testid="rtt-result"]');
    await expect(result).toBeVisible();
    await expect(page.locator('[data-testid="rtt-result-verdict"]')).toBeVisible();
    // The replay affordances the receipt promises must actually be there.
    await expect(page.locator('[data-testid="rtt-run-it-back"]')).toBeVisible();
    await expect(page.locator('[data-testid="rtt-replay-seed"]')).toBeVisible();
    await expect(page.locator('[data-testid="rtt-challenge"]')).toBeVisible();
  });

  test("@mobile an anonymous visitor plays a whole run without horizontal overflow", async ({
    page,
  }) => {
    test.setTimeout(FULL_RUN_TIMEOUT_MS);
    await freshGate(page);
    await expectNoHorizontalOverflow(page);

    await startRun(page, "rtt-start-standard");
    // Checked on the first real board as well as at the end: the widest
    // surfaces (the draft board, the battle lane bars) are mid-run, so a
    // result-only check would miss them.
    await expectNoHorizontalOverflow(page);

    await playToResult(page);
    await expect(page.locator('[data-testid="rtt-result"]')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

test.describe("RUN THE TABLE resume", () => {
  test("a mid-run reload comes back on the same screen", async ({ page }) => {
    test.setTimeout(FULL_RUN_TIMEOUT_MS);
    await freshGate(page);
    await startRun(page, "rtt-start-standard");

    // Get a few decisions in, so "the same screen" is a screen the player
    // actually navigated to rather than the one every run opens on.
    await stepOnce(page, await currentSurface(page)); // system -> node choice
    await stepOnce(page, await currentSurface(page)); // node choice -> node
    const before = await currentSurface(page);
    const runBefore = await storedRun(page);
    expect(runBefore?.run_id).toBeTruthy();

    await page.reload({ waitUntil: "load" });

    await expect(page.locator('[data-testid="rtt-shell"]')).toBeVisible({ timeout: 20_000 });
    expect(await currentSurface(page)).toBe(before);
    // Same run, not a lookalike started fresh on a new seed.
    const runAfter = await storedRun(page);
    expect(runAfter?.run_id).toBe(runBefore?.run_id);
    expect(runAfter?.seed).toBe(runBefore?.seed);

    // And it is still playable from there.
    await stepOnce(page, before);
  });
});

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

test.describe("RUN THE TABLE daily", () => {
  test("today's run is the same board on a revisit", async ({ page }) => {
    await freshGate(page);
    const note = page.locator('[data-testid="rtt-daily-note"]');
    // The daily is separately flag-gated; without it the descriptor never
    // loads and there is no note to compare. Skip rather than fail on a
    // deliberate configuration.
    if ((await note.count()) === 0) {
      test.skip(true, "the RUN THE TABLE daily is not enabled in this environment");
    }
    const first = (await note.innerText()).trim();
    expect(first).toMatch(/\d/);

    await freshGate(page);
    const second = (await page.locator('[data-testid="rtt-daily-note"]').innerText()).trim();
    expect(second).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// Challenge links
// ---------------------------------------------------------------------------

test.describe("RUN THE TABLE challenge links", () => {
  test("a challenge link reproduces the sender's seed", async ({ page }) => {
    test.setTimeout(FULL_RUN_TIMEOUT_MS);
    // Regression test for a defect that broke the share loop end to end, in
    // two independent places:
    //   1. the API returned `public_url_path = /c/{token}`, which is PEAK
    //      DRAFT's challenge page — it resolves tokens through
    //      /api/v1/draft/challenges/{token}/meta and cannot recognise a RUN
    //      THE TABLE token, so the recipient got a not-found screen;
    //   2. even on the right URL, the Start gate rendered only "Start a run"
    //      and "Today's run" — nothing passed the token, so a recipient who
    //      pressed the obvious button silently got a fresh random seed and had
    //      no way to tell.
    // Following the link the API itself hands out, and comparing seeds, is
    // what makes both failures visible.
    await freshGate(page);
    await startRun(page, "rtt-start-standard");
    const origin = await storedRun(page);
    expect(origin?.run_id).toBeTruthy();

    const minted = await page.request.post(
      `${API_BASE}/api/v1/run-the-table/runs/${origin!.run_id}/challenge`,
      { data: {} },
    );
    expect(minted.ok()).toBe(true);
    const { public_url_path: path, challenge_token: token } = await minted.json();
    expect(token).toBeTruthy();
    // The path the server hands out must be the one the recipient can open.
    expect(path).toContain(ROUTE);
    expect(path).not.toContain("/c/");

    // Arrive as the recipient: same browser, no stored run.
    await freshGate(page, path);

    // The gate names the board before anything is committed, and offers a
    // button that actually plays it.
    await expect(page.locator('[data-testid="rtt-challenge-note"]')).toContainText(
      String(origin!.seed),
      { timeout: 20_000 },
    );
    await startRun(page, "rtt-start-challenge");

    const replayed = await storedRun(page);
    expect(replayed?.seed).toBe(origin!.seed);
    expect(replayed?.run_type).toBe("challenge");
    expect(replayed?.run_id).not.toBe(origin!.run_id);
  });
});

// ---------------------------------------------------------------------------
// The gate is the only way in
// ---------------------------------------------------------------------------

test.describe("RUN THE TABLE start gate", () => {
  test("navigating to the route creates no run", async ({ page }) => {
    // The structural rule this mode shares with 82-0 and Peak Draft: a run
    // fixes a seed and is what gets shared, so merely following a link must
    // never burn one. Counted at the network layer, because a run created and
    // then discarded client-side would still have been created server-side.
    const creations: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/run-the-table/runs")
      ) {
        creations.push(request.url());
      }
    });

    await page.goto(ROUTE, { waitUntil: "load" });
    await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
    await page.goto(ROUTE, { waitUntil: "load" });
    await expect(page.locator('[data-testid="rtt-start-gate"]')).toBeVisible({ timeout: 20_000 });
    // The gate reads readiness and the daily descriptor on mount; give those
    // settled requests a moment so a late POST would still be caught.
    await expect(page.locator('[data-testid="rtt-start-standard"]')).toBeEnabled();
    await page.waitForTimeout(1_000);

    expect(creations).toEqual([]);
    await expect(page.locator('[data-testid="rtt-shell"]')).toHaveCount(0);
  });
});
