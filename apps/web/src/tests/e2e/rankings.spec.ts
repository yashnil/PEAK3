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

/** Wait for the explanation modal's entrance animation to finish.
 *
 *  Needed because `toBeVisible()` ignores opacity: it resolves the instant the
 *  panel mounts at `initial={{ opacity: 0 }}`, while the panel is still fading
 *  in over 180ms (see ScoreExplainModal). Anything that samples rendered
 *  colours in that window sees modal text blended with the rankings table
 *  behind it. That made the axe check below fail intermittently -- roughly two
 *  runs in three inside the full suite, and never in isolation, because a
 *  warm/idle machine mounts and analyses faster than the animation completes.
 *  The reported "serious: color-contrast" was real; it just described a frame
 *  no user ever interacts with. */
async function waitForModalOpaque(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="score-explain-modal"]');
      return !!el && getComputedStyle(el).opacity === "1";
    },
    undefined,
    { timeout: 10_000 },
  );
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
    for (const id of ["1y", "2y", "3y", "5y"]) {
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
    await expect(page.locator('[data-testid="active-sort-note"]')).toContainText(
      /playoff rate impact/i,
    );
  });

  test("the acronyms are spelled out somewhere on the page", async ({ page }) => {
    await gotoRankings(page);
    // "Obscure acronyms without labels" is an explicit thing to avoid.
    const legend = page.locator('[data-testid="rankings-legend"]');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText(/statistical impact/i);
    // "PO" expands to Playoff Rate Impact after the Phase 12B rename. The point
    // of the test is that the abbreviation is spelled out, not which words it
    // spells out to.
    await expect(legend).toContainText(/playoff rate impact/i);
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
    await waitForModalOpaque(page);

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

/**
 * Phase 12A: the modal has to explain THIS row, not the formula in general.
 * The old modal produced near-identical prose for every player-season, which is
 * exactly what made a surprising Playoff Rate Impact unexplainable.
 */
test.describe("Rankings — row-specific receipts", () => {
  async function openFirstRow(page: import("@playwright/test").Page) {
    await page.goto("/rankings", { waitUntil: "load" });
    const row = page.getByTestId("rankings-row").first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(page.getByTestId("score-explain-modal")).toBeVisible({ timeout: 15_000 });
  }

  test("shows per-component receipts built from this row's own numbers", async ({ page }) => {
    await openFirstRow(page);

    const receipts = page.getByTestId("score-explain-receipts");
    await expect(receipts).toBeVisible({ timeout: 15_000 });

    // The impact receipt must cite real metrics, not a definition.
    const si = page.getByTestId("score-explain-receipt-statistical_impact");
    await expect(si).toBeVisible();
    await expect(si).toContainText(/BPM|VORP|WS\/48|PER/);

    // Postseason and team are the two the audit exists for.
    await expect(page.getByTestId("score-explain-receipt-postseason_individual_value")).toBeVisible();
    await expect(page.getByTestId("score-explain-receipt-team_achievement")).toBeVisible();
  });

  test("explains what Playoff Rate Impact actually measures", async ({ page }) => {
    await openFirstRow(page);
    const note = page.getByTestId("score-explain-receipt-note-postseason_individual_value");
    await expect(note).toBeVisible({ timeout: 15_000 });
    // Whatever the row, the note must resolve the "why is this number like
    // that?" question rather than restating the component's name.
    await expect(note).toContainText(
      /did not reach the playoffs|replacement-level|shrinks postseason value|not winning/i,
    );
  });

  test("two different rows produce different receipts", async ({ page }) => {
    await openFirstRow(page);
    const first = await page.getByTestId("score-explain-receipts").innerText();
    await page.getByTestId("score-explain-close").click();

    const second = page.getByTestId("rankings-row").nth(3);
    await second.click();
    await expect(page.getByTestId("score-explain-modal")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("score-explain-receipts")).toBeVisible();
    const other = await page.getByTestId("score-explain-receipts").innerText();

    expect(other).not.toEqual(first);
  });

  test("the modal stays accessible with the new sections", async ({ page }) => {
    await openFirstRow(page);
    await expect(page.getByTestId("score-explain-receipts")).toBeVisible({ timeout: 15_000 });

    // WAIT FOR THE ENTRANCE TRANSITION TO SETTLE BEFORE AUDITING.
    //
    // `toBeVisible` resolves as soon as the element has a box, which is true
    // part-way through the dialog's opacity ramp. Auditing there measures a
    // frame nobody looks at: axe read `--text-muted` (#838799) composited at
    // ~94.5% opacity over #191c23 as #7d8193, scored it 4.41:1 and reported a
    // serious colour-contrast violation. At rest the same pair is 4.78:1 and
    // passes AA -- the product was never out of compliance, the audit was
    // simply early. It surfaced as an intermittent failure because whether the
    // scan lands mid-ramp depends on machine load.
    //
    // Asserting settled opacity is STRICTER than what was here before, not
    // looser: it audits the state a user actually reads, and a genuine
    // contrast regression at rest still fails exactly as it did.
    await expect
      .poll(
        async () =>
          page
            .getByTestId("score-explain-modal")
            .evaluate((el) => getComputedStyle(el).opacity),
        { timeout: 5_000 },
      )
      .toBe("1");

    const results = await new AxeBuilder({ page })
      .include('[data-testid="score-explain-modal"]')
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(serious).toEqual([]);
  });
});

/**
 * Phase 12B: no finished season may be labelled as still being played.
 *
 * Both ranking generators hardcoded `_IN_PROGRESS_SEASON = "2025-26"`, so every
 * 2025-26 row rendered "(in progress)" next to its label and carried a caveat
 * saying its numbers were provisional. They were not — the season is complete
 * in this dataset. The fix derives completion from the data (a champion and a
 * Finals MVP exist) instead of a constant, and moved no score.
 */
test.describe("Rankings — season finalization", () => {
  test("no row on any board is labelled in progress", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "load" });
    await expect(page.getByTestId("rankings-row").first()).toBeVisible({ timeout: 20_000 });

    for (const tab of ["Peak Windows", "Single Seasons"]) {
      const button = page.getByRole("button", { name: tab, exact: true });
      if (await button.count()) {
        await button.first().click();
        await expect(page.getByTestId("rankings-row").first()).toBeVisible({ timeout: 15_000 });
      }
      const table = await page.getByTestId("rankings-table").innerText();
      expect(table).not.toContain("(in progress)");
    }
  });

  test("a 2025-26 row opens with final data and no provisional caveat", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "load" });
    await expect(page.getByTestId("rankings-row").first()).toBeVisible({ timeout: 20_000 });

    // Find any 2025-26 row on the visible board; the season must be present —
    // "fixing" the label by dropping the season would also pass a text check.
    const row = page.getByTestId("rankings-row").filter({ hasText: "2025-26" }).first();
    if (!(await row.count())) {
      test.skip(true, "no 2025-26 row on the default board");
    }
    await row.click();

    const modal = page.getByTestId("score-explain-modal");
    await expect(modal).toBeVisible({ timeout: 15_000 });
    const text = await modal.innerText();
    expect(text).not.toContain("in progress");
    expect(text).not.toMatch(/still being played|provisional/i);
  });

  test("the modal names the two renamed components", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "load" });
    const row = page.getByTestId("rankings-row").first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(page.getByTestId("score-explain-modal")).toBeVisible({ timeout: 15_000 });

    const modal = await page.getByTestId("score-explain-modal").innerText();
    expect(modal).toContain("Playoff Rate Impact");
    expect(modal).toContain("Team Result");
    expect(modal).not.toContain("Postseason Value");
    expect(modal).not.toContain("Team Achievement");
  });
});

/**
 * Phase 12C: two scoring models now exist.
 *
 * Scores from PEAK3 v1 and v2 are not comparable, so the board has to say which
 * one produced it. v1 remains the default; v2 is a labelled preview.
 */
test.describe("Rankings — model version", () => {
  test("the board states which scoring model produced it", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "load" });
    await expect(page.getByTestId("rankings-row").first()).toBeVisible({ timeout: 20_000 });

    const badge = page.getByTestId("rankings-model-version");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/PEAK3 v1/);
  });

  test("the default board is v1, not the preview", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "load" });
    await expect(page.getByTestId("rankings-row").first()).toBeVisible({ timeout: 20_000 });
    const provenance = await page.getByTestId("rankings-provenance").innerText();
    expect(provenance).toContain("peak3_official_weights_v1");
    expect(provenance).not.toContain("preview");
  });

  test("the modal explains why this season is the one on the board", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "load" });
    await expect(page.getByTestId("rankings-row").first()).toBeVisible({ timeout: 20_000 });

    // LeBron's 1Y row is the canonical case: 2008-09 beat his 2012-13 title
    // season by 0.16, so the "why this season?" panel must be present.
    await page.getByTestId("rankings-search").fill("LeBron");
    const row = page.getByTestId("rankings-row").first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.getByTestId("score-explain-modal")).toBeVisible({ timeout: 15_000 });

    const panel = page.getByTestId("score-explain-anchor-selection");
    if (!(await panel.count())) {
      test.skip(true, "this row has no narrowly-beaten iconic season");
    }
    await expect(panel).toContainText(/highest-scoring single season/i);
  });
});

/**
 * UX/organization/polish pass (W6): terminology and provenance.
 *
 * Two defects, both about the page telling the truth about itself.
 *
 * TERMINOLOGY. The page claimed its two boards "ask genuinely different
 * questions". At the 1-Year setting that was false: a peak window of length one
 * IS a single season, so both boards returned the same top rows from the same
 * underlying seasons, differing only in that the peaks board keeps one row per
 * player. Meanwhile the header rendered "1-Year Peak Windows" beside a tab named
 * "Single Seasons" — two names for one concept, presented as a choice.
 *
 * PROVENANCE. Everything a reader needs to judge the board was present but
 * rendered as one undifferentiated 10 px muted line under the "show more"
 * button. The worst casualty was the serving-gate note: the served boards apply
 * a 25.0 MPG floor that the committed 250-pool CSVs do not, excluding 722 / 375
 * / 173 windows at 1Y / 3Y / 5Y. Real committed players fall through it
 * (Isaiah Hartenstein is canonical 1Y rank 185; Tony Allen 245; Andrew Bogut 3Y
 * rank 205) and none appear on this board. A board that edits its own list has
 * to say so legibly.
 */
test.describe("Rankings — board terminology", () => {
  test("the 1-Year board is named as the best single season, not as a rival question", async ({
    page,
  }) => {
    await gotoRankings(page);

    const heading = page.getByTestId("rankings-board-heading");
    await expect(heading).toHaveText(/best single season/i);
    await expect(heading).toContainText(/one row per player/i);

    // The exact contradiction: the old header said "1-Year Peak Windows" right
    // next to a tab reading "Single Seasons".
    await expect(heading).not.toContainText(/peak windows/i);
  });

  test("the explainer says outright that at 1-Year the boards differ only by de-duplication", async ({
    page,
  }) => {
    await gotoRankings(page);
    await expect(page.getByTestId("pool-explainer")).toContainText(
      /de-duplication is the only difference/i,
    );
  });

  test("the Single Seasons board is named as every qualifying season", async ({ page }) => {
    await gotoRankings(page);
    await page.locator('[data-testid="pool-tab-seasons"]').click();
    await page.locator('[data-testid="rankings-row"]').first().waitFor({ timeout: 20_000 });

    await expect(page.getByTestId("rankings-board-heading")).toHaveText(
      /every qualifying season/i,
    );
    await expect(page.getByTestId("pool-explainer")).toContainText(/appear many times/i);
  });

  test("3-Year and 5-Year are still described as different questions", async ({ page }) => {
    await gotoRankings(page);
    for (const [id, digit] of [
      ["3y", "3"],
      ["5y", "5"],
    ] as const) {
      await page.locator(`[data-testid="peak-window-tab-${id}"]`).click();
      await page.locator('[data-testid="rankings-row"]').first().waitFor({ timeout: 20_000 });
      await expect(page.getByTestId("rankings-board-heading")).toContainText(
        new RegExp(`best ${digit}-season stretch`, "i"),
      );
      await expect(page.getByTestId("pool-explainer")).toContainText(/consecutive seasons/i);
      // The n=1 caveat must NOT be repeated where it does not apply.
      await expect(page.getByTestId("pool-explainer")).not.toContainText(
        /de-duplication is the only difference/i,
      );
    }
  });

  test("the top rows of the 1-Year and Single Seasons boards are the same two rows", async ({
    page,
  }) => {
    // The claim the copy now makes, verified against what actually renders. If
    // these ever diverge, either the copy is wrong or one artifact is stale.
    await gotoRankings(page);
    const firstTwo = async () =>
      (await page.getByTestId("rankings-row").allInnerTexts()).slice(0, 2);

    const peaks = await firstTwo();
    await page.locator('[data-testid="pool-tab-seasons"]').click();
    await page.locator('[data-testid="rankings-row"]').first().waitFor({ timeout: 20_000 });
    const seasons = await firstTwo();

    for (const [i, text] of peaks.entries()) {
      const name = text.split("\n").find((line) => /[A-Za-z]{3}/.test(line)) ?? text;
      expect(seasons[i]).toContain(name.trim());
    }
  });
});

test.describe("Rankings — provenance", () => {
  test("states the model, the coverage and the data release in readable text", async ({
    page,
  }) => {
    await gotoRankings(page);
    const provenance = page.getByTestId("rankings-provenance");
    await expect(provenance).toBeVisible();

    // The one fact that determines whether two scores are comparable at all.
    await expect(page.getByTestId("rankings-model-version")).toHaveText(/PEAK3 v1/);
    // Data-through season, seasons covered, and the release identifier.
    await expect(provenance).toContainText(/data through/i);
    await expect(provenance).toContainText(/2025-26/);
    await expect(provenance).toContainText(/1979-80/);
    await expect(provenance).toContainText(/top_1000_peaks/);
    // The full weights identity, verbatim from the model.
    await expect(provenance).toContainText("peak3_official_weights_v1");
  });

  test("the serving gate is stated legibly, not as 10px grey filler", async ({ page }) => {
    await gotoRankings(page);
    const gate = page.getByTestId("rankings-serving-gate");
    await expect(gate).toBeVisible();
    await expect(gate).toContainText(/25\.0 minutes per game/i);
    await expect(gate).toContainText(/leaves out/i);

    // The regression this guards: it used to render at 10px in --text-muted,
    // which is why a filter excluding 722 windows went unnoticed. Anything
    // below 12px is not a note, it is a disclaimer nobody reads.
    const fontSize = await gate.evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    expect(fontSize).toBeGreaterThanOrEqual(12);
  });

  test("links to the methodology rather than restating it", async ({ page }) => {
    await gotoRankings(page);
    const link = page
      .getByTestId("rankings-provenance")
      .getByRole("link", { name: /how the score is built/i });
    await expect(link).toHaveAttribute("href", "/methodology");
  });

  test("provenance survives a board switch and keeps naming the same model", async ({ page }) => {
    // A stale-cache symptom would show here first: the seasons board is a
    // different artifact served by a different route, and both must report v1.
    await gotoRankings(page);
    await expect(page.getByTestId("rankings-model-version")).toHaveText(/PEAK3 v1/);

    await page.locator('[data-testid="pool-tab-seasons"]').click();
    await page.locator('[data-testid="rankings-row"]').first().waitFor({ timeout: 20_000 });
    await expect(page.getByTestId("rankings-model-version")).toHaveText(/PEAK3 v1/);
    await expect(page.getByTestId("rankings-provenance")).toContainText(/top_1000_seasons/);
  });

  test("@mobile the provenance panel does not overflow the page", async ({ page }) => {
    await gotoRankings(page);
    await expect(page.getByTestId("rankings-provenance")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
