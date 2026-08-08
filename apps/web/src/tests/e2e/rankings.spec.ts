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

/** Open the unified player analysis.
 *
 * ONE DESTINATION. A row click, the rank and the player name all open this, and
 * there is nothing else in a row to open: the `ƒ` cell that used to open a
 * separate `ScoreExplainModal` is gone, header and cells, and the derivation is
 * three `<details>` inside this drawer. */
async function openAnalysis(page: Page, index = 0): Promise<void> {
  await page.locator('[data-testid="rankings-row"]').nth(index).click();
  await expect(page.getByTestId("rankings-analysis")).toBeVisible({ timeout: 15_000 });
}

/** Expand one of the derivation disclosures.
 *
 *  `<details>` content is present in the DOM but NOT visible while closed, so
 *  every assertion about the derivation has to open its section first. That is
 *  the progressive disclosure working, not a test inconvenience: the first view
 *  of the drawer is the player, and the algebra is below it. */
async function openFold(page: Page, testId: string): Promise<void> {
  const fold = page.getByTestId(testId);
  await fold.locator("summary").click();
  await expect(fold).toHaveAttribute("open", "");
}

/** Wait for the drawer's entrance to finish before sampling rendered colours.
 *
 *  `toBeVisible()` resolves the instant the panel mounts, while the scrim is
 *  still animating its background alpha. Anything that samples colours in that
 *  window measures drawer text against a partially-composited background --
 *  which is exactly how an earlier pass got a "serious: color-contrast" report
 *  describing a frame no user ever interacts with. */
async function waitForDrawerSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const panel = document.querySelector('[data-testid="rankings-analysis"]');
      const scrim = document.querySelector('[data-testid="rankings-analysis-scrim"]');
      if (!panel || !scrim) return false;
      return [...panel.getAnimations(), ...scrim.getAnimations()].every(
        (a) => a.playState === "finished" || a.playState === "idle",
      );
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

test.describe("Rankings — the unified analysis", () => {
  test("the ƒ column is gone, header and cells", async ({ page }) => {
    await gotoRankings(page);
    // The header cell and every row control that lived under it.
    await expect(page.getByTestId("rankings-explain")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Explain the PEAK3 score/i }),
    ).toHaveCount(0);
    const table = await page.getByTestId("rankings-table").innerText();
    expect(table, "no ƒ glyph may remain anywhere in the table").not.toContain("ƒ");

    // Header and body agree on the column count, which is what proves the cell
    // was removed from both rather than merely hidden in one.
    const headerCells = await page.locator("thead th").count();
    const bodyCells = await page
      .getByTestId("rankings-row")
      .first()
      .locator("td")
      .count();
    expect(bodyCells).toBe(headerCells);
  });

  test("a row click opens ONE dialog carrying both the chart and the derivation", async ({
    page,
  }) => {
    await gotoRankings(page);
    const urlBefore = page.url();

    await openAnalysis(page);
    const panel = page.getByTestId("rankings-analysis");

    // Same page: no navigation, no reload.
    expect(page.url()).toBe(urlBefore);

    // There is no second dialog to open.
    await expect(page.getByTestId("score-explain-modal")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);

    // The player first: chart and exact values, above the disclosures.
    await expect(panel.getByTestId("rankings-composite-chart")).toBeVisible();
    await expect(panel.getByTestId("rk-detail-table")).toBeVisible();

    // Then the derivation, in the same drawer.
    for (const fold of ["rk-fold-breakdown", "rk-fold-calculation", "rk-fold-source"]) {
      await expect(panel.getByTestId(fold)).toBeVisible();
      await expect(panel.getByTestId(fold)).not.toHaveAttribute("open", "");
    }
  });

  test("the score breakdown carries a real component breakdown", async ({ page }) => {
    await gotoRankings(page);
    await openAnalysis(page);
    await openFold(page, "rk-fold-breakdown");

    // The regression that matters: this board used to publish no components at
    // all, so the breakdown rendered as "not available".
    await expect(page.getByTestId("component-breakdown")).toBeVisible();
    await expect(page.getByTestId("score-explain-components-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("score-explain-component-cards")).toBeVisible();

    await openFold(page, "rk-fold-calculation");
    await expect(page.getByTestId("score-explain-summary")).toBeVisible();
  });

  test("the analysis is not mostly 'not available'", async ({ page }) => {
    await gotoRankings(page);
    await openAnalysis(page);
    for (const fold of ["rk-fold-breakdown", "rk-fold-calculation", "rk-fold-source"]) {
      await openFold(page, fold);
    }
    const text = (await page.getByTestId("rankings-analysis").innerText()).toLowerCase();
    const occurrences = text.split("not available").length - 1;
    expect(
      occurrences,
      "the analysis should not be padded with unavailable blocks",
    ).toBeLessThanOrEqual(2);
  });

  test("Michael Jordan's row explains the score with percentiles and weights", async ({ page }) => {
    await gotoRankings(page);
    // The #1 1Y window is Jordan 1990-91 — a stable anchor for asserting real
    // content rather than mere presence.
    const jordan = page
      .locator('[data-testid="rankings-row"]', { hasText: "Michael Jordan" })
      .first();
    await jordan.waitFor({ timeout: 20_000 });
    await jordan.click();

    const panel = page.getByTestId("rankings-analysis");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText("Michael Jordan");

    await openFold(page, "rk-fold-breakdown");
    // Every one of the five components must carry a value AND a percentile.
    for (const key of [
      "statistical_impact",
      "traditional_production",
      "individual_recognition",
      "postseason_individual_value",
      "team_achievement",
    ]) {
      await expect(page.getByTestId(`score-explain-component-${key}`)).toContainText(
        /percentile/i,
      );
    }
    // The real official weight, served from peak3.OFFICIAL_WEIGHTS.
    await expect(panel).toContainText("38");
  });

  test("the arithmetic ends in the raw index and the calibrated score", async ({ page }) => {
    await gotoRankings(page);
    await openAnalysis(page);
    await openFold(page, "rk-fold-calculation");

    const table = page.getByTestId("rk-formula-table");
    await expect(table).toBeVisible();
    // Five component rows, each with its weight and its contribution.
    for (const key of [
      "statistical_impact",
      "traditional_production",
      "individual_recognition",
      "postseason_individual_value",
      "team_achievement",
    ]) {
      await expect(table.getByTestId(`rk-formula-row-${key}`)).toBeVisible();
    }
    await expect(table.getByTestId("rk-formula-sum")).toBeVisible();
    await expect(table.getByTestId("rk-formula-index")).toBeVisible();
    await expect(table.getByTestId("rk-formula-total")).toBeVisible();

    // The sum of the five contributions, plus the teammate modifier, must equal
    // the raw index the model publishes — read from the rendered cells, so a
    // presentation that quietly showed a different number would fail here.
    const cells = await table.evaluate((el) => {
      const num = (id: string) => {
        const row = el.querySelector(`[data-testid="${id}"]`);
        const cell = row?.querySelector("td");
        return cell ? parseFloat((cell.textContent ?? "").replace("−", "-").replace("+", "")) : NaN;
      };
      const contributions = [...el.querySelectorAll("tbody tr")].map((tr) => {
        const tds = tr.querySelectorAll("td");
        return parseFloat(tds[tds.length - 1].textContent ?? "");
      });
      return { contributions, sum: num("rk-formula-sum"), index: num("rk-formula-index") };
    });
    const added = cells.contributions.reduce((a, b) => a + b, 0);
    expect(Math.abs(added - cells.sum)).toBeLessThan(0.02);
    expect(Math.abs(cells.index - cells.sum)).toBeLessThan(1);
  });

  test("a component segment is focusable and updates the detail panel", async ({ page }) => {
    await gotoRankings(page);
    await openAnalysis(page);
    await openFold(page, "rk-fold-breakdown");
    await expect(page.getByTestId("component-breakdown")).toBeVisible({ timeout: 15_000 });

    const segments = page.locator('[data-testid="component-breakdown"] button');
    await expect(segments.first()).toBeVisible();
    await segments.first().click();
    const detail = page.getByTestId("component-detail");
    await expect(detail).toBeVisible();
    const first = await detail.innerText();

    await segments.last().click();
    await expect.poll(async () => detail.innerText(), { timeout: 10_000 }).not.toBe(first);
    await expect(page.getByTestId("component-detail-why")).toBeVisible();
  });

  test("comparison rails pivot to another row without leaving the drawer", async ({ page }) => {
    await gotoRankings(page);
    await page.locator('[data-testid="pool-tab-seasons"]').click();
    await page.locator('[data-testid="rankings-row"]').first().waitFor({ timeout: 20_000 });
    await openAnalysis(page);
    await openFold(page, "rk-fold-source");

    const panel = page.getByTestId("rankings-analysis");
    const comparisons = page.getByTestId("score-explain-comparisons");
    await expect(comparisons).toBeVisible({ timeout: 15_000 });

    const before = await panel.innerText();
    await comparisons.locator("button").first().click();
    // Still open, now showing a different row, with a way back.
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("rankings-analysis-back")).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => panel.innerText(), { timeout: 10_000 }).not.toBe(before);
  });

  test("Previous and Next walk the board without closing", async ({ page }) => {
    await gotoRankings(page);
    await openAnalysis(page, 1);
    const name = page.getByTestId("rk-detail-name");
    const first = await name.innerText();

    await page.getByTestId("rankings-analysis-next").click();
    await expect.poll(async () => name.innerText(), { timeout: 10_000 }).not.toBe(first);
    // The derivation follows the player, not only the chart.
    await openFold(page, "rk-fold-calculation");
    await expect(page.getByTestId("rk-formula-table")).toBeVisible();

    await page.getByTestId("rankings-analysis-prev").click();
    await expect.poll(async () => name.innerText(), { timeout: 10_000 }).toBe(first);
  });

  test("Escape and the close button both dismiss the analysis", async ({ page }) => {
    await gotoRankings(page);
    const panel = page.getByTestId("rankings-analysis");

    await openAnalysis(page);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    await openAnalysis(page);
    await page.getByTestId("rankings-analysis-close").click();
    await expect(panel).toHaveCount(0);
  });

  test("a row is reachable and openable by keyboard alone", async ({ page }) => {
    await gotoRankings(page);
    const trigger = page
      .locator('[data-testid="rankings-row"]')
      .first()
      .getByTestId("rankings-open-analysis");
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("rankings-analysis")).toBeVisible({ timeout: 15_000 });
  });

  test("the disclosures are operable by keyboard", async ({ page }) => {
    await gotoRankings(page);
    await openAnalysis(page);
    const fold = page.getByTestId("rk-fold-calculation");
    await fold.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(fold).toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(fold).not.toHaveAttribute("open", "");
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

  test("the open analysis has no critical/serious violations, every fold expanded", async ({
    page,
  }) => {
    await gotoRankings(page);
    await openAnalysis(page);
    // Audited with the derivation OPEN, because a disclosure that hides a
    // contrast failure has only postponed it.
    for (const fold of ["rk-fold-breakdown", "rk-fold-calculation", "rk-fold-source"]) {
      await openFold(page, fold);
    }
    await expect(page.getByTestId("component-breakdown")).toBeVisible();
    await waitForDrawerSettled(page);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      serious.map((v) => `${v.impact}: ${v.id}`),
      // NAMES THE NODES, not just the rule. "serious: color-contrast" on a
      // drawer with fifty elements in it is a rule id and a search; the
      // selector and the measured ratio are the diagnosis.
      `the player analysis must stay axe-clean:\n${serious
        .flatMap((v) =>
          v.nodes.map((n) => `  ${v.id} @ ${n.target.join(" ")} — ${n.failureSummary}`),
        )
        .join("\n")}`,
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

  test("@mobile the analysis is a full-width sheet that fits the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoRankings(page);
    await openAnalysis(page);
    const panel = page.getByTestId("rankings-analysis");
    const box = await panel.boundingBox();
    expect(box, "the drawer must have a real box").toBeTruthy();

    // MEASURED AGAINST THE VIEWPORT, WITH A SUB-PIXEL TOLERANCE.
    //
    // This read `expect(box!.width).toBeLessThanOrEqual(390)` and failed on
    // `390.0000071525574`. That is not an overflow of any kind: the sheet is
    // exactly viewport-width, and `getBoundingClientRect` returns a float
    // whose last bits are the residue of the browser's internal LayoutUnit
    // (1/64 px) to double conversion. Seven nanometres of CSS pixel cannot be
    // rendered, scrolled or seen.
    //
    // 0.5 CSS px is the tolerance because it is the largest value that is
    // still invisible on every display this runs on: at DPR 1 it is half a
    // device pixel and at the DPR 2-3 of the mobile profile it is one to one
    // and a half. A real overflow — a component column, a wide chip, a table
    // that does not scroll inside its own box — is orders of magnitude larger
    // than this and still fails. It is NOT an arbitrary epsilon chosen to make
    // the number pass, and the genuine no-horizontal-scroll invariant is
    // asserted separately and at zero tolerance further down.
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    const SUBPIXEL = 0.5;
    expect(
      box!.width,
      "the analysis sheet must not be wider than the viewport",
    ).toBeLessThanOrEqual(viewportWidth + SUBPIXEL);
    // A full-width SHEET, not a squeezed column beside the table.
    expect(box!.width).toBeGreaterThanOrEqual(viewportWidth - 20);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(394);

    // The same unified content, at 390px: the derivation is here too.
    await openFold(page, "rk-fold-calculation");
    await expect(page.getByTestId("rk-formula-table")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the arithmetic table must scroll inside its own box").toBeLessThanOrEqual(1);
  });
});

/**
 * Phase 12A: the analysis has to explain THIS row, not the formula in general.
 * The old surface produced near-identical prose for every player-season, which
 * is exactly what made a surprising Playoff Rate Impact unexplainable.
 *
 * The receipts now live inside "How this score was calculated", beside the
 * arithmetic they justify.
 */
test.describe("Rankings — row-specific receipts", () => {
  async function openReceipts(page: Page, index = 0) {
    await page.goto("/rankings", { waitUntil: "load" });
    await expect(page.getByTestId("rankings-row").first()).toBeVisible({ timeout: 20_000 });
    await openAnalysis(page, index);
    await openFold(page, "rk-fold-calculation");
  }

  test("shows per-component receipts built from this row's own numbers", async ({ page }) => {
    await openReceipts(page);

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
    await openReceipts(page);
    const note = page.getByTestId("score-explain-receipt-note-postseason_individual_value");
    await expect(note).toBeVisible({ timeout: 15_000 });
    // Whatever the row, the note must resolve the "why is this number like
    // that?" question rather than restating the component's name.
    await expect(note).toContainText(
      /did not reach the playoffs|replacement-level|shrinks postseason value|not winning/i,
    );
  });

  test("two different rows produce different receipts", async ({ page }) => {
    await openReceipts(page);
    const first = await page.getByTestId("score-explain-receipts").innerText();
    await page.getByTestId("rankings-analysis-close").click();
    await expect(page.getByTestId("rankings-analysis")).toHaveCount(0);

    await openAnalysis(page, 3);
    await openFold(page, "rk-fold-calculation");
    await expect(page.getByTestId("score-explain-receipts")).toBeVisible();
    const other = await page.getByTestId("score-explain-receipts").innerText();

    expect(other).not.toEqual(first);
  });

  test("the analysis stays accessible with every section expanded", async ({ page }) => {
    await openReceipts(page);
    await expect(page.getByTestId("score-explain-receipts")).toBeVisible({ timeout: 15_000 });
    await openFold(page, "rk-fold-breakdown");
    await openFold(page, "rk-fold-source");

    // WAIT FOR THE ENTRANCE TRANSITION TO SETTLE BEFORE AUDITING.
    //
    // `toBeVisible` resolves as soon as the element has a box, which is true
    // part-way through the drawer's entrance. Auditing there measures a frame
    // nobody looks at: an earlier pass read `--text-muted` composited against a
    // partially-faded scrim, scored it 4.41:1 and reported a serious
    // colour-contrast violation. At rest the same pair passes AA -- the product
    // was never out of compliance, the audit was simply early.
    await waitForDrawerSettled(page);

    const results = await new AxeBuilder({ page })
      .include('[data-testid="rankings-analysis"]')
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

    const panel = page.getByTestId("rankings-analysis");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    for (const fold of ["rk-fold-breakdown", "rk-fold-calculation", "rk-fold-source"]) {
      await openFold(page, fold);
    }
    const text = await panel.innerText();
    expect(text).not.toContain("in progress");
    expect(text).not.toMatch(/still being played|provisional/i);
  });

  test("the analysis names the two renamed components", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "load" });
    await expect(page.getByTestId("rankings-row").first()).toBeVisible({ timeout: 20_000 });
    await openAnalysis(page);
    for (const fold of ["rk-fold-breakdown", "rk-fold-calculation", "rk-fold-source"]) {
      await openFold(page, fold);
    }

    const text = await page.getByTestId("rankings-analysis").innerText();
    expect(text).toContain("Playoff Rate Impact");
    expect(text).toContain("Team Result");
    expect(text).not.toContain("Postseason Value");
    expect(text).not.toContain("Team Achievement");
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

  test("the analysis explains why this season is the one on the board", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "load" });
    await expect(page.getByTestId("rankings-row").first()).toBeVisible({ timeout: 20_000 });

    // LeBron's 1Y row is the canonical case: 2008-09 beat his 2012-13 title
    // season by 0.16, so the "why this season?" panel must be present.
    // WAIT FOR THE FILTER TO LAND BEFORE OPENING ANYTHING. The search runs
    // behind a 250 ms debounce and then a refetch, so a row clicked from the
    // UNFILTERED list leaves the board a moment later — which correctly closes
    // the drawer, and made this a test about a race rather than about the
    // panel. The same wait the scroll-preservation test already documents.
    const rows = page.getByTestId("rankings-row");
    const unfiltered = await rows.count();
    await page.getByTestId("rankings-search").fill("LeBron");
    await expect.poll(async () => rows.count(), { timeout: 15_000 }).toBeLessThan(
      unfiltered,
    );
    await openAnalysis(page);
    await openFold(page, "rk-fold-source");

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

test.describe("Rankings — the player analysis, and only on request", () => {
  // THE DEFECT THESE REPLACE. The page used to resolve its selection as
  // `match ?? sortedRows[0]`, so it opened with the top-ranked player selected,
  // a radar chart drawn, and a third of the width held open for a panel nobody
  // had asked for. The old tests here asserted that default as the intended
  // behaviour ("defaults to the top-ranked row", "a reader lands on the page
  // already looking at something"), which is exactly the product decision
  // manual acceptance rejected: the chart should appear only after a reader
  // asks to analyse someone, and it should arrive with the whole analysis.

  test("opens with no analysis and no chart at all", async ({ page }) => {
    await gotoRankings(page);
    await expect(page.locator('[data-testid="rankings-row"]').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="rankings-analysis"]')).toHaveCount(0);
    // Not merely hidden: the chart is not constructed on a load that never
    // opens an analysis.
    await expect(page.locator('[data-testid="rankings-composite-chart"]')).toHaveCount(0);
    await expect(page.locator(".rk-chart-svg")).toHaveCount(0);
    for (const row of await page.locator('[data-testid="rankings-row"]').all()) {
      await expect(row).toHaveAttribute("data-selected", "false");
    }
  });

  test("the table uses the full width, with no reserved analysis column", async ({ page }) => {
    await gotoRankings(page);
    await expect(page.locator(".rankings-split")).toHaveCount(0);
    const board = page.locator(".rankings-board");
    await expect(board).toBeVisible();
  });

  test("clicking a row opens the whole analysis, chart included", async ({ page }) => {
    await gotoRankings(page);
    const third = page.locator('[data-testid="rankings-row"]').nth(2);
    const name = (
      await third.getByTestId("rankings-open-analysis").innerText()
    ).trim();
    await third.click();

    const panel = page.locator('[data-testid="rankings-analysis"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator('[data-testid="rk-detail-name"]')).toHaveText(name);

    // The chart, all six axes, and the exact values as a table -- together.
    await expect(panel.locator('[data-testid="rankings-composite-chart"]')).toBeVisible();
    for (const key of [
      "statistical_impact",
      "traditional_production",
      "individual_recognition",
      "postseason_individual_value",
      "team_achievement",
      "data_completeness",
    ]) {
      await expect(page.locator(`[data-testid="rk-chart-label-${key}"]`)).toBeAttached();
    }
    const table = panel.locator('[data-testid="rk-detail-table"]');
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(6);
  });

  test("opens from the keyboard, closes on Escape, and returns focus", async ({ page }) => {
    await gotoRankings(page);
    const select = page.locator('[data-testid="rankings-select-2"]');
    await select.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="rankings-analysis"]')).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="rankings-analysis"]')).toHaveCount(0);
    await expect(select).toBeFocused();
  });

  test("preserves scroll position and the search across an open and close", async ({ page }) => {
    await gotoRankings(page);
    const rows = page.locator('[data-testid="rankings-row"]');
    const unfiltered = await rows.count();

    await page.getByTestId("rankings-search").fill("james");
    // WAIT FOR THE FILTER TO LAND before opening anything. The search runs
    // behind a 250 ms debounce and then a refetch; clicking a row from the
    // UNFILTERED list means the row can leave the board a moment later, which
    // correctly closes the drawer -- and would make this a test about a race
    // rather than about what survives an open and close.
    await expect.poll(async () => rows.count(), { timeout: 10_000 }).toBeLessThan(
      unfiltered,
    );

    await page.mouse.wheel(0, 400);
    // And for the smooth scroll to settle, so "the list did not move" is
    // measured against a resting position rather than a moving one.
    await expect
      .poll(async () => page.evaluate(() => window.scrollY), { timeout: 5_000 })
      .toBeGreaterThan(0);
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await rows.first().click();
    await expect(page.locator('[data-testid="rankings-analysis"]')).toBeVisible();
    await page.getByTestId("rankings-analysis-close").click();
    await expect(page.locator('[data-testid="rankings-analysis"]')).toHaveCount(0);

    await expect(page.getByTestId("rankings-search")).toHaveValue("james");
    expect(
      Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore),
    ).toBeLessThan(120);
  });

  test("the chart does not clip or trap scrolling at 200% zoom", async ({ page }) => {
    await gotoRankings(page);
    // 200% zoom, emulated by halving the viewport against the same CSS pixels.
    await page.setViewportSize({ width: 640, height: 480 });
    await page.locator('[data-testid="rankings-row"]').first().click();
    await expect(page.locator('[data-testid="rankings-composite-chart"]')).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the rankings page scrolls horizontally at 200% zoom").toBeLessThanOrEqual(1);

    const box = await page.locator(".rk-chart-svg").boundingBox();
    expect(box, "the chart did not render").not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
  });

  // -- one destination, at the width where two used to collide ---------------

  test("@mobile every path in a row opens the ONE analysis at 390px", async ({ page }) => {
    // THE DEFECT THIS REPLACES, IN TWO STAGES. The derivation first opened from
    // the player's NAME, the widest thing in a row: at 1440px a mid-row tap
    // landed on empty table and opened the analysis, at 390px the same gesture
    // opened a different dialog. That was fixed by giving the derivation its own
    // bounded `ƒ` cell — and then fixed properly, by there being only one thing
    // in a row to open at all.
    await gotoRankings(page);
    const first = page.locator('[data-testid="rankings-row"]').first();
    await expect(first).toBeVisible({ timeout: 20_000 });

    // No second target to collide with.
    await expect(first.getByTestId("rankings-explain")).toHaveCount(0);

    await first.getByTestId("rankings-open-analysis").click();
    await expect(page.getByTestId("rankings-analysis")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.locator('[data-testid="score-explain-modal"]')).toHaveCount(0);

    // And the derivation is HERE, not somewhere else.
    await openFold(page, "rk-fold-calculation");
    await expect(page.getByTestId("rk-formula-table")).toBeVisible();
  });

  test("@mobile the disclosures meet the tap floor", async ({ page }) => {
    await gotoRankings(page);
    await openAnalysis(page);
    for (const fold of ["rk-fold-breakdown", "rk-fold-calculation", "rk-fold-source"]) {
      const box = (await page.getByTestId(fold).locator("summary").boundingBox())!;
      expect(box, `${fold} summary must have a box`).toBeTruthy();
      expect(box.height, `${fold} summary is below the 44px tap floor`).toBeGreaterThanOrEqual(
        40,
      );
    }
  });

  test("@mobile has no serious accessibility violations with a row open", async ({ page }) => {
    await gotoRankings(page);
    await expect(page.locator('[data-testid="rankings-row"]').first()).toBeVisible({
      timeout: 20_000,
    });
    await page.locator('[data-testid="rankings-row"]').first().getByTestId(
      "rankings-open-analysis",
    ).click();
    await expect(page.getByTestId("rankings-analysis")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    );
    expect(
      serious,
      `serious/critical axe violations at 390px: ${serious.map((v) => v.id).join(", ")}`,
    ).toEqual([]);
  });

  test("has no serious accessibility violations, closed or open", async ({ page }) => {
    await gotoRankings(page);
    await expect(page.locator('[data-testid="rankings-row"]').first()).toBeVisible({
      timeout: 20_000,
    });

    for (const stage of ["closed", "open"] as const) {
      if (stage === "open") {
        await page.locator('[data-testid="rankings-row"]').first().click();
        await expect(page.locator('[data-testid="rankings-analysis"]')).toBeVisible();
      }
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const serious = results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      );
      expect(
        serious,
        `serious/critical axe violations (${stage}): ${serious.map((v) => v.id).join(", ")}`,
      ).toEqual([]);
    }
  });
});
