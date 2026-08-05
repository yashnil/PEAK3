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
    // `domcontentloaded` ON PURPOSE, and NOT raised to `load`. This disclosure
    // is native `<details>`, so it is operable the moment the markup exists --
    // which is the property the test is here to hold. Waiting for hydration
    // first would test a slower page instead of a correct control, and would
    // stop catching the regression that put a React handler back in the way.
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const details = page.getByTestId("fotd-details");
    const summary = page.getByTestId("fotd-evidence-toggle");
    const evidence = page.getByTestId("fotd-evidence");

    await expect(summary).toBeVisible({ timeout: 20_000 });
    await expect(details).not.toHaveAttribute("open", /.*/);
    await expect(evidence).toBeHidden();
    // THE ACCESSIBLE NAME, not `textContent`. Both labels are in the markup and
    // CSS shows one; `display: none` is also what removes the other from the
    // accessibility tree, so this is the assertion that proves the swap works
    // for a screen reader rather than only for a sighted reader.
    await expect(summary).toHaveAccessibleName("Show source rows");

    await summary.click();

    await expect(details).toHaveAttribute("open", /.*/);
    await expect(evidence).toBeVisible();
    await expect(evidence.locator("tbody tr").first()).toBeVisible();
    await expect(summary).toHaveAccessibleName("Hide source rows");

    await summary.click();
    await expect(details).not.toHaveAttribute("open", /.*/);
    await expect(evidence).toBeHidden();
  });

  test("opens from the keyboard with Enter and with Space", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const details = page.getByTestId("fotd-details");
    const summary = page.getByTestId("fotd-evidence-toggle");
    await expect(summary).toBeVisible({ timeout: 20_000 });

    await summary.focus();
    await expect(summary).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", /.*/);
    await page.keyboard.press("Enter");
    await expect(details).not.toHaveAttribute("open", /.*/);

    await page.keyboard.press(" ");
    await expect(details).toHaveAttribute("open", /.*/);
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

  test("has no serious accessibility violations, closed or open", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("nba-fact-of-the-day").waitFor({ timeout: 20_000 });

    async function scan(state: string) {
      const results = await new AxeBuilder({ page })
        .include('[data-testid="nba-fact-of-the-day"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const serious = results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      );
      expect(serious.map((v) => v.id), `violations with the disclosure ${state}`).toEqual([]);
    }

    // Both states: the closed one hides the table from the accessibility tree
    // entirely, so a contrast or structure problem inside it is only reachable
    // once it is open.
    await scan("closed");
    await page.getByTestId("fotd-evidence-toggle").click();
    await expect(page.getByTestId("fotd-evidence")).toBeVisible();
    await scan("open");
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
