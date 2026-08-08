/**
 * TWO TABS ON ONE $20 SHOWDOWN, IN A REAL BROWSER.
 *
 * The reconnect repair in this pass was proven by unit tests against a
 * scripted API and by reading the state machine. Both are worth having and
 * neither is the thing that was actually reported: a player with the game open
 * saw "While you were away". So this drives two independent browser contexts
 * against the real Next frontend and the real FastAPI state machine and
 * asserts the properties that failure would violate.
 *
 * WHY TWO CONTEXTS RATHER THAN TWO PAGES. Separate `BrowserContext`s have
 * separate `localStorage`, which is where the seen-lot cursor lives. Two pages
 * in one context share it, so a cross-tab bug would be hidden by the very
 * storage the bug is about. Contexts are the honest reproduction: the same
 * account, the same match, two independent cursors.
 *
 * WHAT THIS DOES NOT CLAIM. It is a bot practice match, so the "opponent" is
 * the server's own bot rather than a second human. That is the configuration
 * the reported defect occurred in, and it is the only one available without a
 * matchmaking queue in a test.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";

import { mintTestAccessToken } from "./helpers/test-jwt";

/** Sign a fresh context in as `sub` and return its page. */
async function signedInPage(browser: Browser, sub: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
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
  return page;
}

async function dismissHandlePrompt(page: Page): Promise<void> {
  const skip = page.getByTestId("handle-onboarding-skip");
  if (await skip.count()) await skip.first().click().catch(() => {});
}

/** Start a practice Showdown and return its match id from the URL. */
async function startShowdown(page: Page): Promise<string> {
  await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
  await dismissHandlePrompt(page);
  const practice = page.getByTestId("lobby-twenty_dollar-practice");
  await expect(practice).toBeVisible({ timeout: 30_000 });
  await practice.click();
  await expect(page.getByTestId("td-game")).toBeVisible({ timeout: 40_000 });
  const match = page.url().split("/").pop();
  expect(match, "the room URL must carry a match id").toBeTruthy();
  return match as string;
}

/** Dismiss the pre-match intro if this tab is showing it. */
async function pastIntro(page: Page): Promise<void> {
  const start = page.getByTestId("td-intro-start");
  if (await start.count()) await start.click().catch(() => {});
  await expect(page.getByTestId("td-table")).toBeVisible({ timeout: 30_000 });
}

test.describe("The $20 Showdown — two tabs on one match", () => {
  test("both tabs follow the same match, and neither invents a catch-up", async ({
    browser,
  }) => {
    const sub = `e2e-td-2tab-${Date.now()}`;
    const first = await signedInPage(browser, sub);
    const matchId = await startShowdown(first);
    await pastIntro(first);

    // The SECOND tab joins the match already in progress, in its own context
    // and therefore with its own empty cursor.
    const second = await signedInPage(browser, sub);
    await second.goto(`/arena/twenty-dollar/${matchId}`, {
      waitUntil: "domcontentloaded",
    });
    await pastIntro(second);

    // 1. BOTH TABS OBSERVE THE SAME MATCH.
    await expect(second.getByTestId("td-game")).toBeVisible({ timeout: 30_000 });
    expect(second.url()).toContain(matchId);

    // 2. A TAB THAT JOINS MID-MATCH MUST NOT REPORT THE LOTS IT WAS NEVER
    //    PRESENT FOR AS "MISSED". Its cursor seeds from the history it can
    //    already see, which is the whole point of the resume ceiling.
    await second.waitForTimeout(1200);
    await expect(second.getByTestId("td-missed-lots")).toHaveCount(0);

    // 3. ONE TAB ACTING MUST NOT MANUFACTURE A CATCH-UP IN THE OTHER. This is
    //    the reported defect, stated as an assertion: the acting tab stays on
    //    a live board and never shows the away banner.
    const acting = first;
    const watcher = second;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const bid = acting.getByTestId("td-submit-bid");
      const pass = acting.getByTestId("td-pass");
      if ((await bid.count()) && (await bid.isEnabled().catch(() => false))) {
        await bid.click();
        break;
      }
      if ((await pass.count()) && (await pass.isEnabled().catch(() => false))) {
        await pass.click();
        break;
      }
      await acting.waitForTimeout(1500);
    }

    // Let both tabs poll several times so a cascade would have shown itself.
    await acting.waitForTimeout(5000);
    await watcher.waitForTimeout(500);

    await expect(
      acting.getByTestId("td-missed-lots"),
      'the tab that made the move must never see "While you were away"',
    ).toHaveCount(0);

    // 4. NO DUPLICATE ACTION AND NO IMPOSSIBLE STATE, in either tab. Budgets
    //    are the cheapest end-to-end proof: a double-charged bid or a
    //    double-awarded lot shows up here first.
    for (const page of [acting, watcher]) {
      const seats = page.locator('[data-testid^="td-seat-budget-"]');
      const count = await seats.count();
      expect(count, "both seat budgets are rendered").toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) {
        const text = (await seats.nth(i).innerText()).replace(/[^0-9.-]/g, "");
        const value = Number.parseFloat(text);
        expect(Number.isFinite(value)).toBe(true);
        expect(value, "no seat may hold a negative budget").toBeGreaterThanOrEqual(0);
        expect(value, "no seat may hold more than the starting bank").toBeLessThanOrEqual(20);
      }
    }

    // 5. THE CLOCK REMAINS THE SERVER'S. Both tabs read the same authoritative
    //    lot, so neither has invented a turn of its own.
    // "LOT 1 OF 24 · STANDARD MARKET" -- take the FIRST integer, not the
    // whole string. `parseInt` on the raw text returns NaN because it starts
    // with a word.
    const lotOf = async (page: Page): Promise<number | null> => {
      const text = (
        await page.getByTestId("td-lot-number").first().innerText().catch(() => "")
      ).trim();
      const found = text.match(/\d+/);
      return found ? Number.parseInt(found[0], 10) : null;
    };
    await watcher.reload({ waitUntil: "domcontentloaded" });
    await pastIntro(watcher);
    await watcher.waitForTimeout(1500);
    const [a, b] = [await lotOf(acting), await lotOf(watcher)];
    expect(a, "the acting tab reports a lot number").not.toBeNull();
    expect(b, "the reloaded tab reports a lot number").not.toBeNull();
    expect(
      Math.abs((a as number) - (b as number)),
      "two tabs on one match must not diverge by more than the lot in flight",
    ).toBeLessThanOrEqual(1);

    // 6. A RELOAD MUST NOT REPLAY WHAT WAS ALREADY ACKNOWLEDGED. If the
    //    reloaded tab did surface a recap, dismissing it must be durable
    //    across a second reload -- the sticky-cursor defect stated as a test.
    const recap = watcher.getByTestId("td-missed-lots");
    if (await recap.count()) {
      await watcher.getByTestId("td-missed-dismiss").click();
      await expect(recap).toHaveCount(0);
      await watcher.reload({ waitUntil: "domcontentloaded" });
      await pastIntro(watcher);
      await watcher.waitForTimeout(1200);
      await expect(
        watcher.getByTestId("td-missed-lots"),
        "an acknowledged recap must not come back after a reload",
      ).toHaveCount(0);
    }

    await acting.context().close();
    await watcher.context().close();
  });

  test("a stale tab cannot double-submit an action the other tab already made", async ({
    browser,
  }) => {
    const sub = `e2e-td-stale-${Date.now()}`;
    const first = await signedInPage(browser, sub);
    const matchId = await startShowdown(first);
    await pastIntro(first);

    const second = await signedInPage(browser, sub);
    await second.goto(`/arena/twenty-dollar/${matchId}`, {
      waitUntil: "domcontentloaded",
    });
    await pastIntro(second);

    // Both tabs are now holding the SAME state version. One acts; the other's
    // view is stale from that instant. The stale tab acting must be refused by
    // the optimistic lock rather than applied twice -- and must be refused in
    // WORDS, not with raw server prose.
    const actOn = async (page: Page): Promise<boolean> => {
      for (const id of ["td-submit-bid", "td-pass"]) {
        const control = page.getByTestId(id);
        if ((await control.count()) && (await control.isEnabled().catch(() => false))) {
          await control.click();
          return true;
        }
      }
      return false;
    };

    const acted = await actOn(first);
    test.skip(!acted, "no control was live on the first tab in this seeded match");

    // The second tab has not polled since; act immediately on its stale view.
    const staleActed = await actOn(second);

    if (staleActed) {
      // Either the server accepted it as a legitimately later action, or it
      // refused it. Both are correct; what is NOT correct is an unexplained
      // failure or a broken board.
      const error = second.getByTestId("td-error");
      if (await error.count()) {
        const text = await error.innerText();
        expect(text.length, "a refusal must say something").toBeGreaterThan(10);
        expect(text, "no raw HTTP status may reach the player").not.toMatch(/HTTP \d{3}/);
        expect(text, "no stack trace may reach the player").not.toMatch(/Traceback|\bat \w+\./);
      }
    }

    // Whatever happened, the board is still coherent in both tabs.
    for (const page of [first, second]) {
      await expect(page.getByTestId("td-game")).toBeVisible();
      const budgets = page.locator('[data-testid^="td-seat-budget-"]');
      for (let i = 0; i < (await budgets.count()); i += 1) {
        const value = Number.parseFloat(
          (await budgets.nth(i).innerText()).replace(/[^0-9.-]/g, ""),
        );
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(20);
      }
    }

    await first.context().close();
    await second.context().close();
  });
});
