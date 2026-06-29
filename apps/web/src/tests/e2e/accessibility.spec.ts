/**
 * Accessibility tests using axe-core.
 * Tagged with "accessibility" so they can be run in isolation: npm run test:e2e:accessibility
 *
 * Requires real FastAPI (port 8000) and Next.js (port 3000) services.
 * Uses @axe-core/playwright for WCAG 2.1 AA checks.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// ---------------------------------------------------------------------------
// Helper: run axe and fail with readable output
// ---------------------------------------------------------------------------
async function expectNoViolations(builder: AxeBuilder) {
  const results = await builder.analyze();
  const criticalOrSerious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
  if (criticalOrSerious.length > 0) {
    const summary = criticalOrSerious
      .map(
        (v) =>
          `[${v.impact}] ${v.id}: ${v.description}\n  Nodes: ${v.nodes
            .slice(0, 2)
            .map((n) => n.html)
            .join(", ")}`
      )
      .join("\n");
    throw new Error(`${criticalOrSerious.length} critical/serious accessibility violation(s):\n${summary}`);
  }
}

// ---------------------------------------------------------------------------
// Static page accessibility
// ---------------------------------------------------------------------------

test.describe("accessibility: Arena landing", () => {
  test("no critical/serious violations on landing page", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expectNoViolations(
      new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .exclude("iframe") // exclude any embedded iframes
    );
  });
});

test.describe("accessibility: Rankings page", () => {
  test("no critical/serious violations on rankings", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "networkidle" });
    await page.waitForLoadState("domcontentloaded");
    await expectNoViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"])
    );
  });
});

test.describe("accessibility: Methodology page", () => {
  test("no critical/serious violations on methodology", async ({ page }) => {
    await page.goto("/methodology", { waitUntil: "networkidle" });
    await expectNoViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"])
    );
  });
});

// ---------------------------------------------------------------------------
// Draft screen accessibility
// ---------------------------------------------------------------------------

test.describe("accessibility: Draft screen (initial offer)", () => {
  test("no critical/serious violations on initial draft screen", async ({ page }) => {
    await page.goto("/arena/practice/apex_1y?seed=42", { waitUntil: "networkidle" });
    // Wait for draft to load
    await page.getByRole("heading", { name: /peak draft/i }).waitFor({ timeout: 15_000 });
    await expectNoViolations(
      new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .exclude("[aria-hidden=true]")
    );
  });
});

test.describe("accessibility: Role selector", () => {
  test("no critical/serious violations when role selector is open", async ({ page }) => {
    await page.goto("/arena/practice/apex_1y?seed=42", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /peak draft/i }).waitFor({ timeout: 15_000 });
    // Click first offer card to open role selector
    const cards = page.locator("button[aria-pressed]");
    await cards.first().waitFor({ state: "visible" });
    await cards.first().click();
    // Wait for role selector
    await page
      .getByRole("button")
      .filter({ hasText: /Lead Creator|Guard \/ Wing/ })
      .first()
      .waitFor({ state: "visible", timeout: 5_000 });
    await expectNoViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"])
    );
  });
});

test.describe("accessibility: Hold state", () => {
  test("no critical/serious violations when hold is in use", async ({ page }) => {
    await page.goto("/arena/practice/apex_1y?seed=10", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /peak draft/i }).waitFor({ timeout: 15_000 });
    const cards = page.locator("button[aria-pressed]");
    await cards.first().waitFor({ state: "visible" });
    await cards.first().click();
    const holdBtn = page.getByRole("button", { name: /hold/i });
    await holdBtn.click();
    await page.waitForTimeout(1000);
    await expectNoViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"])
    );
  });
});

test.describe("accessibility: Mobile navigation", () => {
  test("no critical/serious violations on mobile landing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "networkidle" });
    await expectNoViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"])
    );
  });

  test("no critical/serious violations on mobile rankings", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/rankings", { waitUntil: "networkidle" });
    await expectNoViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"])
    );
  });
});

test.describe("accessibility: Challenge page", () => {
  test("challenge error page has no critical violations", async ({ page }) => {
    await page.goto("/c/invalid-challenge-token-for-axe-test", { waitUntil: "networkidle" });
    await expectNoViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"])
    );
  });
});
