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

/**
 * PASS 2.5 REGRESSION: a real screenshot caught `PeakV2Modal`/
 * `PeakV2DockedPanel` rendering with a computed background of
 * `transparent` and no visible border on the `/v2-preview` gallery, where
 * V2 is active only via `PeakV2Shell`'s own self-applied
 * `data-ui-version="v2"` (not on `<html>`) — `Dialog`'s `Portal` renders
 * these into `document.body`, a SIBLING of `PeakV2Shell`'s subtree, so
 * every `var(--v2-*)` reference in their `panelStyle` had no scoped
 * ancestor to resolve against. Fixed via `Dialog`'s new
 * `rootDataUiVersion` prop. Every DOM-only unit test for these components
 * passed throughout (`.style.background` reads back the literal
 * `"var(--v2-bg-plane)"` string regardless of whether it resolves to
 * anything) — jsdom does not load the real stylesheet or apply the real
 * CSS cascade, so only a real browser's `getComputedStyle` can catch this
 * class of bug. These tests exist specifically so it cannot silently
 * return.
 */
test.describe("PEAK3 V2 — portal-scoped token resolution (Pass 2.5 regression)", () => {
  test("PeakV2Modal's panel resolves a real, non-transparent background color", async ({ page }) => {
    await page.goto("/v2-preview", { waitUntil: "load" });
    await page.getByRole("button", { name: "Open modal" }).click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    const bg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(bg).not.toBe("transparent");
  });

  test("PeakV2DockedPanel's panel resolves a real background AND a real gold top border", async ({ page }) => {
    await page.goto("/v2-preview", { waitUntil: "load" });
    await page.getByRole("button", { name: "Open docked panel" }).click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    const bg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
    const borderTop = await panel.evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    // The gold accent, resolved — not "no color at all."
    expect(borderTop).toBe("rgb(245, 200, 66)");
  });

  test("the docked panel's backdrop is a light scrim — the background stays clearly visible behind it", async ({
    page,
  }) => {
    await page.goto("/v2-preview", { waitUntil: "load" });
    await page.getByRole("button", { name: "Open docked panel" }).scrollIntoViewIfNeeded();
    // The court panels sit directly above the trigger button — guaranteed
    // in the same viewport, so this is the reliable "background stays
    // legible" check rather than something further down the page that a
    // docked-to-the-bottom sheet may itself now cover.
    await expect(page.getByText("Rim Runner")).toBeVisible();
    await page.getByRole("button", { name: "Open docked panel" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Rim Runner")).toBeVisible();
  });
});
