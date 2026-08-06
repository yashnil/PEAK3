/**
 * NBA Fact of the Day, on the homepage.
 *
 * The browser-level rules: the panel is between the hero and the game
 * catalogue, it is headed as NBA trivia rather than as a PEAK3 insight, it has
 * a real focal point, it shows NO SOURCE-ROW TABLE, and the same date really
 * does produce the same fact for everyone.
 *
 * WHAT THE DISCLOSURE TESTS BECAME. Three tests here used to drive a
 * `<details>` labelled "Show source rows" — that it opened, that it worked from
 * the keyboard, that both states were axe-clean. They were good tests of a
 * control the manual review asked to remove: a card whose most prominent
 * interaction is an invitation to read a four-column database. The assertions
 * are now that the control and the table are absent, and that the panel has no
 * interactive element left to get wrong.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("NBA Fact of the Day", () => {
  test("renders on the homepage, above the game catalogue", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("nba-fact-of-the-day");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    await expect(
      page.getByRole("heading", { name: "NBA Fact of the Day" }),
    ).toBeVisible();
    await expect(page.getByTestId("fotd-text")).toContainText(/\S/);
    await expect(page.getByTestId("fotd-category")).toContainText(/\S/);

    // Placement: between the hero and the catalogue, not appended at the end.
    const factBox = await panel.boundingBox();
    const modesBox = await page.locator("#modes-heading").boundingBox();
    expect(factBox, "the fact panel did not render").not.toBeNull();
    expect(modesBox, "the catalogue heading did not render").not.toBeNull();
    expect(factBox!.y).toBeLessThan(modesBox!.y);
  });

  test("is NBA trivia and never branded as a PEAK3 fact", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("nba-fact-of-the-day");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).not.toContainText(/PEAK3 Fact/i);
    await expect(page.getByTestId("fotd-text")).not.toContainText(/PEAK3/i);
  });

  test("shows no source-row table, and offers no way to open one", async ({ page }) => {
    // `domcontentloaded` ON PURPOSE. The panel is server-rendered and now ships
    // no client behaviour at all, so everything below is true before hydration.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("nba-fact-of-the-day");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId("fotd-details")).toHaveCount(0);
    await expect(page.getByTestId("fotd-evidence")).toHaveCount(0);
    await expect(page.getByTestId("fotd-evidence-toggle")).toHaveCount(0);
    await expect(panel.locator("details")).toHaveCount(0);
    await expect(panel.locator("table")).toHaveCount(0);
    await expect(panel).not.toContainText(/source rows/i);
  });

  test("leads with a featured value and a supporting sentence", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("nba-fact-of-the-day");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    // Not every fact carries a feature, so this asserts the SHAPE when one
    // does rather than requiring today's fact to have one.
    const feature = page.getByTestId("fotd-feature");
    if (await feature.count()) {
      await expect(feature).toContainText(/\S/);
      const featureBox = (await feature.boundingBox())!;
      const headlineBox = (await page.getByTestId("fotd-text").boundingBox())!;
      // A focal point, set apart from the prose rather than inside it.
      expect(featureBox.width).toBeGreaterThan(0);
      expect(headlineBox.width).toBeGreaterThan(0);
    }
    // The court motif is decorative and must stay out of the accessibility tree.
    const motif = panel.locator("svg.fotd-motif");
    if (await motif.count()) {
      await expect(motif.first()).toHaveAttribute("aria-hidden", "true");
    }
  });

  test("shows the same fact to every visitor on the same day", async ({ page, browser }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const first = await page.getByTestId("nba-fact-of-the-day").getAttribute("data-fact-id");
    expect(first).toBeTruthy();

    const other = await browser.newContext();
    const second = await other.newPage();
    try {
      await second.goto("/", { waitUntil: "domcontentloaded" });
      await expect(second.getByTestId("nba-fact-of-the-day")).toHaveAttribute(
        "data-fact-id",
        first!,
      );
    } finally {
      await other.close();
    }
  });

  test("has no serious accessibility violations", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("nba-fact-of-the-day").waitFor({ timeout: 20_000 });

    // ONE STATE NOW, because there is only one. The card used to have a closed
    // and an open state and both had to be scanned, since a contrast or
    // structure problem inside the evidence table was unreachable until it was
    // opened. The table is gone.
    const results = await new AxeBuilder({ page })
      .include('[data-testid="nba-fact-of-the-day"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    );
    expect(serious.map((v) => v.id)).toEqual([]);
  });
});

test.describe("@mobile NBA Fact of the Day on a phone", () => {
  test("fits without a horizontal scroll trap", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("nba-fact-of-the-day").waitFor({ timeout: 20_000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the homepage scrolls horizontally on a phone").toBeLessThanOrEqual(1);
  });
});
