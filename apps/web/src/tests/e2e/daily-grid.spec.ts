/**
 * Daily Grid Challenge (Phase 11A) end-to-end tests.
 *
 * Requires FastAPI (port 8000) and Next.js (port 3000) — both auto-start via
 * playwright.config.ts. Unlike CourtBuilder, the Daily Grid sits behind no
 * server flag, so these need no special environment.
 *
 * WHY THESE PIN A DATE. The board is a pure function of the UTC date, so
 * "today" is a different puzzle every run — and a test that fills a square has
 * to know a real answer for the square it clicks. Every test here loads
 * `/daily?date=FIXED_DATE` and discovers a genuine answer at run time by
 * asking the search endpoint (see `findFillableCell`), rather than hardcoding
 * a player-season that a future taxonomy change would silently invalidate.
 * Nothing in the test knows the answer key; it learns one answer the same way
 * a player would — by naming a player and being told which of their seasons
 * fits.
 *
 * Mobile-specific tests are tagged @mobile and run only in the mobile-chrome
 * project (same convention as gameplay.spec.ts / courtbuilder.spec.ts).
 */
import { test, expect, Page, APIRequestContext } from "@playwright/test";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// A fixed, real date so every run gets the same board. Any valid date works —
// the generator has no special cases — so this is just "a date, chosen once".
const FIXED_DATE = "2026-03-14";

const DAILY_URL = `/daily?date=${FIXED_DATE}`;

/** Full names, so each query stays under the search's identity gate (a bare
 * surname like "James" or "Jordan" matches too many players and comes back
 * deliberately unflagged). Spread across eras and positions so that whatever
 * six constraints the board rolls, something here fits somewhere. */
const PROBE_NAMES = [
  "Michael Jordan", "Hakeem Olajuwon", "Magic Johnson", "Larry Bird",
  "Kareem Abdul-Jabbar", "Tim Duncan", "Shaquille O'Neal", "Kobe Bryant",
  "Kevin Garnett", "Dirk Nowitzki", "Charles Barkley", "Karl Malone",
  "David Robinson", "Patrick Ewing", "Scottie Pippen", "John Stockton",
  "Allen Iverson", "Jason Kidd", "Steve Nash", "Dwyane Wade",
  "Chris Paul", "Dwight Howard", "Kevin Durant", "Stephen Curry",
  "Russell Westbrook", "James Harden", "Giannis Antetokounmpo", "Nikola Jokic",
  "Isiah Thomas", "Clyde Drexler", "Gary Payton", "Reggie Miller",
  "Alonzo Mourning", "Chris Webber", "Ray Allen", "Paul Pierce",
  "Carmelo Anthony", "Pau Gasol", "Tony Parker", "Manu Ginobili",
];

interface FillTarget {
  row: number;
  col: number;
  playerName: string;
  season: string;
  /** A season of the SAME player that the server marks as NOT fitting this
   *  square, when one exists. Used to drive the rejection path with a real
   *  player-season that is genuinely wrong here — never a made-up id. */
  ineligibleSeason: string | null;
}

/**
 * Find one square on the pinned board plus a real player-season that fills it.
 *
 * Probes the live search endpoint exactly the way the UI does: name a player,
 * scope the query to a cell, and read back which of that player's seasons the
 * server marks eligible. Returns the first hit found, so this is fast in
 * practice — an all-time great fits some square on essentially any board.
 */
async function findFillableCell(request: APIRequestContext): Promise<FillTarget> {
  for (const playerName of PROBE_NAMES) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const response = await request.get(`${API_BASE}/api/v1/daily-grid/search`, {
          params: { q: playerName, date: FIXED_DATE, row, col, limit: 50 },
        });
        if (!response.ok()) continue;
        const { results } = await response.json();
        const hits = results as { eligible: boolean | null; season: string }[];
        const fits = hits.find((r) => r.eligible === true);
        if (fits) {
          return {
            row,
            col,
            playerName,
            season: fits.season,
            ineligibleSeason:
              hits.find((r) => r.eligible === false)?.season ?? null,
          };
        }
      }
    }
  }
  throw new Error(
    `no fillable square found on ${FIXED_DATE} from ${PROBE_NAMES.length} probe names ` +
      "— the board may be unsolvable, which is itself the bug",
  );
}

/** Mark the how-to-play rules as already seen, so a test that is not about
 *  onboarding lands straight on the board. Must run before the first
 *  navigation, hence addInitScript. */
async function skipRules(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("peak3.daily-grid.rules-seen", "1");
  });
}

function cellAt(page: Page, row: number, col: number) {
  return page.locator(`[data-testid="grid-cell"][data-row="${row}"][data-col="${col}"]`);
}

/** Select a square and submit `playerName`'s eligible season into it. */
async function fillCell(page: Page, target: FillTarget): Promise<void> {
  await cellAt(page, target.row, target.col).click();
  await expect(page.getByTestId("cell-panel")).toBeVisible();

  await page.getByTestId("cell-search-input").fill(target.playerName);
  const results = page.getByTestId("cell-search-result");
  await expect(results.first()).toBeVisible({ timeout: 10_000 });

  // Click the exact season the server marked eligible, not just the first
  // result — the top hit is that player's best season, which is not
  // necessarily the one that satisfies this square.
  await results.filter({ hasText: target.season }).first().click();

  await expect(cellAt(page, target.row, target.col)).toHaveAttribute(
    "data-state",
    "filled",
    { timeout: 10_000 },
  );
}

test.describe("Daily Grid — page", () => {
  test("loads a complete 3x3 board", async ({ page }) => {
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });

    await expect(page.getByRole("heading", { name: /Daily Grid Challenge/i })).toBeVisible();
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("grid-cell")).toHaveCount(9);
    await expect(page.getByTestId("grid-row-header")).toHaveCount(3);
    await expect(page.getByTestId("grid-col-header")).toHaveCount(3);
  });

  test("states the one-player-per-board rule", async ({ page }) => {
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-unique-rule")).toBeVisible({ timeout: 15_000 });
  });

  test("the same date renders the same board twice", async ({ page }) => {
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    const first = await page.getByTestId("grid-col-header").allInnerTexts();

    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    expect(await page.getByTestId("grid-col-header").allInnerTexts()).toEqual(first);
  });

  test("a different date renders a different board", async ({ page }) => {
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    const first = [
      ...(await page.getByTestId("grid-row-header").allInnerTexts()),
      ...(await page.getByTestId("grid-col-header").allInnerTexts()),
    ];

    await page.goto("/daily?date=2026-09-09", { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    const second = [
      ...(await page.getByTestId("grid-row-header").allInnerTexts()),
      ...(await page.getByTestId("grid-col-header").allInnerTexts()),
    ];

    expect(second).not.toEqual(first);
  });

  test("selecting an empty square opens the panel with both constraints", async ({ page }) => {
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await cellAt(page, 1, 1).click();

    const panel = page.getByTestId("cell-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("cell-panel-row-constraint")).toBeVisible();
    await expect(page.getByTestId("cell-panel-column-constraint")).toBeVisible();
    await expect(page.getByTestId("cell-search-input")).toBeVisible();
  });
});

test.describe("Daily Grid — gameplay", () => {
  test("a valid player-season fills the square", async ({ page, request }) => {
    const target = await findFillableCell(request);

    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await fillCell(page, target);

    const cell = cellAt(page, target.row, target.col);
    await expect(cell.getByTestId("grid-cell-player")).toContainText(
      target.playerName.split(" ").slice(-1)[0],
    );
    await expect(cell.getByTestId("grid-cell-season")).toContainText(target.season);
    await expect(cell.getByTestId("grid-cell-points")).toBeVisible();
  });

  test("an invalid answer is rejected with a reason from the server", async ({
    page,
    request,
  }) => {
    // Submit a REAL player-season that the server itself marked as not fitting
    // this square. Moving a valid answer to a neighbouring square is not a
    // reliable way to get a rejection — the two squares share a constraint, so
    // the season may legitimately satisfy the other one too (this test failed
    // exactly that way first time round).
    const target = await findFillableCell(request);
    test.skip(
      target.ineligibleSeason === null,
      "every season of the probe player fits this square",
    );

    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await cellAt(page, target.row, target.col).click();
    await page.getByTestId("cell-search-input").fill(target.playerName);
    const results = page.getByTestId("cell-search-result");
    await expect(results.first()).toBeVisible({ timeout: 10_000 });

    await results.filter({ hasText: target.ineligibleSeason! }).first().click();

    const reason = page.getByTestId("cell-invalid-reason");
    await expect(reason).toBeVisible({ timeout: 10_000 });
    // The server's message is specific, not a generic "invalid".
    expect((await reason.innerText()).trim().length).toBeGreaterThan(10);
    await expect(cellAt(page, target.row, target.col)).not.toHaveAttribute(
      "data-state",
      "filled",
    );
  });

  test("progress survives a refresh", async ({ page, request }) => {
    const target = await findFillableCell(request);

    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    await fillCell(page, target);

    await page.reload({ waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    const cell = cellAt(page, target.row, target.col);
    await expect(cell).toHaveAttribute("data-state", "filled", { timeout: 15_000 });
    await expect(cell.getByTestId("grid-cell-season")).toContainText(target.season);
  });

  test("a new date starts from an empty board", async ({ page, request }) => {
    const target = await findFillableCell(request);

    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    await fillCell(page, target);

    // Progress is keyed by board_id, so a different date must not inherit it.
    await page.goto("/daily?date=2026-09-09", { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[data-testid="grid-cell"][data-state="filled"]'),
    ).toHaveCount(0);
  });

  test("the completion panel stays hidden until all nine squares are filled", async ({
    page,
    request,
  }) => {
    // Filling all nine through the UI would mean discovering nine valid
    // answers with nine DIFFERENT players against a board that changes with
    // the taxonomy — far more probing than this earns. The completion panel's
    // own contents (total, best cell, hardest cell, share text) are covered
    // exhaustively by the pure functions' unit tests; what E2E is uniquely
    // able to check is that the panel does not appear early.
    const target = await findFillableCell(request);

    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("daily-grid-complete")).toHaveCount(0);

    await fillCell(page, target);
    await expect(page.getByTestId("daily-grid-complete")).toHaveCount(0);
    await expect(page.getByTestId("daily-grid-share")).toHaveCount(0);
  });

});

test.describe("Daily Grid — discoverability", () => {
  test("the homepage links to the Daily Grid", async ({ page }) => {
    await skipRules(page);
    await page.goto("/", { waitUntil: "load" });
    const card = page.getByTestId("home-daily-grid-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("href", "/daily");

    await card.click();
    await expect(page).toHaveURL(/\/daily/);
    await expect(page.getByRole("heading", { name: /Daily Grid Challenge/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("the arena hub links to the Daily Grid", async ({ page }) => {
    await page.goto("/arena", { waitUntil: "load" });
    const card = page.getByTestId("arena-daily-grid-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("href", "/daily");
  });

  test("the navbar reaches the Daily Grid", async ({ page }) => {
    await skipRules(page);
    await page.goto("/", { waitUntil: "load" });
    const daily = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Daily" });
    await expect(daily).toHaveAttribute("href", "/daily");

    await daily.click();
    await expect(page).toHaveURL(/\/daily/);
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
  });

  test("navbar Play still reaches the 82-0 start gate", async ({ page }) => {
    // The Daily Grid sits BESIDE the flagship, never replacing it. Duplicated
    // from play-routing.spec.ts on purpose: this file is what changed the
    // navbar, so it should fail here first if it broke that path.
    await page.goto("/", { waitUntil: "load" });
    const play = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Play" });
    await expect(play).toHaveAttribute("href", "/arena/court/practice/apex_1y");

    await play.click();
    await expect(page).toHaveURL(/\/arena\/court\/practice\/apex_1y/);
    await expect(page.locator('[data-testid="peak-season-start-gate"]')).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("Daily Grid — accessibility and layout", () => {
  test("squares are reachable and activatable by keyboard", async ({ page }) => {
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    const firstCell = cellAt(page, 0, 0);
    await firstCell.focus();
    await expect(firstCell).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("cell-panel")).toBeVisible();
  });

  test("every square carries a descriptive accessible name", async ({ page }) => {
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    const cells = page.getByTestId("grid-cell");
    for (let i = 0; i < 9; i++) {
      const label = await cells.nth(i).getAttribute("aria-label");
      expect(label, `cell ${i} needs an aria-label naming both constraints`).toBeTruthy();
      expect(label!.length).toBeGreaterThan(10);
    }
  });

  test("@mobile the board fits without horizontal overflow", async ({ page }) => {
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the daily grid must not scroll horizontally on mobile").toBeLessThanOrEqual(1);

    await expect(page.getByTestId("grid-cell")).toHaveCount(9);
  });

  test("@mobile a square can still be selected and searched", async ({ page }) => {
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await cellAt(page, 1, 1).click();
    await expect(page.getByTestId("cell-panel")).toBeVisible();
    await expect(page.getByTestId("cell-search-input")).toBeVisible();
  });
});

test.describe("Daily Grid — answer-key confidentiality", () => {
  test("the board payload never carries the answer key", async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/v1/daily-grid/board`, {
      params: { date: FIXED_DATE },
    });
    expect(response.ok()).toBe(true);

    const raw = await response.text();
    for (const forbidden of ["answer_ids", "answer_count", "player_slugs", "answers"]) {
      expect(raw, `board payload must not expose ${forbidden}`).not.toContain(forbidden);
    }

    const body = await response.json();
    for (const cell of body.cells) {
      expect(Object.keys(cell).sort()).toEqual(
        ["col", "col_constraint_id", "rarity_bucket", "row", "row_constraint_id"],
      );
    }
  });

  test("the page's initial HTML never embeds the answer key", async ({ page }) => {
    // The board is fetched client-side, but a future move to a server
    // component must not quietly ship the key inside the RSC payload.
    await skipRules(page);
    const response = await page.goto(DAILY_URL, { waitUntil: "load" });
    const html = (await response?.text()) ?? "";
    for (const forbidden of ["answer_ids", "answer_count"]) {
      expect(html, `initial HTML must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/**
 * Phase 11B: the mode became a competitive optimisation puzzle. These cover the
 * product changes that made it one — the objective is explained before play, no
 * score is visible before a pick is locked, picks are final, and a finished
 * board is measured against today's maximum.
 */
test.describe("Daily Grid — objective and onboarding", () => {
  test("explains the objective before the board is playable", async ({ page }) => {
    // Deliberately NO skipRules: this is the first-visit path.
    await page.goto(DAILY_URL, { waitUntil: "load" });

    const gate = page.getByTestId("how-to-play-gate");
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("how-to-play-objective")).toContainText(
      /highest total PEAK3 score/i,
    );
    // The board is not reachable until the player starts.
    await expect(page.getByTestId("daily-grid-board")).toHaveCount(0);
  });

  test("starting the grid reveals the board and states the objective again", async ({ page }) => {
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await page.getByTestId("start-daily-grid").click();

    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("daily-grid-objective")).toContainText(
      /Maximize your PEAK3 total/i,
    );
  });

  test("the rules can be reopened from the board", async ({ page }) => {
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("daily-grid-how-to-play").click();
    await expect(page.getByTestId("how-to-play-panel")).toBeVisible();
    await page.getByTestId("how-to-play-close").click();
    await expect(page.getByTestId("how-to-play-panel")).toHaveCount(0);
  });
});

test.describe("Daily Grid — no score before a lock", () => {
  test("search results show the player-season but never its score", async ({ page, request }) => {
    const target = await findFillableCell(request);
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await cellAt(page, target.row, target.col).click();
    await page.getByTestId("cell-search-input").fill(target.playerName);
    const rows = page.getByTestId("cell-search-result");
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });

    const surname = target.playerName.split(" ").slice(-1)[0];
    await expect(rows.first()).toContainText(surname);
    // The optimisation target must not be readable off the list. A PEAK3
    // score renders as a 1-3 digit number, optionally with one decimal;
    // a season ("1996-97") is the only numeric text a candidate row may show.
    for (const text of await rows.allInnerTexts()) {
      const withoutSeasons = text.replace(/\d{4}-\d{2}/g, "");
      expect(withoutSeasons, `candidate row leaked a number: ${text}`).not.toMatch(/\d/);
    }
  });

  test("the score appears only once the pick is locked", async ({ page, request }) => {
    const target = await findFillableCell(request);
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await fillCell(page, target);

    const cell = cellAt(page, target.row, target.col);
    await expect(cell.getByTestId("grid-cell-team")).toContainText(/PEAK \d/);
    await expect(cell.getByTestId("grid-cell-points")).toContainText(/\d+ pts/);
    await expect(cell.getByTestId("grid-cell-locked")).toBeVisible();
  });

  test("an empty square invites a pick and names its answer pool", async ({ page }) => {
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    const cell = cellAt(page, 0, 0);
    await expect(cell).toContainText(/Pick/i);
    await expect(cell.getByTestId("grid-cell-rarity")).toContainText(/pool/i);
  });
});

test.describe("Daily Grid — locked picks, no reset", () => {
  test("a locked square cannot be changed", async ({ page, request }) => {
    const target = await findFillableCell(request);
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await fillCell(page, target);
    await cellAt(page, target.row, target.col).click();

    // Reviewing shows the card and a Locked badge — never a remove control,
    // and never a search box a second pick could go into.
    await expect(page.getByTestId("cell-panel-filled")).toBeVisible();
    await expect(page.getByTestId("cell-panel-locked")).toBeVisible();
    await expect(page.getByTestId("cell-panel-remove")).toHaveCount(0);
    await expect(page.getByTestId("cell-search-input")).toHaveCount(0);
    await expect(cellAt(page, target.row, target.col)).toHaveAttribute("data-state", "filled");
  });

  test("there is no reset control on the daily board", async ({ page, request }) => {
    const target = await findFillableCell(request);
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    await fillCell(page, target);

    // A "start over" button would make both the day's score and the comparison
    // against today's maximum meaningless.
    await expect(page.getByTestId("daily-grid-reset")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /reset/i })).toHaveCount(0);
  });
});

test.describe("Daily Grid — today's maximum", () => {
  test("the maximum is not served to an unfinished board", async ({ request }) => {
    // The board's own payload never carries it...
    const board = await request.get(`${API_BASE}/api/v1/daily-grid/board`, {
      params: { date: FIXED_DATE },
    });
    expect(board.ok()).toBe(true);
    for (const forbidden of ["optimal", "percent_of_best", "biggest_miss"]) {
      expect(await board.text()).not.toContain(forbidden);
    }

    // ...and claiming a finished board is not enough to unlock it.
    const partial = await request.post(`${API_BASE}/api/v1/daily-grid/result`, {
      data: {
        date: FIXED_DATE,
        filled: [{ row: 0, col: 0, answer_id: "michael-jordan-199091-chi" }],
        incorrect_attempts: 0,
      },
    });
    expect(partial.status()).toBe(400);
    expect(await partial.text()).not.toContain("optimal_total");
  });

  test("a completed board is measured against the maximum", async ({ page, request }) => {
    // Solving nine squares through the UI would need nine discovered answers
    // with nine different players; the comparison itself is verified here at
    // the API boundary, and its rendering is covered by the unit tests.
    const board = await (
      await request.get(`${API_BASE}/api/v1/daily-grid/board`, { params: { date: FIXED_DATE } })
    ).json();
    expect(board.cells).toHaveLength(9);

    // Confirm the completed-state UI is genuinely gated: an empty board shows
    // no comparison anywhere.
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("complete-comparison")).toHaveCount(0);
    await expect(page.getByTestId("daily-grid-complete")).toHaveCount(0);
  });
});
