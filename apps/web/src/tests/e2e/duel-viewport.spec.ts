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

  test("the document height is unchanged by revealing a result", async ({ page }) => {
    // The direct statement of the fix: the slot reserves its space, so the
    // page is exactly as tall with the panel open as with it closed.
    await openDuel(page);
    const before = await frame(page);
    await cards(page).first().click();
    await expect(page.getByRole("region", { name: /answer result/i })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(700);
    const after = await frame(page);
    expect(
      Math.abs(after.docHeight - before.docHeight),
      "the page grew when the result appeared",
    ).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  test("keyboard selection moves nothing either", async ({ page }) => {
    // Keyboard is the path most likely to scroll: the browser scrolls focused
    // elements into view, and a focus() during a layout change can compound it.
    await openDuel(page);
    const before = await frame(page);
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("region", { name: /answer result/i })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(700);
    assertStill(before, await frame(page), "after keyboard selection");
  });

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
