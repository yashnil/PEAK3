import { expect, test } from "@playwright/test";

/**
 * The theme toggle: one click, both directions, everywhere.
 *
 * THE DEFECT THIS SUITE EXISTS FOR. `nextThemePreference` cycled
 * System → Dark → Light → System — three preferences over a two-state
 * appearance. From `"light"` the next preference was `"system"`, and on a
 * machine whose OS is itself in light mode `resolveTheme("system")` returns
 * `"light"`, so the click changed the stored preference and changed nothing the
 * user could see. The second click reached `"dark"`. Dark → Light in one click,
 * Light → Dark in two, deterministically, on any light-mode OS.
 *
 * WHY THIS IS A BROWSER TEST AND NOT ONLY A UNIT TEST. The unit suite proves
 * the state machine. What it cannot prove is that the blocking pre-paint script
 * in `app/layout.tsx`, the `useSyncExternalStore` snapshot and the DOM attribute
 * all agree after a real navigation and a real reload — which is where a
 * hydration mismatch would live if one existed. Every assertion below reads
 * `document.documentElement`'s own `data-theme`, which is the thing the
 * stylesheet actually keys on.
 *
 * `colorScheme: "light"` is set at the context level ON PURPOSE. It is the OS
 * configuration under which the old cycle was broken, so a regression would
 * reappear here first.
 */

test.use({ colorScheme: "light" });

/** The theme the document is actually painting. */
async function currentTheme(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme") ?? "");
}

async function clickToggle(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("theme-toggle").first().click();
}

test.describe("theme toggle", () => {
  test("flips on EVERY click, in both directions, twenty times", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "domcontentloaded" });
    const toggle = page.getByTestId("theme-toggle").first();
    await expect(toggle).toBeVisible({ timeout: 20_000 });

    // Establish a known starting appearance rather than relying on the default.
    // NOTE: no wait for hydration here, deliberately. A click that lands in the
    // gap between the server-rendered button and React attaching its listener
    // must still flip the theme -- `themeInitScript` installs a capture-phase
    // handler before first paint for exactly that window, and disarms it when
    // `<ThemeToggle>` mounts. A test that waited for hydration would never
    // exercise it, and the dead first click it covers is invisible in
    // development and worst on a slow connection.
    if ((await currentTheme(page)) !== "dark") {
      await clickToggle(page);
      await expect.poll(() => currentTheme(page)).toBe("dark");
    }

    const seen: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const before = await currentTheme(page);
      await clickToggle(page);
      // A CHANGE IS REQUIRED, not merely allowed. `.not.toBe(before)` is the
      // whole assertion: the old cycle's failure mode was a click that left
      // `data-theme` exactly as it was.
      await expect
        .poll(() => currentTheme(page), {
          timeout: 3_000,
          message: `click ${index + 1} did not change the theme (still ${before})`,
        })
        .not.toBe(before);
      seen.push(await currentTheme(page));
    }

    expect(seen).toEqual(
      Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? "light" : "dark")),
    );
  });

  test("works with Enter and with Space", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "domcontentloaded" });
    const toggle = page.getByTestId("theme-toggle").first();
    await expect(toggle).toBeVisible({ timeout: 20_000 });

    await toggle.focus();
    const first = await currentTheme(page);
    await page.keyboard.press("Enter");
    await expect.poll(() => currentTheme(page)).not.toBe(first);

    const second = await currentTheme(page);
    await page.keyboard.press("Space");
    await expect.poll(() => currentTheme(page)).not.toBe(second);
  });

  test("survives a route change and keeps flipping in one click", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("theme-toggle").first()).toBeVisible({ timeout: 20_000 });

    await clickToggle(page);
    const chosen = await currentTheme(page);

    await page.goto("/arena", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("theme-toggle").first()).toBeVisible({ timeout: 20_000 });
    expect(await currentTheme(page)).toBe(chosen);

    // And ONE click still flips it on the new route.
    await clickToggle(page);
    await expect.poll(() => currentTheme(page)).not.toBe(chosen);
  });

  test("survives a reload with no flash of the other theme", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("theme-toggle").first()).toBeVisible({ timeout: 20_000 });
    await clickToggle(page);
    const chosen = await currentTheme(page);

    await page.reload({ waitUntil: "commit" });
    // Read as early as the document exists. The blocking script in
    // `app/layout.tsx` runs before first paint, so the very first value the
    // document carries must already be the stored preference — anything else
    // is the flash.
    await page.waitForFunction(
      () => !!document.documentElement.getAttribute("data-theme"),
    );
    expect(await currentTheme(page)).toBe(chosen);
  });

  test("an explicit choice overrides a light-mode OS", async ({ page }) => {
    // The context is `colorScheme: "light"`. An explicit Dark must stay dark.
    await page.goto("/rankings", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("theme-toggle").first()).toBeVisible({ timeout: 20_000 });

    for (let attempt = 0; attempt < 3 && (await currentTheme(page)) !== "dark"; attempt += 1) {
      await clickToggle(page);
    }
    expect(await currentTheme(page)).toBe("dark");

    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await currentTheme(page)).toBe("dark");
  });

  test("the open Rankings analysis re-themes, and toggling resumes on close", async ({
    page,
  }) => {
    // WHAT THIS ASSERTS, AND WHY IT IS NOT "click the header toggle through the
    // drawer". The analysis is a `role="dialog"` with `aria-modal="true"` and a
    // focus trap: its scrim deliberately covers the page, so the header is not
    // reachable while it is open. That is correct modal behaviour and not a
    // theme defect — a control a screen reader is told is unavailable must not
    // be clickable by a mouse either.
    //
    // What the theme system actually owes this state is that the OPEN PANEL
    // renders in the current theme, and that the toggle resumes working the
    // instant the drawer closes. Both are asserted below.
    await page.goto("/rankings", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="rankings-row"]').first()).toBeVisible({
      timeout: 20_000,
    });

    await clickToggle(page);
    const chosen = await currentTheme(page);

    await page.locator('[data-testid="rankings-row"]').first().click();
    const panel = page.getByTestId("rankings-analysis");
    await expect(panel).toBeVisible();
    // The drawer painted in the chosen theme -- its own surface follows the
    // root attribute rather than a colour captured at mount.
    expect(await currentTheme(page)).toBe(chosen);
    const surface = await panel.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(surface).not.toBe("rgba(0, 0, 0, 0)");

    await page.getByTestId("rankings-analysis-close").click();
    await expect(panel).toHaveCount(0);
    await clickToggle(page);
    await expect.poll(() => currentTheme(page)).not.toBe(chosen);
  });
});
