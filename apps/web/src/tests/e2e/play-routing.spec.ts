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
 *
 * WHAT THE UX / ORGANIZATION / POLISH PASS CHANGED HERE, AND WHY.
 *
 * 1. "Play" is a BUTTON, not a link. It was a link to /arena, which meant the
 *    chrome represented eleven finished doors with one word and the only way to
 *    discover the others was to land on the hub and read it. It now opens a
 *    grouped launcher listing every mode. /arena did not lose its entry point —
 *    it is the launcher's last row, "View all games", and ArrowUp on the
 *    trigger opens the menu with focus already on it, so the hub stays exactly
 *    one keyboard interaction away. The assertions below moved from
 *    `getByRole("link", { name: "Play" })` to the button plus that row; what is
 *    being protected — "Play leads to the hub, and the hub's flagship is RUN
 *    THE TABLE" — is unchanged.
 *
 * 2. `home-primary-cta` was a BUTTON that opened an in-place launcher, rather
 *    than a link named "Start a Run" that led to a second screen also named
 *    "Start a run" — the redundant confirmation was gone from the main path.
 *    Launch-polish §6 went one step further: it is now a direct `<Link>`
 *    straight into a standard run (or, with a run already in progress,
 *    "Continue Run" straight into the bare route). There is no menu to open
 *    at all any more — "Start New Run" and the daily shared run are smaller
 *    secondary links beside it. The invariant the old second gate protected
 *    is unchanged either way: a bare visit to /arena/run-the-table still
 *    shows the gate and still creates no run, asserted separately below.
 */
import { test, expect, Page, Locator } from "@playwright/test";
import {
  RUN_THE_TABLE_SCHEMA_VERSION,
  RUN_THE_TABLE_STORAGE_KEY,
} from "@/types/run-the-table";

/** The navbar's Play trigger. A button since the UX pass — see the header. */
function playTrigger(page: Page): Locator {
  return page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Play" });
}

/** Opens the Play launcher and returns its panel. */
async function openPlayMenu(page: Page): Promise<Locator> {
  const trigger = playTrigger(page);
  await expect(trigger).toBeVisible();
  // `aria-expanded="false"` is SERVER-RENDERED, so it proves the HTML arrived
  // and nothing more -- it is already true before React has attached the
  // trigger's handler, and a click in that window is captured by React's root
  // listener and replayed later, leaving the menu shut. `data-nav-ready` is
  // set from an effect (see `nav.tsx`) and is the header's own "this control
  // is live" signal. Observed as a real failure in `arena-multiplayer.spec.ts`:
  // `aria-expanded` read "false" for a full 5s after a successful click.
  await expect(page.locator("header[data-nav-ready='true']")).toBeAttached();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByTestId("nav-play-panel");
  await expect(panel).toBeVisible();
  return panel;
}

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
  test("opens a launcher whose 'View all games' is the Arena hub", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    const panel = await openPlayMenu(page);

    // The hub, not a deep link into one mode's route.
    const viewAll = panel.getByRole("link", { name: /View all games/i });
    await expect(viewAll).toHaveAttribute("href", "/arena");

    // ...and the launcher does not hide what the hub used to be the only way
    // to find. The flagship is featured; the rest are listed, not buried.
    await expect(panel.locator('[data-nav-featured="true"]')).toHaveCount(1);
    await expect(panel.locator('[data-nav-item="run-the-table"]')).toHaveAttribute(
      "href",
      "/arena/run-the-table",
    );
    for (const [id, href] of [
      ["peak-season", "/arena/court/practice/apex_1y"],
      ["daily-grid", "/daily/grid"],
      ["peak-duel", "/play/daily"],
      ["peak-season-leaderboard", "/arena/court/leaderboard"],
      // /play/endless was linked from nothing at all before this pass.
      ["peak-duel-endless", "/play/endless"],
    ] as const) {
      await expect(panel.locator(`[data-nav-item="${id}"]`)).toHaveAttribute("href", href);
    }

    await viewAll.click();
    await expect(page).toHaveURL(/\/arena$/);
    const flagshipCard = page.locator('[data-testid="arena-flagship-card"]');
    await expect(flagshipCard).toBeVisible({ timeout: 15_000 });
    await expect(flagshipCard).toHaveAttribute("href", "/arena/run-the-table");
    await expect(flagshipCard).toContainText(/RUN THE TABLE/i);
    await assertSoleFeaturedCard(page, "arena-flagship-card");
    await assertNoLegacyModeCards(page);
  });

  test("the launcher is fully keyboard-operable, and ArrowUp lands on the hub", async ({
    page,
  }) => {
    // The one thing the old link gave for free was "one interaction reaches
    // /arena". A disclosure button that took three would have been a
    // regression, so ArrowUp opens the menu with focus on the last row.
    await page.goto("/", { waitUntil: "load" });
    const trigger = playTrigger(page);
    await trigger.focus();
    await page.keyboard.press("ArrowUp");

    const panel = page.getByTestId("nav-play-panel");
    await expect(panel).toBeVisible();
    const focusedHref = await page.evaluate(() =>
      document.activeElement?.getAttribute("href"),
    );
    expect(focusedHref, "ArrowUp focuses 'View all games'").toBe("/arena");

    // Escape closes and gives focus back to the control that opened it.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("reaching RUN THE TABLE from Play creates no run until it is started", async ({ page }) => {
    const created: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/run-the-table/runs")) created.push(r.url());
    });

    await page.goto("/", { waitUntil: "load" });
    const panel = await openPlayMenu(page);
    await panel.locator('[data-nav-item="run-the-table"]').click();
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
    // activePrefix must cover every arena route, not just the hub the trigger
    // leads to — the flagship run, the 82-0 daily route and run history all
    // belong to the same section. The class string is asserted literally
    // because it is the frozen active-state token (plan §3.1).
    for (const path of [
      "/arena",
      "/arena/run-the-table",
      "/arena/court/history",
      "/arena/court/daily/apex_1y",
      "/arena/ranked",
    ]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const play = playTrigger(page);
      const classes = (await play.getAttribute("class")) ?? "";
      expect(classes, `Play should read as active on ${path}`).toContain("bg-[var(--bg-surface)]");
      await expect(play).toHaveAttribute("aria-current", "page");
    }
  });

  test("Daily stays a top-level link and still owns /play/daily", async ({ page }) => {
    // Peak Duel Daily lives under /play for historical reasons while belonging
    // to Daily in the product's IA. Turning Play into a menu must not have
    // moved that highlight.
    await page.goto("/play/daily", { waitUntil: "domcontentloaded" });
    const daily = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Daily" });
    await expect(daily).toHaveAttribute("href", "/daily");
    await expect(daily).toHaveAttribute("aria-current", "page");
  });

  test("Rankings is one control away from anywhere, on desktop and on mobile", async ({ page }) => {
    // The complaint the mobile drawer was rebuilt to answer: reaching Rankings
    // must not mean scrolling past every game.
    await page.goto("/arena/run-the-table", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", {
        name: "Rankings",
      }),
    ).toHaveAttribute("href", "/rankings");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/arena/run-the-table", { waitUntil: "load" });

    // Opening the drawer is retried until it actually opens.
    //
    // The burger is server-rendered, so it is visible and clickable BEFORE React
    // has attached its handler. A single click therefore races hydration: the
    // click lands on the element, nothing toggles, and the drawer never mounts.
    // It passed in isolation and failed at position 198/300 — the shape of a
    // hydration race, not a product defect. `/arena/run-the-table` is one of the
    // heaviest routes in the app, which is why this test sees it and others do
    // not.
    //
    // The loop is toggle-SAFE: it re-reads `aria-expanded` each pass and clicks
    // only while still collapsed, so a late-registering first click cannot be
    // undone by a second one.
    const burger = page.getByTestId("mobile-nav-trigger");
    await expect(burger).toBeVisible();
    await expect(async () => {
      if ((await burger.getAttribute("aria-expanded")) === "false") await burger.click();
      await expect(burger).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    const drawer = page.getByTestId("mobile-nav-drawer");
    await expect(drawer).toBeVisible();
    const rankings = page.getByTestId("mobile-nav-rankings");
    await expect(rankings).toHaveAttribute("href", "/rankings");
    // Visible without scrolling the drawer.
    await expect(rankings).toBeInViewport();

    // AND ON A SHORT PHONE. The drawer used to scroll as a whole, so whether
    // Rankings cleared the fold was a function of how long the open Play
    // catalog happened to be -- which is how adding the Multiplayer group
    // pushed it off screen. Only the expanded section scrolls now, so the
    // property holds at 360x640 too, and the close control and the account row
    // stay reachable with it.
    await page.setViewportSize({ width: 360, height: 640 });
    await expect(rankings).toBeInViewport();
    await expect(page.getByTestId("mobile-nav-close")).toBeInViewport();
    await expect(page.getByTestId("mobile-nav-account")).toBeInViewport();
  });

  test("the open Play panel stays inside the viewport at every desktop width", async ({ page }) => {
    // Found by inspecting the 200%-zoom capture, and then again at 1440x900:
    // the panel was `left: 0`-anchored to a trigger that sits hard right, so a
    // 40rem panel started around x=948 and ran ~150px off the edge. Clamping the
    // panel's WIDTH never addressed it, because the overflow came from its
    // POSITION. Asserted geometrically rather than by class name so any future
    // anchoring change is judged on the only thing that matters.
    //
    // 720x450 is 1440x900 at 200% zoom, which the brief requires to stay usable.
    for (const [width, height] of [
      [1728, 1117],
      [1440, 900],
      [1024, 768],
      [768, 1024],
      [720, 450],
    ] as const) {
      await page.setViewportSize({ width, height });
      // `networkidle`, not `domcontentloaded` -- this test's subject is
      // geometry (see above), not hydration speed, and `domcontentloaded`
      // fires before React attaches the trigger's click handler. A click
      // that lands in that window is a real DOM click with no listener yet
      // and is silently lost -- not a layout bug, and not what this test is
      // for. Measured before making this change, not assumed: `next dev`
      // (what this suite runs against) takes 300-550ms after
      // `domcontentloaded` to attach; a real production build takes
      // 18-112ms, an order of magnitude less and well inside normal human
      // reaction time -- see PERFORMANCE.md's "Client hydration window
      // (P6-f/P6-h investigation)" for the full measurement. `networkidle`
      // is the fix on the test side, not a workaround for a product defect.
      await page.goto("/", { waitUntil: "networkidle" });
      const trigger = page.getByTestId("nav-play-trigger");
      await trigger.click();
      const panel = page.getByTestId("nav-play-panel");
      await expect(panel).toBeVisible();

      const box = (await panel.boundingBox())!;
      expect(box, `panel must have a box at ${width}x${height}`).not.toBeNull();
      expect(box.x, `panel left edge off-screen at ${width}px`).toBeGreaterThanOrEqual(-1);
      expect(
        box.x + box.width,
        `panel right edge past ${width}px viewport at ${width}x${height}`,
      ).toBeLessThanOrEqual(width + 1);

      // And the document itself must not have gained a horizontal scrollbar.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${width}x${height}`).toBeLessThanOrEqual(1);

      await page.keyboard.press("Escape");
    }
  });

  test("exactly one navigation affordance is visible at each width", async ({ page }) => {
    // Regression guard for a real defect found by inspecting a 1440x900
    // screenshot, which no test could have caught: `.pk-nav-burger` in
    // src/styles/nav.css declared `display: inline-flex` unlayered, and an
    // unlayered declaration beats a layered one regardless of source order --
    // so it silently defeated the `sm:hidden` utility on the same element and
    // the hamburger rendered beside the full desktop nav at every width.
    //
    // jsdom cannot see this: vitest never applies the CSS file. Only a real
    // browser can, which is why this assertion lives here and is written
    // against computed visibility rather than class names.
    const burger = page.getByTestId("mobile-nav-trigger");
    const desktopNav = page.getByRole("navigation", { name: "Main navigation" });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(desktopNav, "desktop nav is the affordance at 1440px").toBeVisible();
    await expect(burger, "the hamburger must not sit beside the desktop nav").toBeHidden();

    // 1024x768 and 768x1024 are two of the required review viewports; both are
    // above the 640px `sm` breakpoint, so both are desktop-nav territory.
    for (const width of [1024, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(desktopNav, `desktop nav visible at ${width}px`).toBeVisible();
      await expect(burger, `hamburger hidden at ${width}px`).toBeHidden();
    }

    // Below the breakpoint the pair swaps, and exactly one is still showing.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(burger, "hamburger is the affordance at 390px").toBeVisible();
    await expect(desktopNav, "desktop nav hidden at 390px").toBeHidden();
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
  test("the primary CTA is a direct link into a standard run, not a menu", async ({ page }) => {
    // WHAT CHANGED (launch-polish §6). The CTA was a link called "Start a
    // Run" that led to a screen whose own button was called "Start a run" —
    // the same words twice. An earlier pass turned it into a disclosure
    // button instead; this pass went further and removed the menu itself —
    // the primary click IS starting a run now, with no decision in between.
    await page.goto("/", { waitUntil: "load" });
    const cta = page.locator('[data-testid="home-primary-cta"]');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveJSProperty("tagName", "A");
    await expect(cta).toContainText(/Play Run the Table/i);
    await expect(cta).not.toHaveAttribute("aria-haspopup");
    // The explicit start intent is carried in the href itself. A run is
    // created because the user asked for one, not because they navigated.
    await expect(cta).toHaveAttribute("href", "/arena/run-the-table?start=standard");

    await cta.click();
    await expect(page).toHaveURL(/\/arena\/run-the-table/, { timeout: 15_000 });
    await assertNoLegacyModeCards(page);
  });

  test("a bare visit to RUN THE TABLE still creates no run", async ({ page }) => {
    // The invariant the old second gate existed to protect, asserted directly
    // instead of via the redundant screen. Deleting the confirmation step from
    // the main path must not delete this guarantee.
    const created: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/run-the-table/runs")) created.push(r.url());
    });

    await page.goto("/arena/run-the-table", { waitUntil: "load" });
    await expect(page.locator('[data-testid="rtt-start-gate"]')).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");
    expect(created, "arriving at the route must never create a run").toEqual([]);
  });

  test("with no stored run, the CTA offers neither Continue Run nor Start New Run", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    await page.evaluate(() => window.localStorage.clear());
    await page.reload({ waitUntil: "load" });
    const cta = page.locator('[data-testid="home-primary-cta"]');
    await expect(cta).toContainText(/Play Run the Table/i);
    await expect(cta).not.toContainText(/Continue Run/i);
    await expect(page.getByTestId("home-launcher-standard")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Resume/i })).toHaveCount(0);
  });

  test("with a run in progress, the CTA becomes Continue Run and Start New Run appears", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "load" });
    await page.evaluate(
      ({ key, schema }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            schema_version: schema,
            run_id: "e2e-play-routing-run",
            seed: 4242,
            run_type: "standard",
            updated_at: new Date().toISOString(),
          }),
        );
      },
      { key: RUN_THE_TABLE_STORAGE_KEY, schema: RUN_THE_TABLE_SCHEMA_VERSION },
    );
    await page.reload({ waitUntil: "load" });

    const cta = page.locator('[data-testid="home-primary-cta"]');
    await expect(cta).toContainText(/Continue Run/i);
    // The bare route: continuing must never create a second run.
    await expect(cta).toHaveAttribute("href", "/arena/run-the-table");

    const startNew = page.getByTestId("home-launcher-standard");
    await expect(startNew).toBeVisible();
    await expect(startNew).toHaveAttribute("href", "/arena/run-the-table?start=standard");
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

  test("the flagship's own run-history link is present, and the daily link is gone", async ({
    page,
  }) => {
    await page.goto("/arena", { waitUntil: "load" });
    await expect(page.locator('[data-testid="arena-rtt-runs-link"]')).toHaveAttribute(
      "href",
      "/arena/run-the-table",
    );
    // LP2-3: "Play today's shared run" was the third public entry point into
    // daily play with no visible value over Standard — see
    // `docs/implementation/launch-polish/RTT_DAILY_EVIDENCE.md`. The route
    // it pointed at is untouched; this hub just no longer advertises it.
    await expect(page.locator('[data-testid="arena-rtt-daily-link"]')).toHaveCount(0);
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

  test("is never linked from the navbar, not even from the Play launcher", async ({ page }) => {
    await page.goto("/arena/labs", { waitUntil: "load" });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.locator('a[href="/arena/labs"]')).toHaveCount(0);

    // The launcher lists every mode, which is exactly why it is the surface
    // most likely to re-admit the legacy modes by accident.
    const panel = await openPlayMenu(page);
    await expect(panel.locator('a[href^="/arena/labs"]')).toHaveCount(0);
    await expect(panel.getByRole("link", { name: /View all games/i })).toHaveAttribute(
      "href",
      "/arena",
    );
    // Scoped to the panel, not the page: /arena/labs is where those labels are
    // supposed to live, and the counter-invariant below depends on that.
    for (const label of LEGACY_MODE_LABELS) {
      await expect(panel.getByText(label, { exact: false })).toHaveCount(0);
    }
  });
});

test.describe("Rankings 1Y/3Y/5Y is a separate feature and survives", () => {
  test("the Peak Windows duration selector still offers 1Y/3Y/5Y", async ({ page }) => {
    // Explicit guard against over-applying this cleanup. Removing the 1Y/3Y/5Y
    // GAME modes must not touch the 1Y/3Y/5Y analytics windows.
    await page.goto("/rankings", { waitUntil: "load" });
    for (const id of ["1y", "2y", "3y", "5y"]) {
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

test.describe("mobile navigation drawer", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("@mobile opens as a modal sheet, traps focus, and returns it on Escape", async ({
    page,
  }) => {
    // The surface it replaced was an in-flow div that pushed the page down,
    // trapped nothing, and left the page behind it scrollable.
    await page.goto("/", { waitUntil: "load" });
    const trigger = page.getByTestId("mobile-nav-trigger");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();

    const drawer = page.getByTestId("mobile-nav-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    // Focus is inside the sheet, and Tab keeps it there.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const el = document.activeElement;
        const sheet = document.querySelector('[data-testid="mobile-nav-drawer"]');
        return Boolean(el && sheet && sheet.contains(el));
      });
      expect(inside, `focus stayed in the drawer after ${i + 1} tabs`).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("@mobile every game is reachable from the drawer's Play section", async ({ page }) => {
    await page.goto("/rankings", { waitUntil: "load" });
    await page.getByTestId("mobile-nav-trigger").click();
    // Collapsed by default off the arena section — that is what keeps Rankings
    // above the fold — so it is opened deliberately here.
    await page.getByTestId("mobile-nav-toggle-play").click();
    const drawer = page.getByTestId("mobile-nav-drawer");
    await expect(drawer.locator('[data-nav-item="run-the-table"]')).toHaveAttribute(
      "href",
      "/arena/run-the-table",
    );
    await expect(drawer.locator('[data-nav-item="view-all-games"]')).toHaveAttribute(
      "href",
      "/arena",
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
