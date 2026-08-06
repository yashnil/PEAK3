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
  test("the homepage lists them under Multiplayer and links to the lobby", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const band = page.getByTestId("home-multiplayer-grid");
    await expect(band).toBeVisible();
    await expect(page.getByTestId("home-three_man_weave-card")).toBeVisible();
    await expect(page.getByTestId("home-twenty_dollar-card")).toBeVisible();
    await expect(page.getByTestId("home-multiplayer-lobby-link")).toHaveAttribute(
      "href",
      "/arena/lobby",
    );
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
      await expectNotAGeneric404(page);

      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("tmw-draft-order")).toBeVisible();
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
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("tmw-pick"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 20_000 });
      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 20_000 });

      // THE SPINNER IS AN EVENT, and it resolves to the server's own answer.
      // `data-final-value` carries that answer from the first frame, so this
      // asserts the reel cannot land anywhere else without racing it.
      const roll = page.getByTestId("tmw-roll");
      await expect(roll).toBeVisible({ timeout: 20_000 });
      const franchiseReel = page.getByTestId("tmw-roll-franchise");
      await expect(franchiseReel).toHaveAttribute("data-final-value", /.+/);

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

      await expect(roll).toHaveAttribute("data-revealed", "true", { timeout: 15_000 });

      // All three rosters are on screen, and no bot is a numbered placeholder.
      await expect(page.getByTestId("tmw-courts")).toBeVisible();
      for (const seat of [0, 1, 2]) {
        await expect(
          page.getByTestId(`tmw-seat-court-${seat}`).first(),
        ).toBeVisible();
      }
      await expect(page.getByTestId("tmw-room")).not.toContainText(/PEAK3 Bot \d/);

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
      // the roster; clicking one stages the player there; the primary button
      // names the whole decision. The previous flow was a `<select>` and a
      // button that read "Draft <name>" with the slot left implicit.
      const candidate = list.locator('button:not([disabled])').first();
      await candidate.click();

      const legalSlot = page
        .locator('[data-testid^="tmw-place-"][data-legal="true"]')
        .first();
      await expect(legalSlot).toBeVisible();
      // A legal destination is a REAL BUTTON, not a div that happens to have a
      // click handler -- so the keyboard and the accessibility tree agree with
      // what the eye sees.
      expect(await legalSlot.evaluate((node) => node.tagName)).toBe("BUTTON");
      await legalSlot.click();

      const confirm = page.getByTestId("tmw-confirm-pick");
      await expect(confirm).toContainText(/Draft .+ at /);
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

      await confirm.click();

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

  test("the draft room has no serious accessibility violations", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("tmw-a11y"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 20_000 });
      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("tmw-roll")).toHaveAttribute("data-revealed", "true", {
        timeout: 15_000,
      });
      await axeClean(page, "the Three-Man Weave draft room");
    } finally {
      await context.close();
    }
  });
});

test.describe("The $20 Showdown", () => {
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
      const api = "http://localhost:8000/api/v1/arena";
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

      // The itemised receipt is still there, one disclosure below.
      await page.getByTestId("td-result-detail-toggle").click();
      await expect(page.getByTestId("td-level-roster_total")).toBeVisible({ timeout: 20_000 });
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
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("tmw-mobile"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 20_000 });
      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 20_000 });

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
