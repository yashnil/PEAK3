/**
 * PEAK3 Rankings end-to-end (Phase 10B).
 *
 * Requires FastAPI (8000) and Next.js (3000) — both auto-start via
 * playwright.config.ts.
 *
 * These cover the Phase 10B overhaul: two boards instead of three, sortable
 * component columns, and a same-page explanation modal that actually contains
 * information. The previous modal "looked good but showed no specific useful
 * information" because the Peak Windows board published no component data at
 * all — `build_top_peaks.py` discarded every contribution `build_leaderboard()`
 * had already computed. Several assertions below exist specifically to keep that
 * from regressing.
 *
 * Mobile-specific tests are tagged @mobile and run only in the mobile-chrome
 * project, matching the convention in gameplay.spec.ts.
 */
import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const RANKINGS = "/rankings";

async function gotoRankings(page: Page): Promise<void> {
  await page.goto(RANKINGS, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: /peak3 rankings/i })).toBeVisible({
    timeout: 15_000,
  });
  // Rows arrive from the API; every later assertion depends on real data.
  await page.locator('[data-testid="rankings-row"]').first().waitFor({ timeout: 20_000 });
}

/** Sortable column keys, matching board-model.ts's RankingSortKey. */
const SORT_KEYS = [
  "total",
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
] as const;

/** The header cell for a sortable column. Addressed by testid rather than by
 *  accessible name: the visible short label (SI/TP/REC…) is aria-hidden and the
 *  button's real accessible name is the spelled-out component, so a name-based
 *  lookup is both brittle and easy to get wrong. */
function sortHeaderCell(page: Page, key: string) {
  return page.locator(`[data-testid="rankings-header-${key}"]`);
}

function sortHeaderButton(page: Page, key: string) {
  return sortHeaderCell(page, key).getByRole("button");
}

test.describe("Rankings — two boards", () => {
  test("exposes exactly Peak Windows and Single Seasons, and no Canonical Players", async ({ page }) => {
    await gotoRankings(page);

    await expect(page.locator('[data-testid="pool-tab-peak-windows"]')).toBeVisible();
    await expect(page.locator('[data-testid="pool-tab-seasons"]')).toBeVisible();

    // The board that was removed for being redundant with Peak Windows.
    await expect(page.getByText("Canonical Players", { exact: false })).toHaveCount(0);
    await expect(page.locator('[data-testid="pool-tab-top250"]')).toHaveCount(0);

    // Exactly two board tabs, so a third can't creep back in unnoticed.
    const boardTabs = page.getByRole("tablist", { name: /ranking board/i }).getByRole("tab");
    await expect(boardTabs).toHaveCount(2);
  });

  test("each board explains its own universe", async ({ page }) => {
    await gotoRankings(page);
    const explainer = page.locator('[data-testid="pool-explainer"]');
    await expect(explainer).toContainText(/one row per player/i);

    await page.locator('[data-testid="pool-tab-seasons"]').click();
    await expect(explainer).toContainText(/appear many times/i);
  });

  test("Peak Windows keeps a 1Y/3Y/5Y duration selector", async ({ page }) => {
    await gotoRankings(page);
    for (const id of ["1y", "3y", "5y"]) {
      await expect(page.locator(`[data-testid="peak-window-tab-${id}"]`)).toBeVisible();
    }
    await page.locator('[data-testid="peak-window-tab-3y"]').click();
    await expect(page.locator('[data-testid="peak-window-tab-3y"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.locator('[data-testid="rankings-row"]').first().waitFor({ timeout: 20_000 });
  });

  test("Single Seasons lets the same player appear more than once", async ({ page }) => {
    await gotoRankings(page);
    await page.locator('[data-testid="pool-tab-seasons"]').click();
    await page.locator('[data-testid="rankings-row"]').first().waitFor({ timeout: 20_000 });

    // Search narrows to one player; a season board must then show several of
    // that player's seasons. This is the whole point of the board, and it is
    // what distinguishes it from Peak Windows.
    await page.locator('[data-testid="rankings-search"]').fill("Jordan");
    await expect
      .poll(async () => page.locator('[data-testid="rankings-row"]').count(), { timeout: 15_000 })
      .toBeGreaterThan(1);
  });
});

test.describe("Rankings — sorting", () => {
  test("every component column sorts, and the active sort is stated", async ({ page }) => {
    await gotoRankings(page);

    for (const key of SORT_KEYS) {
      const button = sortHeaderButton(page, key);
      await button.waitFor({ state: "visible", timeout: 10_000 });
      await button.click();
      // aria-sort is what a screen-reader user relies on, so assert that rather
      // than a purely visual cue.
      await expect(sortHeaderCell(page, key)).toHaveAttribute(
        "aria-sort",
        /descending|ascending/,
        { timeout: 10_000 },
      );
      await expect(page.locator('[data-testid="active-sort-note"]')).toBeVisible();
    }
  });

  test("sorting by SI actually reorders the rows", async ({ page }) => {
    await gotoRankings(page);
    const firstPeakName = await page.locator('[data-testid="rankings-row"]').first().innerText();

    await sortHeaderButton(page, "statistical_impact").click();
    await expect(page.locator('[data-testid="active-sort-note"]')).toContainText(/statistical/i);

    // Either the leader changes, or SI order genuinely matches PEAK order at
    // the very top (plausible for the #1 window). Assert the values themselves
    // are non-increasing, which is the real contract.
    const siValues = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="rankings-row"]'));
      return rows
        .slice(0, 12)
        .map((r) => {
          const cell = r.querySelector('[data-component="statistical_impact"]');
          return cell ? parseFloat(cell.textContent ?? "") : NaN;
        })
        .filter((v) => Number.isFinite(v));
    });
    expect(siValues.length, "SI cells must be readable to prove the sort").toBeGreaterThan(3);
    const sortedDesc = [...siValues].sort((a, b) => b - a);
    expect(siValues).toEqual(sortedDesc);
    expect(firstPeakName.length).toBeGreaterThan(0);
  });

  test("sort can be reset back to the board's own PEAK order", async ({ page }) => {
    await gotoRankings(page);
    await sortHeaderButton(page, "individual_recognition").click();
    await expect(page.locator('[data-testid="active-sort-note"]')).toBeVisible();
    await page.locator('[data-testid="reset-sort-btn"]').click();
    await expect(page.locator('[data-testid="active-sort-note"]')).toHaveCount(0);
  });

  test("sorting works on the Single Seasons board too", async ({ page }) => {
    await gotoRankings(page);
    await page.locator('[data-testid="pool-tab-seasons"]').click();
    await page.locator('[data-testid="rankings-row"]').first().waitFor({ timeout: 20_000 });
    await sortHeaderButton(page, "postseason_individual_value").click();
    await expect(page.locator('[data-testid="active-sort-note"]')).toContainText(/postseason/i);
  });

  test("the acronyms are spelled out somewhere on the page", async ({ page }) => {
    await gotoRankings(page);
    // "Obscure acronyms without labels" is an explicit thing to avoid.
    const legend = page.locator('[data-testid="rankings-legend"]');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText(/statistical impact/i);
    await expect(legend).toContainText(/postseason/i);
  });
});

test.describe("Rankings — explanation modal", () => {
  test("clicking a row opens a same-page modal with a real component breakdown", async ({ page }) => {
    await gotoRankings(page);
    const urlBefore = page.url();

    await page.locator('[data-testid="rankings-row"]').first().click();
    const modal = page.locator('[data-testid="score-explain-modal"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    // Same page: no navigation, no reload.
    expect(page.url()).toBe(urlBefore);

    // The regression that matters: this board used to publish no components at
    // all, so the breakdown rendered as "not available".
    await expect(page.locator('[data-testid="component-breakdown"]')).toBeVisible();
    await expect(page.locator('[data-testid="score-explain-components-unavailable"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="score-explain-summary"]')).toBeVisible();
  });

  test("the modal is not mostly 'not available'", async ({ page }) => {
    await gotoRankings(page);
    await page.locator('[data-testid="rankings-row"]').first().click();
    const modal = page.locator('[data-testid="score-explain-modal"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="score-explain-component-cards"]')).toBeVisible();

    const text = (await modal.innerText()).toLowerCase();
    const occurrences = text.split("not available").length - 1;
    expect(occurrences, "the modal should not be padded with unavailable blocks").toBeLessThanOrEqual(2);
  });

  test("Michael Jordan's row explains the score with percentiles and weights", async ({ page }) => {
    await gotoRankings(page);
    // The #1 1Y window is Jordan 1990-91 — a stable anchor for asserting real
    // content rather than mere presence.
    const jordan = page.locator('[data-testid="rankings-row"]', { hasText: "Michael Jordan" }).first();
    await jordan.waitFor({ timeout: 20_000 });
    await jordan.click();

    const modal = page.locator('[data-testid="score-explain-modal"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal).toContainText("Michael Jordan");

    // Every one of the five components must carry a value AND a percentile.
    for (const key of [
      "statistical_impact",
      "traditional_production",
      "individual_recognition",
      "postseason_individual_value",
      "team_achievement",
    ]) {
      await expect(page.locator(`[data-testid="score-explain-component-${key}"]`)).toContainText(
        /percentile/i,
      );
    }
    // The real official weight, served from peak3.OFFICIAL_WEIGHTS.
    await expect(modal).toContainText("38");
  });

  test("a component segment is focusable and updates the detail panel", async ({ page }) => {
    await gotoRankings(page);
    await page.locator('[data-testid="rankings-row"]').first().click();
    await expect(page.locator('[data-testid="component-breakdown"]')).toBeVisible({ timeout: 15_000 });

    const segments = page.locator('[data-testid="component-breakdown"] button');
    await expect(segments.first()).toBeVisible();
    await segments.first().click();
    const detail = page.locator('[data-testid="component-detail"]');
    await expect(detail).toBeVisible();
    const first = await detail.innerText();

    await segments.last().click();
    await expect.poll(async () => detail.innerText(), { timeout: 10_000 }).not.toBe(first);
    await expect(page.locator('[data-testid="component-detail-why"]')).toBeVisible();
  });

  test("comparison rails let you pivot to another row without leaving the modal", async ({ page }) => {
    await gotoRankings(page);
    await page.locator('[data-testid="pool-tab-seasons"]').click();
    await page.locator('[data-testid="rankings-row"]').first().waitFor({ timeout: 20_000 });
    await page.locator('[data-testid="rankings-row"]').first().click();

    const modal = page.locator('[data-testid="score-explain-modal"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    const comparisons = page.locator('[data-testid="score-explain-comparisons"]');
    await expect(comparisons).toBeVisible({ timeout: 15_000 });

    const before = await modal.innerText();
    await comparisons.locator("button").first().click();
    // Still open, now showing a different row, with a way back.
    await expect(modal).toBeVisible();
    await expect(page.locator('[data-testid="score-explain-back"]')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => modal.innerText(), { timeout: 10_000 }).not.toBe(before);
  });

  test("Escape and the close button both dismiss the modal", async ({ page }) => {
    await gotoRankings(page);
    const modal = page.locator('[data-testid="score-explain-modal"]');

    await page.locator('[data-testid="rankings-row"]').first().click();
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);

    await page.locator('[data-testid="rankings-row"]').first().click();
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="score-explain-close"]').click();
    await expect(modal).toHaveCount(0);
  });

  test("a row is reachable and openable by keyboard alone", async ({ page }) => {
    await gotoRankings(page);
    const trigger = page.locator('[data-testid="rankings-row"] button').first();
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="score-explain-modal"]')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Rankings — accessibility", () => {
  test("the rankings page has no critical/serious violations", async ({ page }) => {
    await gotoRankings(page);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      serious.map((v) => `${v.impact}: ${v.id}`),
      "rankings page must stay axe-clean",
    ).toEqual([]);
  });

  test("the open modal has no critical/serious violations", async ({ page }) => {
    await gotoRankings(page);
    await page.locator('[data-testid="rankings-row"]').first().click();
    await expect(page.locator('[data-testid="score-explain-modal"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="component-breakdown"]')).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      serious.map((v) => `${v.impact}: ${v.id}`),
      "the explanation modal must stay axe-clean",
    ).toEqual([]);
  });
});

test.describe("Rankings — mobile", () => {
  test("@mobile no horizontal page overflow with two boards and component columns", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoRankings(page);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 4);
  });

  test("@mobile the modal fits the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoRankings(page);
    await page.locator('[data-testid="rankings-row"]').first().click();
    const modal = page.locator('[data-testid="score-explain-modal"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    const box = await modal.boundingBox();
    expect(box, "modal must have a real box").toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual(390);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(394);
  });
});
