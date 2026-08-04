/**
 * Accessibility tests using axe-core.
 * Tagged with "accessibility" so they can be run in isolation: npm run test:e2e:accessibility
 *
 * Requires real FastAPI (port 8000) and Next.js (port 3000) services.
 * Uses @axe-core/playwright for WCAG 2.1 AA checks.
 */
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import {
  RUN_THE_TABLE_TOUR_ID,
  RUN_THE_TABLE_TOUR_VERSION,
} from "@/components/ui/tour-steps";
import { TOUR_STORAGE_KEY, TOUR_STORAGE_SCHEMA_VERSION } from "@/lib/tour-state";

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

test.describe("accessibility: Arena hub", () => {
  test("no critical/serious violations on the arena hub", async ({ page }) => {
    await page.goto("/arena", { waitUntil: "networkidle" });
    await expectNoViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("[aria-hidden=true]")
    );
  });
});

test.describe("accessibility: RUN THE TABLE", () => {
  // The flagship's first screen — the state every new player arriving from the
  // homepage CTA or the navbar sees before a run exists. Same thresholds as
  // every other surface; no exemption for being the newest mode.
  test("no critical/serious violations on the start state", async ({ page }) => {
    await page.goto("/arena/run-the-table", { waitUntil: "networkidle" });
    await page.locator('[data-testid="rtt-start-gate"]').waitFor({ timeout: 15_000 });
    await expectNoViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("[aria-hidden=true]")
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

test.describe("accessibility: CourtBuilder screen (Phase 5C)", () => {
  // Phase 9B: the run now begins on an explicit click, which adds a new
  // pre-game surface. Both the gate AND the board it leads to are scanned --
  // the gate is the first thing every new player sees, so it must be clean.
  test("no critical/serious violations on the Start gate", async ({ page }) => {
    await page.goto("/arena/court/practice/apex_1y?seed=42", { waitUntil: "networkidle" });
    await page.locator('[data-testid="peak-season-start-gate"]').waitFor({ timeout: 15_000 });
    await expectNoViolations(
      new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .exclude("[aria-hidden=true]")
    );
  });

  test("no critical/serious violations on initial CourtBuilder screen", async ({ page }) => {
    await page.goto("/arena/court/practice/apex_1y?seed=42", { waitUntil: "networkidle" });
    await page.locator('[data-testid="begin-run-btn"]').click();
    await page.locator('[data-testid="court-builder"]').waitFor({ timeout: 15_000 });
    await expectNoViolations(
      new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .exclude("[aria-hidden=true]")
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

// ---------------------------------------------------------------------------
// RUN THE TABLE — the restart confirmation dialog (rtt_ruleset_v4)
// ---------------------------------------------------------------------------
// A modal is the surface most likely to fail an audit and least likely to be
// caught by a page-level scan, because it does not exist until something is
// pressed. This drives the real product to the real dialog and runs axe on it
// with the dialog OPEN.
//
// The tour is suppressed the way `run-the-table.spec.ts` does it -- as a
// returning player's browser would have it -- because the first-run tour's
// full-screen scrim intercepts pointer events. That is a real, intended
// first-run experience with its own coverage; it is not what is under test here.
test.describe("accessibility: RUN THE TABLE restart dialog", () => {
  test("no critical/serious violations with the confirmation dialog open", async ({
    page,
  }) => {
    await page.goto("/arena/run-the-table", { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ({ key, schema, tourId, version }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            schema_version: schema,
            tours: {
              [tourId]: {
                version,
                status: "completed",
                at: "2026-01-01T00:00:00.000Z",
              },
            },
            coachmarks: {},
          }),
        );
      },
      {
        key: TOUR_STORAGE_KEY,
        schema: TOUR_STORAGE_SCHEMA_VERSION,
        tourId: RUN_THE_TABLE_TOUR_ID,
        version: RUN_THE_TABLE_TOUR_VERSION,
      },
    );

    await page.goto("/arena/run-the-table?start=standard", {
      waitUntil: "domcontentloaded",
    });
    const trigger = page.getByTestId("rtt-start-new-run");
    await trigger.waitFor({ timeout: 30000 });
    await trigger.click();
    await page.getByTestId("rtt-restart-dialog").waitFor({ timeout: 10000 });

    // The dialog's own contract, in a real browser rather than jsdom: it is a
    // named modal, and focus is inside it on the non-destructive choice.
    const named = await page
      .locator("[role=dialog][aria-modal=true]")
      .getAttribute("aria-label");
    expect(named).toBe("Start a new run?");
    await expect(page.getByTestId("rtt-restart-cancel")).toBeFocused();

    await expectNoViolations(
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("[aria-hidden=true]")
    );
  });
});
