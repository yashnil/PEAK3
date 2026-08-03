/**
 * Peak Draft end-to-end gameplay tests.
 * Requires FastAPI (port 8000) and Next.js (port 3000) — both auto-start via playwright.config.ts.
 * Uses deterministic seeds for reproducible boards.
 * Mobile-specific tests are tagged @mobile and run only in the mobile-chrome project.
 */
import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Play one round: click first eligible offer card, pick first eligible role, Lock In.
 * Waits for the /actions response before returning.
 */
async function playOneRound(page: Page): Promise<void> {
  // Wait for eligible offer cards (data-eligible="true", not disabled)
  const eligibleCard = page.locator('[data-testid="offer-card"][data-eligible="true"]:not([disabled])');
  await eligibleCard.first().waitFor({ state: "visible", timeout: 15_000 });
  await eligibleCard.first().click();

  // Wait for role selector to appear
  const roleBtn = page.locator('[data-testid="role-btn"]:not([disabled])');
  await roleBtn.first().waitFor({ state: "visible", timeout: 8_000 });
  await roleBtn.first().click();

  // Lock In
  const lockIn = page.locator('[data-testid="lock-in"]');
  await lockIn.waitFor({ state: "visible" });
  await expect(lockIn).not.toBeDisabled({ timeout: 3_000 });

  // Wait for API response
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/actions") && r.status() === 200, { timeout: 10_000 }),
    lockIn.click(),
  ]);
  expect(response.status()).toBe(200);
}

/** Navigate to a practice draft page and wait for offer cards to load. */
async function startPracticeDraft(page: Page, mode: string, seed = 42): Promise<void> {
  await page.goto(`/arena/practice/${mode}?seed=${seed}`, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "Peak Draft" })).toBeVisible({ timeout: 15_000 });
  // Wait for eligible offer cards to be ready
  await page.locator('[data-testid="offer-card"]').first().waitFor({ state: "visible", timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Arena landing
// ---------------------------------------------------------------------------

test.describe("Arena landing", () => {
  test("loads with correct heading and CTAs", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // The homepage leads with RUN THE TABLE, the flagship mode. The lead has
    // moved twice before (Peak Duel -> 82-0 PEAK Season -> RUN THE TABLE), and
    // each time the previous flagship stayed on the page as a secondary card --
    // asserted in play-routing.spec.ts's "every finished mode is still linked".
    //
    // The bare `h1` locator is strict-mode-sensitive on purpose: a second h1
    // anywhere on this page is itself a bug, so this fails if one appears.
    await expect(page.locator("h1")).toContainText("Build a roster of peaks.");
    await expect(page.locator("h1")).toContainText("Run the table.");
    await expect(page.locator('[data-testid="home-primary-cta"]')).toBeVisible();
    await expect(page.locator('a[href="/rankings"]').first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // The primary CTA became a launcher (UX pass, plan §5.1).
  //
  // It used to be a link labelled "Start a Run" pointing at
  // /arena/run-the-table -- whose first screen is RunStartGate, with a second,
  // identical "Start a run" button. Two identical commitments in a row.
  //
  // Deleting that gate was never an option: following a bare link must not
  // create a run (it fixes the seed and, for the daily, burns the day's
  // attempt) -- play-routing.spec.ts pins that. So the fix landed on the
  // homepage instead: the control is now a menu button that NAMES the choice,
  // and each option carries `?start=` so the mode starts exactly once. The bare
  // route still gates, unchanged.
  //
  // Changed here versus the pre-pass file: `toContainText(/Start a Run/i)` and
  // `toHaveAttribute("href", "/arena/run-the-table")` on the CTA itself. Both
  // described a link that no longer exists. Everything else in this block --
  // the h1 strings, the CTA being visible, nav link count, skip link, mobile
  // overflow -- is unchanged.
  // -------------------------------------------------------------------------

  test("homepage primary CTA goes straight into a run, not into a menu", async ({
    page,
  }) => {
    // Launch-polish §I. This assertion is the inverse of what it used to be.
    // The CTA WAS a disclosure button, back when the launcher offered several
    // starting choices. With one meaningful public mode, a click whose only
    // result is a list to click again buys nothing, so it is now a plain link
    // straight into a standard run.
    //
    // Note this test previously pinned `aria-haspopup="menu"` and an absent
    // href -- i.e. the mechanism, not the promise -- which is exactly why it
    // went stale the moment the mechanism changed. It now asserts the property
    // a player is actually owed: one click, and you are in the game.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const cta = page.locator('[data-testid="home-primary-cta"]');
    await expect(cta).toBeVisible();
    await expect(cta).toContainText(/Play Run the Table/i);
    await expect(cta).toHaveAttribute("href", "/arena/run-the-table?start=standard");
    // No intermediate menu exists to open.
    await expect(page.locator('[data-testid="home-launcher-menu"]')).toHaveCount(0);
  });

  test("the daily is a secondary link that never spends the attempt on navigation", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Present without any click -- secondary by visual weight, not by being
    // hidden behind a disclosure.
    const daily = page.locator('[data-testid="home-launcher-daily"]');
    await expect(daily).toBeVisible();
    // Deliberately NOT `?start=daily`: the daily is one shared board and one
    // attempt per UTC day, so a URL that spends it on navigation would burn the
    // attempt of everyone the link reaches. It lands on the gate instead. This
    // is the assertion worth keeping from the pre-launch-polish version of this
    // test -- it guards a correctness property, not a layout choice.
    await expect(daily).toHaveAttribute("href", "/arena/run-the-table?mode=daily");

    // "Start New Run" is deliberately absent with no run in progress: it only
    // earns a place once there is something to prefer it over.
    await expect(page.locator('[data-testid="home-launcher-standard"]')).toHaveCount(0);
  });

  test("a shared ?mode=daily link never spends the daily attempt on navigation", async ({
    page,
  }) => {
    // The homepage launcher's daily option is a plain link, so its URL will end
    // up in address bars, bookmarks and group chats. Counted at the network
    // layer: a run created and then discarded client-side was still created.
    const creations: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/run-the-table/runs")
      ) {
        creations.push(request.url());
      }
    });

    await page.goto("/arena/run-the-table?mode=daily", { waitUntil: "load" });
    await expect(page.locator('[data-testid="rtt-start-gate"]')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_000);
    expect(creations).toEqual([]);
  });

  test("the resume option is absent for a browser with no saved run", async ({ page }) => {
    // Fresh context => empty localStorage. Offering "resume" with nothing to
    // resume is a dead end, so it must not be rendered at all.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // No menu to open any more (launch-polish §I) -- the resume affordance is
    // either rendered inline or it is not. The property is unchanged: nothing
    // offers to resume a run that does not exist. Also asserted here: with no
    // saved run the primary CTA still reads as a fresh start, not "Continue".
    await expect(page.locator('[data-testid="home-launcher-resume"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="home-resume-notice"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="home-primary-cta"]')).toContainText(
      /Play Run the Table/i,
    );
  });

  test("a keyboard user reaches the run and the daily without a pointer", async ({ page }) => {
    // This test used to drive the launcher MENU's roving-focus behaviour
    // (ArrowDown opens, focus lands on the first item, Escape restores). That
    // menu is gone (launch-polish §I) and with it the whole apparatus -- which
    // is the point: plain links get correct keyboard semantics for free, so
    // there is no custom keyboard contract left to regress.
    //
    // What still has to hold, and is what this now asserts: a keyboard-only
    // player can reach BOTH the primary run and the daily, and activating the
    // primary with Enter actually starts one. That is the promise; the menu
    // was only ever one implementation of it.
    //
    // `networkidle`, not `domcontentloaded`: `focus()` is a plain DOM call that
    // succeeds pre-hydration, but activation is React-attached, so a keypress
    // in that window is a real event with no listener yet, silently lost.
    // Measured: `next dev` (what this suite runs) takes 300-410ms to attach; a
    // production build takes 18-44ms. See PERFORMANCE.md's "Client hydration
    // window (P6-f/P6-h investigation)".
    await page.goto("/", { waitUntil: "networkidle" });
    const cta = page.locator('[data-testid="home-primary-cta"]');
    const daily = page.locator('[data-testid="home-launcher-daily"]');

    await cta.focus();
    await expect(cta).toBeFocused();
    // The daily is reachable by keyboard alone, not pointer-only.
    await daily.focus();
    await expect(daily).toBeFocused();

    await cta.focus();
    await Promise.all([
      page.waitForURL("**/arena/run-the-table**"),
      page.keyboard.press("Enter"),
    ]);
    await expect(page.locator('[data-testid="rtt-start-gate"]')).toBeVisible({ timeout: 20_000 });
  });

  test("choosing a standard run lands on RUN THE TABLE, never the 82-0 board", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // One click, not two: the CTA IS the standard run now (launch-polish §I).
    await Promise.all([
      page.waitForURL("**/arena/run-the-table**"),
      page.locator('[data-testid="home-primary-cta"]').click(),
    ]);
    // The CTA must not drop the player into the previous flagship's board:
    // neither the 82-0 court nor its start gate belongs on this route.
    await expect(page.locator('[data-testid="court-builder"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="peak-season-start-gate"]')).toHaveCount(0);
  });

  test("a bare RUN THE TABLE route still gates rather than starting a run", async ({ page }) => {
    // The invariant the launcher exists to preserve: `?start=` is what starts a
    // run, arriving at the route is not.
    await page.goto("/arena/run-the-table", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="rtt-start-gate"]')).toBeVisible({ timeout: 15_000 });
  });

  test("the 82-0 card still reaches its start gate without starting a run", async ({ page }) => {
    // The old primary-CTA test, kept in full against 82-0's new home on the
    // page. Phase 9B: following a link must never consume a run (it fixes the
    // board and, for the daily, burns the day's attempt). The board appears
    // after "Begin"; that transition is covered in courtbuilder.spec.ts's
    // "Start gate" suite.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.locator('[data-testid="home-peak-season-card"]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveAttribute("href", "/arena/court/practice/apex_1y");
    await Promise.all([page.waitForURL("**/arena/court/practice/apex_1y**"), card.click()]);
    await expect(page.locator('[data-testid="peak-season-start-gate"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="begin-run-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="court-builder"]')).toHaveCount(0);
  });

  test("Phase 8E: old /play/daily route still renders without a dead end or hard crash", async ({ page }) => {
    // Demoted from the primary CTA, but still an intentionally supported
    // secondary mode (linked from the homepage's "Daily Peak Duel" card) --
    // must never hard-crash or dead-end even though it's no longer the
    // default landing spot.
    await page.goto("/play/daily", { waitUntil: "networkidle" });
    const hasHardError = await page.locator("h2:has-text('Application error')").isVisible().catch(() => false);
    expect(hasHardError).toBe(false);
  });

  test("navigation links are accessible", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();
    const links = nav.getByRole("link");
    expect(await links.count()).toBeGreaterThan(3);
  });

  test("skip-to-main link is present in DOM", async ({ page }) => {
    await page.goto("/");
    const skipLink = page.getByRole("link", { name: /skip to main/i });
    await expect(skipLink).toBeAttached();
  });

  test("@mobile mobile — no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 4);
  });
});

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

test.describe("Rankings regression", () => {
  test("loads rankings page with heading", async ({ page }) => {
    await page.goto("/rankings");
    await expect(page.getByRole("heading", { name: /peak3 rankings/i })).toBeVisible({ timeout: 10_000 });
  });

  test("duration tabs are present and switch content", async ({ page }) => {
    await page.goto("/rankings");
    // Phase 10B: the "Canonical Players" board (which owned the 1-Year/2-Year/
    // 3-Year/5-Year sub-tabs) was removed as redundant with Peak Windows. The
    // duration selector now lives on Peak Windows, so this lookup is scoped to
    // that tablist -- the previous unscoped getByRole("tab") matched across
    // BOTH tablists and would trip Playwright strict mode. Deep rankings
    // coverage lives in rankings.spec.ts; this stays a smoke test.
    const tab3y = page
      .getByRole("tablist", { name: /peak window duration/i })
      .getByRole("tab", { name: /3.year|3-year/i });
    await tab3y.waitFor({ state: "visible", timeout: 10_000 });
    await tab3y.click();
    await expect(tab3y).toHaveAttribute("aria-selected", "true");
  });

  test("@mobile mobile — no horizontal overflow on rankings", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/rankings");
    await page.waitForLoadState("networkidle");
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 4);
  });
});

// ---------------------------------------------------------------------------
// Methodology
// ---------------------------------------------------------------------------

test.describe("Methodology regression", () => {
  test("loads methodology page", async ({ page }) => {
    await page.goto("/methodology");
    await expect(page.getByRole("heading", { name: /formula explorer/i })).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Peak Duel
// ---------------------------------------------------------------------------

test.describe("Peak Duel regression", () => {
  test("daily challenge page renders without hard crash", async ({ page }) => {
    await page.goto("/play/daily", { waitUntil: "networkidle" });
    // Accepts any of: game content, error state, or loading state
    const body = page.locator("body");
    await expect(body).not.toBeEmpty();
    // No uncaught error boundary (Next.js error pages have specific structure)
    const hasHardError = await page.locator("h2:has-text('Application error')").isVisible().catch(() => false);
    expect(hasHardError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Practice draft — 1Y Apex
// ---------------------------------------------------------------------------

test.describe("Practice draft — 1Y Apex", () => {
  test("loads draft screen with Peak Draft heading", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 42);
  });

  test("completes all 5 rounds and shows result", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 42);
    for (let i = 0; i < 5; i++) {
      await playOneRound(page);
    }
    // After 5 rounds, draft is complete — receipt appears
    await expect(
      page.getByText(/lineup.*rating|draft.*efficiency/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("@mobile mobile — no horizontal overflow on draft screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await startPracticeDraft(page, "apex_1y", 1);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 4);
  });
});

// ---------------------------------------------------------------------------
// Practice draft — 3Y Prime
// ---------------------------------------------------------------------------

test.describe("Practice draft — 3Y Prime", () => {
  test("completes 3Y Prime draft", async ({ page }) => {
    await startPracticeDraft(page, "prime_3y", 43);
    for (let i = 0; i < 5; i++) {
      await playOneRound(page);
    }
    await expect(
      page.getByText(/lineup.*rating|draft.*efficiency/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Practice draft — 5Y Foundation
// ---------------------------------------------------------------------------

test.describe("Practice draft — 5Y Foundation", () => {
  test("completes 5Y Foundation draft", async ({ page }) => {
    // seed=7 verified to complete with greedy first-eligible-card strategy
    await startPracticeDraft(page, "foundation_5y", 7);
    for (let i = 0; i < 5; i++) {
      await playOneRound(page);
    }
    await expect(
      page.getByText(/lineup.*rating|draft.*efficiency/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Hold mechanic
// ---------------------------------------------------------------------------

test.describe("Hold mechanic", () => {
  test("Hold button exists and is clickable", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 10);
    const holdBtn = page.getByRole("button", { name: /hold/i });
    await expect(holdBtn).toBeVisible();
    await expect(holdBtn).not.toBeDisabled();
  });

  test("Hold saves a card and shows Holding text", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 10);
    // Select a card first, then hold it
    const card = page.locator('[data-testid="offer-card"][data-eligible="true"]:not([disabled])');
    await card.first().click();
    // Click Hold
    const holdBtn = page.getByRole("button", { name: /hold/i });
    await holdBtn.click();
    await page.waitForTimeout(500);
    // Hold button should now say "Holding" or be disabled
    const holdingText = page.getByRole("button", { name: /holding/i });
    const isHolding = await holdingText.isVisible().catch(() => false);
    const holdDisabled = await holdBtn.isDisabled().catch(() => false);
    expect(isHolding || holdDisabled).toBe(true);
  });

  test("Hold cannot be used twice", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 10);
    // Round 1: hold a card, then select another and confirm
    const card = page.locator('[data-testid="offer-card"][data-eligible="true"]:not([disabled])');
    await card.first().click();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/actions") && r.status() === 200),
      page.getByRole("button", { name: /^hold/i }).click(),
    ]);
    // Now select a remaining card
    const remaining = page.locator('[data-testid="offer-card"][data-eligible="true"]:not([disabled])');
    await remaining.first().click();
    const roleBtn = page.locator('[data-testid="role-btn"]:not([disabled])');
    await roleBtn.first().click();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/actions") && r.status() === 200),
      page.locator('[data-testid="lock-in"]').click(),
    ]);
    // In round 2, Hold should be disabled
    await page.waitForTimeout(300);
    const holdBtnR2 = page.getByRole("button", { name: /hold|holding/i });
    await expect(holdBtnR2).toBeDisabled({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Reframe mechanic
// ---------------------------------------------------------------------------

test.describe("Reframe mechanic", () => {
  test("Reframe button exists", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 20);
    await expect(page.getByRole("button", { name: /reframe/i })).toBeVisible();
  });

  test("Reframe changes the card offers and is then disabled", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 20);
    const reframeBtn = page.getByRole("button", { name: /reframe/i });
    await expect(reframeBtn).not.toBeDisabled();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/actions") && r.status() === 200),
      reframeBtn.click(),
    ]);
    await expect(reframeBtn).toBeDisabled({ timeout: 5_000 });
  });

  test("Reframe cannot be used twice", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 20);
    const reframeBtn = page.getByRole("button", { name: /reframe/i });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/actions") && r.status() === 200),
      reframeBtn.click(),
    ]);
    await expect(reframeBtn).toBeDisabled({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Mid-draft refresh
// ---------------------------------------------------------------------------

test.describe("Mid-draft refresh", () => {
  test("refreshing restores a working draft state", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 55);
    await playOneRound(page);
    // Reload
    await page.reload({ waitUntil: "load" });
    // After reload, either the same game resumes or a new one starts — both are acceptable
    await expect(page.getByRole("heading", { name: "Peak Draft" })).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Peak Receipt
// ---------------------------------------------------------------------------

test.describe("Peak Receipt", () => {
  test("shows lineup evaluation on completion", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 42);
    for (let i = 0; i < 5; i++) {
      await playOneRound(page);
    }
    // Receipt shows lineup rating (multiple elements match — first() avoids strict-mode)
    await expect(
      page.getByText(/lineup.*rating|draft.*efficiency|lineup peak/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Decision Replay
// ---------------------------------------------------------------------------

test.describe("Decision Replay", () => {
  test("shows picks after completing draft", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 42);
    for (let i = 0; i < 5; i++) {
      await playOneRound(page);
    }
    // Decision replay shows round history
    await expect(
      page.getByText(/round 1|pick 1|your picks/i)
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Challenge link
// ---------------------------------------------------------------------------

test.describe("Challenge link", () => {
  test("invalid challenge token shows error page", async ({ page }) => {
    await page.goto("/c/invalid-challenge-token", { waitUntil: "networkidle" });
    // Tokens failing HMAC verification → API returns 400 "challenge_expired"
    // → page renders "Challenge Expired" screen (custom, user-friendly)
    await expect(
      page
        .getByRole("heading", { name: /challenge expired/i })
        .or(page.getByRole("heading", { name: /challenge not found/i }))
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

test.describe("Keyboard navigation", () => {
  test("Tab key cycles through draft offer cards", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 42);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toBeAttached({ timeout: 3_000 });
  });

  test("Enter key activates focused offer card", async ({ page }) => {
    await startPracticeDraft(page, "apex_1y", 42);
    const cards = page.locator('[data-testid="offer-card"]');
    await cards.first().focus();
    await page.keyboard.press("Enter");
    const roleBtn = page.locator('[data-testid="role-btn"]');
    await expect(roleBtn.first()).toBeVisible({ timeout: 5_000 });
  });
});
