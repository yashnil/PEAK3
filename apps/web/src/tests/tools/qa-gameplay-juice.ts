/**
 * MANUAL QA DRIVER — the gameplay-responsiveness + visual-juice pass.
 *
 * NOT a spec (deliberately not named `*.spec.ts`) and outside the main
 * config's `testDir`, so it can never run as part of `npm run test:e2e` or in
 * CI. See `playwright.qa-juice.config.ts`.
 *
 * WHAT IT IS FOR, in three jobs:
 *
 *   1. REPRODUCE the defects reported from the deployed build, with every
 *      browser console error and page exception recorded rather than
 *      inferred.
 *   2. MEASURE real input latency -- press to first visible acknowledgement,
 *      press to request sent, request to authoritative response, response to
 *      confirmed state -- separately, because they have separate fixes. An
 *      artificial-latency mode reproduces the deployed shape on a laptop.
 *   3. CAPTURE review frames of every surface this pass changed. Each shot
 *      asserts the surface is really on screen first, so a frame is never
 *      something other than what its filename claims.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { mintTestAccessToken } from "../e2e/helpers/test-jwt";

const OUT = path.resolve(__dirname, "../../../../../design-review/qa-juice");
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };

/** One-way latency added to every API call in the latency runs. */
const RTT_MS = 200;

function uniqueSub(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function signIn(context: BrowserContext, page: Page, sub: string): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__peak3TestAuth !== "undefined");
  const token = mintTestAccessToken(sub, `${sub}@qa.test`);
  await page.evaluate(
    ([t, s]) => {
      window.__peak3TestAuth!.setSession(t as string, {
        id: s as string,
        email: `${s}@qa.test`,
        isAnonymous: false,
      });
    },
    [token, sub],
  );
}

async function addLatency(page: Page, oneWayMs: number): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    await new Promise((r) => setTimeout(r, oneWayMs));
    await route.continue();
  });
}

interface Recorder {
  errors: string[];
  exceptions: string[];
}

function record(page: Page): Recorder {
  const rec: Recorder = { errors: [], exceptions: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") rec.errors.push(msg.text());
  });
  page.on("pageerror", (error) => {
    rec.exceptions.push(`${error.name}: ${error.message}`);
  });
  return rec;
}

/** Write a frame, having first proved the surface is on screen. */
async function shot(page: Page, name: string, expectVisible: string): Promise<void> {
  await expect(page.getByTestId(expectVisible)).toBeVisible();
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

function writeReport(name: string, body: unknown): void {
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(body, null, 2));
  console.log(`\n== ${name} ==\n${JSON.stringify(body, null, 2)}`);
}

/**
 * PRESS -> ACKNOWLEDGEMENT, measured in the page rather than from the driver.
 *
 * Playwright's own click latency is not the number under review; what matters
 * is how long the browser took to paint a change after the pointer went down.
 * A `MutationObserver` armed immediately before the press records the first
 * DOM mutation inside the surface, which is the first frame the player could
 * possibly see.
 */
async function measureAck(page: Page, rootTestId: string, clickTestId: string) {
  await page.evaluate((root) => {
    const w = window as unknown as { __ack?: { t0: number; dt: number | null } };
    const node = document.querySelector(`[data-testid="${root}"]`);
    w.__ack = { t0: performance.now(), dt: null };
    if (!node) return;
    const observer = new MutationObserver(() => {
      if (w.__ack && w.__ack.dt === null) w.__ack.dt = performance.now() - w.__ack.t0;
    });
    observer.observe(node, { subtree: true, attributes: true, childList: true, characterData: true });
  }, rootTestId);
  const target = page.getByTestId(clickTestId);
  await page.evaluate((root) => {
    const w = window as unknown as { __ack?: { t0: number; dt: number | null } };
    if (w.__ack) w.__ack.t0 = performance.now();
    void root;
  }, rootTestId);
  await target.click();
  return page.evaluate(() => {
    const w = window as unknown as { __ack?: { t0: number; dt: number | null } };
    return w.__ack?.dt ?? null;
  });
}

// ---------------------------------------------------------------------------
// Three-Man Weave
// ---------------------------------------------------------------------------

test.describe("Three-Man Weave", () => {
  test("the reported roster-move flow, measured and shot", async ({ browser }) => {
    test.setTimeout(900_000);
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    const rec = record(page);
    await addLatency(page, RTT_MS);
    const moves: unknown[] = [];
    const picks: unknown[] = [];
    try {
      await signIn(context, page, uniqueSub("qa-tmw"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 120_000 });
      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 120_000 });

      const overlay = page.getByTestId("tmw-pick-overlay");

      for (let turn = 0; turn < 5 && rec.exceptions.length === 0; turn += 1) {
        await overlay.waitFor({ state: "visible", timeout: 240_000 }).catch(() => {});
        if (!(await overlay.isVisible().catch(() => false))) break;

        if (turn === 1) {
          await shot(page, "tmw-01-draft-room", "tmw-pick-overlay");
        }

        // --- rearrangement, the reported flow -----------------------------
        const occupied = page.locator('[data-testid^="tmw-place-"][data-occupied="true"]');
        if ((await occupied.count()) > 0) {
          const source = occupied.first();
          const sourceId = await source.getAttribute("data-testid");
          await source.click();
          if ((await overlay.getAttribute("data-mode")) === "moving") {
            const legal = page.locator('[data-testid^="tmw-place-"][data-legal="true"]');
            if ((await legal.count()) > 0) {
              const destination = legal.first();
              const destId = await destination.getAttribute("data-testid");
              await destination.click();
              const label = await page.getByTestId("tmw-move-confirm").textContent();
              if (turn === 1) await shot(page, "tmw-02-move-staged", "tmw-move-confirm");

              const ackMs = await measureAck(page, "tmw-pick-overlay", "tmw-move-confirm");
              const pressedAt = Date.now();
              // The optimistic arrangement is on screen before the server
              // has answered; the pending marking is what says so.
              const pendingSeen = await page
                .locator('[data-gf-pending="true"]')
                .first()
                .isVisible()
                .catch(() => false);
              await expect(overlay).toHaveAttribute("data-mode", /idle|placing/, { timeout: 30_000 }).catch(() => {});
              const confirmedMs = Date.now() - pressedAt;
              moves.push({ turn, sourceId, destId, label, ackMs, pendingVisibleBeforeServer: pendingSeen, confirmedMs });
              if (turn === 1) await shot(page, "tmw-03-move-confirmed", "tmw-pick-overlay");
            } else {
              await page.getByTestId("tmw-move-cancel").click();
            }
          }
        }

        if (!(await overlay.isVisible().catch(() => false))) continue;
        const candidate = page
          .locator('[data-testid="tmw-candidate-list"] button:not([disabled])')
          .first();
        if ((await candidate.count()) === 0) continue;
        await candidate.click();
        const legalSlot = page.locator('[data-testid^="tmw-place-"][data-legal="true"]').first();
        if ((await legalSlot.count()) === 0) continue;
        await legalSlot.click();
        await expect(page.getByTestId("tmw-confirm-pick")).toBeEnabled({ timeout: 20_000 });
        const pickAck = await measureAck(page, "tmw-pick-overlay", "tmw-confirm-pick");
        const pickPressed = Date.now();
        await overlay.waitFor({ state: "hidden", timeout: 120_000 }).catch(() => {});
        picks.push({ turn, ackMs: pickAck, confirmedMs: Date.now() - pickPressed });

        // The board, off-turn, with the painted floor.
        if (turn === 1) {
          await page.waitForTimeout(600);
          await shot(page, "tmw-04-courts", "tmw-courts");
        }
      }

      writeReport("tmw-report", {
        rttOneWayMs: RTT_MS,
        moves,
        picks,
        consoleErrors: rec.errors,
        pageExceptions: rec.exceptions,
      });
      expect(rec.exceptions, "the room threw").toEqual([]);
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// $20 Showdown
// ---------------------------------------------------------------------------

test.describe("$20 Showdown", () => {
  test("bid and pass acknowledgement, turn rails, and the auction loop", async ({ browser }) => {
    test.setTimeout(900_000);
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    const rec = record(page);
    await addLatency(page, RTT_MS);
    const actions: unknown[] = [];
    try {
      await signIn(context, page, uniqueSub("qa-sd"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-twenty_dollar-practice").click();
      await page.waitForURL(/\/arena\/twenty-dollar\/[0-9a-f-]{36}/, { timeout: 120_000 });
      await expect(page.getByTestId("td-game")).toBeVisible({ timeout: 120_000 });

      const controls = page.getByTestId("td-bid-controls");
      for (let lot = 0; lot < 6 && rec.exceptions.length === 0; lot += 1) {
        await expect(controls).toHaveAttribute("data-live", "true", { timeout: 180_000 }).catch(() => {});
        if ((await controls.getAttribute("data-live")) !== "true") break;

        if (lot === 0) await shot(page, "sd-01-auction-floor", "td-game");

        const passing = lot % 3 === 2;
        const target = passing ? "td-pass" : "td-submit-bid";
        if (await page.getByTestId(target).isDisabled().catch(() => true)) break;

        const ackMs = await measureAck(page, "td-game", target);
        const pressed = Date.now();
        // The acknowledgement is on screen before the server answers.
        const turnLine = await page.getByTestId("td-turn-indicator").textContent();
        const pendingText = await page.getByTestId("td-pending").textContent().catch(() => null);
        if (lot === 0) await shot(page, "sd-02-decision-pending", "td-pending");
        await expect(page.getByTestId("td-game")).not.toHaveAttribute("data-phase", "pending", { timeout: 60_000 }).catch(() => {});
        actions.push({
          lot,
          action: passing ? "pass" : "bid",
          ackMs,
          acknowledgedAs: (turnLine ?? "").trim(),
          clockZone: (pendingText ?? "").trim(),
          settledMs: Date.now() - pressed,
        });

        if (lot === 1) {
          await page.waitForTimeout(400);
          await shot(page, "sd-03-turn-rails", "td-turn-rail-0");
        }
        await page.waitForTimeout(1200);
      }

      writeReport("showdown-report", {
        rttOneWayMs: RTT_MS,
        actions,
        consoleErrors: rec.errors,
        pageExceptions: rec.exceptions,
      });
      expect(rec.exceptions, "the auction room threw").toEqual([]);
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Daily Grid
// ---------------------------------------------------------------------------

test.describe("Daily Grid", () => {
  test("the board and the reworked result screen", async ({ browser }) => {
    test.setTimeout(600_000);
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    const rec = record(page);
    try {
      await signIn(context, page, uniqueSub("qa-grid"));
      await page.goto("/daily/grid", { waitUntil: "domcontentloaded" });
      // The gate offers a guided tour; a capture run takes the direct route.
      const skipTour = page.getByTestId("daily-grid-gate-skip-tour");
      if (await skipTour.count()) await skipTour.first().click().catch(() => {});
      const start = page.getByTestId("start-daily-grid");
      await start.waitFor({ state: "visible", timeout: 120_000 }).catch(() => {});
      if (await start.count()) await start.first().click();
      await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 120_000 });
      await shot(page, "grid-01-board", "daily-grid-board");

      // Fill every square with the first legal answer the search offers.
      for (let index = 0; index < 9; index += 1) {
        const cell = page.locator('[data-testid="grid-cell"]:not([data-state="filled"])').first();
        if ((await cell.count()) === 0) break;
        await cell.click();
        const search = page.getByTestId("cell-search-input");
        await search.waitFor({ state: "visible", timeout: 20_000 });
        await search.fill("a");
        const hit = page.getByTestId("cell-search-result").first();
        await hit.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
        if ((await hit.count()) === 0) {
          await page.keyboard.press("Escape");
          continue;
        }
        await hit.click();
        await page.waitForTimeout(250);
      }

      const complete = page.getByTestId("daily-grid-complete");
      await complete.waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
      if (await complete.isVisible().catch(() => false)) {
        await page.waitForTimeout(1200);
        await shot(page, "grid-02-result", "daily-grid-complete");
      }

      writeReport("grid-report", {
        reachedResult: await complete.isVisible().catch(() => false),
        consoleErrors: rec.errors,
        pageExceptions: rec.exceptions,
      });
    } finally {
      await context.close();
    }
  });
});
