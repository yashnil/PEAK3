/**
 * NBA Fact of the Day, on the homepage.
 *
 * The browser-level rules: the panel is between the hero and the game
 * catalogue, it is headed as NBA trivia rather than as a PEAK3 insight, its
 * evidence disclosure works, and the same date really does produce the same
 * fact for everyone.
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

  test("discloses the rows the fact was computed from", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const toggle = page.getByTestId("fotd-evidence-toggle");
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("fotd-evidence")).toBeVisible();
    await expect(page.getByTestId("fotd-evidence").locator("tbody tr").first()).toBeVisible();
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
    await page.getByTestId("fotd-evidence-toggle").click();
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
