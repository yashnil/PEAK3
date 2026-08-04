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
    // Wait for `aria-expanded` to exist before clicking: the trigger renders
    // server-side and only becomes interactive once the launcher hydrates, so
    // a click sent before then is swallowed. `play-routing.spec.ts` gates on
    // the same attribute for the same reason.
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
    await expect(page.getByTestId("lobby-twenty_dollar-private_room")).toBeVisible();
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

  test("a human pick is accepted and the bots take their turns", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAs(context, page, uniqueSub("tmw-pick"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 20_000 });
      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 20_000 });

      // Seat 0 opens the snake, so the first pick is ours. Picking is two
      // steps by design: choose the identity, then choose the slot, because a
      // multi-position player has a real choice to make.
      const candidate = page
        .getByTestId("tmw-candidates")
        .locator('button[data-blocked="false"]')
        .first();
      await candidate.waitFor({ timeout: 20_000 });
      await candidate.click();
      await page.getByTestId("tmw-slot-choices").waitFor({ timeout: 10_000 });
      await page.getByTestId("tmw-slot-choices").locator("button").first().click();

      // A pick that landed shows up in the shared identity-lock feed, and the
      // bots must move without waiting out a 45-second clock each.
      await expect(page.getByTestId("tmw-identity-lock")).toContainText(/\S/, {
        timeout: 20_000,
      });
      await expect
        .poll(
          async () =>
            (await page.getByTestId("tmw-identity-lock").locator("li").count()) >= 3,
          { timeout: 30_000, message: "the bots never took their turns" },
        )
        .toBe(true);
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
      // countdown is the server's, and it is close to a full window.
      const clock = page.getByTestId("td-turn-clock");
      await expect(clock).toBeVisible();
      const seconds = Number((await clock.innerText()).replace(/\D/g, ""));
      expect(seconds).toBeGreaterThan(5);

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

      // Pass on several lots. The bot must buy at least one of them.
      for (let i = 0; i < 8; i += 1) {
        const pass = page.getByTestId("td-pass");
        if (!(await pass.isEnabled().catch(() => false))) {
          await page.waitForTimeout(1200);
          continue;
        }
        await pass.click().catch(() => undefined);
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
      // The receipt, with its settlement and its five-of-six disclosure.
      await expect(page.getByTestId("td-level-roster_total")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("td-component-disclosure")).toBeVisible();
      // Both rosters are full and every bought player now shows their score.
      await expect(page.getByTestId("td-slot-0-C")).not.toContainText("Open");
      await expect(page.getByTestId("td-slot-1-C")).not.toContainText("Open");

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
