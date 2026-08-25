/**
 * PEAK3 V2 UI-version switch (Pass 3, product-direction: V2-only cutover).
 *
 * V2 reached full parity with legacy across every real user-facing route
 * and game mode; every legacy JSX branch has since been deleted at its call
 * site. Verifies, in a real browser against the real homepage: V2 renders
 * by default with no query param at all, `?ui=legacy` is a no-op (V2 still
 * renders — there is no production path to legacy any more), the
 * `/v2-preview` gallery still renders independently, and nothing about
 * loading the homepage touches the backend beyond its ordinary read-only
 * data load.
 *
 * Requires FastAPI (8000) and Next.js (3000) — both auto-start via
 * playwright.config.ts, same as every other spec in this directory.
 */
import { test, expect } from "@playwright/test";

test.describe("PEAK3 V2 UI-version switch", () => {
  test("renders V2 by default with no query param at all", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-ui-version", "v2");
    await expect(page.locator('[data-testid="peak-v2-shell"]')).toBeVisible();
    // The old legacy hero heading no longer exists anywhere in the tree.
    await expect(page.locator("#hero-heading")).toHaveCount(0);
  });

  test("?ui=legacy is a no-op — V2 still renders, never a fallback to the deleted legacy tree", async ({ page }) => {
    await page.goto("/?ui=legacy", { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-ui-version", "v2");
    await expect(page.locator('[data-testid="peak-v2-shell"]')).toBeVisible();
  });

  test("a stale legacy preference from before the cutover cannot resurface — still resolves to v2", async ({ page }) => {
    // Simulates a returning visitor whose browser still has a pre-cutover
    // `peak3-ui-version: "legacy"` value in localStorage.
    await page.addInitScript(() => {
      window.localStorage.setItem("peak3-ui-version", "legacy");
    });
    await page.goto("/", { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("data-ui-version", "v2");
    await expect(page.locator('[data-testid="peak-v2-shell"]')).toBeVisible();
  });

  test("loading the homepage makes no additional network request beyond the page's own read-only data load", async ({
    page,
  }) => {
    const apiRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes(":8000/")) apiRequests.push(req.url());
    });
    await page.goto("/", { waitUntil: "load" });
    for (const url of apiRequests) {
      expect(url).not.toMatch(/\/(runs|matches|actions)\b/);
    }
  });

  test("the V2 primitive gallery renders independently", async ({ page }) => {
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
    await page.goto("/", { waitUntil: "load" });
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
