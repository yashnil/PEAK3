/**
 * Peak Duel must not move under the player.
 *
 * WHAT THE BUG ACTUALLY WAS. Four sibling blocks below the cards were each
 * mounted and unmounted by their own condition — the keyboard hint, the
 * "Checking…" line, the error, and the reveal panel. Choosing a player
 * unmounted the hint and mounted a ~260px panel in the same frame, so the
 * document grew and everything below the cards jumped; "Next duel" reversed it.
 *
 * There were TWO causes, and measuring separated them:
 *
 *   1. `autoFocus` on the reveal panel's "Next duel" button. `focus()` without
 *      options lets the browser scroll the element into view -- measured at
 *      603px of window scroll on a click, 626px on a keypress. This was the
 *      larger half and it is not a layout bug at all.
 *   2. The stage itself growing by ~320px as the panel mounted.
 *
 * So these tests assert scrollY *and* the on-screen position of the cards
 * *and* the document height: fixing either cause alone still leaves visible
 * movement, and only the height check catches a regression in the reservation.
 */
import { test, expect, type Page } from "@playwright/test";

/** Movement small enough to be invisible: sub-pixel rounding and font metrics. */
const TOLERANCE_PX = 2;

interface Frame {
  scrollY: number;
  cardsTop: number;
  docHeight: number;
}

async function frame(page: Page): Promise<Frame> {
  return page.evaluate(() => {
    const cards = document.querySelector('[data-testid="duel-card-left"]');
    return {
      scrollY: window.scrollY,
      cardsTop: cards ? cards.getBoundingClientRect().top : 0,
      docHeight: document.documentElement.scrollHeight,
    };
  });
}

function assertStill(before: Frame, after: Frame, what: string) {
  expect(Math.abs(after.scrollY - before.scrollY), `${what}: window scrolled`).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(
    Math.abs(after.cardsTop - before.cardsTop),
    `${what}: the cards moved on screen (layout shift under a still viewport)`,
  ).toBeLessThanOrEqual(TOLERANCE_PX);
}

async function openDuel(page: Page) {
  await page.goto("/play/endless", { waitUntil: "load" });
  // The mode has a start gate; a duel only exists after it is pressed.
  await page.getByRole("button", { name: /start endless/i }).click();
  await expect(page.getByTestId("duel-stage-slot")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("duel-card-left")).toBeVisible({ timeout: 30_000 });
  // Let entry animation settle so the baseline is a resting layout.
  await page.waitForTimeout(600);
}

/** The two player cards, whatever they are labelled. */
function cards(page: Page) {
  return page.getByTestId("duel-card-left");
}

test.describe("Peak Duel — the page never moves", () => {
  /**
   * A NESTED describe, not a blanket `test.use()` on the outer one: the
   * `@mobile` test below ("scrolled down the page, the stage still does not
   * move") deliberately runs at whatever viewport its Playwright PROJECT
   * assigns (`mobile-chrome`'s Pixel 5 preset) precisely because it is
   * testing mobile geometry, and a describe-level override here would have
   * silently replaced that with a desktop size and stopped testing anything
   * mobile-shaped.
   */
  test.describe("at a size this file has proven fits", () => {
    /**
     * Pinned to the ONE viewport this file has already measured and proven
     * the reveal panel fits inside without needing to scroll -- see "the
     * whole result and Next duel fit the viewport at 1440x900" below, which
     * asserts `window.scrollY === 0` at exactly this size, and whose own
     * comment states outright: "Shorter viewports may scroll the PAGE; that
     * is fine and is not asserted."
     *
     * Without this, the two tests in this block ran at the `chromium-core`
     * project's device-default viewport (1280x720 -- narrower than the
     * shortest size this file's product-level test guarantees a scroll-free
     * reveal at) and were intermittently flaky: with duel content that
     * pushes the panel's natural height a few px past its usual, "Next
     * duel" -- the last thing in the panel -- sat as little as 4px from the
     * 720px edge. Comfortably inside Playwright's own "fully in view"
     * margin on most runs and not quite on a few, `.click()` would then
     * perform its own ordinary, correct scroll-into-view before clicking --
     * a real, Playwright-driven few-px scroll, and the exact intermittent
     * movement these tests caught, but not the page moving under the player
     * the way the historical bug in this file's top comment did. That
     * failure mode can only be disentangled from a genuine regression by
     * testing at a size the product has actually committed to fitting,
     * which this file already establishes is 1440x900, not whatever a
     * given Playwright project happens to default to.
     */
    test.use({ viewport: { width: 1440, height: 900 } });

    test("choosing a player moves nothing, and neither does Next duel", async ({ page }) => {
      await openDuel(page);

      const before = await frame(page);
      await cards(page).first().click();

      await expect(page.getByRole("region", { name: /answer result/i })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(700); // reveal animation completes
      const afterPick = await frame(page);
      assertStill(before, afterPick, "after choosing a player");

      const next = page.getByRole("button", { name: /next duel|next|continue/i }).first();
      await next.click();
      await page.waitForTimeout(700);
      const afterNext = await frame(page);
      assertStill(before, afterNext, "after Next duel");
    });

    test("keyboard selection moves nothing either", async ({ page }) => {
      // Keyboard is the path most likely to scroll: the browser scrolls
      // focused elements into view, and a focus() during a layout change
      // can compound it.
      await openDuel(page);
      const before = await frame(page);
      await page.keyboard.press("ArrowLeft");
      await expect(page.getByRole("region", { name: /answer result/i })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(700);
      assertStill(before, await frame(page), "after keyboard selection");
    });
  });

  test("the result grows downward only, and is never clipped into a nested scroller", async ({
    page,
  }) => {
    /*
     * THIS ASSERTION REPLACES "the document height is unchanged".
     *
     * WHY IT CHANGED, stated plainly. Document height was a PROXY for the real
     * requirement — "the page never moves under the player" — and it was too
     * strict a proxy. Holding it exactly required pinning the result inside the
     * CARDS' box (`absolute inset-0` + `overflow-y-auto`), and the result does
     * not fit there: measured at 1440x900 the cards occupy 257px and the result
     * needs 510px, so 253px of it — most of the component comparison and the
     * "Next duel" button — lived behind a nested scrollbar, on a viewport with
     * ~460px of unused space directly below. At 1728x1000 it was 269px.
     *
     * The defect the original test was written for was the page JUMPING: the
     * window scrolling and the cards moving on screen when an answer landed.
     * That is asserted directly, and unchanged, by the three tests around this
     * one. What this test adds is everything the proxy was standing in for and
     * one thing it could not express:
     *
     *   1. nothing moves UP — the stage may only extend below the cards;
     *   2. the result is never clipped — no scrollable ancestor inside it;
     *   3. the primary action is reachable without scrolling at desktop sizes.
     *
     * Growth strictly below the cards, with the scroll position and the cards
     * fixed, is not movement under the player: it is page that was not being
     * used. So this is a stronger guard than the one it replaces, not a looser
     * one — (2) and (3) would both have passed under the old assertion while
     * the result was unusable.
     */
    await openDuel(page);
    const before = await frame(page);
    await cards(page).first().click();
    await expect(page.getByRole("region", { name: /answer result/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(700);
    const after = await frame(page);

    // 1. NOTHING MOVED UP. The cards hold their exact position and the window
    //    did not scroll; the page may only have got taller underneath.
    assertStill(before, after, "revealing a result");
    expect(
      after.docHeight,
      "the page got SHORTER when the result appeared",
    ).toBeGreaterThanOrEqual(before.docHeight - TOLERANCE_PX);

    // 2. THE RESULT IS NOT CLIPPED. No ancestor inside the stage scrolls, and
    //    the panel is rendered at its full natural height.
    const clipped = await page.evaluate(() => {
      const region = document.querySelector(
        '[role="region"][aria-label*="nswer" i]',
      ) as HTMLElement | null;
      if (!region) return { found: false, overflow: 0, chain: "" };
      let node: HTMLElement | null = region;
      let worst = 0;
      const chain: string[] = [];
      // Walk up to the page body looking for anything scrolling vertically.
      while (node && node !== document.body) {
        const over = node.scrollHeight - node.clientHeight;
        if (over > 1 && getComputedStyle(node).overflowY !== "visible") {
          worst = Math.max(worst, over);
          chain.push(`${node.tagName}.${node.className.slice(0, 60)} +${over}px`);
        }
        node = node.parentElement;
      }
      return { found: true, overflow: worst, chain: chain.join(" | ") };
    });
    expect(clipped.found, "the result region was not found").toBe(true);
    expect(
      clipped.overflow,
      `the result is inside a nested scroller: ${clipped.chain}`,
    ).toBe(0);
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1728, height: 1000 },
  ]) {
    test(`the whole result and Next duel fit the viewport at ${viewport.width}x${viewport.height}`, async ({
      browser,
    }) => {
      // The requirement in product terms: at an ordinary desktop size a player
      // sees the verdict, the points, the session score, the complete
      // face-to-face comparison AND the way onward, without scrolling anything.
      // Shorter viewports may scroll the PAGE; that is fine and is not asserted.
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      try {
        await openDuel(page);
        await cards(page).first().click();
        const region = page.getByRole("region", { name: /answer result/i });
        await expect(region).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(700);

        // Every part of the result, named rather than counted.
        await expect(region).toContainText(/correct|not quite/i);
        await expect(region).toContainText(/session total/i);
        await expect(region).toContainText(/component/i);

        // V2 (product-direction): the primary action reads "Next Matchup" /
        // "See results" rather than legacy's "Next duel" — same `onNext`
        // action, matching the file's own broader pattern at `openDuel`'s
        // sibling assertions (`/next duel|next|continue/i`).
        const next = page.getByRole("button", { name: /next duel|next matchup|continue/i }).first();
        const box = (await next.boundingBox())!;
        expect(
          box.y + box.height,
          "the Next duel button is below the fold with the result open",
        ).toBeLessThanOrEqual(viewport.height);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
      } finally {
        await context.close();
      }
    });
  }

  test("scrolled down the page, the stage still does not move @mobile", async ({ page }) => {
    // The failure is only visible when there is somewhere to jump TO, so this
    // starts from a scrolled position rather than the top of the document.
    await openDuel(page);
    await page.evaluate(() => window.scrollTo(0, 120));
    await page.waitForTimeout(250);
    const before = await frame(page);
    await cards(page).first().click();
    await expect(page.getByRole("region", { name: /answer result/i })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(700);
    assertStill(before, await frame(page), "after choosing while scrolled");
  });
});

test.describe("Peak Duel — reduced motion", () => {
  test("no movement with animations suppressed", async ({ browser }) => {
    // `test.use({ reducedMotion })` is not typed on this Playwright version's
    // fixtures, so the context is created explicitly instead.
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    // With transitions off the panel appears instantly, which is the harshest
    // case for a layout that reserves space lazily.
    await openDuel(page);
    const before = await frame(page);
    await cards(page).first().click();
    await expect(page.getByRole("region", { name: /answer result/i })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    assertStill(before, await frame(page), "after choosing with reduced motion");
    await context.close();
  });
});
