/**
 * Phase 10C: the main Play path leads into 82-0 PEAK Season, and nowhere else.
 *
 * Requires FastAPI (8000) and Next.js (3000) — both auto-start via
 * playwright.config.ts.
 *
 * THE BUG THESE COVER. The navbar "Play" link pointed at /arena, and /arena
 * rendered the 82-0 hero with the legacy "Peak Draft (Legacy / Labs)" section
 * — 1Y Apex / 3Y Prime / 5Y Foundation mode cards plus a Ranked closed-alpha
 * card — directly underneath it. So the two most prominent entry points in the
 * product (navbar Play, homepage CTA) both landed users on a page whose lower
 * half advertised the old 5-player draft as a co-equal option. The flagship was
 * never unambiguously *the* product.
 *
 * IMPORTANT SCOPE NOTE, asserted at the bottom of this file: this is about the
 * old 1Y/3Y/5Y *game modes*. The 1Y/3Y/5Y window selector on Rankings → Peak
 * Windows is a separate, actively-used analytics feature and must survive.
 *
 * THE SECOND BUG THESE COVER. Removing the cards was not enough. The 82-0
 * start gate still printed "1Y Apex" as a board-variant chip, so the single
 * most-visited screen in the product went on advertising a retired mode name
 * to every user arriving from "Play". Hence `assertNoLegacyModeLabels`.
 */
import { test, expect, Page } from "@playwright/test";

const LEGACY_MODE_LABELS = ["1Y Apex", "3Y Prime", "5Y Foundation"];

/** No legacy Peak Draft mode CARD, and no legacy mode LABEL, may appear on a
 *  main-product Play surface.
 *
 *  The label half of this is asserted separately below via
 *  `assertNoLegacyModeLabels`, and the two are kept apart on purpose: a card
 *  can be removed while its vocabulary survives elsewhere on the page, which
 *  is exactly what happened the first time round. The 82-0 start gate kept
 *  printing "1Y Apex" as a small board-variant chip after the cards were gone,
 *  because CourtBuilder had inherited `apex_1y`/`prime_3y`/`foundation_5y` as
 *  its own board-variant ids. Failing on the card affordances alone let that
 *  through. */
async function assertNoLegacyModeCards(page: Page): Promise<void> {
  await expect(
    page.getByRole("link", { name: /Daily Draft/i }),
    "no legacy Daily Draft entry point",
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /^Practice$/i }),
    "no legacy Practice entry point",
  ).toHaveCount(0);
  await expect(page.getByText("Peak Draft (Legacy", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Ranked (closed alpha)", { exact: false })).toHaveCount(0);
  await expect(
    page.getByText("Build a 5-player lineup", { exact: false }),
    "no legacy 5-player-draft pitch",
  ).toHaveCount(0);
  await assertNoLegacyModeLabels(page);
}

/** The retired 1Y/3Y/5Y game-mode names must not be rendered anywhere on a
 *  flagship surface — not as a card, not as a chip, not as metadata.
 *
 *  Scope note: this is about the mode NAMES as product vocabulary. The board
 *  ids behind them are untouched and still appear in URLs
 *  (`/arena/court/practice/apex_1y`), in the API, and in saved runs, so this
 *  deliberately checks rendered text only and never the URL. */
async function assertNoLegacyModeLabels(page: Page): Promise<void> {
  for (const label of LEGACY_MODE_LABELS) {
    await expect(
      page.getByText(label, { exact: false }),
      `retired mode name "${label}" must not be rendered on a flagship surface`,
    ).toHaveCount(0);
  }
}

test.describe("Navbar Play", () => {
  test("routes to the 82-0 start gate, not the legacy draft hub", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    const play = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Play" });
    await expect(play).toBeVisible();
    // The link itself must point at the flagship, not the hub.
    await expect(play).toHaveAttribute("href", "/arena/court/practice/apex_1y");

    await play.click();
    await expect(page).toHaveURL(/\/arena\/court\/practice\/apex_1y/);
    await expect(page.locator('[data-testid="peak-season-start-gate"]')).toBeVisible({
      timeout: 15_000,
    });
    await assertNoLegacyModeCards(page);
  });

  test("navigating via Play creates no game until Begin is pressed", async ({ page }) => {
    const created: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/perfect-season/games")) created.push(r.url());
    });

    await page.goto("/", { waitUntil: "load" });
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Play" })
      .click();
    await expect(page.locator('[data-testid="begin-run-btn"]')).toBeVisible({ timeout: 15_000 });

    // The decisive assertion: reaching the game from the navbar must not
    // consume a run. A run fixes its board and (for the daily) burns the day's
    // attempt, so it may only begin on a deliberate click.
    expect(created, "navigation alone must never create a run").toEqual([]);
    await expect(page.locator('[data-testid="court-builder"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="spin-stage"]')).toHaveCount(0);
  });

  test("Begin actually starts the 82-0 run", async ({ page }) => {
    await page.goto("/arena/court/practice/apex_1y", { waitUntil: "load" });
    const begin = page.locator('[data-testid="begin-run-btn"]');
    await expect(begin).toBeVisible({ timeout: 15_000 });
    await expect(begin).toContainText(/Begin 82-0 Run/i);

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/perfect-season/games") && r.request().method() === "POST",
      ),
      begin.click(),
    ]);
    await expect(page.locator('[data-testid="court-builder"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="peak-season-start-gate"]')).toHaveCount(0);
  });

  test("Play stays highlighted across the arena section", async ({ page }) => {
    // The link deep-links into the practice route, so a naive startsWith(href)
    // active check would stop highlighting on the daily route and run history.
    for (const path of ["/arena", "/arena/court/history", "/arena/court/daily/apex_1y"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const play = page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Play" });
      const classes = (await play.getAttribute("class")) ?? "";
      expect(classes, `Play should read as active on ${path}`).toContain("bg-[var(--bg-surface)]");
    }
  });
});

test.describe("82-0 start gate exposes no retired mode vocabulary", () => {
  test("the practice start gate shows no legacy mode name", async ({ page }) => {
    await page.goto("/arena/court/practice/apex_1y", { waitUntil: "load" });
    const gate = page.locator('[data-testid="peak-season-start-gate"]');
    await expect(gate).toBeVisible({ timeout: 15_000 });

    // The regression itself: the chip beside the "82-0 PEAK Season" badge.
    await assertNoLegacyModeLabels(page);

    // ...and the gate still identifies itself, so this can't be passed by
    // rendering nothing at all.
    await expect(gate).toContainText("82-0 PEAK Season");
    await expect(page.locator('[data-testid="begin-run-btn"]')).toContainText(/Begin 82-0 Run/i);
  });

  test("the daily start gate shows no legacy mode name", async ({ page }) => {
    await page.goto("/arena/court/daily/apex_1y", { waitUntil: "load" });
    await expect(page.locator('[data-testid="daily-challenge-header"]')).toBeVisible({
      timeout: 15_000,
    });
    await assertNoLegacyModeLabels(page);
    await expect(page.locator('[data-testid="begin-run-btn"]')).toContainText(/Begin Daily Run/i);
  });

  test("a non-standard board variant is named without legacy branding", async ({ page }) => {
    // `prime_3y` is still a routable board id (saved runs and shared links
    // predate the cleanup), so it has to render *something*. It must just not
    // render "3Y Prime". This is the case that would regress if someone
    // "fixed" the chip by special-casing apex_1y only.
    await page.goto("/arena/court/practice/prime_3y", { waitUntil: "load" });
    await expect(page.locator('[data-testid="peak-season-start-gate"]')).toBeVisible({
      timeout: 15_000,
    });
    await assertNoLegacyModeLabels(page);
  });
});

test.describe("Homepage CTA", () => {
  test("'Build Your Perfect Season' routes to the 82-0 start gate", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    const cta = page.locator('[data-testid="home-primary-cta"]');
    await expect(cta).toBeVisible();
    await expect(cta).toContainText(/Build Your Perfect Season/i);
    await expect(cta).toHaveAttribute("href", "/arena/court/practice/apex_1y");

    await cta.click();
    await expect(page).toHaveURL(/\/arena\/court\/practice\/apex_1y/);
    await expect(page.locator('[data-testid="peak-season-start-gate"]')).toBeVisible({
      timeout: 15_000,
    });
    await assertNoLegacyModeCards(page);
  });

  test("the homepage never links to the legacy labs route", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    await expect(page.locator('a[href="/arena/labs"]')).toHaveCount(0);
    await assertNoLegacyModeCards(page);
  });
});

test.describe("/arena hub", () => {
  test("promotes only 82-0 and shows no legacy draft modes", async ({ page }) => {
    await page.goto("/arena", { waitUntil: "load" });
    await expect(page.locator('[data-testid="courtbuilder-hero"]')).toBeVisible({ timeout: 15_000 });
    await assertNoLegacyModeCards(page);
  });

  test("its primary CTA reaches the start gate without starting a run", async ({ page }) => {
    await page.goto("/arena", { waitUntil: "load" });
    await page.getByRole("link", { name: /Build a Perfect Season/i }).click();
    await expect(page).toHaveURL(/\/arena\/court\/practice\/apex_1y/);
    await expect(page.locator('[data-testid="peak-season-start-gate"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="court-builder"]')).toHaveCount(0);
  });

  test("keeps the daily and run-history entry points", async ({ page }) => {
    await page.goto("/arena", { waitUntil: "load" });
    await expect(page.locator('[data-testid="daily-peak-season-cta"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="court-history-link"]')).toBeVisible();
  });
});

test.describe("Legacy Labs", () => {
  test("is reachable, clearly labeled, and offers a route back to the flagship", async ({ page }) => {
    // Kept reachable on purpose: the routes, state machine and ranked queues
    // behind these modes are all still live and still tested, so removing the
    // entry point without removing the system would have been the riskier half
    // of the change.
    await page.goto("/arena/labs", { waitUntil: "load" });
    await expect(page.locator('[data-testid="legacy-labs-page"]')).toBeVisible({ timeout: 15_000 });
    const banner = page.locator('[data-testid="legacy-labs-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/not part of the main PEAK3 experience/i);
    await expect(page.locator('[data-testid="labs-back-to-flagship"]')).toHaveAttribute(
      "href",
      "/arena/court/practice/apex_1y",
    );
    // The demoted modes DO still render here — this is their home now.
    for (const label of LEGACY_MODE_LABELS) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    }
  });

  test("is never linked from the navbar", async ({ page }) => {
    await page.goto("/arena/labs", { waitUntil: "load" });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.locator('a[href="/arena/labs"]')).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Play" })).toHaveAttribute(
      "href",
      "/arena/court/practice/apex_1y",
    );
  });
});

test.describe("Rankings 1Y/3Y/5Y is a separate feature and survives", () => {
  test("the Peak Windows duration selector still offers 1Y/3Y/5Y", async ({ page }) => {
    // Explicit guard against over-applying this cleanup. Removing the 1Y/3Y/5Y
    // GAME modes must not touch the 1Y/3Y/5Y analytics windows.
    await page.goto("/rankings", { waitUntil: "load" });
    for (const id of ["1y", "3y", "5y"]) {
      await expect(page.locator(`[data-testid="peak-window-tab-${id}"]`)).toBeVisible({
        timeout: 15_000,
      });
    }
    await page.locator('[data-testid="peak-window-tab-3y"]').click();
    await expect(page.locator('[data-testid="peak-window-tab-3y"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

test.describe("Phase 10C mobile", () => {
  // /arena and /arena/labs both changed shape this phase (the hub lost the
  // legacy section; labs is new), so both get an overflow guard rather than
  // relying on the pre-existing homepage-only check.
  for (const path of ["/arena", "/arena/labs", "/arena/court/practice/apex_1y"]) {
    test(`@mobile no horizontal overflow on ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path, { waitUntil: "load" });
      await page.waitForLoadState("networkidle");
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 4);
    });
  }
});
