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
 *
 * HOME-03 ADDED THREE FACTS THAT ONLY A BROWSER CAN CHECK: that the figure is
 * unconditional (whichever fact the calendar picks today), that the category
 * accent group actually resolves to a colour through the stylesheet, and that
 * the default "See their PEAK3 profile" row — the card's old only control, in
 * faint secondary text — is gone, with anything that survives being a real
 * target.
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

  test("leads with a figure and a supporting sentence", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("nba-fact-of-the-day");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    // HOME-03: the figure is unconditional, so whichever fact the calendar
    // picks the card has a focal point rather than collapsing to a paragraph.
    const figure = page.getByTestId("fotd-figure");
    await expect(figure).toBeVisible();
    const figureBox = (await figure.boundingBox())!;
    const headlineBox = (await page.getByTestId("fotd-text").boundingBox())!;
    expect(figureBox.width).toBeGreaterThan(0);
    expect(headlineBox.width).toBeGreaterThan(0);

    // Not every fact carries a `feature`, so this asserts the SHAPE when one
    // does rather than requiring today's fact to have one.
    const feature = page.getByTestId("fotd-feature");
    if (await feature.count()) await expect(feature).toContainText(/\S/);

    // The motif is decorative and must stay out of the accessibility tree.
    const motif = panel.locator("svg.fotd-motif");
    await expect(motif.first()).toHaveAttribute("aria-hidden", "true");
  });

  test("is coloured by the category it is about", async ({ page }) => {
    // One custom property drives the whole card, so this is the single
    // browser-observable fact that the accent group reached the stylesheet.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("nba-fact-of-the-day");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    const accent = await panel.getAttribute("data-accent");
    expect(
      ["history", "rules", "records", "playoffs", "global", "people"],
      "the card rendered with no accent group",
    ).toContain(accent);

    const resolved = await panel.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--fotd-accent").trim(),
    );
    expect(resolved, "--fotd-accent did not resolve to a colour").toMatch(/\S/);
  });

  test("offers no faint default profile link", async ({ page }) => {
    // HOME-03 removed the "See their PEAK3 profile" row that appeared on
    // roughly three quarters of the bank. Whatever survives must be a real
    // control (SHARED-04), never underlined secondary body text.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("nba-fact-of-the-day");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    // `.fotd-link` was the old faint style: 0.6875rem, `--text-secondary`,
    // underlined body text, and the card's only control. It no longer exists.
    await expect(panel.locator(".fotd-link")).toHaveCount(0);
    const cta = page.getByTestId("fotd-player-link");
    if (await cta.count()) {
      await expect(cta).toHaveClass(/fotd-cta/);
      const box = (await cta.boundingBox())!;
      expect(box.height, "the one surviving action is not a comfortable target")
        .toBeGreaterThanOrEqual(40);
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
