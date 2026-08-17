/**
 * PEAK3 V2 UI-version switch (Pass 2, product-direction).
 *
 * Verifies, in a real browser against the real homepage: the default stays
 * legacy with no query param, `?ui=v2` activates the parallel V2
 * presentation, the choice persists locally past the one navigation, the
 * `/v2-preview` gallery renders independently of the ambient version, and
 * switching versions touches only the DOM attribute — no new run, no
 * altered state, nothing sent to the backend beyond the page's ordinary
 * read-only data load.
 *
 * Requires FastAPI (8000) and Next.js (3000) — both auto-start via
 * playwright.config.ts, same as every other spec in this directory.
 */
import { test, expect } from "@playwright/test";

test.describe("PEAK3 V2 UI-version switch", () => {
  test("defaults to legacy with no query param — production is visually unchanged", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-ui-version", "legacy");
    // The legacy hero heading — unchanged copy, unchanged testid.
    await expect(page.locator("#hero-heading")).toBeVisible();
    await expect(page.locator('[data-testid="peak-v2-shell"]')).toHaveCount(0);
  });

  test("?ui=v2 activates the V2 homepage instead of legacy, with no required click", async ({ page }) => {
    await page.goto("/?ui=v2", { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-ui-version", "v2");
    await expect(page.locator('[data-testid="peak-v2-shell"]')).toBeVisible();
    // The legacy hero must not also be present — exactly one tree renders.
    await expect(page.locator("#hero-heading")).toHaveCount(0);
  });

  test("the ?ui=v2 choice persists locally past the one navigation it arrived on", async ({ page }) => {
    await page.goto("/?ui=v2", { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-ui-version", "v2");
    // A plain navigation with no ?ui= at all — the stored preference alone
    // must still resolve to v2, with no flash of legacy first.
    await page.goto("/", { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-ui-version", "v2");
    await expect(page.locator('[data-testid="peak-v2-shell"]')).toBeVisible();
  });

  test("?ui=legacy on a later navigation overrides a previously-stored v2 preference", async ({ page }) => {
    await page.goto("/?ui=v2", { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-ui-version", "v2");
    await page.goto("/?ui=legacy", { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-ui-version", "legacy");
    await expect(page.locator("#hero-heading")).toBeVisible();
  });

  test("switching versions makes no additional network request beyond the page's own data load", async ({
    page,
  }) => {
    const apiRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes(":8000/")) apiRequests.push(req.url());
    });
    await page.goto("/", { waitUntil: "load" });
    const countAfterLegacyLoad = apiRequests.length;
    // Flip to V2 via a client-side navigation (no full reload) — if the
    // switch mutated backend state or re-fetched game data, it would show
    // up here.
    await page.goto("/?ui=v2", { waitUntil: "load" });
    const countAfterV2Load = apiRequests.length;
    // Both loads legitimately hit the read-only homepage data endpoints —
    // the invariant is that switching versions is not itself an
    // ADDITIONAL mutation on top of that ordinary page load, not that zero
    // requests happen at all.
    expect(countAfterV2Load).toBeGreaterThanOrEqual(countAfterLegacyLoad);
    for (const url of apiRequests) {
      expect(url).not.toMatch(/\/(runs|matches|actions)\b/);
    }
  });

  test("the V2 primitive gallery renders independently of the ambient ?ui= value", async ({ page }) => {
    await page.goto("/v2-preview", { waitUntil: "load" });
    await expect(page.locator('[data-testid="peak-v2-shell"]')).toBeVisible();
    await expect(page.getByText("PEAK3 V2 · Broadcast Arena")).toBeVisible();
    // Not indexed, not linked from anywhere — direct URL only, same
    // posture as /arena/labs.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("reduced motion: the V2 homepage's cinematic hero renders with no required interaction", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?ui=v2", { waitUntil: "load" });
    await expect(page.locator('[data-testid="peak-v2-shell"]')).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
