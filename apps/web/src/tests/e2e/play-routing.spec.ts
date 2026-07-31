/**
 * The main Play path leads into RUN THE TABLE, the flagship mode — and every
 * finished mode stays reachable behind it.
 *
 * Requires FastAPI (8000) and Next.js (3000) — both auto-start via
 * playwright.config.ts.
 *
 * THE ORIGINAL BUG THESE COVER (Phase 10C). The navbar "Play" link pointed at
 * /arena, and /arena rendered the flagship hero with the legacy "Peak Draft
 * (Legacy / Labs)" section — 1Y Apex / 3Y Prime / 5Y Foundation mode cards plus
 * a Ranked closed-alpha card — directly underneath it. So the two most
 * prominent entry points in the product (navbar Play, homepage CTA) both landed
 * users on a page whose lower half advertised the old 5-player draft as a
 * co-equal option. The flagship was never unambiguously *the* product.
 *
 * WHAT CHANGED SINCE. The legacy modes moved to /arena/labs and stayed there,
 * so /arena is safe to land on again: "Play" points at the hub, and the hub is
 * an explicit hierarchy — one featured flagship card (RUN THE TABLE), then
 * full-season modes (82-0 PEAK Season), then the daily games. These tests now
 * assert that hierarchy, not just the absence of the legacy cards: the flagship
 * card must be the ONLY featured card on the page, or "featured" means nothing.
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

/** Exactly one card on a hub may carry the flagship treatment, and it must be
 *  the one named. A second gold card is the failure mode this guards. */
async function assertSoleFeaturedCard(page: Page, testId: string): Promise<void> {
  const featured = page.locator('[data-featured="true"]');
  await expect(featured, "exactly one featured card per hub").toHaveCount(1);
  await expect(page.locator(`[data-testid="${testId}"]`)).toHaveAttribute(
    "data-featured",
    "true",
  );
}

test.describe("Navbar Play", () => {
  test("routes to the Arena hub, whose flagship is RUN THE TABLE", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    const play = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Play" });
    await expect(play).toBeVisible();
    // The hub, not a deep link into one mode's route.
    await expect(play).toHaveAttribute("href", "/arena");

    await play.click();
    await expect(page).toHaveURL(/\/arena$/);
    const flagshipCard = page.locator('[data-testid="arena-flagship-card"]');
    await expect(flagshipCard).toBeVisible({ timeout: 15_000 });
    await expect(flagshipCard).toHaveAttribute("href", "/arena/run-the-table");
    await expect(flagshipCard).toContainText(/RUN THE TABLE/i);
    await assertSoleFeaturedCard(page, "arena-flagship-card");
    await assertNoLegacyModeCards(page);
  });

  test("reaching RUN THE TABLE from Play creates no run until it is started", async ({ page }) => {
    const created: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/run-the-table/runs")) created.push(r.url());
    });

    await page.goto("/", { waitUntil: "load" });
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Play" })
      .click();
    await page.locator('[data-testid="arena-flagship-card"]').click();
    await expect(page).toHaveURL(/\/arena\/run-the-table/, { timeout: 15_000 });
    // The route lands on an explicit start screen, exactly like 82-0's Begin
    // gate — arriving is not starting.
    await expect(page.locator('[data-testid="rtt-start-gate"]')).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");

    // The decisive assertion: reaching a mode from the navbar must never
    // consume a run. A run fixes its seed and (for the daily) burns the day's
    // attempt, so it may only begin on a deliberate click.
    expect(created, "navigation alone must never create a run").toEqual([]);
  });

  test("navigating to 82-0 creates no game until Begin is pressed", async ({ page }) => {
    // Same guarantee for the previous flagship, now reached one click deeper
    // via the Arena hub rather than straight off the navbar.
    const created: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/perfect-season/games")) created.push(r.url());
    });

    await page.goto("/arena", { waitUntil: "load" });
    await page.getByRole("link", { name: /Build a Perfect Season/i }).click();
    await expect(page.locator('[data-testid="begin-run-btn"]')).toBeVisible({ timeout: 15_000 });

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
    // activePrefix must cover every arena route, not just the hub the link
    // points at — the flagship run, the 82-0 daily route and run history all
    // belong to the same section.
    for (const path of [
      "/arena",
      "/arena/run-the-table",
      "/arena/court/history",
      "/arena/court/daily/apex_1y",
    ]) {
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

test.describe("Homepage", () => {
  test("'Start a Run' routes to RUN THE TABLE", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    const cta = page.locator('[data-testid="home-primary-cta"]');
    await expect(cta).toBeVisible();
    await expect(cta).toContainText(/Start a Run/i);
    await expect(cta).toHaveAttribute("href", "/arena/run-the-table");

    await cta.click();
    await expect(page).toHaveURL(/\/arena\/run-the-table/, { timeout: 15_000 });
    await expect(page.locator('[data-testid="rtt-start-gate"]')).toBeVisible({ timeout: 15_000 });
    await assertNoLegacyModeCards(page);
  });

  test("the hero leads with RUN THE TABLE and nothing else is featured", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    const h1 = page.locator("h1");
    await expect(h1, "exactly one h1 on the homepage").toHaveCount(1);
    await expect(h1).toContainText("Build a roster of peaks.");
    await expect(h1).toContainText("Run the table.");
    // The retired hero line must be gone, not merely pushed down the page.
    await expect(page.getByText("Chase 82-0", { exact: false })).toHaveCount(0);
    await assertSoleFeaturedCard(page, "home-flagship-card");
    await expect(page.locator('[data-testid="home-flagship-card"]')).toHaveAttribute(
      "href",
      "/arena/run-the-table",
    );
  });

  test("every finished mode is still linked from the homepage", async ({ page }) => {
    // Promoting the flagship must not hide the modes it outranks.
    await page.goto("/", { waitUntil: "load" });
    for (const [testId, href] of [
      ["home-peak-season-card", "/arena/court/practice/apex_1y"],
      ["home-daily-grid-card", "/daily/grid"],
      ["home-daily-duel-card", "/play/daily"],
      ["home-leaderboard-card", "/arena/court/leaderboard"],
    ] as const) {
      const card = page.locator(`[data-testid="${testId}"]`);
      await expect(card, `${testId} must still be on the homepage`).toBeVisible({
        timeout: 15_000,
      });
      await expect(card).toHaveAttribute("href", href);
    }
  });

  test("the homepage never links to the legacy labs route", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    await expect(page.locator('a[href="/arena/labs"]')).toHaveCount(0);
    await assertNoLegacyModeCards(page);
  });
});

test.describe("/arena hub", () => {
  test("promotes only RUN THE TABLE and shows no legacy draft modes", async ({ page }) => {
    await page.goto("/arena", { waitUntil: "load" });
    await expect(page.locator('[data-testid="arena-flagship-card"]')).toBeVisible({
      timeout: 15_000,
    });
    await assertSoleFeaturedCard(page, "arena-flagship-card");
    // 82-0 keeps its full block — demoted, never hidden. `assertSoleFeaturedCard`
    // above is what proves it is no longer the page's gold hero.
    await expect(page.locator('[data-testid="courtbuilder-hero"]')).toBeVisible();
    await assertNoLegacyModeCards(page);
  });

  test("nothing on the hub calls the flagship a prototype", async ({ page }) => {
    // "Flagship prototype" was the badge on the old hero. A flagship the
    // product routes every new player to is not a prototype, and saying so
    // undercuts the whole hierarchy this page exists to express.
    await page.goto("/arena", { waitUntil: "load" });
    await expect(page.locator('[data-testid="arena-flagship-card"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("prototype", { exact: false })).toHaveCount(0);
  });

  test("the flagship's own daily and run-history links are present", async ({ page }) => {
    await page.goto("/arena", { waitUntil: "load" });
    await expect(page.locator('[data-testid="arena-rtt-daily-link"]')).toHaveAttribute(
      "href",
      "/arena/run-the-table?mode=daily",
    );
    await expect(page.locator('[data-testid="arena-rtt-runs-link"]')).toHaveAttribute(
      "href",
      "/arena/run-the-table",
    );
  });

  test("the 82-0 CTA reaches the start gate without starting a run", async ({ page }) => {
    await page.goto("/arena", { waitUntil: "load" });
    await page.getByRole("link", { name: /Build a Perfect Season/i }).click();
    await expect(page).toHaveURL(/\/arena\/court\/practice\/apex_1y/);
    await expect(page.locator('[data-testid="peak-season-start-gate"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="court-builder"]')).toHaveCount(0);
  });

  test("keeps the 82-0 daily, run-history and leaderboard entry points", async ({ page }) => {
    await page.goto("/arena", { waitUntil: "load" });
    await expect(page.locator('[data-testid="daily-peak-season-cta"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="court-history-link"]')).toBeVisible();
    // The 82-0 leaderboard had no entry point on this hub at all before.
    await expect(page.locator('[data-testid="arena-leaderboard-link"]')).toHaveAttribute(
      "href",
      "/arena/court/leaderboard",
    );
  });

  test("still lists both daily games", async ({ page }) => {
    await page.goto("/arena", { waitUntil: "load" });
    await expect(page.locator('[data-testid="arena-daily-grid-card"]')).toHaveAttribute(
      "href",
      "/daily/grid",
    );
    await expect(page.locator('[data-testid="arena-daily-duel-card"]')).toHaveAttribute(
      "href",
      "/play/daily",
    );
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
    await expect(nav.getByRole("link", { name: "Play" })).toHaveAttribute("href", "/arena");
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

test.describe("mobile", () => {
  // Every surface whose shape changed gets an overflow guard: the hub was
  // rebuilt around the flagship card, and /arena/run-the-table is new.
  for (const path of [
    "/arena",
    "/arena/run-the-table",
    "/arena/labs",
    "/arena/court/practice/apex_1y",
  ]) {
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
