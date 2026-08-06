/**
 * Manual-acceptance screenshot capture for the Arena games production rescue.
 *
 * NOT a spec (deliberately not named `*.spec.ts`) and outside the main config's
 * `testDir`, so it can never run as part of `npm run test:e2e` or in CI. It
 * writes PNGs into a review directory, which is evidence rather than an
 * assertion about product behaviour.
 *
 * Reachable only via (from apps/web):
 *   npx playwright test --config=playwright.rescue-shots.config.ts
 *
 * WHY EACH CAPTURE IS ITS OWN `test()`. One surface that cannot be reached must
 * not silence the rest of the sheet, and a capture that cannot reach its
 * surface must FAIL rather than write a misleading frame — a screenshot review
 * is worthless if a frame might be something other than what its filename
 * claims. Every capture therefore asserts the surface is present BEFORE it
 * shoots, and records what it saw into a manifest with a content hash, so the
 * reviewer reads generated truth rather than an assumption.
 *
 * The manifest's `md5` exists because an earlier capture pass in this
 * repository silently produced pairs of byte-identical frames under different
 * names — two filenames, one screen. A duplicate hash is now visible.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { mintTestAccessToken } from "../e2e/helpers/test-jwt";
// THE PORT, FROM THE CONFIG THAT OPENS IT. `NEXT_PUBLIC_API_URL` is set for the
// Next process and not for this one, so reading it from `process.env` here
// yielded `undefined` and a fallback that pointed at a port nothing was
// listening on. And `127.0.0.1` rather than `localhost`: Node resolves
// `localhost` to `::1` first, while uvicorn binds IPv4.
import { API_PORT } from "../../../playwright.rescue-shots.config";

const API_BASE = `http://127.0.0.1:${API_PORT}`;

const OUT = path.resolve(__dirname, "../../../../../docs/implementation/arena-rescue-review");
const MANIFEST = path.join(OUT, "screenshot-manifest.json");

const DESKTOP = { width: 1440, height: 900 };
const SHORT_DESKTOP = { width: 1440, height: 700 };
const MOBILE = { width: 390, height: 844 };

fs.mkdirSync(OUT, { recursive: true });

interface ManifestEntry {
  file: string;
  viewport: string;
  url: string;
  note: string;
  theme: string | null;
  md5: string;
}

function appendManifest(entry: ManifestEntry): void {
  const existing: ManifestEntry[] = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, "utf8"))
    : [];
  fs.writeFileSync(
    MANIFEST,
    `${JSON.stringify([...existing.filter((e) => e.file !== entry.file), entry], null, 2)}\n`,
  );
}

/**
 * A STICKY HEADER IS STITCHED INTO THE MIDDLE OF A FULL-PAGE SHOT.
 *
 * Chromium composes `fullPage: true` by scrolling and joining, so anything
 * `position: sticky` or `fixed` is painted wherever it happened to be sitting
 * -- the `td-13-result` frame came back with the whole site navigation as an
 * opaque band across the middle of the result, covering both rosters. That is
 * an artefact of the capture, not of the product, but a review frame that hides
 * the thing under review is useless either way.
 *
 * Pinning them to `static` for the duration of the shot is the standard fix. It
 * is injected as a stylesheet and removed immediately, so nothing that follows
 * the frame sees a different page.
 */
const UNSTICK_ID = "peak3-capture-unstick";

function dropFromManifest(file: string): void {
  if (!fs.existsSync(MANIFEST)) return;
  const existing: ManifestEntry[] = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  fs.writeFileSync(
    MANIFEST,
    `${JSON.stringify(existing.filter((e) => e.file !== file), null, 2)}\n`,
  );
}

async function shot(
  page: Page,
  name: string,
  note: string,
  fullPage = false,
  keepScroll = false,
): Promise<string> {
  const file = `${name}.png`;
  const target = path.join(OUT, file);
  // A VIEWPORT FRAME IS SHOT FROM THE TOP OF THE PAGE unless the frame is
  // ABOUT something further down. The Showdown driver clicks its way through a
  // whole auction, so the scroll position when a state finally occurs is an
  // accident of the previous action -- `td-09-unsold-reveal` came back with the
  // reveal's own "LOT 3" eyebrow tucked behind the site nav.
  if (!fullPage && !keepScroll) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(120);
  }
  if (fullPage) {
    await page.evaluate((id) => {
      const style = document.createElement("style");
      style.id = id;
      // Only the two things that stitch badly. A blanket `position: static`
      // would collapse layouts that legitimately depend on `absolute`.
      style.textContent =
        ".pk-nav-header, .arena-shell-rail, .td-column-centre, " +
        ".tmw-place-actions, .td-bid { position: static !important; }";
      document.head.appendChild(style);
    }, UNSTICK_ID);
    await page.waitForTimeout(80);
  }
  await page.screenshot({ path: target, fullPage });
  if (fullPage) {
    await page.evaluate((id) => document.getElementById(id)?.remove(), UNSTICK_ID);
  }
  const md5 = crypto.createHash("md5").update(fs.readFileSync(target)).digest("hex");
  const size = page.viewportSize();
  appendManifest({
    file,
    viewport: size ? `${size.width}x${size.height}` : "unknown",
    url: page.url(),
    note,
    theme: await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme"),
    ),
    md5,
  });
  return md5;
}

async function signIn(context: BrowserContext, page: Page, sub: string): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__peak3TestAuth !== "undefined");
  const token = mintTestAccessToken(sub, `${sub}@shots.test`);
  await page.evaluate(
    ([t, s]) => {
      window.__peak3TestAuth!.setSession(t as string, {
        id: s as string,
        email: `${s}@shots.test`,
        isAnonymous: false,
      });
    },
    [token, sub],
  );
}

/** Dismiss the "Choose a public handle" prompt.
 *
 *  A REAL PRODUCT PROMPT, and a genuine obstruction to a review frame: it is
 *  shown to a freshly signed-in account with no handle, which is every account
 *  this capture mints, and it sits over the bottom-right of the page. Two
 *  frames came back with it covering half of the $20 Showdown card and the
 *  daily-status panel. Skipping it is what a real reader does with it, so the
 *  frame afterwards is the product rather than the onboarding. */
async function dismissHandlePrompt(page: Page): Promise<void> {
  const skip = page.getByTestId("handle-onboarding-skip");
  if (await skip.count()) {
    await skip.first().click();
    await expect(page.getByTestId("handle-onboarding-prompt")).toHaveCount(0);
  }
}

/** Open a `<details>` — IDEMPOTENTLY.
 *
 *  A disclosure is a toggle, and the rankings driver opens the same three folds
 *  for more than one frame. Clicking unconditionally closed the fold the second
 *  frame was about. */
async function openFold(page: Page, testId: string): Promise<void> {
  const fold = page.getByTestId(testId);
  if ((await fold.getAttribute("open")) === null) {
    await fold.locator("summary").click();
  }
  await expect(fold).toHaveAttribute("open", "");
}

function uniqueSub(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ---------------------------------------------------------------------------
// Three-Man Weave
// ---------------------------------------------------------------------------

test.describe("Three-Man Weave", () => {
  test("spinner, draft room, placement, rearrangement, movement, bots", async ({ browser }) => {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    try {
      await signIn(context, page, uniqueSub("shot-tmw"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 30_000 });

      // 1 + 2. THE SPINNER, MID-FLIGHT AND LANDED. The reel is the 82-0 wheel;
      // `data-stage="spinning"` on the strip is the state a static banner could
      // never be in, so the frame proves motion rather than implying it.
      const reel = page.locator('[data-testid="tmw-roll-franchise"]');
      await expect(reel).toBeVisible({ timeout: 20_000 });
      if ((await reel.getAttribute("data-stage")) !== "done") {
        await shot(page, "tmw-01-spinner-spinning", "Franchise/decade reels in flight");
      }
      await expect(page.getByTestId("tmw-roll")).toHaveAttribute(
        "data-revealed",
        "true",
        { timeout: 20_000 },
      );

      const overlay = page.getByTestId("tmw-pick-overlay");

      // 2 + 3. THE LANDED ROLL AND THE BOARD, SHOT OFF-TURN.
      //
      // The first version shot these the moment `data-revealed` flipped, and
      // both frames came back showing the draft room instead: `overlayOpen` is
      // `yourTurn && rollRevealed && canPick`, so on the human's own turn the
      // overlay opens on exactly that event. The board is only actually visible
      // when somebody else holds the clock, which is where these belong anyway
      // -- a spinner "landing" frame with a dialog over it shows neither.
      //
      // IT POLLS TO A DEADLINE rather than testing once. The single-attempt
      // version failed with "never caught the board with the overlay closed",
      // and the reason is that a closed overlay is a WINDOW, not a state you
      // can arrive at and hold: the draft order is seed-drawn, so the human can
      // hold two picks in a row, and the overlay then reopens between the poll
      // that observed it closed and the screenshot. Across eighteen picks the
      // window always comes; what it needed was to keep looking for it.
      const shootBoard = async (budgetMs: number) => {
        const deadline = Date.now() + budgetMs;
        while (Date.now() < deadline) {
          const open = await overlay.isVisible().catch(() => false);
          const revealed = await page
            .getByTestId("tmw-roll")
            .getAttribute("data-revealed")
            .catch(() => null);
          if (!open && revealed === "true") {
            await shot(page, "tmw-02-spinner-landed", "The roll locked, active roster lit");
            await expect(page.getByTestId("tmw-turnbar")).toBeVisible();
            await shot(page, "tmw-03-board", "Turn bar, timeline, three rosters", true);
            return true;
          }
          await page.waitForTimeout(150);
        }
        return false;
      };
      let boardShot = await shootBoard(2_000);

      // 4-7. THE DRAFT ROOM. Waits for the human's own turn rather than
      // assuming seat order, which is seed-drawn.
      await expect(overlay).toBeVisible({ timeout: 90_000 });
      await shot(page, "tmw-04-draft-room", "Pool left, interactive roster right");

      const candidate = page
        .locator('[data-testid="tmw-candidate-list"] button:not([disabled])')
        .first();
      await candidate.click();
      await shot(
        page,
        "tmw-05-candidate-selected",
        "Selected candidate highlighted; legal slots lit, illegal slots dimmed",
      );

      const legal = page.locator('[data-testid^="tmw-place-"][data-legal="true"]').first();
      await legal.click();

      // LET THE PRIMARY FINISH TURNING GOLD, AND PROVE IT DID.
      //
      // This frame is the reason the check exists. Shot on the click, it came
      // back with the button carrying its ENABLED label -- "Draft Anfernee
      // Hardaway at Point guard" -- painted in the DISABLED neutral, weaker
      // than the Cancel button beside it. `.btn-primary` transitions its fill
      // over 140ms, and the screenshot was landing inside that window: the
      // pixel measured exactly `--bg-surface`, the colour it was leaving.
      //
      // A settle alone would only make the frame LOOK right. The computed
      // background is read, asserted and recorded in the manifest, so the frame
      // is evidence that the control is filled rather than a picture taken late
      // enough to seem so.
      const confirm = page.getByTestId("tmw-confirm-pick");
      await expect(confirm).toBeEnabled();
      await page.waitForTimeout(400);
      const confirmFill = await confirm.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      expect(
        confirmFill,
        `the staged primary is painted ${confirmFill} -- the disabled surface`,
      ).not.toBe("rgb(26, 29, 36)");
      await shot(
        page,
        "tmw-06-staged",
        `Player staged on the clicked slot; the primary names who and where, filled ${confirmFill}`,
      );

      // THE REARRANGEMENT FRAME IS NOT TAKEN HERE. On pick one the roster is
      // empty, so no candidate can possibly need a rearrangement -- there is
      // nothing to move. It is captured in the full-draft test below, on a
      // later pick, where the state can actually occur.

      // Commit, so the later frames have a populated roster.
      const chosen = page
        .locator('[data-testid="tmw-candidate-list"] button:not([disabled])')
        .first();
      await chosen.click();
      const target = page.locator('[data-testid^="tmw-place-"][data-legal="true"]').first();
      await target.click();
      await page.getByTestId("tmw-confirm-pick").click();

      // The overlay closes while the bots pick; that is the window for the
      // board frames if the human happened to be first on the clock.
      if (!boardShot) {
        boardShot = await shootBoard(90_000);
      }
      expect(boardShot, "never caught the board with the overlay closed").toBe(true);

      // 8 + 9. BOT TURNS. The server enforces a 1-5s think time against the
      // turn's `opened_at`, so the scouting state is genuinely on screen.
      const reveal = page.getByTestId("tmw-bot-reveal");
      await expect(reveal).toBeVisible({ timeout: 40_000 });

      // A BOT ON THE CLOCK. The tray's own "scouting" state is NOT required
      // here, and requiring it was wrong: a bot's think time is a seeded 1-5
      // seconds while the reveal tray holds for 2.6, so the next pick often
      // lands before the previous reveal clears and there is no scouting gap
      // at all. That is the product behaving correctly, not a missing state.
      //
      // What must be true -- and is asserted before the frame is written -- is
      // that the board says a BOT holds the clock: the turn bar names it and
      // exactly one court carries the badge. The scouting animation is captured
      // when it happens to be up, and the manifest records which it was.
      await expect(page.getByTestId("tmw-turn-spotlight")).toHaveAttribute(
        "data-yours",
        "false",
      );
      // :visible IS LOAD-BEARING. `RosterBoard` renders every court twice --
      // once in the desktop grid, once in the mobile tab panel -- and CSS hides
      // one of the two. An unscoped count therefore finds two badges for one
      // seat, which is a fact about the DOM and not about the board. What the
      // review has to establish is that a PLAYER sees exactly one seat lit.
      await expect(
        page.locator('[data-testid^="tmw-seat-onclock-"]:visible'),
      ).toHaveCount(1);
      await shot(
        page,
        "tmw-08-bot-turn",
        `A bot on the clock (tray: ${await reveal.getAttribute("data-state")})`,
      );

      // A BOT'S pick, not merely a revealed pick. The tray shows your own picks
      // too, and the first version of this frame captured one: "YOU DRAFTED
      // Aaron McKie" filed under `tmw-09-bot-reveal`.
      await expect
        .poll(
          async () => {
            const state = await reveal.getAttribute("data-state").catch(() => null);
            const yours = await reveal.getAttribute("data-yours").catch(() => null);
            return state === "revealed" && yours === "false";
          },
          { timeout: 120_000 },
        )
        .toBe(true);
      await shot(page, "tmw-09-bot-reveal", "The bot's pick, its season and its slot");

      // 10. DIRECT ROSTER MOVEMENT, from inside the draft room.
      await expect(overlay).toBeVisible({ timeout: 120_000 });
      const placed = page
        .locator('[data-testid^="tmw-place-"][data-occupied="true"]')
        .first();
      if ((await placed.count()) > 0) {
        await placed.click();
        await expect(overlay).toHaveAttribute("data-mode", "moving");
        await shot(
          page,
          "tmw-10-roster-move",
          "A placed card selected; its legal destinations lit",
        );
      }
    } finally {
      await context.close();
    }
  });

  /**
   * THE PAYOFF SCREEN, from a match played to the end.
   *
   * Eighteen picks against two bots, each of which takes a seeded 1-5 seconds
   * to think. The human takes whatever the roll offers first -- the frame under
   * review is the RESULT, not the quality of the roster that reached it.
   */
  test("a full draft to the podium", async ({ browser }) => {
    // EIGHTEEN PICKS AGAINST TWO BOTS ON REAL THINK TIME. The shared 300s
    // config timeout cut this off around pick fourteen, so the podium frame --
    // the one required result screen for this game -- was never written.
    test.setTimeout(900_000);
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    try {
      await signIn(context, page, uniqueSub("shot-tmw-end"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await expect(page.getByTestId("tmw-room")).toBeVisible({ timeout: 30_000 });

      const overlay = page.getByTestId("tmw-pick-overlay");
      let midgameShot = false;
      let rearrangeShot = false;
      let rearrangeTries = 0;

      // BUDGETED IN ITERATIONS, NOT PICKS. Most passes through this loop are
      // waits -- a bot's seeded 1-5s think time, a roll being drawn -- so an
      // early budget of 40 was spent waiting long before any picks were made.
      //
      // THE HUMAN MAKES SIX OF THE EIGHTEEN PICKS, not eighteen. The loop used
      // to run until `committed < 18` was false, which can never happen in a
      // three-seat snake draft, so it fell back on the play-again break and
      // burned its whole budget in 400ms sleeps -- two runs timed out at 300s
      // and then at 600s without ever writing the podium frame.
      let committed = 0;
      for (let step = 0; step < 900; step += 1) {
        if ((await page.getByTestId("tmw-play-again").count()) > 0) break;

        if (!(await overlay.isVisible().catch(() => false))) {
          // ALL THREE ROSTERS PART-FILLED, shot while a BOT holds the clock.
          //
          // The first version pressed Escape and shot immediately, which
          // produced a frame of the overlay still open on pick 1: `overlayOpen`
          // is derived from the server's own turn state, so closing it while
          // the turn is still yours simply reopens it on the next render --
          // which is the correct behaviour and the reason the board must be
          // caught when it is genuinely not your turn.
          const filled = await page.locator('[data-filled="true"]').count();
          if (!midgameShot && filled >= 4 && filled <= 12) {
            midgameShot = true;
            await shot(page, "tmw-13-midgame", `All three rosters part-filled (${filled} picks)`, true);
          }
          await page.waitForTimeout(500);
          continue;
        }

        // THE REARRANGEMENT PREVIEW, once, on a roster that has something to
        // move. Not forced: a roll where every candidate fits directly is a
        // legitimate board, and a frame captured from a synthetic state would
        // not be evidence.
        if (!rearrangeShot && committed >= 2 && rearrangeTries < 12) {
          const needsMove = page
            .locator('[data-testid^="tmw-candidate-"][data-fit="fits_after_rearrangement"]')
            .first();
          if ((await needsMove.count()) > 0) {
            // Counted only when the state EXISTS, so a run of rolls where every
            // candidate fits directly does not spend the budget.
            rearrangeTries += 1;
            if (
              !(await needsMove.click({ timeout: 5_000 }).then(() => true).catch(() => false))
            ) {
              continue;
            }
            const target = page
              .locator('[data-testid^="tmw-place-"][data-legal="true"]')
              .first();
            if ((await target.count()) > 0) {
              if (!(await target.click({ timeout: 5_000 }).then(() => true).catch(() => false))) {
                continue;
              }
              if (await page.getByTestId("tmw-rearrange-note").isVisible().catch(() => false)) {
                rearrangeShot = true;
                await shot(
                  page,
                  "tmw-07-rearrangement",
                  "The arrangement in order; each affected slot carries its destination",
                );
              }
              // BACK TO A CLEAN OVERLAY -- BUT ONLY IF THE CONTROL IS THERE.
              // `.click().catch()` on an absent element is not a no-op: it
              // waits out Playwright's 30s actionability timeout first. Cancel
              // exists only in `placing` mode, and the stalls this caused ran
              // the HUMAN'S OWN TURNS out -- the server log for that run reads
              // "turn 6 timed out (seat 0)", then 11, 12 and 17.
              const cancel = page.getByTestId("tmw-cancel-pick");
              if ((await cancel.count()) > 0) {
                await cancel.click({ timeout: 3_000 }).catch(() => {});
              }
            }
          }
        }

        // TRY EACH CANDIDATE UNTIL ONE COMMITS. A candidate whose only legal
        // landing needs a rearrangement stages nothing on click, so taking the
        // first one every time can stall the whole draft on one roll.
        const options = page.locator(
          '[data-testid="tmw-candidate-list"] button:not([disabled])',
        );
        const count = Math.min(await options.count(), 6);
        let placed = false;
        // EVERY SPECULATIVE CLICK IS BOUNDED. This loop probes candidates that
        // may not stage, in a dialog that the server can close underneath it,
        // and the default 30s actionability wait turns each miss into most of a
        // turn. A miss should cost a few seconds and move on.
        for (let index = 0; index < count && !placed; index += 1) {
          const ok = await options
            .nth(index)
            .click({ timeout: 5_000 })
            .then(() => true)
            .catch(() => false);
          if (!ok) continue;
          const slot = page.locator('[data-testid^="tmw-place-"][data-legal="true"]').first();
          if ((await slot.count()) === 0) continue;
          if (!(await slot.click({ timeout: 5_000 }).then(() => true).catch(() => false))) {
            continue;
          }
          const confirm = page.getByTestId("tmw-confirm-pick");
          if (!(await confirm.isEnabled().catch(() => false))) continue;
          if (!(await confirm.click({ timeout: 5_000 }).then(() => true).catch(() => false))) {
            continue;
          }
          placed = true;
          committed += 1;
        }
        await page.waitForTimeout(placed ? 250 : 500);
      }

      const podium = page.getByTestId("tmw-play-again");
      await expect(podium, "the draft never reached its result screen").toBeVisible({
        timeout: 180_000,
      });
      await shot(
        page,
        "tmw-14-result",
        "Podium: placements, basis, decisive pick, real buttons",
        true,
      );

      // REAL BUTTONS, ASSERTED FROM THE COMPUTED STYLE -- `btn-primary` was
      // defined in no stylesheet, and a class assertion passed the whole time.
      const styles = await podium.evaluate((node) => {
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
    } finally {
      await context.close();
    }
  });

  test("mobile placement", async ({ browser }) => {
    const context = await browser.newContext({ viewport: MOBILE });
    const page = await context.newPage();
    try {
      await signIn(context, page, uniqueSub("shot-tmw-m"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 30_000 });

      const overlay = page.getByTestId("tmw-pick-overlay");
      await expect(overlay).toBeVisible({ timeout: 90_000 });
      await page
        .locator('[data-testid="tmw-candidate-list"] button:not([disabled])')
        .first()
        .click();
      await shot(page, "tmw-11-mobile-placement", "390px: pool then placement, action row pinned");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the draft room overflows a 390px viewport").toBeLessThanOrEqual(1);
    } finally {
      await context.close();
    }
  });

  test("short-height desktop keeps the primary action in view", async ({ browser }) => {
    const context = await browser.newContext({ viewport: SHORT_DESKTOP });
    const page = await context.newPage();
    try {
      await signIn(context, page, uniqueSub("shot-tmw-s"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-three_man_weave-practice").click();
      await page.waitForURL(/\/arena\/three-man-weave\/[0-9a-f-]{36}/, { timeout: 30_000 });

      await expect(page.getByTestId("tmw-pick-overlay")).toBeVisible({ timeout: 90_000 });
      await page
        .locator('[data-testid="tmw-candidate-list"] button:not([disabled])')
        .first()
        .click();
      const confirm = page.getByTestId("tmw-confirm-pick");
      await expect(confirm).toBeVisible();

      // PART 6: "the primary action must remain in view at common laptop
      // heights." Asserted, not eyeballed.
      const box = await confirm.boundingBox();
      expect(box, "the Draft button has no box").not.toBeNull();
      expect(
        box!.y + box!.height,
        "the Draft button falls below a 700px viewport",
      ).toBeLessThanOrEqual(700);
      await shot(page, "tmw-12-short-desktop", "1440x700: the Draft button is still on screen");
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// The $20 Showdown
// ---------------------------------------------------------------------------

test.describe("The $20 Showdown", () => {
  /**
   * ONE FULL MATCH, capturing each required state the first time it occurs.
   *
   * WHY OPPORTUNISTIC AND NOT SCRIPTED. Which lot is unsold, which one draws a
   * raise, and when the board crosses into the closeout market are all
   * consequences of the match seed and the bot's own valuation. A capture that
   * forced any of them would be photographing a state the rules did not
   * actually produce. So the driver plays the auction and shoots whichever
   * required frame is still missing, and the test FAILS at the end naming any
   * state the match never reached -- which is information, not a flake.
   */
  test("a complete auction, state by state", async ({ browser }) => {
    // A FULL 24-LOT BOARD ON REAL BOT THINK TIME does not fit the shared
    // 300s config timeout. This one test buys the room to finish.
    test.setTimeout(600_000);
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    const captured = new Set<string>();

    /**
     * Shoot `name` the first time this state occurs -- AND ONLY IF IT LOOKS
     * DIFFERENT FROM EVERY FRAME ALREADY TAKEN.
     *
     * Several of these states can be true at the same instant: a bot on the
     * clock, an unsold lot revealed, and a market skip just spent all coexist
     * one iteration after the human passes. The first version wrote all three,
     * and the manifest showed the result -- `td-04-bot-thinking`,
     * `td-06-skip-accepted` and `td-09-unsold-reveal` were the same bytes under
     * three names, which is three claims of evidence for one screen.
     *
     * A collision drops the file and leaves the name UNCAPTURED, so the driver
     * takes it again the next time the state occurs on a board that has moved.
     * If it never does, the required-states check at the end says so by name.
     */
    const frameHashes = new Map<string, string>();
    const once = async (name: string, note: string, fullPage = false, keepScroll = false) => {
      if (captured.has(name)) return;
      const md5 = await shot(page, name, note, fullPage, keepScroll);
      const twin = [...frameHashes.entries()].find(([, hash]) => hash === md5);
      if (twin) {
        fs.unlinkSync(path.join(OUT, `${name}.png`));
        dropFromManifest(`${name}.png`);
        return;
      }
      frameHashes.set(name, md5);
      captured.add(name);
    };

    try {
      await signIn(context, page, uniqueSub("shot-td"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-twenty_dollar-practice").click();
      await page.waitForURL(/\/arena\/twenty-dollar\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await expect(page.getByTestId("td-game")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("td-candidate")).toBeVisible({ timeout: 30_000 });

      // 1. AN UNOPENED LOT is shot INSIDE the loop, the first time the board
      // genuinely has no bid on it. Shooting it on arrival captured a lot the
      // bot had already opened at $1 and filed it under "unopened".

      const submit = page.getByTestId("td-submit-bid");
      const pass = page.getByTestId("td-pass");

      // PLAY THE MATCH OUT, not a slice of it. The first version budgeted 90
      // polls, which ran out around lot six -- and the three states that only
      // exist LATE in a 24-lot board (an unsold lot, the closeout market, the
      // result screen) were therefore never reached. They are required frames,
      // so the driver now runs to a wall clock long enough to finish a match.
      const deadline = Date.now() + 480_000;
      for (let step = 0; step < 2_000 && Date.now() < deadline; step += 1) {
        if ((await page.getByTestId("td-result").count()) > 0) break;

        // -- states that do not need our turn ------------------------------
        if ((await page.getByTestId("td-lot-ticker").count()) > 0) {
          // AN EXCHANGE IS AT LEAST TWO PRICES. One `$1` in the feed is an
          // opening bid, and the first version filed that under
          // "raise exchange" -- a frame of the thing not yet happening.
          const ticker = await page.getByTestId("td-lot-ticker").innerText();
          if ((ticker.match(/\$\d+/g) ?? []).length >= 2) {
            await once("td-05-raise-exchange", `Live bidding: ${ticker.replace(/\n/g, " | ")}`);
          }
        }
        if ((await page.getByTestId("td-lot-reveal").count()) > 0) {
          const reveal = await page.getByTestId("td-lot-reveal").innerText();
          if (/Nobody bid/i.test(reveal)) {
            await once("td-09-unsold-reveal", "Unsold: nobody could use the candidate");
          } else {
            await once("td-08-sold-reveal", "Sold: score, season and destination revealed");
          }
        }
        if (
          (await page.getByTestId("td-standing-holder").innerText().catch(() => "")).match(
            /no bid yet/i,
          )
        ) {
          await once("td-01-unopened-lot", "Unopened lot; symmetrical seat panels", true);
        }
        // 10. THE SETTLED-LOT TRAY, opened DURING the match. It used to be shot
        // after the loop, and once the driver was allowed to play the board out
        // the loop ended on the RESULT screen -- which has no tray at all, so
        // the frame was simply never taken.
        if (
          !captured.has("td-10-settled-history") &&
          (await page.getByTestId("td-settled-tray").count()) > 0
        ) {
          const toggle = page.getByTestId("td-tray-toggle");
          const rows = page.locator('[data-testid^="td-history-"]');
          if ((await rows.count()) === 0) await toggle.click().catch(() => {});
          if ((await rows.count()) >= 2) {
            await once(
              "td-10-settled-history",
              "Settled lots as a full-width tray, not a column crushing the opponent",
              false,
              true, // the tray is BELOW the board; this frame is about the tray
            );
          }
        }
        if ((await page.getByTestId("td-market-phase").getAttribute("data-phase")) === "closeout") {
          await once("td-11-closeout", "The closeout market, named on the board");
        }

        const waiting = await page.getByTestId("td-waiting").innerText();
        if (/Waiting for/i.test(waiting)) {
          await once("td-04-bot-thinking", `Opponent on the clock: ${waiting}`);
        }

        // -- our turn -------------------------------------------------------
        if (!(await submit.isEnabled().catch(() => false))) {
          await page.waitForTimeout(400);
          continue;
        }

        await once(
          "td-02-your-turn",
          "Large clock on the active seat, stating what expiry will cost",
        );

        // A MARKET SKIP, WITH ITS COUNTER BEFORE AND AFTER. Taken the first
        // time passing would actually spend one -- the control says so itself.
        const costsSkip = (await pass.getAttribute("data-costs-skip")) === "true";
        if (costsSkip && !captured.has("td-06-skip-accepted")) {
          const before = await page.getByTestId("td-skips-0").getAttribute("data-remaining");
          await once("td-06a-skip-before", `Market Skip offered; ${before} remaining`);
          await pass.click();
          await expect
            .poll(
              async () => page.getByTestId("td-skips-0").getAttribute("data-remaining"),
              { timeout: 20_000 },
            )
            .not.toBe(before);
          const after = await page.getByTestId("td-skips-0").getAttribute("data-remaining");
          await once(
            "td-06-skip-accepted",
            `Accepted market skip: ${before} -> ${after} remaining`,
          );
          continue;
        }

        // A BID, WITH ITS PENDING STATE. The command response is held for a
        // beat so the in-flight frame is a real render rather than a guess.
        if (!captured.has("td-03-bid-accepted")) {
          // ONE-SHOT, VIA PLAYWRIGHT'S OWN `times` OPTION. A hand-rolled
          // "only delay the first" flag left the handler installed, and a
          // second command hitting it while the first was still in flight
          // continued an already-handled route -- which failed the run rather
          // than the product.
          await page.route(
            "**/commands",
            async (route) => {
              await new Promise((resolve) => setTimeout(resolve, 1200));
              await route.continue();
            },
            { times: 1 },
          );
          const amount = await page.getByTestId("td-bid-amount").innerText();
          await submit.click();
          await once("td-07-bid-pending", `Submitting ${amount}: controls disabled, state named`);
          await expect(submit).toBeEnabled({ timeout: 30_000 }).catch(() => {});
          await once("td-03-bid-accepted", "Accepted bid on the feed; no error banner");
          continue;
        }

        // FROM HERE ON, BID. Five acquisitions fill the roster, after which the
        // human is legitimately out of every remaining lot and the board runs
        // to its end under the bots -- which is how the late states arrive.
        await submit.click();
        await page.waitForTimeout(250);
      }


      // 13. THE RESULT.
      if ((await page.getByTestId("td-result").count()) > 0) {
        await once("td-13-result", "Winner, margin, both rosters, real buttons", true);
      }

      // WHAT THE MATCH NEVER REACHED, named rather than silently missing.
      const required = [
        "td-01-unopened-lot",
        "td-02-your-turn",
        "td-03-bid-accepted",
        "td-04-bot-thinking",
        "td-07-bid-pending",
        "td-10-settled-history",
      ];
      const missing = required.filter((name) => !captured.has(name));
      expect(missing, `these required states never occurred: ${missing.join(", ")}`).toEqual([]);
    } finally {
      await context.close();
    }
  });

  /**
   * THE TIMEOUT, ON A REAL CLOCK.
   *
   * Nothing is stubbed and nothing is hurried: the human simply does not act,
   * and the server's own sweep resolves the turn `TURN_SECONDS` later plus the
   * action grace window. Both states are captured -- the warning the timer
   * shows BEFORE zero, and what the board says afterwards.
   */
  test("a real timeout, on a real clock", async ({ browser }) => {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    try {
      await signIn(context, page, uniqueSub("shot-td-timeout"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-twenty_dollar-practice").click();
      await page.waitForURL(/\/arena\/twenty-dollar\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await expect(page.getByTestId("td-game")).toBeVisible({ timeout: 30_000 });

      const submit = page.getByTestId("td-submit-bid");
      await expect(submit).toBeEnabled({ timeout: 60_000 });

      // FIRST, A BID PLACED NEAR THE DEADLINE, and taken. The clock is left to
      // run into its urgent band and the command goes in with a few seconds on
      // it, so the pair of frames answers the question a player actually has --
      // "does a late press still count?" -- rather than only showing what
      // happens when one is not made at all.
      await expect(page.getByTestId("td-timer")).toHaveAttribute("data-state", "urgent", {
        timeout: 45_000,
      });
      const late = await page.getByTestId("td-timer-value").innerText();
      await shot(page, "td-12c-late-bid", `About to bid with ${late}s on the clock`);
      const lateAmount = await page.getByTestId("td-bid-amount").innerText();
      await submit.click();
      await expect(page.getByTestId("td-lot-ticker")).toContainText(lateAmount, {
        timeout: 30_000,
      });
      expect(
        await page.getByTestId("td-error").count(),
        "a bid placed inside the urgent band was rejected",
      ).toBe(0);
      await shot(
        page,
        "td-12d-late-bid-accepted",
        `${lateAmount} placed with ${late}s left, on the feed and unrejected`,
      );

      // NOW THE OTHER HALF: the next decision is simply not made.
      await expect(submit).toBeEnabled({ timeout: 120_000 });
      const consequence = await page.getByTestId("td-timer-consequence").innerText();
      const skipsBefore = await page.getByTestId("td-skips-0").getAttribute("data-remaining");
      await shot(
        page,
        "td-12a-timeout-warning",
        `Before zero: "${consequence}" (skips ${skipsBefore})`,
      );

      // DO NOTHING. 25s turn + a 2s grace, plus a poll to notice.
      await expect(page.getByTestId("td-timer")).toHaveAttribute("data-state", "expired", {
        timeout: 45_000,
      });
      await shot(page, "td-12b-timeout-expired", "At zero: controls stood down, settling");

      await expect
        .poll(
          async () =>
            (await page.getByTestId("td-lot-reveal").count()) > 0 ||
            (await page.getByTestId("td-settled-tray").count()) > 0 ||
            (await page.getByTestId("td-skips-0").getAttribute("data-remaining")) !== skipsBefore,
          { timeout: 60_000 },
        )
        .toBe(true);
      const skipsAfter = await page.getByTestId("td-skips-0").getAttribute("data-remaining");
      await shot(
        page,
        "td-12-timeout-consequence",
        `After the sweep: skips ${skipsBefore} -> ${skipsAfter}; ${consequence}`,
        true,
      );
    } finally {
      await context.close();
    }
  });

  test("mobile auction", async ({ browser }) => {
    const context = await browser.newContext({ viewport: MOBILE });
    const page = await context.newPage();
    try {
      await signIn(context, page, uniqueSub("shot-td-m"));
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await page.getByTestId("lobby-twenty_dollar-practice").click();
      await page.waitForURL(/\/arena\/twenty-dollar\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await expect(page.getByTestId("td-candidate")).toBeVisible({ timeout: 30_000 });
      await shot(page, "td-14-mobile", "390px: candidate, clock and controls in reading order");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the auction overflows a 390px viewport").toBeLessThanOrEqual(1);
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Rankings and theme
// ---------------------------------------------------------------------------

test.describe("Rankings", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`browsing and analysis in ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: DESKTOP });
      const page = await context.newPage();
      try {
        await page.addInitScript(
          (value) => window.localStorage.setItem("peak3-theme", value as string),
          theme,
        );
        await page.goto("/rankings", { waitUntil: "domcontentloaded" });
        await expect(page.locator('[data-testid="rankings-row"]').first()).toBeVisible({
          timeout: 30_000,
        });

        // NO CHART BEFORE A SELECTION. Asserted before the frame is written, so
        // the screenshot cannot be evidence of something that is not true.
        expect(await page.locator(".rk-chart-svg").count()).toBe(0);
        // AND NO ƒ COLUMN. Asserted the same way and for the same reason: the
        // frame is the evidence that the derivation column is gone, so the
        // assertion has to run before the shutter rather than after it.
        expect(
          await page.getByTestId("rankings-explain").count(),
          "the ƒ derivation control is still in the table",
        ).toBe(0);
        expect(await page.getByTestId("rankings-table").innerText()).not.toContain("ƒ");
        await shot(
          page,
          `rk-01-browsing-${theme}`,
          "Full-width board; no analysis, no chart, no ƒ column",
        );

        await page.locator('[data-testid="rankings-row"]').first().click();
        await expect(page.getByTestId("rankings-analysis")).toBeVisible();
        await expect(page.getByTestId("rankings-composite-chart")).toBeVisible();
        // EXACTLY ONE DIALOG. The whole point of the unification: there is no
        // second surface to open.
        expect(await page.getByRole("dialog").count()).toBe(1);
        for (const fold of ["rk-fold-breakdown", "rk-fold-calculation", "rk-fold-source"]) {
          await expect(page.getByTestId(fold)).toBeVisible();
          expect(
            await page.getByTestId(fold).getAttribute("open"),
            `${fold} must be closed on open`,
          ).toBeNull();
        }
        await shot(
          page,
          `rk-02-analysis-${theme}`,
          "First view: chart, exact values, completeness — derivation collapsed below",
        );

        // THE SAME DRAWER, EXPANDED. The frame that proves the derivation is
        // here rather than behind a second dialog.
        for (const fold of ["rk-fold-breakdown", "rk-fold-calculation", "rk-fold-source"]) {
          await openFold(page, fold);
        }
        await expect(page.getByTestId("rk-formula-table")).toBeVisible();
        // Scroll the arithmetic into view: the frame is about the formula, and
        // a viewport shot of the panel head would not show it.
        await page.getByTestId("rk-formula-table").scrollIntoViewIfNeeded();
        await shot(
          page,
          `rk-04-derivation-${theme}`,
          "The same drawer, expanded: weights, component scores, contributions, sum, index, score",
        );

        // PREVIOUS/NEXT MOVES BOTH HALVES.
        //
        // `openFold` rather than `.click()`: `<details>` is a TOGGLE, the three
        // folds are already open from the frame above, and clicking a summary
        // again CLOSED the one this frame is about. The capture asserted
        // `rk-formula-table` visible and got `hidden` — a capture defect, and
        // exactly the kind that produces a frame showing the wrong thing if
        // nobody asserts before the shutter.
        const before = await page.getByTestId("rk-detail-name").innerText();
        await page.getByTestId("rankings-analysis-next").click();
        await expect
          .poll(() => page.getByTestId("rk-detail-name").innerText(), { timeout: 10_000 })
          .not.toBe(before);
        await openFold(page, "rk-fold-calculation");
        await expect(page.getByTestId("rk-formula-table")).toBeVisible();
        await shot(
          page,
          `rk-05-next-player-${theme}`,
          `Lower ranked: the analysis AND the derivation followed (was ${before.trim()})`,
        );
      } finally {
        await context.close();
      }
    });
  }

  test("mobile analysis is a full-width sheet", async ({ browser }) => {
    const context = await browser.newContext({ viewport: MOBILE });
    const page = await context.newPage();
    try {
      await page.goto("/rankings", { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-testid="rankings-row"]').first()).toBeVisible({
        timeout: 30_000,
      });
      // THE PLAYER NAME, which is what a phone user actually taps.
      //
      // This used to click the rank number, and the comment here recorded why:
      // the row's name was itself the button that opened the SCORE DERIVATION,
      // so at 390px -- where the name covers most of the row -- the natural
      // gesture opened the wrong dialog and the capture had to work around it.
      // That was first fixed by giving the derivation its own bounded cell, and
      // is now fixed properly: there is one destination, so the gesture the
      // workaround existed to avoid is the only one there is.
      await page.getByTestId("rankings-open-analysis").first().click();
      const panel = page.getByTestId("rankings-analysis");
      await expect(panel).toBeVisible();

      const box = await panel.boundingBox();
      expect(box!.width, "the mobile analysis is not full width").toBeGreaterThan(380);
      await shot(page, "rk-03-mobile-analysis", "390px: a full-width sheet, not a squeezed column");

      // THE SAME UNIFIED CONTENT ON A PHONE. Not a reduced version of it.
      for (const fold of ["rk-fold-breakdown", "rk-fold-calculation", "rk-fold-source"]) {
        await openFold(page, fold);
      }
      await page.getByTestId("rk-formula-table").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("rk-formula-table")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the mobile analysis overflows the viewport").toBeLessThanOrEqual(1);
      await shot(
        page,
        "rk-06-mobile-derivation",
        "390px: the arithmetic, in the same sheet, scrolling inside its own box",
      );
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// The closed-alpha multiplayer lobby
//
// The review found this page rendering a single panel — "Multiplayer is not
// open yet" — with both playable modes behind it. These frames are the
// evidence it does not any more, and the assertions run BEFORE each shutter so
// a frame cannot be evidence of something that is not true.
// ---------------------------------------------------------------------------

test.describe("Closed-alpha lobby", () => {
  /** Close the public queue in the readiness response.
   *
   *  The capture runs against the same API `scripts/ci/e2e-tests.sh` starts,
   *  which has the queue OPEN because most Arena tests are about matchmaking.
   *  Restarting it per frame to flip one flag would cost minutes; the readiness
   *  response is exactly the input the lobby derives its posture from, and the
   *  server half of the same posture is covered deterministically in
   *  `apps/api/tests/test_arena_local_practice.py`. */
  async function closeTheQueue(page: Page): Promise<void> {
    await page.route("**/api/v1/arena/readiness", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: { ...body, public_queue_enabled: false, bots_enabled: true },
      });
    });
  }

  for (const [label, viewport] of [
    ["desktop", DESKTOP],
    ["mobile", MOBILE],
  ] as const) {
    test(`the lobby offers both bot modes — ${label}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      try {
        await signIn(context, page, uniqueSub(`shot-lobby-${label}`));
        await closeTheQueue(page);
        await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("lobby-mode-grid")).toBeVisible({
          timeout: 30_000,
        });
        await dismissHandlePrompt(page);

        // THE WALL IS GONE, and both modes are playable. Asserted before the
        // shutter: the frame is the evidence, so the claim cannot be made by
        // the screenshot alone.
        expect(await page.getByTestId("lobby-disabled").count()).toBe(0);
        expect(
          await page.getByTestId("arena-lobby").getAttribute("data-posture"),
        ).toBe("practice_only");
        for (const id of ["three_man_weave", "twenty_dollar"]) {
          await expect(page.getByTestId(`lobby-${id}-practice`)).toBeEnabled();
          await expect(page.getByTestId(`lobby-${id}-playable`)).toBeVisible();
        }
        // And matchmaking is visibly unavailable without blocking anything.
        expect(await page.getByTestId("lobby-twenty_dollar-public_queue").count()).toBe(0);
        await expect(page.getByTestId("lobby-coming-later")).toBeVisible();

        await shot(
          page,
          `lobby-01-closed-alpha-${label}`,
          "Both games playable vs bots; matchmaking held back once, at the end",
          label === "mobile",
        );
      } finally {
        await context.close();
      }
    });
  }

  test("a genuinely disabled Arena is still a wall", async ({ browser }) => {
    // THE STATE THAT MUST NOT HAVE BEEN LOST. Making a closed alpha playable is
    // only correct if a missing capability still says so.
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    try {
      await page.route("**/api/v1/arena/readiness", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({ response, json: { ...body, arena_enabled: false } });
      });
      await page.goto("/arena/lobby", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("lobby-disabled")).toBeVisible({ timeout: 30_000 });
      expect(await page.getByTestId("lobby-mode-grid").count()).toBe(0);
      await shot(page, "lobby-02-unavailable", "Arena off: a real wall, and it says which state it is");
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// NBA Fact of the Day
//
// TEN CARDS ACROSS CATEGORIES, and they are not ten random days: the driver
// asks the API for the date each chosen category actually falls on, so the
// sheet covers history, the modern game, a player, a franchise, the Finals, a
// record, the global game, how the game changed, and a surprise — rather than
// whatever ten consecutive days happened to produce.
// ---------------------------------------------------------------------------

test.describe("NBA Fact of the Day", () => {
  /** PRUNE BEFORE SHOOTING, because the slot names are not stable.
   *
   *  A previous pass left frames from a partial run sitting beside the new ones
   *  under different index numbers, and the manifest kept both — a sheet that
   *  claims to be twenty cards and is actually seventeen new ones plus three
   *  from a run that failed. The slots are named after the semantic area now
   *  rather than the category, so every filename changed at once and stale
   *  frames would have been indistinguishable from fresh ones.
   */
  test.beforeAll(() => {
    for (const file of fs.readdirSync(OUT)) {
      if (!file.startsWith("fotd-") || !file.endsWith(".png")) continue;
      fs.unlinkSync(path.join(OUT, file));
      dropFromManifest(file);
    }
  });

  /** The first date on or after `from` whose fact is in `group`.
   *
   *  BY SEMANTIC GROUP, NOT BY CATEGORY. This used to take a list of
   *  categories, which asks the wrong question of the bank: a fact carries one
   *  category, chosen by whichever generator or curator produced it, and can be
   *  about several things. Selecting "the global game" by
   *  `category === "global"` finds five facts and misses Sabonis's nine-year
   *  wait (filed `draft`), Petrović (filed `player_story`) and every Olympic
   *  fact — twenty-one of the twenty-six the bank actually has. The sheet is
   *  meant to show what each AREA looks like on the homepage, so it asks for
   *  the area. `GET /nba-facts/today` returns `semantic_groups` for exactly
   *  this.
   */
  async function findDate(
    page: Page,
    group: string,
    from: Date,
    used: Set<string>,
  ): Promise<{ iso: string; category: string } | null> {
    // THE WINDOW MUST BE LONGER THAN THE SCHEDULE'S PERIOD. It was 120 days
    // against a 211-day period, so three small categories — `historic_games`,
    // `tactics`, `nba_history` — were genuinely unreachable and the sheet came
    // back with seventeen cards. Every fact appears exactly once per period, so
    // a window over the period finds all of them.
    for (let offset = 0; offset < 280; offset += 1) {
      const day = new Date(from.getTime() + offset * 86_400_000);
      const iso = day.toISOString().slice(0, 10);
      const response = await page.request.get(
        `${API_BASE}/api/v1/nba-facts/today?on=${iso}`,
      );
      if (!response.ok()) continue;
      const body = await response.json();
      const groups: string[] = body.semantic_groups ?? [];
      if (groups.includes(group) && !used.has(body.fact_id)) {
        used.add(body.fact_id);
        return { iso, category: body.category };
      }
    }
    return null;
  }

  /** One slot per semantic area, plus five more across the largest ones.
   *
   *  NOT twenty consecutive days. A daily card is reviewed by seeing what the
   *  bank can put on it, and consecutive days would show whatever the rotation
   *  happened to serve — which, with a balanced schedule, is a fair sample of
   *  the biggest groups and none at all of the smallest.
   *
   *  THE FIFTEEN ARE `SEMANTIC_GROUPS` FROM `nba_peak/nba_facts/coverage.py`,
   *  in its order, so this sheet and the coverage audit are answering the same
   *  question about the same areas. The five extras are second draws from the
   *  areas that hold most of the bank: with 83 playoff facts and 80 record
   *  facts, one frame each is a thinner sample of them than of the areas that
   *  hold six.
   */
  const WANTED: [string, string][] = [
    ["foundational-history", "foundational_history"],
    ["obscure-history", "obscure_history"],
    ["current-nba", "current_nba"],
    ["playoffs-finals", "playoffs_finals"],
    ["records-oddities", "records_oddities"],
    ["draft", "draft"],
    ["tactics", "tactics"],
    ["rules", "rules"],
    ["global-international", "global_international"],
    ["fiba-olympics", "fiba_olympics"],
    ["international-leagues", "international_leagues"],
    ["womens", "womens"],
    ["culture", "culture"],
    ["geographic", "geographic"],
    ["connections", "connections"],
    ["playoffs-finals-2", "playoffs_finals"],
    ["records-oddities-2", "records_oddities"],
    ["foundational-history-2", "foundational_history"],
    ["global-international-2", "global_international"],
    ["current-nba-2", "current_nba"],
  ];

  for (const theme of ["dark", "light"] as const) {
    test(`twenty representative cards, one per semantic area — ${theme}`, async ({ browser }) => {
      test.setTimeout(420_000);
      const context = await browser.newContext({ viewport: DESKTOP });
      const page = await context.newPage();
      await page.addInitScript(
        (value) => window.localStorage.setItem("peak3-theme", value as string),
        theme,
      );
      const used = new Set<string>();
      const start = new Date("2026-08-06T00:00:00Z");
      const missing: string[] = [];
      try {
        let index = 0;
        for (const [slug, group] of WANTED) {
          const found = await findDate(page, group, start, used);
          if (!found) {
            // NAMED RATHER THAN SKIPPED SILENTLY. A slot with no fact in the
            // next four months is a gap in the bank, and the sheet should say
            // so rather than quietly producing nineteen frames.
            missing.push(`${slug} (${group})`);
            continue;
          }
          index += 1;
          await page.goto(`/?fact=${found.iso}`, { waitUntil: "domcontentloaded" });
          const panel = page.getByTestId("nba-fact-of-the-day");
          await expect(panel).toBeVisible({ timeout: 30_000 });
          // THE FRAME IS WHAT ITS FILENAME CLAIMS. A twenty-card sheet is
          // worthless if a name can disagree with its contents.
          expect(await panel.getAttribute("data-category")).toBe(found.category);
          expect(await panel.locator("table").count()).toBe(0);
          expect(await panel.locator("details").count()).toBe(0);
          // Every card has a focal point, whichever half of the bank it is from.
          await expect(panel.getByTestId("fotd-feature")).toBeVisible();
          await panel.scrollIntoViewIfNeeded();
          await shot(
            page,
            `fotd-${theme}-${String(index).padStart(2, "0")}-${slug}`,
            `${group} — ${found.category} on ${found.iso}`,
            false,
            true,
          );
        }
        if (missing.length) {
          // eslint-disable-next-line no-console
          console.warn(`no fact found for: ${missing.join("; ")}`);
        }
        expect(
          index,
          `fewer than eighteen categories produced a card: missing ${missing.join("; ")}`,
        ).toBeGreaterThanOrEqual(18);
      } finally {
        await context.close();
      }
    });
  }

  for (const theme of ["dark", "light"] as const) {
    test(`the card on a phone — ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: MOBILE });
      const page = await context.newPage();
      await page.addInitScript(
        (value) => window.localStorage.setItem("peak3-theme", value as string),
        theme,
      );
      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        const panel = page.getByTestId("nba-fact-of-the-day");
        await expect(panel).toBeVisible({ timeout: 30_000 });
        await panel.scrollIntoViewIfNeeded();
        const maxScrollX = await page.evaluate(() => {
          const before = window.scrollX;
          window.scrollTo(9999, 0);
          const after = window.scrollX;
          window.scrollTo(before, 0);
          return after;
        });
        expect(maxScrollX, "the fact card takes the page sideways").toBe(0);
        await shot(
          page,
          `fotd-mobile-${theme}`,
          "390px: the motif above the copy, not beside it",
          false,
          true,
        );
      } finally {
        await context.close();
      }
    });
  }
});

test.describe("82-0 leaderboard", () => {
  const ROWS = [
    {
      id: "run-a", display_name: "hoopsmith", mode: "apex_1y",
      game_type: "peak_season", game_id: "game-a", seed: 102,
      wins: 82, losses: 0, lineup_score: 91.4, score_status: "complete",
      exact_cards_scored: 8, total_cards: 8,
      team_respins_used: 0, season_respins_used: 0,
      data_version: null, formula_version: null, simulation_version: null,
      created_at: "2026-08-02T18:22:00.000Z",
    },
    {
      id: "run-b", display_name: "peakfan", mode: "apex_1y",
      game_type: "peak_season", game_id: "game-b", seed: 431465972,
      wins: 81, losses: 1, lineup_score: 77.3, score_status: "complete",
      exact_cards_scored: 8, total_cards: 8,
      team_respins_used: 2, season_respins_used: 2,
      data_version: null, formula_version: null, simulation_version: null,
      created_at: "2026-08-04T05:10:16.000Z",
    },
    {
      id: "run-c", display_name: "courtline", mode: "apex_1y",
      game_type: "peak_season", game_id: "game-c", seed: 771,
      wins: 79, losses: 3, lineup_score: 74.8, score_status: "complete",
      exact_cards_scored: 8, total_cards: 8,
      team_respins_used: 1, season_respins_used: 0,
      data_version: null, formula_version: null, simulation_version: null,
      created_at: "2026-07-29T11:04:00.000Z",
    },
  ];

  async function serve(page: Page, body: unknown): Promise<void> {
    await page.route("**/api/v1/perfect-season/leaderboard?*", (route) =>
      route.fulfill({ json: body }),
    );
  }

  for (const theme of ["dark", "light"] as const) {
    test(`a populated board in ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: DESKTOP });
      const page = await context.newPage();
      try {
        await page.addInitScript(
          (value) => window.localStorage.setItem("peak3-theme", value as string),
          theme,
        );
        // "Your best" is only fetched for a signed-in reader — the component
        // asks for a token before it asks for a placement, precisely so a
        // signed-out visitor makes no pointless request. The first capture
        // asserted the panel without signing in and correctly found nothing.
        await signIn(context, page, uniqueSub(`shot-lb-${theme}`));
        await serve(page, {
          leaderboard_enabled: true, next_cursor: "page-2",
          daily: false, daily_key: null, runs: ROWS,
        });
        await page.route("**/api/v1/perfect-season/leaderboard/me*", (route) =>
          route.fulfill({
            json: { leaderboard_enabled: true, mode: "apex_1y", rank: 2, run: ROWS[1] },
          }),
        );
        await page.goto("/arena/court/leaderboard", { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("leaderboard-table")).toBeVisible({ timeout: 30_000 });
        await dismissHandlePrompt(page);

        // The number one is unmistakable, and "your best" is on screen.
        expect(
          await page.getByTestId("leaderboard-row").first().getAttribute("data-leader"),
        ).toBe("true");
        await expect(page.getByTestId("ps-board-your-best")).toBeVisible();
        await expect(page.getByTestId("ps-board-more")).toBeVisible();
        await shot(
          page,
          `lb-01-populated-${theme}`,
          "Rank, name, record, score, date, seed, receipt; leader marked; your best highlighted",
        );
      } finally {
        await context.close();
      }
    });
  }

  test("the empty state", async ({ browser }) => {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    try {
      await serve(page, {
        leaderboard_enabled: true, next_cursor: null,
        daily: false, daily_key: null, runs: [],
      });
      await page.goto("/arena/court/leaderboard", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("ps-board-empty")).toBeVisible({ timeout: 30_000 });
      await shot(page, "lb-02-empty", "Enabled, reachable, and nobody has submitted yet");
    } finally {
      await context.close();
    }
  });

  test("the failure state, with a retry", async ({ browser }) => {
    // THE DEFECT THIS FRAME EXISTS FOR. A dropped request used to render the
    // sentence about a capability nobody had turned on.
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    try {
      await page.route("**/api/v1/perfect-season/leaderboard?*", (route) => route.abort());
      await page.goto("/arena/court/leaderboard", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("ps-board-failed")).toBeVisible({ timeout: 30_000 });
      expect(await page.getByTestId("ps-board-disabled").count()).toBe(0);
      await expect(page.getByTestId("ps-board-retry")).toBeVisible();
      await shot(page, "lb-03-failed", "A connection problem, said as one, with a retry that retries");
    } finally {
      await context.close();
    }
  });

  test("the disabled state", async ({ browser }) => {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    try {
      await serve(page, {
        leaderboard_enabled: false, next_cursor: null,
        daily: false, daily_key: null, runs: [],
      });
      await page.goto("/arena/court/leaderboard", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("ps-board-disabled")).toBeVisible({ timeout: 30_000 });
      expect(await page.getByTestId("ps-board-failed").count()).toBe(0);
      await shot(page, "lb-04-disabled", "The server said so — and says the runs are not lost");
    } finally {
      await context.close();
    }
  });

  test("the board on a phone", async ({ browser }) => {
    const context = await browser.newContext({ viewport: MOBILE });
    const page = await context.newPage();
    try {
      await serve(page, {
        leaderboard_enabled: true, next_cursor: null,
        daily: false, daily_key: null, runs: ROWS,
      });
      await page.goto("/arena/court/leaderboard", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("leaderboard-table")).toBeVisible({ timeout: 30_000 });
      // WHAT A USER CAN ACTUALLY DO, not what the root box reports.
      //
      // The first version of this used the repository's usual probe,
      // `documentElement.scrollWidth - clientWidth`, and got 238 — while
      // `body.scrollWidth` was 390 and the page could not be scrolled
      // sideways by a single pixel. Chromium counts a nested scroll
      // container's layout overflow in the ROOT element's `scrollWidth` even
      // though it is clipped and unreachable, so the usual probe reports a
      // phantom on any page with a horizontally-scrolling region. That probe
      // is correct everywhere else in this suite and wrong precisely here.
      //
      // Trying to scroll and reading how far it went cannot report a phantom.
      const maxScrollX = await page.evaluate(() => {
        const before = window.scrollX;
        window.scrollTo(9999, 0);
        const after = window.scrollX;
        window.scrollTo(before, 0);
        return after;
      });
      expect(maxScrollX, "the page scrolls sideways on a phone").toBe(0);
      await shot(page, "lb-05-mobile", "390px: the table scrolls inside its own box");
    } finally {
      await context.close();
    }
  });
});

test.describe("Theme", () => {
  test("one click, both directions, captured at each end", async ({ browser }) => {
    // A LIGHT-MODE OS, which is the configuration the three-state cycle was
    // broken under: from "light" the next preference was "system", which
    // resolves back to light and changed nothing visible.
    const context = await browser.newContext({ viewport: DESKTOP, colorScheme: "light" });
    const page = await context.newPage();
    try {
      await page.goto("/rankings", { waitUntil: "domcontentloaded" });
      const toggle = page.getByTestId("theme-toggle").first();
      await expect(toggle).toBeVisible({ timeout: 30_000 });
      // THE BOARD IS LOADED BEFORE ANY OF THIS. The theme frames used to be
      // taken on an empty table, which shows a palette applied to nothing.
      await expect(page.locator('[data-testid="rankings-row"]').first()).toBeVisible({
        timeout: 30_000,
      });

      const themeOf = () =>
        page.evaluate(() => document.documentElement.getAttribute("data-theme"));

      for (let index = 0; index < 4; index += 1) {
        const before = await themeOf();
        await toggle.click();
        await expect
          .poll(themeOf, {
            timeout: 3_000,
            message: `click ${index + 1} did not change the theme (still ${before})`,
          })
          .not.toBe(before);
        const now = await themeOf();
        if (index < 2) {
          // LET THE PALETTE LAND. `data-theme` flips on the attribute; the
          // colours cross-fade after it, and a frame taken on the flip caught
          // the nav still wearing the OTHER theme's ink -- the `theme-01-light`
          // frame measured 2.58:1 for a link that measures 8.9:1 once settled,
          // which would have been read as a contrast defect that is not there.
          await page.waitForTimeout(600);
          await shot(page, `theme-0${index + 1}-${now}`, `Click ${index + 1}: ${before} -> ${now}`);
        }
      }
    } finally {
      await context.close();
    }
  });
});
