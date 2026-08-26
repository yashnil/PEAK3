/**
 * The Arena's two multiplayer modes, end to end in a real browser.
 *
 * WHY THIS FILE EXISTS. Every defect this pass fixed was invisible to a unit
 * test and obvious in a browser within thirty seconds:
 *
 *   * Neither game appeared in the homepage catalog, the Play menu or `/arena`.
 *     The only way in was to type `/arena/lobby`.
 *   * Three-Man Weave matchmaking created a match and pushed
 *     `/arena/three-man-weave/<id>`, a route that did not exist. Every match
 *     landed on a Next.js 404.
 *   * The $20 Showdown's bot passed on every lot, so a human pass ended the
 *     auction.
 *
 * So the assertions here are deliberately about REACHING and PLAYING rather
 * than about rendering: navigate the way a person would, start a real match
 * against the real server, take real turns, and assert on the resulting board.
 *
 * REQUIRES the API with `PEAK3_ARENA_ENABLED` / `PEAK3_ARENA_BOTS_ENABLED`
 * (set by `scripts/ci/e2e-tests.sh` and by `npm run start:api`) and a signed
 * test JWT, because every Arena route resolves a seat from `auth.uid()`.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { mintTestAccessToken } from "./helpers/test-jwt";

const SERIOUS = ["serious", "critical"];

async function signInAs(context: BrowserContext, page: Page, sub: string): Promise<string> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // AuthProvider attaches window.__peak3TestAuth in a useEffect — wait for
  // hydration to actually complete before calling it, otherwise this is a
  // silent no-op (optional chaining swallows "not hydrated yet" as success).
  await page.waitForFunction(() => typeof window.__peak3TestAuth !== "undefined");
  const token = mintTestAccessToken(sub, `${sub}@e2e.test`);
  await page.evaluate(
    ([t, s]) => {
      window.__peak3TestAuth!.setSession(t as string, {
        id: s as string,
        email: `${s}@e2e.test`,
        isAnonymous: false,
      });
    },
    [token, sub],
  );
  return token;
}

function uniqueSub(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Fail loudly on the exact symptom that shipped: a framework 404. */
async function expectNotAGeneric404(page: Page): Promise<void> {
  await expect(page.locator("body")).not.toContainText("This page could not be found");
  await expect(page.locator("body")).not.toContainText("404");
}

/**
 * Dismiss Three-Man Weave's shared `GameIntro` briefing, if it's up.
 *
 * gameplay-experience-polish: the briefing now shows once per match
 * regardless of entry point (this file's own quick-practice button included
 * — see `ThreeManWeaveGame.tsx`'s docstring on why it moved there from the
 * lobby). It is a real focus-trapped dialog, so every test that navigates
 * straight into a match must dismiss it before the room underneath is
 * interactable at all — `count() > 0` rather than a bare `.click()` because
 * a slow-loading run could already have it dismissed (a fresh browser
 * context never has, but this keeps the helper honest either way) and
 * because "not present" must not read as a failure here.
 */
async function dismissTmwIntro(page: Page): Promise<void> {
  const start = page.getByTestId("game-intro-start");
  if ((await start.count()) > 0) {
    await start.click();
    await expect(page.getByTestId("tmw-game-intro")).toHaveCount(0);
  }
}

async function axeClean(page: Page, context: string): Promise<void> {
  // WAIT FOR MOTION TO SETTLE FIRST. Contrast is a property of the resting
  // state, and axe measures the COMPOSITED colour — so a card caught halfway
  // through its 400ms entry fade reports the fade's opacity as the text
  // colour and fails a palette that is in fact calibrated. (Observed:
  // `--text-muted` #838799 reported as #707382, 3.98:1 instead of 5.23:1.)
  // Asserting against the mid-animation frame would either force the fade out
  // of the product or bake a flake in.
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== "running"),
    undefined,
    { timeout: 5000 },
  ).catch(() => undefined);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((v) => SERIOUS.includes(v.impact ?? ""));
  // The SELECTORS are in the failure message, not just a count. A bare
  // "color-contrast ×12" costs a trace download and a manual hunt every time;
  // the target list points straight at the rule that has to change.
  expect(
    blocking.flatMap((v) =>
      v.nodes.map(
        (node) =>
          `${v.id} (${v.impact}) @ ${node.target.join(" ")} — ` +
          (node.failureSummary ?? "").split("\n").join(" ").slice(0, 200),
      ),
    ),
    `serious/critical axe violations on ${context}`,
  ).toEqual([]);
}

test.describe("both games are reachable through normal navigation", () => {
  test("the homepage lists them in the game slate and links to the lobby", async ({ page }) => {
    // V2's homepage lists every multiplayer mode as its own game-slate cell
    // (Pass 2, product-direction) rather than a separate "Multiplayer" band
    // with one shared generic lobby link — each cell links DIRECTLY into
    // the lobby with its game pre-selected (arena-readiness-server.ts:
    // `href: /arena/lobby?game=${meta.id}`), which is the real navigation
    // path this repository serves today.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const tmwCard = page.getByTestId("home-three_man_weave-card");
    const showdownCard = page.getByTestId("home-twenty_dollar-card");
    await expect(tmwCard).toBeVisible();
    await expect(showdownCard).toBeVisible();
    await expect(tmwCard).toHaveAttribute("href", /^\/arena\/lobby/);
    await expect(showdownCard).toHaveAttribute("href", /^\/arena\/lobby/);
  });

  test("the Arena catalog lists them", async ({ page }) => {
    await page.goto("/arena", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("arena-multiplayer-grid")).toBeVisible();
    await expect(page.getByTestId("arena-three_man_weave-card")).toBeVisible();
    await expect(page.getByTestId("arena-twenty_dollar-card")).toBeVisible();
  });

  test("the Play menu carries a Multiplayer group", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // The launcher is deliberately NOT `role="menu"` — every row is a
    // navigation link, and menu semantics would remove them from the links
    // rotor. See `PlayMenu.tsx`'s "WHY NOT role=menu".
    const trigger = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Play" });
    // GATE ON THE HEADER'S OWN READINESS, not on `aria-expanded`. That
    // attribute is SERVER-RENDERED as "false", so waiting for it proves only
    // that the HTML arrived -- it is true before React has attached the
    // trigger's handler, and a click in that window is captured by React's
    // root listener and replayed later, leaving the menu shut. Caught locally:
    // this assertion read "false" for the full 5s after a click that Playwright
    // reported as successful. `data-nav-ready` is set from an effect (see
    // `nav.tsx`), so it appears only once this header has hydrated.
    await expect(page.locator("header[data-nav-ready='true']")).toBeAttached();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByTestId("nav-play-panel");
    await expect(panel).toBeVisible();
    const group = panel.locator('[data-group="multiplayer"]');
    await expect(group).toBeVisible();
    await expect(group.getByRole("link", { name: /Three-Man Weave/i })).toBeVisible();
    await expect(group.getByRole("link", { name: /\$20 Showdown/i })).toBeVisible();
  });

  test("a homepage card reaches the lobby, which offers all three entry paths", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("home-twenty_dollar-card").click();
    await page.waitForURL(/\/arena\/lobby/);
    await expectNotAGeneric404(page);
    await expect(page.getByTestId("lobby-twenty_dollar-public_queue")).toBeVisible();
    // The entry path is still `private_room` in storage; the LABEL is what
    // changed, because "Private room" described the mechanism rather than the
    // reason anyone would use it.
    const withFriends = page.getByTestId("lobby-twenty_dollar-private_room");
    await expect(withFriends).toBeVisible();
    await expect(withFriends).toContainText("Play With Friends");
    await expect(page.getByTestId("lobby-mode-grid")).not.toContainText("Private room");
    await expect(page.getByTestId("lobby-twenty_dollar-practice")).toBeVisible();
  });
});

test.describe("the multiplayer lobby", () => {
  test("shows both games on one screen with facts and rules", async ({ page }) => {
    await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("lobby-mode-grid")).toBeVisible();
    const weave = page.getByTestId("lobby-mode-three_man_weave");
    await expect(weave).toContainText("Three-Man Weave");
    await expect(weave).toContainText("3 players");
    await expect(weave).toContainText("Closed alpha");
    await expect(page.getByTestId("lobby-rules-three_man_weave")).toBeVisible();
  });

  test("has no serious accessibility violations", async ({ page }) => {
    await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
    await page.getByTestId("lobby-mode-grid").waitFor();
    await axeClean(page, "the multiplayer lobby");
  });

  test("is operable by keyboard, including the How to Play disclosure", async ({ page }) => {
    await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
    const rules = page.getByTestId("lobby-rules-twenty_dollar");
    await rules.getByRole("group").or(rules.locator("summary")).first().focus();
    await page.keyboard.press("Enter");
    await expect(rules.locator("ol li").first()).toBeVisible();
  });
});

/**
 * CLOSED ALPHA, in a real browser: bots seat, the public queue does not.
 *
 * WHY THE READINESS RESPONSE IS REWRITTEN HERE RATHER THAN THE ENVIRONMENT.
 * `scripts/ci/e2e-tests.sh` starts ONE API for the whole suite, with
 * `PEAK3_ARENA_PUBLIC_QUEUE_ENABLED=true`, because most of these tests are
 * about matchmaking. Restarting it per describe-block to flip one flag would
 * make every other test in this file wait on it. So this block intercepts the
 * readiness response and closes the queue in it — which is exactly the input
 * the lobby derives its posture from, and the server-side half of the same
 * posture is covered deterministically in
 * `apps/api/tests/test_arena_local_practice.py`.
 *
 * THE DEFECT UNDER TEST. In this posture the page used to render one panel
 * reading "Multiplayer is not open yet", with both playable games behind it.
 */
test.describe("closed alpha — the queue is shut and both games are still playable", () => {
  async function closeTheQueue(page: import("@playwright/test").Page) {
    await page.route("**/api/v1/arena/readiness", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: { ...body, public_queue_enabled: false, bots_enabled: true },
      });
    });
  }

  test("offers both bot-practice modes instead of a wall", async ({ page }) => {
    await closeTheQueue(page);
    await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("lobby-mode-grid")).toBeVisible();

    await expect(page.getByTestId("lobby-disabled")).toHaveCount(0);
    await expect(page.getByTestId("lobby-no-modes")).toHaveCount(0);
    for (const id of ["three_man_weave", "twenty_dollar"]) {
      const play = page.getByTestId(`lobby-${id}-practice`);
      await expect(play).toBeVisible();
      await expect(play).toBeEnabled();
      await expect(play).toContainText(/play vs bots/i);
      await expect(page.getByTestId(`lobby-${id}-playable`)).toBeVisible();
    }
    await expect(page.getByTestId("arena-lobby")).toHaveAttribute(
      "data-posture",
      "practice_only",
    );
  });

  test("public matchmaking is unavailable, and said once rather than per card", async ({
    page,
  }) => {
    await closeTheQueue(page);
    await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("lobby-mode-grid")).toBeVisible();

    await expect(page.getByTestId("lobby-twenty_dollar-public_queue")).toHaveCount(0);
    await expect(page.getByTestId("lobby-three_man_weave-public_queue")).toHaveCount(0);
    const later = page.getByTestId("lobby-coming-later");
    await expect(later).toBeVisible();
    await expect(later).toContainText(/public matchmaking/i);
    await expect(later).toContainText(/ratings/i);
    await expect(later).toContainText(/arena leaderboard/i);

    const text = await page.getByTestId("arena-lobby").innerText();
    expect(text).not.toMatch(/Multiplayer is not open yet/i);
  });

  test("bot practice actually starts from the closed-alpha lobby", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("closed-alpha"));
      await closeTheQueue(page);
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-twenty_dollar-practice").click();
      await page.waitForURL(/\/arena\/twenty-dollar\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await expectNotAGeneric404(page);
    } finally {
      await context.close();
    }
  });

  test("has no serious accessibility violations", async ({ page }) => {
    await closeTheQueue(page);
    await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
    await page.getByTestId("lobby-mode-grid").waitFor();
    await axeClean(page, "the closed-alpha multiplayer lobby");
  });

  test("@mobile fits a phone without horizontal overflow", async ({ page }) => {
    await closeTheQueue(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
    await page.getByTestId("lobby-mode-grid").waitFor();
    await expect(page.getByTestId("lobby-twenty_dollar-practice")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the closed-alpha lobby overflows a 390px viewport").toBeLessThanOrEqual(1);
  });

  test("is operable by keyboard", async ({ page }) => {
    await closeTheQueue(page);
    await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
    const play = page.getByTestId("lobby-three_man_weave-practice");
    await play.focus();
    await expect(play).toBeFocused();
  });
});

test.describe("Three-Man Weave", () => {
  test("bot practice starts and renders the dynamic match route, not a 404", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("tmw"));

      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();

      // THE ROUTE THAT 404'D. The match id lands in the path, not a query.
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 20_000 });
      await dismissTmwIntro(page);
      await expectNotAGeneric404(page);

      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 20_000 });
      // ONE TURN-STATUS REGION (TMW-07/TMW-08). This used to assert the
      // eighteen-chip `tmw-draft-order` snake strip, which is deleted: the
      // A-B-C / C-B-A order is a published rule that never changes, so it
      // belongs in How to Play rather than on a live board. What a drafter
      // actually needs mid-turn is here.
      await expect(page.getByTestId("tmw-turnbar")).toBeVisible();
      await expect(page.getByTestId("tmw-turnbar-round")).toContainText(/Round \d of \d/);
      await expect(page.getByTestId("tmw-courts")).toBeVisible();
      // Three seats, and the bots are named without an implementation label.
      await expect(page.getByTestId("tmw-room")).not.toContainText("random_legal");
      await expect(page.getByTestId("tmw-room")).not.toContainText("_v1");

      // REFRESHING A MATCH URL MUST NOT 404 EITHER.
      const url = page.url();
      await page.reload({ waitUntil: "domcontentloaded" });
      await expectNotAGeneric404(page);
      expect(page.url()).toBe(url);
      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 20_000 });

      await axeClean(page, "an active Three-Man Weave draft");
    } finally {
      await context.close();
    }
  });

  test("an unknown match id shows a PEAK3 error state, never a white 404", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("tmw-404"));
      await page.goto("/arena/three-man-weave/00000000-0000-0000-0000-000000000000", {
        waitUntil: "domcontentloaded",
      });
      const error = page.getByTestId("tmw-match-error");
      await expect(error).toBeVisible({ timeout: 20_000 });
      await expect(error).toContainText(/could not find|belongs to someone else/i);
      await expect(error.getByRole("link", { name: /back to multiplayer/i })).toBeVisible();
      await axeClean(page, "the Three-Man Weave error state");
    } finally {
      await context.close();
    }
  });

  test("the spinner resolves, then the pick overlay opens on the human's turn", async ({
    browser,
  }) => {
    // WHY THIS ONE TEST NEEDS MORE THAN PLAYWRIGHT'S DEFAULT 30s. Its
    // critical path is INTENTIONAL product pacing, not slack: the opening
    // reveal ceremony is a real server turn (`OPENING_REVEAL_SECONDS`, 9.2s),
    // and the human's seat is drawn from the match seed so up to TWO bot
    // picks can precede the overlay, and after the human's own pick the test
    // deliberately waits for two MORE bot turns — and every bot pick takes a
    // seeded 4–10s think (BOT_THINK_SECONDS_MIN/MAX, enforced server-side
    // against the turn's opened_at) plus a poll for the move to land. Worst
    // case by design: 9.2 + 2x(10+2) + 2x(10+2) ≈ 57s of server-enforced
    // pacing alone, before ~15–20s of setup and live interactions (CI run
    // 31556826178 died at 30s with the spin resolved, pick 1 drafted and bot
    // 2 mid-deliberation — nothing wrong, just a budget written for the old
    // instant-bot timing). 90s = that 77s derived worst case plus CI margin;
    // the step-level waits below were already sized for this and are
    // unchanged.
    test.setTimeout(90_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("tmw-pick"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 20_000 });
      // EVERY MATCH NOW OPENS ON `PHASE_INTRO` (`apps/api/app/services/
      // three_man_weave/mode.py`), a real server turn nothing else can begin
      // until it ends. `dismissTmwIntro` sends the real `tmw_skip_intro`
      // command the moment `GameIntro` closes, which ends ONLY that phase --
      // the ceremony that follows (`PHASE_REVEAL`) is untouched by it and
      // plays its own full, undiminished course from that instant, exactly
      // what this test exists to observe: the reel's natural travel, its
      // `data-final-value`/`data-revealed` progression and the phase leaving
      // `reveal` on the SERVER'S OWN deadline, with nothing on this page
      // doing anything to it. Dismissed here, before the ceremony has even
      // had a chance to open, is therefore the CORRECT place for it now --
      // waiting to dismiss it would leave the match stuck in `PHASE_INTRO`
      // (its own backstop timeout is measured in minutes, not seconds; see
      // that constant's own docstring) rather than delaying anything real.
      await dismissTmwIntro(page);
      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 20_000 });

      // THE CEREMONY IS THE SERVER'S REVEAL PHASE.
      //
      // It used to be a client `setTimeout` the room had to keep out of the way
      // of a deadline the server had already started, and the first repair
      // simply refused to mount it on rounds the human led. Neither is true now:
      // the mode opens a turn in `phase="reveal"` that belongs to no seat and
      // accepts no command, and the room mounts the ceremony for exactly as long
      // as the server says that turn is open -- every round, every seat.
      //
      // ASSERTED AGAINST THE SERVER'S OWN PHASE, not against a timer: the room
      // publishes it as `data-turn-phase`. The reveal is a few seconds long and
      // the foundation's clock is swept lazily on reads, so a page that took
      // longer than the window to load and hydrate can legitimately arrive after
      // it -- hence the conditional. What is NOT conditional is the invariant:
      // while the phase is `reveal`, the pick panel is shut.
      const room = page.getByTestId("tmw-room");
      const roll = page.getByTestId("tmw-roll");
      const inlineRoll = page.getByTestId("tmw-overlay-roll");
      await expect(roll.or(inlineRoll).first()).toBeVisible({ timeout: 20_000 });

      const hasCeremony = (await roll.count()) > 0;
      if (hasCeremony) {
        // THE PICK PANEL MAY NOT OPEN OVER THE CEREMONY. This is the whole
        // regression, in one assertion, read off the server's own phase.
        await expect(room).toHaveAttribute("data-turn-phase", "reveal");
        expect(
          await page.getByTestId("tmw-pick-overlay").count(),
          "the pick panel opened while the server was still revealing the roll",
        ).toBe(0);
      }

      if (hasCeremony) {
        // THE SPINNER IS AN EVENT, and it resolves to the server's own answer.
        // `data-final-value` carries that answer from the first frame, so this
        // asserts the reel cannot land anywhere else without racing it.
        //
        // `[data-testid="tmw-roll"]` mounts immediately, but `WeaveSpinner`
        // holds its OWN internal matchup-card sub-stage (`data-stage="intro"`,
        // `tmw-ceremony-intro`/`tmw-intro` -- a different element from the
        // `GameIntro` PRE-MATCH BRIEFING dialog, already dismissed by this
        // point via `PHASE_INTRO`/`tmw_skip_intro`) for `INTRO_SHARE` (half)
        // of `TMW_OPENING_REVEAL_SECONDS` (9.2s -> ~4.6s) before `tmw-roll-
        // franchise` -- the reel itself -- ever attaches.
        const franchiseReel = page.getByTestId("tmw-roll-franchise");
        await expect(franchiseReel).toHaveAttribute("data-final-value", /.+/);
      }

      // IT ACTUALLY SPINS, and that is asserted rather than assumed. Manual
      // acceptance called this "effectively a static result banner": the reel
      // MECHANICS were right (a 52-row travel, an easing curve, a settle
      // overshoot) and the presentation gave none of it away -- no window, no
      // payline, and a type-weight jump at the landing that read as "a label
      // appeared" rather than "a wheel stopped".
      //
      // Two things prove motion here. A moving reel renders a STRIP of rows,
      // which a static banner has no reason to contain; and the strip's own
      // transform is not the identity while it travels.
      const strip = page.locator('[data-testid="tmw-roll-franchise"].spin-reel-strip');
      if ((await strip.count()) > 0) {
        await expect(strip).toHaveAttribute("data-stage", /armed|spinning|settling/);
        expect(
          await strip.locator(".spin-reel-row").count(),
          "the reel rendered no rows, so there is nothing to travel",
        ).toBeGreaterThan(10);
        const transform = await strip
          .locator(".spin-reel-track")
          .evaluate((node) => getComputedStyle(node).transform);
        expect(transform, "the reel strip is not translated").not.toBe("none");
      }

      if (hasCeremony) {
        await expect(roll).toHaveAttribute("data-revealed", "true", { timeout: 15_000 });
      }

      // AND THE HANDOFF IS THE SERVER'S TOO. The ceremony gives way to a pick
      // turn because the reveal's deadline passed and the mode opened one --
      // not because an animation finished. So the phase must leave `reveal` on
      // its own, with nothing on this page doing anything.
      await expect(room).not.toHaveAttribute("data-turn-phase", "reveal", {
        timeout: 60_000,
      });

      // All three rosters are on screen, and no bot is a numbered placeholder.
      await expect(page.getByTestId("tmw-courts")).toBeVisible();
      for (const seat of [0, 1, 2]) {
        await expect(
          page.getByTestId(`tmw-seat-court-${seat}`).first(),
        ).toBeVisible();
      }
      await expect(page.getByTestId("tmw-room")).not.toContainText(/\bBot\s+\d+\b/);

      // The human's seat is drawn from the match seed, so the first turn may
      // belong to a bot. Wait for the overlay rather than assuming seat A.
      const overlay = page.getByTestId("tmw-pick-overlay");
      await overlay.waitFor({ timeout: 45_000 });

      // NO SCORE BEFORE A PICK. Every candidate row carries a name, an
      // eligibility line, positions and a fit verdict -- and nothing that
      // could be read as a valuation.
      const list = page.getByTestId("tmw-candidate-list");
      await expect(list).toBeVisible();
      await expect(page.getByTestId("tmw-pool-count")).toContainText(/Showing \d+ of \d+/);

      // Search narrows the view, and clearing it restores the whole pool.
      const firstName = (
        await list.locator("button").first().locator(".tmw-candidate-name").innerText()
      ).trim();
      const before = await list.locator("button").count();
      await page.getByTestId("tmw-pick-search").fill(firstName.split(" ").pop() ?? firstName);
      await expect.poll(async () => list.locator("button").count()).toBeLessThanOrEqual(before);
      await page.getByTestId("tmw-pick-search").fill("");
      await expect.poll(async () => list.locator("button").count()).toBe(before);

      // DIRECT PLACEMENT. Selecting a candidate lights up its legal slots on
      // the roster; clicking one stages the player there. The previous flow
      // was a `<select>` and a button that read "Draft <name>" with the slot
      // left implicit.
      //
      // 3.2 (gameplay-experience-polish): a legal click now COMMITS
      // immediately instead of only staging -- a single-slot candidate
      // commits on this very click, a multi-slot one commits the instant its
      // slot is chosen below. Either way the overlay can close (the server
      // accepts the pick and hands the turn to the next seat) before this
      // test would reach a later assertion, so the structural "real button"
      // check happens HERE, right after staging and before any click that
      // might commit and close the overlay -- the one moment guaranteed safe
      // for every candidate shape.
      const candidate = list.locator('button:not([disabled])').first();
      await candidate.click();

      const confirm = page.getByTestId("tmw-confirm-pick");
      await expect(confirm).toBeVisible();
      // A REAL BUTTON, NOT TEXT. `btn-primary` was defined in no stylesheet, so
      // under Tailwind Preflight this control painted with no background, no
      // border and no padding.
      const styles = await confirm.evaluate((node) => {
        const computed = getComputedStyle(node);
        return {
          background: computed.backgroundColor,
          minHeight: parseFloat(computed.minHeight),
          padding: parseFloat(computed.paddingLeft),
        };
      });
      expect(styles.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(styles.minHeight).toBeGreaterThanOrEqual(40);
      expect(styles.padding).toBeGreaterThan(4);

      // If a slot still needs choosing (the multi-slot case; a single-slot
      // candidate already committed on the press above), choose one -- an
      // enabled legal slot means the pick has not committed yet.
      const legalSlot = page
        .locator('[data-testid^="tmw-place-"][data-legal="true"]')
        .first();
      if ((await legalSlot.count()) > 0 && !(await legalSlot.isDisabled())) {
        // A legal destination is a REAL BUTTON, not a div that happens to have
        // a click handler -- so the keyboard and the accessibility tree agree
        // with what the eye sees.
        expect(await legalSlot.evaluate((node) => node.tagName)).toBe("BUTTON");
        await legalSlot.click();
      }

      // No separate confirm press is made here on purpose -- the click(s)
      // above already committed the pick. The identity lock is the server's
      // own record of it landing.
      await expect(page.getByTestId("tmw-identity-lock")).toContainText(/\S/, {
        timeout: 20_000,
      });
      await expect
        .poll(
          async () =>
            (await page.getByTestId("tmw-identity-lock").locator("li").count()) >= 2,
          { timeout: 40_000, message: "the bots never took their turns" },
        )
        .toBe(true);

      // The drafted card now shows its franchise-specific season and score --
      // the reveal the pre-pick list withheld.
      await expect
        .poll(
          async () => {
            const cells = page.locator('[data-testid^="tmw-slot-season-"]');
            const count = await cells.count();
            for (let index = 0; index < count; index += 1) {
              const text = await cells.nth(index).innerText();
              if (/\d{4}-\d{2}/.test(text)) return true;
            }
            return false;
          },
          { timeout: 20_000, message: "no drafted card revealed its scoring season" },
        )
        .toBe(true);
    } finally {
      await context.close();
    }
  });

  /**
   * THE PICKER LAG REGRESSION (TMW-D3).
   *
   * THE REPORT. "The player list is open, I move over the player I want, the
   * hover stutters, I click repeatedly and nothing selects, the clock runs out
   * and the game drafts somebody I never chose." Named case: the drafter wanted
   * John Stockton and the timeout fallback gave them a different legal player.
   *
   * THE CAUSE, measured rather than guessed. The candidate row carried
   * `.pk-lift .pk-press` — `translateY(-2px)` on hover, `scale(0.985)` on press.
   * The element that moves was the element receiving the pointer, so on a 44px
   * row the hover state fed back into itself. With the pointer held COMPLETELY
   * STATIONARY 1px above a row's bottom edge, instrumentation counted
   * 29 `mouseenter` + 29 `mouseleave` in 1500ms — about 19 flips a second — and
   * a ~2px band at the top of every row where the row had already lifted out
   * from under the cursor. An oscillating row is also a row that can be under
   * the cursor at `mousedown` and gone at `mouseup`, and `click` only fires when
   * both land on the same element. After the fix the same measurement reads
   * 1 enter / 0 leave and 0px of displacement.
   *
   * WHAT THIS TEST GUARDS, and why it is shaped this way. Two properties, and
   * a count that is a requirement rather than a flourish:
   *
   *   1. PRECISION, 20/20. Twenty presses on twenty deliberately chosen rows,
   *      each asserting that the row that highlighted and the name on the
   *      commit button are the ones pressed. Run with the search box active,
   *      with a position filter active, and on the unfiltered list, because all
   *      three re-key the list and the original defect was reported while
   *      searching. One miss fails the test.
   *   2. NEAR-DEADLINE CORRECTNESS. Then it waits for the clock to run down,
   *      presses a SPECIFIC NAMED player in the final seconds, commits, and
   *      asserts THAT PLAYER — not a fallback, not nothing — is the one the
   *      server recorded as drafted.
   */
  test("presses a specific player 20/20 and drafts exactly that player in the final seconds", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("tmw-precision"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 20_000 });
      await dismissTmwIntro(page);

      const overlay = page.getByTestId("tmw-pick-overlay");
      await overlay.waitFor({ timeout: 60_000 });
      const list = page.getByTestId("tmw-candidate-list");
      const search = page.getByTestId("tmw-pick-search");
      const confirm = page.getByTestId("tmw-confirm-pick");

      /** One press, with a REAL POINTER, on a row chosen by index. */
      async function pressRow(index: number): Promise<{ name: string; ok: boolean }> {
        const row = list.locator("button:not([disabled])").nth(index);
        const name = (await row.locator(".tmw-candidate-name").innerText()).trim();
        // Raw pointer events do not scroll; `.click()` would. This has to be a
        // raw pointer sequence to reproduce the defect at all, so the scroll is
        // explicit. It also settles BEFORE the box is measured — measuring
        // first and pressing after is how a harness invents its own miss.
        await row.scrollIntoViewIfNeeded();
        await page.waitForTimeout(80);
        const box = (await row.boundingBox())!;
        // Approach, dwell, press, release — the human sequence. The dwell is
        // what made the old row oscillate; the release is what it dropped.
        await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.85);
        await page.waitForTimeout(60);
        await page.mouse.down();
        await page.waitForTimeout(50);
        await page.mouse.up();
        const ok = await row
          .and(page.locator('[data-selected="true"]'))
          .waitFor({ timeout: 2000 })
          .then(() => true)
          .catch(() => false);
        return { name, ok };
      }

      // ---- 0. THE ROOT CAUSE, AS A GEOMETRIC INVARIANT ---------------------
      // A row must not move when it is pointed at, and pointing at one must
      // not repeatedly flip in and out of hover while the pointer is still.
      // Before the fix this read 29/29 in the same 1500ms.
      //
      // DELEGATED ON THE LIST CONTAINER via `mouseover`/`mouseout`, not
      // `mouseenter`/`mouseleave` attached to the specific row's own DOM
      // node. Two independent problems with the direct-attach version, both
      // found by actually running this against a live server rather than
      // assumed:
      //
      //   1. THIS IS A REAL, SERVER-BACKED PRACTICE MATCH that polls and
      //      re-renders on its own clock. A poll landing inside the 1500ms
      //      window can legitimately replace the observed row's element
      //      (React still keys each row by `candidate.player_slug`, so this
      //      is not the list reordering under the pointer -- it is the same
      //      candidate, re-mounted by an unrelated data refresh). A listener
      //      attached directly to that one node goes silent the instant its
      //      node is replaced, which reads as "the mouseenter that should
      //      have happened never did" -- measured on CI as `enter: 0`, not
      //      the oscillation signature (a high, repeating count) and not a
      //      hover regression: the instrumentation was watching a node that
      //      no longer existed, not the pointer.
      //   2. `mouseenter`/`mouseleave` are dispatched PER ELEMENT, so a
      //      first attempt at delegating them via `{capture: true}` on the
      //      container over-counted: the row is a `<button>` wrapping a
      //      `.tmw-candidate-name` span, and capture-phase delegation sees
      //      BOTH the button's own enter/leave and the span's, as two
      //      separate events, for one real hover transition. `mouseover`/
      //      `mouseout` DO bubble and fire once per genuine boundary
      //      crossing; checking `relatedTarget` against the nearest
      //      `<button>` ancestor (rather than the bare presence of one)
      //      is what makes a move between the button and its own label NOT
      //      count as a leave+enter pair, which is what the geometric
      //      invariant actually means by "flip in and out of hover".
      {
        const row = list.locator("button:not([disabled])").first();
        await row.scrollIntoViewIfNeeded();
        const rest = (await row.boundingBox())!;
        await page.evaluate(() => {
          const w = window as unknown as Record<string, number>;
          w.__enter = 0;
          w.__leave = 0;
          const container = document.querySelector('[data-testid="tmw-candidate-list"]');
          const buttonOf = (n: EventTarget | null) =>
            n instanceof HTMLElement ? n.closest("button") : null;
          container?.addEventListener("mouseover", (e) => {
            const me = e as MouseEvent;
            const from = buttonOf(me.relatedTarget);
            const to = buttonOf(me.target);
            if (to && to !== from) w.__enter += 1;
          });
          container?.addEventListener("mouseout", (e) => {
            const me = e as MouseEvent;
            const from = buttonOf(me.target);
            const to = buttonOf(me.relatedTarget);
            if (from && to !== from) w.__leave += 1;
          });
        });
        // 1px inside the bottom edge: the exact band the lift used to swing
        // the row out of and back into.
        await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height - 1);
        await page.waitForTimeout(1500);
        const hovered = (await row.boundingBox())!;
        const flips = await page.evaluate(() => {
          const w = window as unknown as Record<string, number>;
          return { enter: w.__enter, leave: w.__leave };
        });
        expect(
          Math.abs(hovered.y - rest.y),
          "the candidate row moved under the pointer — a transform is back on it",
        ).toBeLessThan(0.5);
        // ONE LEGITIMATE SWAP is tolerated (a poll re-mounting the exact row
        // under a still pointer -- see above), but true oscillation is not:
        // the original bug's ~19 flips/second would still land far outside
        // either bound inside 1500ms.
        expect(
          flips.leave,
          "the row oscillated in and out of hover with the pointer held still",
        ).toBeLessThanOrEqual(1);
        expect(
          flips.enter,
          "the row oscillated in and out of hover with the pointer held still",
        ).toBeLessThanOrEqual(2);
      }

      // ---- 1. TWENTY PRESSES, TWENTY EXACT MATCHES --------------------------
      const misses: string[] = [];
      for (let attempt = 0; attempt < 20; attempt += 1) {
        // Rotate the list's shape so the stress covers the states the report
        // came from: a plain list, a live search, and a position filter.
        if (attempt === 7) await search.fill("a");
        if (attempt === 14) {
          await search.fill("");
          await page.getByTestId("tmw-filter-bench_1").click();
        }
        const available = await list.locator("button:not([disabled])").count();
        if (available === 0) continue;
        const { name, ok } = await pressRow(attempt % available);
        if (!ok) {
          misses.push(`attempt ${attempt}: pressing "${name}" staged nothing`);
          continue;
        }
        // THE NAME ON THE COMMIT BUTTON IS THE NAME PRESSED. Highlighting the
        // right row while staging a different player would be the same defect
        // wearing a disguise.
        const label = await confirm.innerText();
        if (!label.includes(name)) {
          misses.push(`attempt ${attempt}: pressed "${name}" but the button reads "${label}"`);
        }
      }
      expect(misses, `presses that did not land on the intended player:\n${misses.join("\n")}`)
        .toEqual([]);

      // ---- 2. THE FINAL SECONDS -------------------------------------------
      await page.getByTestId("tmw-filter-bench_1").click(); // clear the filter
      await search.fill("");

      // Run the clock down. The whole point is to act inside the window where
      // the old panel had already locked itself and the fallback was about to
      // be assigned.
      await expect
        .poll(
          async () =>
            Number(await page.getByTestId("tmw-overlay-clock-value").innerText()),
          { timeout: 60_000, intervals: [500], message: "the turn clock never ran down" },
        )
        .toBeLessThanOrEqual(6);

      const intended = await pressRow(0);
      expect(intended.ok, `"${intended.name}" did not stage in the final seconds`).toBe(true);

      // PASS 1: a legal candidate clicked before the deadline STAGES on the
      // click — a single legal slot stages that pair immediately, more than
      // one legal slot still needs its destination clicked to complete the
      // staged pair. Neither click commits: this test intentionally never
      // presses "confirm" and instead lets the clock run all the way out
      // (see below), so what actually proves the fix is that the SERVER's
      // timeout drafts this exact staged choice rather than the weaker
      // `autopick` fallback — see `mode._reduce_timeout` and
      // `PickOverlay`'s `select`/`selectPlacementSlot` docstrings.
      if (await confirm.isDisabled()) {
        await page.locator('[data-testid^="tmw-place-"][data-legal="true"]').first().click();
      }

      // ---- 3. THAT EXACT PLAYER, AND NOT A FALLBACK ------------------------
      // The identity lock is the server's own record of who came off the board.
      await expect(page.getByTestId("tmw-identity-lock")).toContainText(intended.name, {
        timeout: 20_000,
      });
      await expect(page.getByTestId("tmw-courts")).toContainText(intended.name);
    } finally {
      await context.close();
    }
  });

  /**
   * PASS 1: a STAGED (never drafted) candidate is what a timeout drafts.
   *
   * The original incident (gameplay-experience-polish 3.2): a player clicked
   * a legal candidate (Amar'e Stoudemire, on a 2000s Suns offer) WELL BEFORE
   * the deadline, never pressed a separate confirm action, and the timeout
   * fallback assigned a different, weaker legal player (Brevin Knight)
   * instead of honoring the click. 3.2's fix made the click itself commit;
   * Pass 1 reverses that (selection must never equal commit) but closes the
   * SAME incident a different way: staging is now server-visible, and a
   * timeout prefers a legal staged choice over `autopick`
   * (`mode._reduce_timeout`). This test reproduces the original report
   * end-to-end: click (and, if needed, stage a slot for) a legal candidate
   * with time to spare, touch NOTHING else — no confirm press either — let
   * the full clock (and the server's grace window) run out, and assert the
   * exact player clicked is who the server actually drafted — never a
   * fallback.
   */
  test("Pass 1: a candidate staged well before the deadline is what the timeout drafts, never the fallback", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("tmw-early-click"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 20_000 });
      await dismissTmwIntro(page);

      const overlay = page.getByTestId("tmw-pick-overlay");
      await overlay.waitFor({ timeout: 60_000 });
      const list = page.getByTestId("tmw-candidate-list");
      const confirm = page.getByTestId("tmw-confirm-pick");

      // Plenty of time left — this is deliberately NOT the near-deadline case
      // covered above.
      const secondsLeft = Number(await page.getByTestId("tmw-overlay-clock-value").innerText());
      expect(secondsLeft, "this test needs to start with real time on the clock").toBeGreaterThan(10);

      const row = list.locator("button:not([disabled])").first();
      const clicked = (await row.locator(".tmw-candidate-name").innerText()).trim();
      await row.click();
      await expect(row).toHaveAttribute("data-selected", "true");

      // A multi-slot candidate still needs its destination chosen — clicking
      // it only completes the staged pair, same as a single-slot press.
      // Beyond that, NOTHING is pressed: no "confirm", no second action. The
      // clock is left to run all the way out onto the staged choice.
      if (await confirm.isDisabled()) {
        await page.locator('[data-testid^="tmw-place-"][data-legal="true"]').first().click();
      }

      // Let the clock run all the way out, past the server's own grace
      // window too — the exact window in which the old code discarded a
      // clicked-but-unconfirmed player and substituted a fallback.
      await expect(page.getByTestId("tmw-identity-lock")).toContainText(clicked, {
        timeout: 90_000,
      });
      await expect(page.getByTestId("tmw-courts")).toContainText(clicked);
    } finally {
      await context.close();
    }
  });

  test("the draft room has no serious accessibility violations", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("tmw-a11y"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 20_000 });
      await dismissTmwIntro(page);
      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 20_000 });
      // WAIT FOR THE BOARD, NOT FOR THE CEREMONY. The round-opening ceremony is
      // the server's `reveal` turn and it is a few seconds long, so whether it
      // is still on screen when this assertion runs depends on how long the page
      // took to load -- not on anything this test controls. The turn-status
      // region is present in either phase, and the accessibility sweep below
      // covers whichever one is up. See `ThreeManWeaveGame`'s docstring.
      await expect(page.getByTestId("tmw-turnbar")).toBeVisible({ timeout: 15_000 });
      await axeClean(page, "the Three-Man Weave draft room");
    } finally {
      await context.close();
    }
  });
});

test.describe("The $20 Showdown", () => {
  /** Start a bot-practice auction and return once the first lot is live. */
  async function openAuction(context: BrowserContext, page: Page, tag: string) {
    await signInAs(context, page, uniqueSub(tag));
    await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
    await page.getByTestId("lobby-twenty_dollar-practice").click();
    await page.waitForURL(/\/arena\/twenty-dollar\/[0-9a-f-]{36}/, { timeout: 20_000 });
    await expect(page.getByTestId("td-game")).toBeVisible({ timeout: 20_000 });
  }

  test("the intro is a real server phase: readable, skippable, and it costs no clock", async ({
    browser,
  }) => {
    /*
     * C1. The competitive intro used to be a CLIENT beat while the server had
     * already stamped the first lot's 25-second deadline, so it was spending
     * the player's own decision time to explain the rules — and
     * `affordableBeat` truncated or skipped it whenever that would push the
     * remaining window below its floor, i.e. exactly when the player was
     * newest to the mode.
     *
     * It is a real turn now (`mode.PHASE_INTRO`), belonging to no seat and
     * accepting no bid, and the first auction turn opens with a FULL window
     * measured from the moment it ends.
     */
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openAuction(context, page, "td-intro");

      const room = page.getByTestId("td-game");
      await expect(page.getByTestId("td-intro")).toBeVisible();
      await expect(room).toHaveAttribute("data-phase", "intro");

      // NO DECISION CLOCK IS RUNNING. The controls are shut and the clock panel
      // is in its held state rather than counting anything down.
      await expect(page.getByTestId("td-bid-controls")).toHaveAttribute(
        "data-live",
        "false",
      );
      await expect(page.getByTestId("td-clock")).toHaveAttribute("data-mode", "held");

      // IT IS LONG ENOUGH TO READ. Still up a full 2.5s in — the old beat could
      // be cut to nothing.
      await page.waitForTimeout(2500);
      await expect(page.getByTestId("td-intro")).toBeVisible();

      // AND SKIPPABLE, which really ends the server's turn rather than hiding
      // an overlay over a board that still refuses every action.
      await page.getByTestId("td-intro-start").click();
      await expect(page.getByTestId("td-intro")).toHaveCount(0, { timeout: 10_000 });
      await expect(room).not.toHaveAttribute("data-phase", "intro");
      await expect(page.getByTestId("td-candidate")).toBeVisible({ timeout: 15_000 });

      // The first lot's window is genuinely full: the human's own countdown,
      // when it is their turn, starts at the top rather than part-spent.
      const controls = page.getByTestId("td-bid-controls");
      await expect(controls).toHaveAttribute("data-live", "true", { timeout: 40_000 });
      const seconds = Number(await page.getByTestId("td-timer-value").innerText());
      expect(
        seconds,
        "the first lot's clock was already part-spent when it opened",
      ).toBeGreaterThan(18);
    } finally {
      await context.close();
    }
  });

  test("the lot on the block never blinks out between lots", async ({ browser }) => {
    /*
     * C4. "During manual play, an active auction player appeared and then
     * visually disappeared during state transitions."
     *
     * IT WAS NOT A POLLING RACE. The server never publishes a null candidate
     * for a live match — `_resolve_lot` clears it and `_advance_lot` sets the
     * next one inside the SAME reducer call. It was the entry animation:
     * `AuctionStage` keys its card on `lot_index`, so a new lot REMOUNTS it,
     * and `.td-enter` plus the nested `.pk-reveal` blocks all animated
     * `opacity: 0 -> 1` with `fill-mode: both`. Instrumented across a full
     * auction, sampling every animation frame: 13 windows where the card was
     * live but invisible, one per lot, 24-47ms each above a 0.05 threshold and
     * the whole 400ms fade below it. After the fix: zero.
     *
     * The invariant: once a lot is on the block its player is painted in EVERY
     * frame until the next lot replaces them.
     */
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openAuction(context, page, "td-continuity");
      await page.getByTestId("td-intro-start").click().catch(() => undefined);
      await expect(page.getByTestId("td-candidate")).toBeVisible({ timeout: 20_000 });

      await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        w.__gaps = [] as unknown[];
        let gapStart: number | null = null;
        const sample = () => {
          const game = document.querySelector('[data-testid="td-game"]');
          const done = !!document.querySelector('[data-testid="td-result"]');
          const el = document.querySelector(
            '[data-testid="td-candidate"]',
          ) as HTMLElement | null;
          let visible = false;
          if (el) {
            const rect = el.getBoundingClientRect();
            visible =
              Number(getComputedStyle(el).opacity) > 0.05 &&
              rect.width > 0 &&
              rect.height > 0;
          }
          if (game && !done && !visible) {
            if (gapStart === null) gapStart = performance.now();
          } else if (gapStart !== null) {
            (w.__gaps as unknown[]).push(Math.round(performance.now() - gapStart));
            gapStart = null;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });

      // Play several lots as fast as the board offers an action, so the sampler
      // spans real lot transitions rather than one static board.
      const stopAt = Date.now() + 60_000;
      let lots = 0;
      while (Date.now() < stopAt && lots < 4) {
        if (await page.getByTestId("td-result").count()) break;
        const pass = page.getByTestId("td-pass");
        if (await pass.isEnabled({ timeout: 500 }).catch(() => false)) {
          await pass.click({ timeout: 2000 }).catch(() => undefined);
          lots += 1;
          continue;
        }
        await page.waitForTimeout(250);
      }
      expect(lots, "the auction never advanced, so nothing was measured").toBeGreaterThan(1);

      const gaps = await page.evaluate(
        () => (window as unknown as Record<string, number[]>).__gaps,
      );
      expect(
        gaps,
        `the lot card was invisible while a lot was live, for ${gaps.join("ms, ")}ms`,
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("forfeiting takes two deliberate actions, ends the match, and survives a reload", async ({
    browser,
  }) => {
    // C2. Without this the only way out is closing the tab, which leaves the
    // opponent watching a clock tick out and leaves a live match on the server
    // for the same player to be dropped back into.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openAuction(context, page, "td-forfeit");
      await page.getByTestId("td-intro-start").click().catch(() => undefined);
      await expect(page.getByTestId("td-candidate")).toBeVisible({ timeout: 20_000 });
      const url = page.url();

      // ONE CLICK DOES NOT CONCEDE. It only reveals the confirmation, and the
      // destructive choice is not the one that takes focus.
      await page.getByTestId("td-forfeit").click();
      await expect(page.getByTestId("td-forfeit-confirm")).toBeVisible();
      await expect(page.getByTestId("td-forfeit-cancel")).toBeFocused();
      await expect(page.getByTestId("td-result")).toHaveCount(0);

      // Escape backs out without conceding.
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("td-forfeit-confirm")).toHaveCount(0);
      await expect(page.getByTestId("td-candidate")).toBeVisible();

      await page.getByTestId("td-forfeit").click();
      await page.getByTestId("td-forfeit-confirm-button").click();

      // THE MATCH IS OVER, SERVER-SIDE.
      await expect(page.getByTestId("td-result")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("td-result-headline")).toContainText(/\S/);

      // AND IT CANNOT BE REVIVED BY A REFRESH: the status is what changed, so
      // every later read projects a settled match rather than a live board.
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("td-result")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("td-candidate")).toHaveCount(0);
      await expect(page.getByTestId("td-bid-controls")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("the opponent's clock counts DOWN, like the human's", async ({ browser }) => {
    // C3. It used to read "TIME ELAPSED 2s" and count up, because the API sent
    // `seconds_remaining` only to the seat holding the turn. A turn deadline is
    // not hidden information; the server publishes `turn_seconds_remaining` to
    // every seat now.
    test.setTimeout(120_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openAuction(context, page, "td-opponent-clock");
      await page.getByTestId("td-intro-start").click().catch(() => undefined);
      await expect(page.getByTestId("td-candidate")).toBeVisible({ timeout: 20_000 });

      // HAND THE TURN OVER. The opening bidder is drawn from the seed, so this
      // seat may or may not be on the clock first; passing when it is makes the
      // opponent's turn arrive without waiting out a 25-second timeout.
      const pass = page.getByTestId("td-pass");
      if (await pass.isEnabled({ timeout: 30_000 }).catch(() => false)) {
        await pass.click();
      }

      const clock = page.getByTestId("td-clock");
      await expect
        .poll(async () => clock.getAttribute("data-mode"), {
          timeout: 60_000,
          message: "the opponent never took a turn",
        })
        .toBe("elapsed");

      await expect(clock).toHaveAttribute("data-direction", "down");
      await expect(page.getByTestId("td-timer")).toContainText("Time remaining");
      // The value renders as "8s", so parse rather than coerce.
      const read = async () =>
        parseInt((await page.getByTestId("td-elapsed-value").innerText()).trim(), 10);
      const first = await read();
      await page.waitForTimeout(1200);
      const second = await read();
      expect(second, `the opponent clock went ${first} -> ${second}`).toBeLessThan(first);
    } finally {
      await context.close();
    }
  });

  test("bot practice reaches a live auction with precise bid controls", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("td"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-twenty_dollar-practice").click();

      await page.waitForURL(/\/arena\/twenty-dollar\/[0-9a-f-]{36}/, { timeout: 20_000 });
      await expectNotAGeneric404(page);
      await expect(page.getByTestId("td-game")).toBeVisible({ timeout: 20_000 });

      // The whole game on one screen.
      await expect(page.getByTestId("td-candidate")).toBeVisible();
      await expect(page.getByTestId("td-standing-bid")).toBeVisible();
      await expect(page.getByTestId("td-budget-0")).toBeVisible();
      await expect(page.getByTestId("td-budget-1")).toBeVisible();
      await expect(page.getByTestId("td-roster-0")).toBeVisible();
      await expect(page.getByTestId("td-bid-controls")).toBeVisible();

      // Whole-dollar controls, not a slider.
      expect(await page.locator('input[type="range"]').count()).toBe(0);
      await expect(page.getByTestId("td-bid-plus")).toBeVisible();
      await expect(page.getByTestId("td-bid-max")).toBeVisible();

      // THE SKIP ECONOMY IS ON SCREEN, for both seats, before it bites. A rule
      // you discover by finding a control greyed out has been taught badly.
      await expect(page.getByTestId("td-skips-0")).toContainText(/skips? left/);
      await expect(page.getByTestId("td-skips-1")).toContainText(/skips? left/);
      await expect(page.getByTestId("td-market-phase")).toHaveAttribute(
        "data-phase",
        "standard",
      );

      // The score is concealed while the lot is live.
      await expect(page.getByTestId("td-candidate")).toContainText(/sealed until/i);

      // No implementation labels anywhere on the board.
      await expect(page.getByTestId("td-game")).not.toContainText("random_legal");
      await expect(page.getByTestId("td-game")).not.toContainText("twenty_dollar_v");

      await axeClean(page, "an active $20 Showdown auction");
    } finally {
      await context.close();
    }
  });

  test("the human gets a usable window and a real bid resolves a lot", async ({
    browser,
  }) => {
    // THE SAME TRAP, FOUND BY AUDIT RATHER THAN BY LOSING ANOTHER CI CYCLE.
    // This test grants two inner waits of 30s each — `toBeEnabled` for the
    // human's window and the convergence poll after the bid — inside a 30s
    // whole-test budget, before the ~12.4s of cold setup CI measured on its
    // sibling. Sixty seconds of allowances cannot fit in thirty; it has been
    // passing only because both normally resolve in a second or two.
    //
    // Inside the test body, NOT at describe scope, where it would silently
    // re-budget every Showdown test including those whose 30s ceiling is right.
    test.setTimeout(80_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("td-bid"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-twenty_dollar-practice").click();
      await page.waitForURL(/\/arena\/twenty-dollar\/[0-9a-f-]{36}/, { timeout: 20_000 });
      await expect(page.getByTestId("td-game")).toBeVisible({ timeout: 20_000 });

      // Wait for the clock to be ours. The opening bidder is seed-drawn, so
      // it may be the bot's move first.
      const submit = page.getByTestId("td-submit-bid");
      await expect(submit).toBeEnabled({ timeout: 30_000 });

      // THE TIMER DEFECT: a turn must never arrive already expired. The
      // countdown is the server's, converted to a local monotonic deadline the
      // instant the response lands, and it lives in `ArenaTimer` -- which also
      // means a tick no longer rerenders the whole board.
      const clock = page.getByTestId("td-timer-value");
      await expect(clock).toBeVisible();
      const seconds = Number((await clock.innerText()).replace(/\D/g, ""));
      expect(seconds).toBeGreaterThan(5);

      // AND IT SAYS WHAT EXPIRY WILL COST, before it costs it. Four outcomes
      // with genuinely different consequences; a countdown that does not name
      // which is coming is a countdown a player cannot act on.
      await expect(page.getByTestId("td-timer-consequence")).toContainText(
        /market skip|automatic|concedes|for free/i,
      );

      await submit.click();

      // A lot resolves — either the bot answers and we keep bidding, or it
      // passes and the reveal appears. Both are progress; a stuck board is not.
      await expect
        .poll(
          async () =>
            (await page.getByTestId("td-lot-reveal").count()) > 0 ||
            (await page.getByTestId("td-lot-ticker").count()) > 0,
          { timeout: 30_000, message: "the auction never advanced after a bid" },
        )
        .toBe(true);
    } finally {
      await context.close();
    }
  });

  test("passing does not make the bot pass in sympathy", async ({ browser }) => {
    // WHERE THE CI RUN ACTUALLY DIED, AND WHY 30s WAS NEVER ENOUGH.
    //
    // The trace ends on an UNFINISHED `click` on `td-pass`, started at
    // t=12.38s and still waiting when the whole-test budget expired 17.6s
    // later. It never reached the invariant assertion below, so the bot was
    // neither proven nor disproven to have copied the human. The loop asks
    // `isEnabled()` and then clicks — two round-trips across a 2s poll — so
    // the board can legitimately flip to the bot's turn in between and disable
    // the control; the click then waits for it to come back, bounded only by
    // the test. That wait is CORRECT: it is how the human's twelve actions
    // reliably happen, which is what spends the bot's five
    // `MARKET_SKIPS_PER_SEAT` and forces it into a bid it must make.
    //
    // The budget is also arithmetically impossible on its own: the convergence
    // poll below is granted 25s, and CI measured 12.4s of cold navigation and
    // match creation before the loop begins. 25 + 12.4 exceeds 30 before a
    // single iteration runs.
    //
    // 150s is this test's own worst case: 12.4s of setup, twelve iterations
    // each of which may wait out a bot turn, and the 25s poll. Observed max
    // across 50 local runs was 59.6s, so the ceiling is for the tail.
    //
    // THE LOOP IS DELIBERATELY UNCHANGED. Four rewrites of it were tried and
    // measured, and every one made this test WORSE by letting an iteration
    // skip acting: a 2s bounded click failed 4/50, an 8s bound 1-2/50, and a
    // deadline form 25/50 — all with "the bot never spent a dollar", because
    // the human had stopped driving the auction the bot is forced by. The
    // unbounded wait is the thing that keeps the invariant observable.
    test.setTimeout(150_000);

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("td-pass"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-twenty_dollar-practice").click();
      await page.waitForURL(/\/arena\/twenty-dollar\/[0-9a-f-]{36}/, { timeout: 20_000 });
      await expect(page.getByTestId("td-game")).toBeVisible({ timeout: 20_000 });

      // Decline every lot the rules allow. Once the five market skips are
      // spent, passing on a candidate that fits is no longer legal and the
      // only move is to open at the minimum -- so the loop follows the rule
      // rather than clicking a disabled control. Either way the BOT must act
      // on its own read of the board.
      for (let i = 0; i < 12; i += 1) {
        const pass = page.getByTestId("td-pass");
        const bid = page.getByTestId("td-submit-bid");
        if (await pass.isEnabled().catch(() => false)) {
          await pass.click().catch(() => undefined);
        } else if (await bid.isEnabled().catch(() => false)) {
          await bid.click().catch(() => undefined);
        } else {
          await page.waitForTimeout(1200);
          continue;
        }
        await page.waitForTimeout(600);
        const botSpent = await page.getByTestId("td-budget-1").innerText();
        if (!botSpent.includes("$20")) break;
      }

      await expect
        .poll(async () => (await page.getByTestId("td-budget-1").innerText()).includes("$20"), {
          timeout: 25_000,
          message: "the bot never spent a dollar — it mirrored the human's pass",
        })
        .toBe(false);
    } finally {
      await context.close();
    }
  });

  test("the finished result state renders and is accessible", async ({ browser }) => {
    // A full auction is ten-plus lots, and every bot move waits out its
    // `BOT_THINK_SECONDS` of real time on purpose -- that delay is the product
    // behaviour, not test latency, so the budget is raised rather than the
    // delay lowered.
    test.setTimeout(150_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const token = await signInAs(context, page, uniqueSub("td-done"));
      const api = "http://localhost:8012/api/v1/arena";
      const auth = { Authorization: `Bearer ${token}` };

      // DRIVEN THROUGH THE API, NOT THE UI, on purpose. A full auction is ten
      // lots of alternating turns; clicking it out would take a minute of
      // real polling and would be flaky for reasons that have nothing to do
      // with the receipt. The rules, the turns and the bot are already
      // covered above and in `test_arena_practice_e2e.py`; what is being
      // tested HERE is the finished surface, so the match is fast-forwarded
      // against the same authenticated routes the UI uses.
      const created = await (
        await page.request.post(`${api}/matches/practice`, {
          headers: auth,
          data: { mode: "twenty_dollar" },
        })
      ).json();
      const matchId = created.match_id;
      const you = created.your_seat_index;
      let view = created;

      for (let step = 0; step < 900; step += 1) {
        if (view.public_state.phase === "complete") break;
        if (view.current_turn_seat_index !== you) {
          // Poll rather than spin: the bot only acts once its think delay has
          // elapsed against the STORED turn, so hammering changes nothing but
          // the request count.
          await page.waitForTimeout(250);
          view = await (
            await page.request.get(`${api}/matches/${matchId}`, { headers: auth })
          ).json();
          continue;
        }
        const priv = view.private_state;
        const bid = priv.minimum_bid <= priv.max_bid && view.legal_commands.includes("bid");
        const result = await (
          await page.request.post(`${api}/matches/${matchId}/commands`, {
            headers: auth,
            data: {
              command_type: bid ? "bid" : "pass",
              payload: bid ? { amount: priv.max_bid } : {},
              expected_state_version: view.state_version,
              idempotency_key: `e2e-done-${step.toString().padStart(4, "0")}`,
            },
          })
        ).json();
        view = result.match;
      }
      expect(view.public_state.phase, "the fast-forwarded match never completed").toBe(
        "complete",
      );

      await page.goto(`/arena/twenty-dollar/${matchId}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("td-game")).toBeVisible({ timeout: 20_000 });

      // THE RESULT REPLACES THE AUCTION. The auction board is gone, not frozen
      // above the receipt -- which is what made the winner the last thing on
      // the page.
      const result = page.getByTestId("td-result");
      await expect(result).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("td-table")).toHaveCount(0);
      await expect(page.getByTestId("td-bid-controls")).toHaveCount(0);

      // The winner, both totals and both rosters are in the FIRST viewport:
      // no downward scroll is needed to learn who won.
      await expect(page.getByTestId("td-result-headline")).toBeInViewport();
      await expect(page.getByTestId("td-result-total-0")).toBeVisible();
      await expect(page.getByTestId("td-result-total-1")).toBeVisible();
      await expect(page.getByTestId("td-result-money-0")).toContainText(/spent/);
      await expect(page.getByTestId("td-result-facts")).toBeVisible();
      await expect(page.getByTestId("td-play-again")).toBeVisible();
      await expect(page.getByTestId("td-back-to-arena")).toHaveAttribute("href", "/arena");

      // "One bid away" is retired: its arithmetic moved a card between rosters
      // and left one side with six players and the other with four.
      await expect(result).not.toContainText(/one bid away/i);

      // The itemised receipt is still there, one disclosure below. Settlement
      // is a real single-level ladder today (SETTLEMENT_ORDER carries exactly
      // one entry, "roster_total" — see receipt.py's own comment: "ONE LEVEL,
      // AND ONLY ONE"), and PeakV2ShowdownResult deliberately hides that
      // section whenever levels.length <= 1 — a one-level ladder repeats the
      // hero bar's own head-to-head numbers rather than saying anything new.
      // So "td-level-roster_total" never renders under real settlement rules;
      // the itemised disclosure this toggle actually reveals is the
      // slot-by-slot comparison (`td-positional-{slot}`).
      await page.getByTestId("td-result-detail-toggle").click();
      await expect(page.locator('[data-testid^="td-positional-"]').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("td-component-disclosure")).toBeVisible();

      await axeClean(page, "the finished $20 Showdown result");
    } finally {
      await context.close();
    }
  });

  test("a disabled bid explains itself rather than going quiet", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("td-why"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-twenty_dollar-practice").click();
      await page.waitForURL(/\/arena\/twenty-dollar\/[0-9a-f-]{36}/, { timeout: 20_000 });
      await expect(page.getByTestId("td-game")).toBeVisible({ timeout: 20_000 });

      // Either the control is live (and shows a hint) or it is blocked (and
      // shows a reason). What must never happen is neither.
      const explained =
        (await page.getByTestId("td-bid-hint").count()) > 0 ||
        (await page.getByTestId("td-bid-blocked").count()) > 0;
      expect(explained, "a bid control with neither a hint nor a reason").toBe(true);
    } finally {
      await context.close();
    }
  });
});

test.describe("@mobile multiplayer on a phone", () => {
  test("the lobby stacks without a horizontal scroll trap", async ({ page }) => {
    await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
    await page.getByTestId("lobby-mode-grid").waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the lobby scrolls horizontally on a phone").toBeLessThanOrEqual(1);
  });
});

test.describe("@mobile the draft board on a phone", () => {
  test("offers every roster as a tab rather than three crushed columns", async ({
    browser,
  }) => {
    // A round now opens on a server-timed ceremony before the board is
    // interactive, so this flow costs a few seconds more than the 30s default.
    test.setTimeout(90_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("tmw-mobile"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 20_000 });
      // Entering (dismissing) the briefing here is deliberate, not merely
      // clicking past a modal: `ThreeManWeaveGame.tsx`'s `dismissIntro` sends
      // the real `skip-reveal` server command the instant the dialog closes,
      // so this ALSO ends round one's ceremony -- exactly what a player who
      // has read the briefing and is ready to play would do. Before that
      // fix, dismissing the intro was a local-only state flip: the ceremony
      // kept running unseen behind it on its own server clock, and on a
      // slower CI runner the round-1 pick turn itself could open (and start
      // ticking down) before this test ever got a chance to interact with
      // anything, which is what the historical 90s-timeout failure was.
      await dismissTmwIntro(page);
      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 20_000 });

      // THE CEREMONY IS THE SERVER'S REVEAL PHASE, and by now it has already
      // been asked to end (see `dismissTmwIntro` above) -- this still reads
      // the server's own phase rather than assuming so, since a very fast
      // dismiss could still be mid-flight against a ceremony that had not
      // yet had a chance to open at all.
      await expect(page.getByTestId("tmw-room")).not.toHaveAttribute(
        "data-turn-phase",
        "reveal",
        { timeout: 30_000 },
      );

      // Three tabs, every roster one tap away, and the active one readable.
      for (const seat of [0, 1, 2]) {
        await expect(page.getByTestId(`tmw-roster-tab-${seat}`)).toBeVisible();
      }
      await page.getByTestId("tmw-roster-tab-2").click();
      await expect(page.getByTestId("tmw-seat-court-2").last()).toBeVisible();

      // And no horizontal scroll trap.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the draft room scrolls horizontally on a phone").toBeLessThanOrEqual(1);
    } finally {
      await context.close();
    }
  });
});
