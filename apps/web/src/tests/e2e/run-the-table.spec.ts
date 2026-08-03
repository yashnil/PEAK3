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

/**
 * The first-run guided tour, and how the gameplay tests get past it.
 *
 * The tour is a real, required first-run experience: it auto-starts once per
 * browser profile and its spotlight overlay is modal, so it intercepts pointer
 * events until dismissed. That is correct product behaviour and it is exactly
 * why these tests started failing — the driver's first click on a System landed
 * on the tour scrim, not the button.
 *
 * The right answer is NOT to stop the tour auto-starting. It is to say which
 * experience each test is about. Gameplay tests are about the game, so they
 * seed "tour already seen" the way a returning player's browser would; the tour
 * itself has its own coverage (`src/tests/unit/guided-tour.test.tsx`, plus the
 * auto-start assertion below), so suppressing it here hides nothing.
 *
 * These constants are IMPORTED, not duplicated.
 *
 * They used to be copied into this file "because it runs in Playwright's Node
 * context" — but both source modules are plain TypeScript with no React and no
 * browser API at module scope, so the import works fine, and the copy was pure
 * drift risk. It duly drifted: Standard v2 bumped
 * `RUN_THE_TABLE_TOUR_VERSION` to 2 (correctly — the run changed from 3 acts
 * to 4, so returning players should see the tour again), the copy here stayed
 * at 1, and `seedTourSeen` began writing a version that no longer matched.
 * `shouldAutoStartTour` then returned true for every gameplay test and the
 * tour's full-screen scrim swallowed the clicks, failing six specs with
 * timeouts that looked like slowness and were not.
 *
 * Values are still written into the PAGE's localStorage via page.evaluate;
 * only where the numbers come from has changed.
 */
import {
  RUN_THE_TABLE_TOUR_ID,
  RUN_THE_TABLE_TOUR_VERSION,
} from "@/components/ui/tour-steps";
import { TOUR_STORAGE_KEY, TOUR_STORAGE_SCHEMA_VERSION } from "@/lib/tour-state";

/** Mark the RUN THE TABLE tour as already seen, as a returning player's browser
 *  would have it. Must be called after a same-origin navigation. */
async function suppressTour(page: Page): Promise<void> {
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

// A full run is a fixed structural cost of the mode, not slow test code: one
// perk pick per offer, one choice and one resolution per decision node, one
// resolution and one advance per boss, plus the two reveals — every one a real
// server round-trip.
//
// The shape has grown twice. v2 took it from 3 acts / 6 decisions / 3 bosses to
// 4 / 8 / 4; rtt_ruleset_v3 takes it to 5 / 10 / 5 and adds the opening-roster
// reveal and one boss reveal per act. Each budget was sized with headroom
// rather than to the observed figure, because it exists to catch a hang, not to
// police normal variance — and each time the previous one was left stale the
// suite failed with timeouts that looked like slowness and were not.
const FULL_RUN_TIMEOUT_MS = 180_000;

/**
 * Every decision surface, in the order they are probed. `rtt-result` leads: it
 * is the terminal state and the only one the driver stops on.
 *
 * The two reveal surfaces come next, BEFORE the screens they sit in front of.
 * `rtt-opening-reveal` occupies the system-select slot and `rtt-boss-reveal`
 * the boss-preview slot, and the probe returns the first id it finds, so a
 * reveal must be checked before the surface it is covering or the driver would
 * click a control that is not on screen.
 */
const SURFACE_IDS = [
  "rtt-result",
  "rtt-opening-reveal",
  // `rtt-boss-intro` (name, philosophy, win condition, 3-2-1 countdown,
  // skip) sits in front of `rtt-boss-reveal` at the SAME `boss_ready`
  // server status — see `RunTheTableGame`'s `dismissedBossIntroId` gate.
  // Missing from this list, `currentSurface()` threw "no known surface"
  // the instant any full-run test reached its first boss, so no test in
  // this file that calls `playToResult` had ever actually completed a run
  // — every one of them errored out at act 1's boss without anyone
  // noticing, because the suite itself was not being run this pass.
  "rtt-boss-intro",
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
  // Returning-player tour state — see the TOUR_STORAGE_KEY block above.
  await suppressTour(page);
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
    case "rtt-boss-intro":
      // The pre-roll: name, philosophy, win condition, 3-2-1 countdown. Skip
      // is interactive from the first frame (no waiting on the countdown) —
      // lands directly on the paired lineup reveal, same status, next gate.
      await page.locator('[data-testid="rtt-boss-intro-skip"]').click();
      break;
    case "rtt-opening-reveal":
    case "rtt-boss-reveal": {
      // One action starts the WHOLE reveal in a single batched round trip
      // (SYNTHESIS_CONTRACT.md §2.2); "Skip all" then jumps the client's own
      // paced presentation straight to fully resolved, with no second
      // request. Asserting the END state rather than watching the sequence
      // is the same reasoning as the battle skip below.
      const kind = surface === "rtt-opening-reveal" ? "roster" : "boss";
      await page.locator(`[data-testid="rtt-reveal-start-${kind}"]`).click();
      const skip = page.locator(`[data-testid="rtt-reveal-skip-${kind}"]`);
      await skip.waitFor({ state: "visible", timeout: 20_000 });
      await skip.click();
      break;
    }
    case "rtt-scout-prepare":
      // Scout the Boss is the FREE branch and the only one that can never be
      // refused, whatever the run has spent — which is exactly why the driver
      // uses it, the same reason it passes at a Draft Room. Preparing the first
      // lane resolves the node.
      await page
        .locator('[data-testid="rtt-scout-prepare"] [data-testid^="rtt-scout-prepare-"]')
        .first()
        .click();
      break;
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

/**
 * Get past the Opening Draft Reveal to the first DECISION.
 *
 * Under rtt_ruleset_v3 a run no longer opens on the System choice. It opens on
 * the opening-roster reveal, which occupies the same slot (see
 * `needsOpeningReveal` — it gates on `status === "system_select"`), and the
 * System choice is behind it. That is intended v3 UX, not an obstacle, so this
 * helper skips it rather than the product suppressing it.
 *
 * TWO ROUND TRIPS, WHICH IS THE MINIMUM. `can_skip` is the server's own rule
 * (`0 < revealed < total`), so "skip all" does not exist until one card has
 * been turned over — a routine test cannot get past the reveal in fewer calls
 * without the product lying about what the player has seen. `count` saturates
 * server-side, so the second call finishes the rest of the roster whatever its
 * length.
 *
 * WHAT THIS DOES NOT COST IN COVERAGE. The reveal itself is proven card by
 * card, including its server-authoritative count and its mid-reveal resume, by
 * "the opening draft reveal deals the roster one card at a time" below. Every
 * other test in this file is about something else and pays the two calls to
 * get to it — the same bargain `suppressTour` already strikes with the tour.
 *
 * Tolerant of not being needed: a caller that is already past the reveal (or a
 * run that had none) gets a no-op, so it is safe to call unconditionally right
 * after `startRun`.
 */
async function skipOpeningReveal(page: Page): Promise<void> {
  const surface = await currentSurface(page);
  if (surface !== "rtt-opening-reveal") return;
  await stepOnce(page, surface);
}

/** How many roster slots have fully SETTLED in the reveal stage — a slot
 *  mid-beat or still concealed does not count. Read off `RevealCard`'s own
 *  status attribute rather than the progress line, so the count and the
 *  cards on screen have to agree. */
async function revealedSlotCount(page: Page): Promise<number> {
  return page.locator('[data-testid="rtt-reveal-card"][data-reveal-status="settled"]').count();
}

/** Drive the run to its receipt.
 *
 *  A run ends either by resolving the FINAL boss — act 5 under rtt_ruleset_v3,
 *  and the driver never names the number — or by running out of lives, which
 *  ends the run the moment it happens rather than at the next advance. Both land on `rtt-result`, so the driver stops on
 *  the SURFACE rather than on a particular outcome — which is why it needed no
 *  change when the outcome taxonomy became TABLE CLEARED / RUN ENDED AT THE
 *  FINAL BOSS / RUN ENDED IN ACT N. */
async function driveTo(page: Page, target: SurfaceId, maxSteps = 90): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    const surface = await currentSurface(page);
    // Every surface, every step — see `expectNoRawObjects`.
    await expectNoRawObjects(page);
    if (surface === target) return;
    await stepOnce(page, surface);
  }
  throw new Error(`did not reach ${target} within ${maxSteps} steps`);
}

async function playToResult(page: Page, maxSteps = 90): Promise<void> {
  return driveTo(page, "rtt-result", maxSteps);
}

async function storedRun(page: Page): Promise<StoredRun | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredRun) : null;
  }, STORAGE_KEY);
}

/**
 * No raw object serialisation anywhere on the page.
 *
 * `cost_modifiers` is `list[dict]` on the server and was declared `string[]` on
 * the client, so `RunCard` did `.join(" · ")` on objects and printed
 * "[object Object]" on every card any price System had discounted — in the
 * Draft Room and on both Trade Desk columns. The unit fixtures all hardcoded
 * `cost_modifiers: []`, which is exactly why it shipped, so the browser check
 * is the one that runs against real engine payloads with real discounts.
 *
 * Checked on EVERY surface of a full run rather than once at the end: a
 * discount only appears when the run happens to hold a price System and the
 * board happens to offer a qualifying card.
 */
async function expectNoRawObjects(page: Page): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toContain("[object Object]");
  expect(text).not.toContain("[object ");
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

test.describe("RUN THE TABLE clarity", () => {
  /**
   * PROGRESSIVE DISCLOSURE (plan §6). The first decision of the run is a perk
   * choice, and it used to open with a wall of percentile thresholds. Three
   * layers now: plain effect, one hint, and the engine's exact rule collapsed
   * behind `See exact rule` — MOVED, never removed, so this asserts both that
   * the plain line leads AND that the threshold text is still in the document.
   */
  test("the perk chooser leads with plain language and keeps the exact rule", async ({ page }) => {
    await freshGate(page);
    await startRun(page, "rtt-start-standard");
    // v3 opens on the Opening Draft Reveal; the perk chooser is behind it.
    await skipOpeningReveal(page);
    const select = page.locator('[data-testid="rtt-system-select"]');
    await expect(select).toBeVisible();

    const firstOption = select.locator("button").first();
    const optionId = await firstOption.getAttribute("data-testid");
    const perkId = (optionId ?? "").replace("rtt-system-", "");

    // Layer 1 is inside the option button itself, so it is on the first scan.
    await expect(page.locator(`[data-testid="rtt-system-effect-${perkId}"]`)).toBeVisible();

    // Layer 3 exists, is collapsed, and carries the engine's own summary.
    const rule = page.locator(`[data-testid="rtt-system-rule-${perkId}"]`);
    await expect(rule).toHaveCount(1);
    await expect(rule).not.toHaveAttribute("open", "");
    await rule.locator("summary").click();
    await expect(page.locator(`[data-testid="rtt-system-summary-${perkId}"]`)).toBeVisible();
  });

  /**
   * "75.1th" was rendered on every card in the game — `percentileSentence`
   * appended "th" unconditionally and `RunCard` hard-coded the same "th" as a
   * JSX text node. Swept across the whole board rather than one card.
   */
  test("no card anywhere renders a broken ordinal", async ({ page }) => {
    await freshGate(page);
    await startRun(page, "rtt-start-standard");
    await skipOpeningReveal(page);
    await page.locator('[data-testid="rtt-system-select"] button').first().click();
    await expect(page.locator('[data-testid="rtt-shell"]')).toBeVisible();
    const text = (await page.locator('[data-testid="rtt-shell"]').innerText()) ?? "";
    // "75.1th" / "21.2th" / "96.3th". A trailing 0 legitimately takes "th"
    // ("1.0th"), so only 1, 2 and 3 are the tell.
    expect(text).not.toMatch(/\.[123]th\b/);
  });
});

// ---------------------------------------------------------------------------
// Opening Draft Reveal
// ---------------------------------------------------------------------------

test.describe("RUN THE TABLE opening reveal", () => {
  /**
   * THE ONE TEST THAT PLAYS THE REVEAL IN FULL, and the reason every other
   * test in this file is allowed to call `skipOpeningReveal`.
   *
   * SYNTHESIS_CONTRACT.md §2.2 batched the reveal into ONE round trip: the
   * single "Reveal your roster" press fires `reveal(roster, 7)` once, the
   * server saturates and returns every slot already-authoritative in that
   * one response, and the CLIENT paces its own presentation of it afterward
   * (`useRevealSequence`). So what this test asserts is different from the
   * old per-card round-trip contract, but the same principle holds: nothing
   * is shown before the press, the roster the player eventually sees is
   * exactly what the server sent, and a mid-sequence pause genuinely halts
   * the presentation rather than merely hiding a CSS transition.
   */
  test("the opening reveal fires ONE batched action, then paces an already-authoritative roster locally", async ({
    page,
  }) => {
    test.setTimeout(FULL_RUN_TIMEOUT_MS);
    await freshGate(page);
    await startRun(page, "rtt-start-standard");

    const reveal = page.locator('[data-testid="rtt-opening-reveal"]');
    await expect(reveal).toBeVisible();
    await expect(reveal).toHaveAttribute("data-reveal-complete", "false");

    // Nothing is turned over until the player asks — the roster exists, but
    // the run does not spoil it on arrival, anywhere on screen (including
    // the persistent roster dock — see the leak-fix assertions below).
    const start = page.locator('[data-testid="rtt-reveal-start-roster"]');
    await expect(start).toBeVisible();
    expect(await revealedSlotCount(page)).toBe(0);

    // The ONE action. It fires exactly one POST — the network assertion
    // lives in the batching-specific test below; here we assert the visible
    // consequence: the sequence starts pacing, and pause genuinely holds it.
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/actions") && r.request().method() === "POST" && r.status() === 200,
      ),
      start.click(),
    ]);
    await expect(page.locator('[data-testid="rtt-reveal-pause-roster"]')).toBeVisible({
      timeout: 20_000,
    });

    // Pause holds the sequence — the settled count must not advance while paused.
    await page.locator('[data-testid="rtt-reveal-pause-roster"]').click();
    const heldCount = await revealedSlotCount(page);
    await page.waitForTimeout(600);
    expect(await revealedSlotCount(page)).toBe(heldCount);
    await page.locator('[data-testid="rtt-reveal-resume-roster"]').click();

    // Skip all jumps every slot to fully settled with no further animation
    // and no second round trip — the completion IS the handover, matching
    // every other surface transition in this mode.
    await page.locator('[data-testid="rtt-reveal-skip-roster"]').click();
    await expect(page.locator('[data-testid="rtt-system-select"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="rtt-opening-reveal"]')).toHaveCount(0);

    // And it does not replay: the reveal is done for this run, not for this
    // page load.
    await page.reload({ waitUntil: "load" });
    await expect(page.locator('[data-testid="rtt-system-select"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="rtt-opening-reveal"]')).toHaveCount(0);
  });

  test("the reveal is exactly ONE POST regardless of skip", async ({ page }) => {
    await freshGate(page);
    await startRun(page, "rtt-start-standard");
    await expect(page.locator('[data-testid="rtt-opening-reveal"]')).toBeVisible();

    let revealPosts = 0;
    page.on("requestfinished", (req) => {
      if (req.method() !== "POST" || !req.url().includes("/actions")) return;
      let body: { action_type?: string } | null = null;
      try {
        body = req.postDataJSON() as { action_type?: string } | null;
      } catch {
        body = null;
      }
      if (body?.action_type === "reveal") revealPosts += 1;
    });

    await page.locator('[data-testid="rtt-reveal-start-roster"]').click();
    const skip = page.locator('[data-testid="rtt-reveal-skip-roster"]');
    await skip.waitFor({ state: "visible", timeout: 20_000 });
    await skip.click();

    await expect(page.locator('[data-testid="rtt-system-select"]')).toBeVisible({ timeout: 20_000 });
    // Skipped, not discarded: every slot was still dealt, in one round trip.
    await expect(page.locator('[data-testid="rtt-opening-reveal"]')).toHaveCount(0);
    expect(revealPosts).toBe(1);
  });

  test("the roster dock conceals every unrevealed slot during the sequence — no name, score, or window leaks", async ({
    page,
  }) => {
    await freshGate(page);
    await startRun(page, "rtt-start-standard");
    await expect(page.locator('[data-testid="rtt-opening-reveal"]')).toBeVisible();

    const dock = page.locator('[data-testid="rtt-roster-dock"]');
    await expect(dock).toHaveAttribute("data-reveal-active", "true");
    // Every compact roster chip reads concealed before the reveal starts.
    await expect(page.locator('[data-testid^="rtt-slot-compact-"][data-concealed="false"]')).toHaveCount(0);

    await page.locator('[data-testid="rtt-reveal-start-roster"]').click();
    await page.locator('[data-testid="rtt-reveal-skip-roster"]').click();
    await expect(page.locator('[data-testid="rtt-system-select"]')).toBeVisible({ timeout: 20_000 });

    // Once the sequence is fully resolved, the dock no longer conceals.
    await expect(dock).toHaveAttribute("data-reveal-active", "false");
  });
});

test.describe("RUN THE TABLE full run", () => {
  test("an anonymous visitor plays a whole standard run to a receipt", async ({ page }) => {
    test.setTimeout(FULL_RUN_TIMEOUT_MS);
    await freshGate(page);
    await startRun(page, "rtt-start-standard");

    // THE REAL v3 OPENING SEQUENCE, in order. A run no longer opens on the
    // System choice: rtt_ruleset_v3 deals the opening roster first, one card
    // at a time, and the System choice is the first DECISION behind it. This
    // asserts both halves rather than skipping straight past the reveal,
    // because "which surface does a run open on" is exactly what this test's
    // first line has always been for.
    expect(await currentSurface(page)).toBe("rtt-opening-reveal");
    await skipOpeningReveal(page);
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

  /**
   * P6-c regression. `expectNoHorizontalOverflow` above checks
   * `document.body.scrollWidth` against `document.body.clientWidth` — a
   * real check, but a DOCUMENT-level one, and it is never called while the
   * boss reveal itself is on screen (only at the start gate, right after
   * starting, and at the receipt). It also would not have caught this: the
   * overflowing content did not make the page scrollable, it just bled past
   * its own card and the viewport's edge while `document.body` stayed the
   * same width — a `scrollWidth` check and a per-element
   * `getBoundingClientRect()` check catch genuinely different failure
   * modes, and this bug only shows up in the second one.
   *
   * ROOT CAUSE (RevealCard.tsx): the paired (player's already-known) card
   * block was `shrink-0` with `@[420px]:max-w-[40%]` — a container query
   * that left it UNCONSTRAINED below a 420px container, so at 390px it
   * claimed whatever width its content wanted and squeezed the boss-side
   * identity/score column — the row's only `flex-1` element — until its
   * score number bled past the card, sometimes past the page's right edge
   * entirely. Fixed with an unconditional `max-w-[32%]` floor.
   */
  test("@mobile the boss reveal's paired lineup never clips a card past the 390px viewport", async ({
    page,
  }) => {
    test.setTimeout(FULL_RUN_TIMEOUT_MS);
    await freshGate(page);
    await startRun(page, "rtt-start-standard");
    await skipOpeningReveal(page);
    await driveTo(page, "rtt-boss-reveal");

    // Deliberately NOT `stepOnce` here — it also waits for the surface to be
    // replaced (by the "Continue" click), and the settled-but-still-mounted
    // moment in between is exactly what needs inspecting.
    await page.locator('[data-testid="rtt-reveal-start-boss"]').click();
    const skip = page.locator('[data-testid="rtt-reveal-skip-boss"]');
    await skip.waitFor({ state: "visible", timeout: 20_000 });
    await skip.click();
    await expect(
      page.locator('[data-testid="rtt-reveal-card"][data-reveal-status="settled"]'),
    ).toHaveCount(7);

    const overflowing = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="rtt-reveal-card"]'));
      return rows
        .flatMap((row) => Array.from(row.querySelectorAll<HTMLElement>("*")))
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .map((el) => el.getAttribute("data-testid") || `.${el.className}`);
    });
    expect(overflowing, `element(s) clipped past the viewport: ${overflowing.join(", ")}`).toHaveLength(0);
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

    // Get a few DECISIONS in, so "the same screen" is a screen the player
    // actually navigated to rather than the one every run opens on. The reveal
    // is skipped first so the two steps below are decisions, not a reveal and
    // one decision — mid-reveal resume has its own test above.
    await skipOpeningReveal(page);
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

test.describe("RUN THE TABLE guided tour", () => {
  test("auto-starts for a genuine first-time player, and can be dismissed", async ({ page }) => {
    test.setTimeout(FULL_RUN_TIMEOUT_MS);
    // The counterweight to `suppressTour`. Every gameplay test above seeds
    // "tour already seen" so the driver can reach the game; this test is the one
    // that proves the tour really does appear when nothing is seeded, so that
    // suppression removes no coverage.
    await page.goto(ROUTE, { waitUntil: "load" });
    await page.evaluate(
      ({ run, tour }) => {
        window.localStorage.removeItem(run);
        window.localStorage.removeItem(tour);
      },
      { run: STORAGE_KEY, tour: TOUR_STORAGE_KEY },
    );
    await page.goto(ROUTE, { waitUntil: "load" });
    await startRun(page, "rtt-start-standard");

    const tour = page.getByTestId("guided-tour");
    await expect(tour, "the tour auto-starts on a first run").toBeVisible({ timeout: 20_000 });
    // Progress is stated, per the brief's "2 of 7".
    await expect(tour).toContainText(/\bof\s+\d+\b/);

    // Next advances; Back returns. The first step's Back is disabled, which is
    // why the round trip starts with Next.
    await page.getByTestId("guided-tour-next").click();
    await expect(tour).not.toHaveAttribute("data-step", "run-map");
    await page.getByTestId("guided-tour-back").click();
    await expect(tour).toHaveAttribute("data-step", "run-map");

    // Escape dismisses, and the game underneath is immediately playable — the
    // exact interaction whose absence made the overlay swallow the driver's
    // clicks and fail four specs.
    await page.keyboard.press("Escape");
    await expect(tour).toHaveCount(0);
    const surface = await currentSurface(page);
    await stepOnce(page, surface);

    // And it does not come back on the next run in the same browser.
    await page.reload({ waitUntil: "load" });
    await expect(page.locator('[data-testid="rtt-shell"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("guided-tour")).toHaveCount(0);
  });
});

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

  test("?start=standard creates exactly one run and strips the param", async ({ page }) => {
    // The homepage launcher's deep link (plan §5.1). The param is the ONE
    // sanctioned way a navigation may create a run, so it must be consumed
    // exactly once: counted at the network layer, because a second run created
    // and then discarded client-side would still have been created server-side.
    const creations: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/run-the-table/runs")
      ) {
        creations.push(request.url());
      }
    });

    await freshGate(page);
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/run-the-table/runs") &&
          r.request().method() === "POST" &&
          r.status() === 200,
      ),
      page.goto(`${ROUTE}?start=standard`, { waitUntil: "load" }),
    ]);
    await expect(page.locator('[data-testid="rtt-shell"]')).toBeVisible({ timeout: 20_000 });

    // Stripped, so a refresh replays the run rather than starting a second.
    //
    // `waitForURL` rather than a bare read, and rather than a sleep: the
    // contract is "the address bar no longer carries the param", and waiting on
    // that observable is what the next line (a refresh) actually depends on.
    // The strip is synchronous in the product now — this used to be a deferred
    // `router.replace` whose RSC round trip was still in flight while the game
    // surface painted — so this resolves on the first poll rather than papering
    // over a race.
    await page.waitForURL((url) => !url.searchParams.has("start"), { timeout: 10_000 });
    await expect(page.locator('[data-testid="rtt-shell"]')).toBeVisible();
    expect(creations).toHaveLength(1);

    const first = await storedRun(page);
    await page.reload({ waitUntil: "load" });
    await expect(page.locator('[data-testid="rtt-shell"]')).toBeVisible({ timeout: 20_000 });
    expect(creations).toHaveLength(1);
    expect((await storedRun(page))?.run_id).toBe(first?.run_id);
  });

  test("a slow create still strips the param, and a refresh mid-flight starts nothing", async ({
    page,
  }) => {
    // The failure this guards is the one CI actually hit: the param was
    // stripped by a deferred navigation that had not landed by the time the
    // board painted. Delaying the create response widens that window as far as
    // it can go — if the strip were still deferred behind anything the run
    // creation waits on, this would fail every time rather than only on a cold
    // machine.
    const creations: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/run-the-table/runs")
      ) {
        creations.push(request.url());
      }
    });

    await page.route(`${API_BASE}/api/v1/run-the-table/runs`, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });

    await freshGate(page);
    await page.goto(`${ROUTE}?start=standard`, { waitUntil: "commit" });

    // The URL is clean BEFORE the run exists — the strip does not wait on the
    // network. A player who refreshes here loses nothing and starts nothing.
    await page.waitForURL((url) => !url.searchParams.has("start"), { timeout: 10_000 });

    await expect(page.locator('[data-testid="rtt-shell"]')).toBeVisible({ timeout: 30_000 });
    expect(creations).toHaveLength(1);

    // And an immediate refresh resumes rather than creating a second run.
    const first = await storedRun(page);
    expect(first?.run_id).toBeTruthy();
    await page.reload({ waitUntil: "load" });
    await expect(page.locator('[data-testid="rtt-shell"]')).toBeVisible({ timeout: 30_000 });
    expect(creations).toHaveLength(1);
    expect((await storedRun(page))?.run_id).toBe(first?.run_id);
  });

  test("going back to the launcher link and forward again creates no second run", async ({
    page,
  }) => {
    // `history.replaceState` rewrites the CURRENT entry, so the entry the
    // player can navigate back to is the one before the deep link, never the
    // deep link itself. Anything else would let the back/forward buttons spend
    // a fresh run per press.
    const creations: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/run-the-table/runs")
      ) {
        creations.push(request.url());
      }
    });

    await freshGate(page);
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/run-the-table/runs") &&
          r.request().method() === "POST" &&
          r.status() === 200,
      ),
      page.goto(`${ROUTE}?start=standard`, { waitUntil: "load" }),
    ]);
    await page.waitForURL((url) => !url.searchParams.has("start"), { timeout: 10_000 });
    const first = await storedRun(page);

    await page.goto("/arena", { waitUntil: "load" });
    await page.goBack({ waitUntil: "load" });
    await expect(page.locator('[data-testid="rtt-shell"]')).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get("start")).toBeNull();

    await page.goForward({ waitUntil: "load" });
    await page.goBack({ waitUntil: "load" });
    await expect(page.locator('[data-testid="rtt-shell"]')).toBeVisible({ timeout: 20_000 });

    expect(creations).toHaveLength(1);
    expect((await storedRun(page))?.run_id).toBe(first?.run_id);
  });
});
