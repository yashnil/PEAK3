/**
 * 82-0 Peak Season / CourtBuilder end-to-end gameplay tests (Phase 5C).
 * Requires FastAPI (port 8000) and Next.js (port 3000) — both auto-start via
 * playwright.config.ts. Requires PEAK3_COURTBUILDER_ENABLED=true and
 * PEAK3_COURTBUILDER_TEAM_SPIN_ENABLED=true in the API's environment (see
 * .github/workflows/ci.yml's Playwright step, or run locally with those
 * exported before `npm run dev`/`npm run start:api`).
 * Mobile-specific tests are tagged @mobile and run only in the
 * mobile-chrome project (see gameplay.spec.ts for the same convention).
 */
import { test, expect, Page } from "@playwright/test";

const TOTAL_ROUNDS = 8;

/** Play one full round: select the first candidate, place into the first
 * open slot. Registers waitForResponse BEFORE each click, matching the
 * Promise.all pattern already established in gameplay.spec.ts to avoid a
 * response/registration race. */
async function playOneRound(page: Page): Promise<void> {
  const candidate = page.locator('[data-testid="candidate-card"]').first();
  await candidate.waitFor({ state: "visible", timeout: 10_000 });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
    candidate.click(),
  ]);

  const openSlot = page.locator('[data-testid="court-slot"][data-filled="false"]').first();
  await openSlot.waitFor({ state: "visible", timeout: 10_000 });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/place") && r.status() === 200),
    openSlot.click(),
  ]);
}

async function startCourtBuilder(page: Page, mode = "apex_1y", seed = 42): Promise<void> {
  await page.goto(`/arena/court/practice/${mode}?seed=${seed}`, { waitUntil: "load" });
  await expect(page.locator('[data-testid="court-builder"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="court-slot"]').first().waitFor({ state: "visible", timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Full happy path
// ---------------------------------------------------------------------------

test.describe("CourtBuilder full attempt", () => {
  test("completes all 8 rounds and shows a result", async ({ page }) => {
    await startCourtBuilder(page);

    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      await playOneRound(page);
    }

    const completeBtn = page.locator('[data-testid="complete-season-btn"]');
    await completeBtn.waitFor({ state: "visible", timeout: 10_000 });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/complete") && r.status() === 200),
      completeBtn.click(),
    ]);

    // Result must always load after completion -- the exact P0 failure
    // class this pivot exists to avoid (ADR-005 Context).
    await expect(page.locator('[data-testid="season-result"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="season-record"]')).toBeVisible();
    await expect(page.locator('[data-testid="experimental-notice"]')).toBeVisible();
    // Durable retrieval by game_id (not just in-memory client state) is
    // covered at the API level in apps/api/tests/test_perfect_season.py::
    // test_full_anonymous_practice_attempt_completes_and_result_always_loads
    // -- a raw page reload here would hit the practice route's server
    // component, which creates a brand-new game on every load (same
    // accepted behavior as Peak Draft's own practice route; see
    // gameplay.spec.ts's "Mid-draft refresh" test), so it is not a useful
    // check of this specific contract.
  });

  test("court grid always shows all 8 slots, filled and open together", async ({ page }) => {
    await startCourtBuilder(page);
    await playOneRound(page);
    const slots = page.locator('[data-testid="court-slot"]');
    await expect(slots).toHaveCount(8);
    await expect(page.locator('[data-testid="court-slot"][data-filled="true"]')).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// ADR-005 Decision 6: no score/rank shown before lock
// ---------------------------------------------------------------------------

test.describe("CourtBuilder score-hiding contract", () => {
  test("candidate cards never render a numeric score before selection", async ({ page }) => {
    await startCourtBuilder(page);
    const candidateText = await page.locator('[data-testid="candidate-card"]').first().innerText();
    // A candidate card renders only the player's name -- no digits from a
    // score/rank should ever appear in its text content.
    expect(/\d/.test(candidateText)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unconventional lineup remains legal
// ---------------------------------------------------------------------------

test.describe("CourtBuilder soft placement", () => {
  test("bench slots can be filled before any starter slot", async ({ page }) => {
    await startCourtBuilder(page);

    const candidate = page.locator('[data-testid="candidate-card"]').first();
    await candidate.waitFor({ state: "visible" });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      candidate.click(),
    ]);

    const benchSlot = page.locator('[data-testid="court-slot"][data-slot-type="bench_1"]');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/place") && r.status() === 200),
      benchSlot.click(),
    ]);

    await expect(page.locator('[data-testid="court-slot"][data-slot-type="bench_1"]')).toHaveAttribute(
      "data-filled", "true",
    );
    await expect(page.locator('[data-testid="court-slot"][data-slot-type="starter_1"]')).toHaveAttribute(
      "data-filled", "false",
    );
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

test.describe("CourtBuilder keyboard navigation", () => {
  test("a full round can be completed via keyboard only", async ({ page }) => {
    await startCourtBuilder(page);

    const candidate = page.locator('[data-testid="candidate-card"]').first();
    await candidate.waitFor({ state: "visible" });
    await candidate.focus();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      page.keyboard.press("Enter"),
    ]);

    const openSlot = page.locator('[data-testid="court-slot"][data-filled="false"]').first();
    await openSlot.waitFor({ state: "visible" });
    await openSlot.focus();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/place") && r.status() === 200),
      page.keyboard.press("Enter"),
    ]);

    await expect(page.locator('[data-testid="court-slot"][data-filled="true"]')).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

test.describe("CourtBuilder mobile", () => {
  test("@mobile mobile — no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await startCourtBuilder(page);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 4);
  });
});
