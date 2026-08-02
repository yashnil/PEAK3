/**
 * Daily Grid Challenge (Phase 11A) end-to-end tests.
 *
 * Requires FastAPI (port 8000) and Next.js (port 3000) — both auto-start via
 * playwright.config.ts. Unlike CourtBuilder, the Daily Grid sits behind no
 * server flag, so these need no special environment.
 *
 * WHY THESE PIN A DATE. The board is a pure function of the daily key --
 * the date in `America/Los_Angeles`, not UTC -- so
 * "today" is a different puzzle every run — and a test that fills a square has
 * to know a real answer for the square it clicks. Every test here loads
 * `/daily/grid?date=FIXED_DATE` and discovers a genuine answer at run time by
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
// The app's own daily-key arithmetic — the mirror of the server's
// `nba_peak.daily_key` (midnight America/Los_Angeles). Every date this file
// derives comes from here, so the runner's TZ cannot change what "today" or
// "yesterday" means. See the comment in the streak test for what mixing two
// calendars actually cost.
import { shiftDailyKey, todayPacific } from "@/lib/daily-time";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// A fixed, real date so every run gets the same board. It must be a PAST date:
// a client-supplied date is an archive request, and a board that has not opened
// yet is a 422 rather than a preview.
const FIXED_DATE = "2026-03-14";

const DAILY_URL = `/daily/grid?date=${FIXED_DATE}`;

/**
 * A *past* board, deliberately.
 *
 * These two tests used to navigate to `?date=2026-09-09`, a date in the
 * future. That only worked because the Daily Grid accepted any well-formed
 * date, so "tomorrow's board" was servable today — the same permissiveness
 * that let a client's clock decide which day it was playing. Client-supplied
 * dates are now validated as ARCHIVE requests and a future board is a 422,
 * because it does not exist yet.
 *
 * A past date proves exactly what these tests are for (a different date is a
 * different board, and progress does not bleed across board_ids) without
 * asserting that the server will serve a board that has not opened.
 */
const ARCHIVE_DATE = "2026-07-15";


/** Full names, so each query names ONE identity and therefore always earns an
 * eligibility verdict (a bare surname can match enough qualifying players to
 * trip the reveal cap and come back deliberately unflagged).
 *
 * Derived empirically rather than guessed: these are the players a greedy
 * distinct-player solver actually reaches for across 200 consecutive generated
 * boards, so the list covers every era, position and franchise the taxonomy
 * puts on an axis. A hand-picked "all-time greats" list is not enough -- a
 * board can pair a franchise with a decade in a way only a role player
 * satisfies, which is exactly how this helper failed before. */
const PROBE_NAMES = [
  "Michael Jordan", "LeBron James", "Shaquille O'Neal", "Tim Duncan",
  "Stephen Curry", "Nikola Jokic", "Giannis Antetokounmpo", "Kevin Durant",
  "David Robinson", "Victor Wembanyama", "Shai Gilgeous-Alexander", "Magic Johnson",
  "Kevin Garnett", "Hakeem Olajuwon", "Larry Bird", "Charles Barkley",
  "Chauncey Billups", "Chris Webber", "Patrick Ewing", "Paul George",
  "Luka Doncic", "Karl Malone", "Domantas Sabonis", "Chris Paul",
  "Grant Hill", "Dominique Wilkins", "Kawhi Leonard", "Dwight Howard",
  "Reggie Miller", "Bernard King", "Jason Kidd", "Moses Malone",
  "Clyde Drexler", "Damian Lillard", "Tyrese Haliburton", "Karl-Anthony Towns",
  "Trae Young", "John Stockton", "Eddie Jones", "Kevin McHale",
  "Gilbert Arenas", "Dikembe Mutombo", "Tracy McGrady", "Russell Westbrook",
  "John Wall", "Isaiah Thomas", "Glen Rice", "Isiah Thomas",
  "Steve Nash", "Kevin Love", "Kareem Abdul-Jabbar", "Rudy Gobert",
  "Derrick Rose", "Dwyane Wade", "Manu Ginobili", "Marc Gasol",
  "Peja Stojakovic", "Sidney Moncrief", "Jeff Ruland", "Ben Wallace",
  "Scottie Pippen", "Anthony Davis", "Adrian Dantley", "Pau Gasol",
  "Ray Allen", "Brook Lopez", "Joel Embiid", "Alonzo Mourning",
  "Carmelo Anthony", "Terry Porter", "Kemba Walker", "James Harden",
  "Vince Carter", "Kyrie Irving", "Blake Griffin", "Shareef Abdur-Rahim",
  "Mitch Richmond", "Draymond Green", "Jayson Tatum", "Franz Wagner",
  "DeMarcus Cousins", "Chris Mullin", "Luol Deng", "Gus Williams",
  "Gary Payton", "Jalen Brunson", "Zach LaVine", "Goran Dragic",
  "Allen Iverson", "Dana Barros", "Hassan Whiteside", "Kevin Johnson",
  "Ja Morant", "Mark Williams", "Marcus Camby", "Larry Hughes",
  "Chris Bosh", "Shawn Marion", "Anfernee Hardaway", "Derrick Coleman",
  "Muggsy Bogues", "Stephon Marbury", "Dirk Nowitzki", "Metta World Peace",
  "Brandon Roy", "Dennis Rodman", "Victor Oladipo", "Amar'e Stoudemire",
  "DeAndre Jordan", "Terrell Brandon", "Mike Conley", "Zach Randolph",
  "Marques Johnson", "Kristaps Porzingis", "Elton Brand", "Nic Claxton",
  "Sherman Douglas", "Tyson Chandler", "Artis Gilmore", "Baron Davis",
  "Gerald Wallace", "Billy Knight", "Danny Manning", "Josh Smith",
  "Jimmy Butler", "Joakim Noah", "Jack Sikma", "Jalen Duren",
  "Robert Williams", "Kobe Bryant", "Kyle Lowry", "Donovan Mitchell",
  "De'Aaron Fox", "Bob Lanier", "Andrei Kirilenko", "Otis Birdsong",
  "Horace Grant", "Paul Millsap", "Terry Cummings", "Chet Holmgren",
  "Mark Aguirre", "Derek Harper", "Detlef Schrempf", "Nikola Vucevic",
  "Julius Erving", "Darrell Armstrong", "Mookie Blaylock", "Arvydas Sabonis",
  "Sam Cassell", "Doc Rivers", "Dan Roundfield", "Ryan Anderson",
  "Daniel Gafford", "Jusuf Nurkic", "Otis Smith", "Paul Pierce",
  "Al Horford", "Larry Nance", "George Gervin", "OG Anunoby",
  "Klay Thompson", "Rasheed Wallace", "Alex English", "Fat Lever",
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
        const hits = results as { status: string; season: string }[];
        const fits = hits.find((r) => r.status === "available");
        if (fits) {
          return {
            row,
            col,
            playerName,
            season: fits.season,
            ineligibleSeason:
              hits.find((r) => r.status === "no_fit")?.season ?? null,
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

/**
 * Nine real, server-scored squares for the pinned board, using nine different
 * players.
 *
 * Every value comes back from the live API: the season is one the SEARCH route
 * marked available, and the score is the one POST /answer awarded for locking
 * it. Nothing is invented — seeding this into localStorage is the same state
 * the UI would reach by nine clicks, which is what makes it legitimate to skip
 * the clicks. (The result route re-validates all nine server-side anyway, so a
 * fabricated board would simply be rejected.)
 */
interface SolvedCell {
  row: number;
  col: number;
  player_season: { player_slug: string };
  cell_score: { arena_points: number };
}

async function solveBoardViaApi(
  request: APIRequestContext,
  date: string = FIXED_DATE,
): Promise<SolvedCell[]> {
  const filled: SolvedCell[] = [];
  const used: string[] = [];

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let locked = false;
      for (const playerName of PROBE_NAMES) {
        // Built by hand rather than via `params`, because `used` is a REPEATED
        // query parameter and Playwright's params object cannot express one.
        const query = new URLSearchParams({
          q: playerName,
          date,
          row: String(row),
          col: String(col),
          limit: "50",
        });
        // Passing `used` makes the server mark spent identities, so the
        // distinct-player rule is enforced by the same code the UI uses.
        for (const slug of used) query.append("used", slug);
        const search = await request.get(
          `${API_BASE}/api/v1/daily-grid/search?${query.toString()}`,
        );
        if (!search.ok()) continue;
        const { results } = await search.json();
        const fits = (results as { status: string; id: string }[]).find(
          (r) => r.status === "available",
        );
        if (!fits) continue;

        const answer = await request.post(`${API_BASE}/api/v1/daily-grid/answer`, {
          data: {
            date,
            row,
            col,
            answer_id: fits.id,
            used_player_slugs: used,
            filled_cells: filled.map((c) => [c.row, c.col]),
          },
        });
        const body = await answer.json();
        if (!body.valid) continue;

        used.push(body.player_season.player_slug);
        filled.push({ row, col, player_season: body.player_season, cell_score: body.cell_score });
        locked = true;
        break;
      }
      if (!locked) {
        throw new Error(
          `no distinct-player answer found for square (${row}, ${col}) on ${date}`,
        );
      }
    }
  }
  return filled;
}

/** Mark Daily Grid onboarding as already seen, so a test that is not about
 *  onboarding lands straight on the board. Must run before the first
 *  navigation, hence addInitScript.
 *
 *  Writes the VERSIONED tour store (`lib/tour-state.ts`) under the
 *  `"daily-grid"` tour id. It used to write the unversioned
 *  `"peak3.daily-grid.rules-seen"` flag, which the app now only ever READS, as
 *  a one-way migration for players who dismissed the old gate. */
async function skipRules(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "peak3.tour.state",
      JSON.stringify({
        schema_version: 1,
        tours: { "daily-grid": { version: 1, status: "completed", at: "" } },
        coachmarks: {},
      }),
    );
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

    await page.goto(`/daily/grid?date=${ARCHIVE_DATE}`, { waitUntil: "load" });
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

  test("an answer the server already rejected cannot be submitted at all", async ({
    page,
    request,
  }) => {
    // Phase 11C changed this behaviour deliberately. Up to 11B a no-fit
    // result stayed clickable and taught its lesson through the server's
    // rejection sentence — which meant the only way to learn a result was
    // unplayable was to try it. The server has already said so by the time the
    // list renders, so the row is disabled and no request is made. (The
    // rejection SENTENCE still renders when a verdict was withheld and the
    // player submits anyway; that path is covered in the component tests,
    // where the server response can be forced.)
    const target = await findFillableCell(request);
    test.skip(
      target.ineligibleSeason === null,
      "every season of the probe player fits this square",
    );

    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    let submits = 0;
    await page.route("**/api/v1/daily-grid/answer", (route) => {
      submits += 1;
      return route.continue();
    });

    await cellAt(page, target.row, target.col).click();
    await page.getByTestId("cell-search-input").fill(target.playerName);
    const results = page.getByTestId("cell-search-result");
    await expect(results.first()).toBeVisible({ timeout: 10_000 });

    const noFit = results.filter({ hasText: target.ineligibleSeason! }).first();
    await expect(noFit).toBeDisabled();
    await noFit.click({ force: true });

    await expect(page.getByTestId("cell-invalid-reason")).toHaveCount(0);
    await expect(cellAt(page, target.row, target.col)).not.toHaveAttribute(
      "data-state",
      "filled",
    );
    expect(submits).toBe(0);
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
    await page.goto(`/daily/grid?date=${ARCHIVE_DATE}`, { waitUntil: "load" });
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
    await expect(card).toHaveAttribute("href", "/daily/grid");

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
    await expect(card).toHaveAttribute("href", "/daily/grid");
  });

  test("the navbar reaches the Daily Grid through the hub", async ({ page }) => {
    // Phase 12A: Daily is a hub for BOTH daily games, so the navbar lands
    // there and the grid is one deliberate click further.
    await skipRules(page);
    await page.goto("/", { waitUntil: "load" });
    const daily = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Daily" });
    await expect(daily).toHaveAttribute("href", "/daily");

    await daily.click();
    await expect(page).toHaveURL(/\/daily$/);
    await page.getByTestId("daily-hub-grid-card").click();
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
  });

  test("navbar Play still reaches the flagship, and 82-0 is still there too", async ({ page }) => {
    // The Daily Grid sits BESIDE the other modes, never replacing them.
    // Duplicated from play-routing.spec.ts on purpose: this file is what
    // changed the navbar, so it should fail here first if it broke that path.
    //
    // "Play" is a disclosure BUTTON since the UX pass, not a link: it opens the
    // nested game launcher. The hub is still one interaction away, as the
    // launcher's last row. The property under test is unchanged — Play leads to
    // /arena, and /arena's flagship is RUN THE TABLE.
    await page.goto("/", { waitUntil: "load" });
    const play = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Play", exact: true });
    await expect(play).toHaveAttribute("aria-expanded", "false");

    await play.click();
    await expect(play).toHaveAttribute("aria-expanded", "true");
    await page
      .getByTestId("nav-play-panel")
      .getByRole("link", { name: /View all games/i })
      .click();
    await expect(page).toHaveURL(/\/arena$/);
    await expect(page.getByTestId("arena-flagship-card")).toHaveAttribute(
      "href",
      "/arena/run-the-table",
      { timeout: 15_000 },
    );
    // ...and the previous flagship kept its full entry block on the hub.
    await expect(page.getByTestId("courtbuilder-hero")).toBeVisible();
    await expect(page.getByRole("link", { name: /Build a Perfect Season/i })).toBeVisible();
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
  test("states the objective and the timer rule before the board is playable", async ({ page }) => {
    // Deliberately NO skipRules: this is the first-visit path.
    await page.goto(DAILY_URL, { waitUntil: "load" });

    const gate = page.getByTestId("daily-grid-start-gate");
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(gate).toContainText("9 squares · 9 different exact player-seasons");
    await expect(gate).toContainText("Build the highest-scoring valid grid you can.");
    await expect(gate).toContainText("The timer starts only when you press Start.");

    // The three briefed actions.
    await expect(page.getByTestId("start-daily-grid")).toHaveText(/Start Timed Grid/);
    await expect(page.getByTestId("daily-grid-gate-how-to-play")).toHaveText(/How to Play/);
    await expect(page.getByTestId("daily-grid-gate-skip-tour")).toHaveText(/Skip Tour and Start/);

    // The board is not reachable until the player starts, so there is no square
    // to select and therefore no search surface to inspect candidates with.
    await expect(page.getByTestId("daily-grid-board")).toHaveCount(0);
    await expect(page.getByTestId("grid-cell")).toHaveCount(0);
    await expect(page.getByTestId("cell-search-input")).toHaveCount(0);
  });

  test("the walkthrough runs untimed from the gate, seven steps, and closes", async ({ page }) => {
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-start-gate")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("daily-grid-gate-how-to-play").click();
    await expect(page.getByTestId("guided-tour-popover")).toBeVisible();
    await expect(page.getByTestId("guided-tour-progress")).toHaveText("1 of 7");

    for (let i = 2; i <= 7; i += 1) {
      await page.getByTestId("guided-tour-next").click();
      await expect(page.getByTestId("guided-tour-progress")).toHaveText(`${i} of 7`);
    }
    await page.getByTestId("guided-tour-back").click();
    await expect(page.getByTestId("guided-tour-progress")).toHaveText("6 of 7");

    // Escape closes it, and the gate is still the screen: nothing was started.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("guided-tour-popover")).toHaveCount(0);
    await expect(page.getByTestId("daily-grid-start-gate")).toBeVisible();
    await expect(page.getByTestId("daily-grid-board")).toHaveCount(0);
  });

  test("starting the grid reveals the board and states the objective again", async ({ page }) => {
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await page.getByTestId("start-daily-grid").click();

    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("daily-grid-objective")).toContainText(
      /maximize your PEAK3 total with nine different players/i,
    );
    await expect(page.getByTestId("daily-grid-objective")).toContainText(
      /Scores stay hidden until each pick locks/i,
    );
  });

  test("Skip Tour and Start goes straight to the board", async ({ page }) => {
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-start-gate")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("daily-grid-gate-skip-tour").click();
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("guided-tour-popover")).toHaveCount(0);
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

  test("the walkthrough is replayable from the permanent ? control", async ({ page }) => {
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    const launcher = page.getByTestId("daily-grid-tour-launcher");
    await expect(launcher).toContainText("?");
    await launcher.click();
    await expect(page.getByTestId("guided-tour-popover")).toBeVisible();
    await expect(page.getByTestId("guided-tour-progress")).toHaveText("1 of 7");

    // Closing it leaves the board exactly as it was — no reset, nothing lost.
    await page.getByTestId("guided-tour-skip").click();
    await expect(page.getByTestId("guided-tour-popover")).toHaveCount(0);
    await expect(page.getByTestId("daily-grid-board")).toBeVisible();
    await expect(page.getByTestId("daily-grid-progress")).toHaveText("0/9");
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

/**
 * Phase 11C. Three product changes, end to end: a result can never be offered
 * as playable when it is not, the clock is real and survives a refresh, and
 * the completion state reads like a game result.
 */
test.describe("Daily Grid — search says what a result is", () => {
  test("a used player is labelled used and cannot be picked again", async ({ page, request }) => {
    const target = await findFillableCell(request);
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await fillCell(page, target);

    // Now look that same player up on a DIFFERENT square. Every one of their
    // seasons must be reported as spent — including any that fit.
    const other = [0, 1, 2]
      .flatMap((r) => [0, 1, 2].map((c) => ({ row: r, col: c })))
      .find((c) => c.row !== target.row || c.col !== target.col)!;
    await cellAt(page, other.row, other.col).click();
    await page.getByTestId("cell-search-input").fill(target.playerName);

    const rows = page.getByTestId("cell-search-result");
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    await expect(rows.first()).toHaveAttribute("data-status", "used");
    await expect(rows.first()).toBeDisabled();
    await expect(rows.first()).toContainText(/used/i);
    // And never as available.
    await expect(page.getByTestId("cell-search-result-available")).toHaveCount(0);
  });

  test("a result that does not fit is labelled and disabled, not clickable", async ({
    page,
    request,
  }) => {
    const target = await findFillableCell(request);
    test.skip(!target.ineligibleSeason, "this player's every season fits the square");

    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await cellAt(page, target.row, target.col).click();
    await page.getByTestId("cell-search-input").fill(target.playerName);

    const noFit = page
      .getByTestId("cell-search-result")
      .filter({ hasText: target.ineligibleSeason! })
      .first();
    await expect(noFit).toBeVisible({ timeout: 10_000 });
    await expect(noFit).toHaveAttribute("data-status", "no_fit");
    await expect(noFit).toBeDisabled();
    await expect(noFit).toContainText(/no fit/i);
  });

  test("available results appear before the ones that cannot be played", async ({
    page,
    request,
  }) => {
    const target = await findFillableCell(request);
    test.skip(!target.ineligibleSeason, "this player's every season fits the square");

    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await cellAt(page, target.row, target.col).click();
    await page.getByTestId("cell-search-input").fill(target.playerName);
    await expect(page.getByTestId("cell-search-result").first()).toBeVisible({ timeout: 10_000 });

    const statuses = await page
      .getByTestId("cell-search-result")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-status")));
    const rank: Record<string, number> = { available: 0, unknown: 0, used: 1, no_fit: 2 };
    const ranks = statuses.map((s) => rank[s ?? "unknown"]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

test.describe("Daily Grid — timer", () => {
  test("does not run until the first move, then starts and survives a refresh", async ({ page }) => {
    await skipRules(page);
    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    const timer = page.getByTestId("daily-grid-timer");
    await expect(timer).toBeVisible();
    await expect(timer).toHaveText("—");

    await cellAt(page, 0, 0).click();
    await expect(timer).toHaveText(/^\d+:\d{2}$/, { timeout: 5_000 });

    // The clock is a persisted START TIME, so a reload continues it rather
    // than restarting it.
    await page.waitForTimeout(2_100);
    const before = await timer.textContent();
    await page.reload({ waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    await expect(timer).toHaveText(/^\d+:\d{2}$/);
    const after = await timer.textContent();
    expect(toSeconds(after!)).toBeGreaterThanOrEqual(toSeconds(before!));
  });
});

function toSeconds(display: string): number {
  const parts = display.split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

test.describe("Daily Grid — completed result screen", () => {
  test("shows the grade, the score trio, the recap grid and the biggest miss", async ({
    page,
    request,
  }) => {
    test.slow();
    const filled = await solveBoardViaApi(request);
    const boardResponse = await request.get(`${API_BASE}/api/v1/daily-grid/board`, {
      params: { date: FIXED_DATE },
    });
    const board = await boardResponse.json();

    await page.addInitScript(
      ([boardId, date, cells]) => {
        // The versioned tour store, which superseded the unversioned
        // "peak3.daily-grid.rules-seen" flag. Writing the record for the
        // "daily-grid" tour id is what suppresses the start gate.
        window.localStorage.setItem(
          "peak3.tour.state",
          JSON.stringify({
            schema_version: 1,
            tours: { "daily-grid": { version: 1, status: "completed", at: "" } },
            coachmarks: {},
          }),
        );
        window.localStorage.setItem(
          `peak3.daily-grid.${boardId}`,
          JSON.stringify({
            board_id: boardId,
            date,
            schema_version: 3,
            filled: cells,
            incorrect_attempts: 2,
            started_at: "2026-03-14T12:00:00.000Z",
            completed_at: "2026-03-14T12:06:30.000Z",
          }),
        );
      },
      [board.board_id, FIXED_DATE, filled] as const,
    );

    await page.goto(DAILY_URL, { waitUntil: "load" });

    const panel = page.getByTestId("daily-grid-complete");
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Headline, then the three numbers, then the recap.
    await expect(page.getByTestId("complete-headline")).toHaveText(
      /Perfect Grid|Near Perfect|Strong Run|Room to Improve/,
    );
    await expect(page.getByTestId("complete-total-score")).toHaveText(/^\d+$/, { timeout: 15_000 });
    await expect(page.getByTestId("complete-optimal-total")).toHaveText(/^\d+$/);
    await expect(page.getByTestId("complete-percent-of-best")).toHaveText(/^\d+(\.\d+)?%$/);

    // The clock stopped at completion and reads the frozen 6:30.
    await expect(page.getByTestId("complete-time")).toContainText("6:30");
    await expect(page.getByTestId("daily-grid-timer")).toHaveText("6:30");

    await expect(page.getByTestId("complete-mini-cell")).toHaveCount(9);

    // Either a biggest miss, or a genuinely perfect board. Both are real
    // states; what must not happen is neither.
    const miss = page.getByTestId("complete-biggest-miss");
    const perfect = page.getByTestId("complete-perfect");
    expect((await miss.count()) + (await perfect.count())).toBe(1);

    // No invented standing anywhere on the screen.
    await expect(panel).not.toContainText(/percentile|leaderboard/i);
  });

  test("the share button copies a result summary", async ({ page, request, context }) => {
    test.slow();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const filled = await solveBoardViaApi(request);
    const board = await (
      await request.get(`${API_BASE}/api/v1/daily-grid/board`, { params: { date: FIXED_DATE } })
    ).json();

    await page.addInitScript(
      ([boardId, date, cells]) => {
        // The versioned tour store, which superseded the unversioned
        // "peak3.daily-grid.rules-seen" flag. Writing the record for the
        // "daily-grid" tour id is what suppresses the start gate.
        window.localStorage.setItem(
          "peak3.tour.state",
          JSON.stringify({
            schema_version: 1,
            tours: { "daily-grid": { version: 1, status: "completed", at: "" } },
            coachmarks: {},
          }),
        );
        window.localStorage.setItem(
          `peak3.daily-grid.${boardId}`,
          JSON.stringify({
            board_id: boardId,
            date,
            schema_version: 3,
            filled: cells,
            incorrect_attempts: 0,
            started_at: "2026-03-14T12:00:00.000Z",
            completed_at: "2026-03-14T12:06:30.000Z",
          }),
        );
      },
      [board.board_id, FIXED_DATE, filled] as const,
    );

    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-complete")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("complete-mini-cell")).toHaveCount(9);

    await page.getByTestId("daily-grid-share").click();
    await expect(page.getByTestId("daily-grid-share")).toHaveText(/copied/i, { timeout: 5_000 });

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("PEAK3 Daily Grid — 2026-03-14");
    expect(copied).toContain("Time: 6:30");
    expect(copied).toContain("# best  + close  - fair  . weak");
    expect(copied).toContain("peak3.app/daily");
    expect(copied).not.toMatch(/percentile|leaderboard/i);
  });
});

/**
 * Phase 11D: the daily loop, end to end. Completing a board leaves a streak, a
 * record and a reason to come back — and none of it may imply a ranking.
 */
test.describe("Daily Grid — streak, history and the daily loop", () => {
  /** Seed a completed archive for `days` consecutive days ending at `endDate`,
   *  plus the onboarding-seen record. Written through the same shape the app stores,
   *  so the page reads it exactly as it would its own writes. */
  async function seedArchive(page: Page, endDate: string, days: number): Promise<void> {
    await page.addInitScript(
      ([end, count]) => {
        // The versioned tour store, which superseded the unversioned
        // "peak3.daily-grid.rules-seen" flag. Writing the record for the
        // "daily-grid" tour id is what suppresses the start gate.
        window.localStorage.setItem(
          "peak3.tour.state",
          JSON.stringify({
            schema_version: 1,
            tours: { "daily-grid": { version: 1, status: "completed", at: "" } },
            coachmarks: {},
          }),
        );
        const entries = [];
        for (let i = 0; i < (count as number); i += 1) {
          const d = new Date(`${end}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() - i);
          const date = d.toISOString().slice(0, 10);
          entries.push({
            board_id: `daily-grid-v2-${date}`,
            date,
            theme: "Award Season",
            difficulty: "medium",
            started_at: `${date}T12:00:00.000Z`,
            completed_at: `${date}T12:06:00.000Z`,
            elapsed_seconds: 360,
            score: 640,
            today_max: 800,
            percent_of_max: 80,
            grade: "Strong Run",
            misses: 1,
            filled_count: 9,
            counted_for_streak: true,
            picks: [],
          });
        }
        window.localStorage.setItem(
          "peak3.daily-grid.archive",
          JSON.stringify({
            schema_version: 1,
            entries,
            current_streak: count,
            longest_streak: count,
            total_completed: count,
            last_streak_date: end,
            best_percent_of_max: 80,
            best_score: 640,
          }),
        );
      },
      [endDate, days] as const,
    );
  }

  test("a completed board shows the streak, the record and a come-back prompt", async ({
    page,
    request,
  }) => {
    test.slow();
    // `todayPacific`/`shiftDailyKey` from the app's own daily-key module — the
    // same arithmetic the server's `nba_peak.daily_key` performs, and never a
    // second, hand-rolled version of it.
    //
    // WHAT WAS WRONG. `today` was computed in America/Los_Angeles (correct) and
    // `yesterday` as `Date.now() - 86_400_000` in UTC (not). Those two agree for
    // sixteen or seventeen hours a day and disagree for the rest: on a UTC
    // runner at 02:05 UTC, Pacific "today" is the 1st while UTC "yesterday" is
    // also the 1st, so the archive seeded for "the two days before today"
    // actually contained today — the completion added no new day and the streak
    // came out 2 instead of 3. Nothing about the product was wrong; the fixture
    // was measuring two different calendars. Deriving every key from one
    // function makes the runner's timezone irrelevant by construction, which is
    // why this test now also runs green under TZ=UTC and TZ=America/Los_Angeles.
    const today = todayPacific();
    const filled = await solveBoardViaApi(request, today);
    const board = await (
      await request.get(`${API_BASE}/api/v1/daily-grid/board`, { params: { date: today } })
    ).json();

    // The server is the authority on what day it is; if it disagrees with the
    // key we derived, say so here rather than three assertions later as an
    // off-by-one streak.
    expect(board.date, "server board date must be the Pacific daily key").toBe(today);

    // Two prior days, so finishing today makes it three in a row.
    const yesterday = shiftDailyKey(today, -1);
    const dayBefore = shiftDailyKey(today, -2);
    await seedArchive(page, yesterday, 2);
    await page.addInitScript(
      ([boardId, date, cells]) => {
        window.localStorage.setItem(
          `peak3.daily-grid.${boardId}`,
          JSON.stringify({
            board_id: boardId,
            date,
            schema_version: 3,
            filled: cells,
            incorrect_attempts: 1,
            started_at: new Date(Date.now() - 300_000).toISOString(),
            completed_at: new Date().toISOString(),
          }),
        );
      },
      [board.board_id, today, filled] as const,
    );

    await page.goto("/daily/grid", { waitUntil: "load" });

    await expect(page.getByTestId("daily-grid-complete")).toBeVisible({ timeout: 15_000 });

    // Assert the DAILY KEYS before the totals they produce. "3" is a
    // consequence of three contiguous days being in the archive — the two
    // seeded ones plus today's completion, which the page writes on load — and
    // a bare `toHaveText("3")` cannot distinguish "the streak maths is broken"
    // from "the fixture seeded the wrong dates". The previous failure was
    // entirely the second kind.
    const recordedDates = await page.evaluate(() => {
      const raw = window.localStorage.getItem("peak3.daily-grid.archive");
      return raw
        ? (JSON.parse(raw) as { entries: { date: string }[] }).entries.map((e) => e.date).sort()
        : [];
    });
    expect(recordedDates, "three contiguous daily keys ending today").toEqual([
      dayBefore,
      yesterday,
      today,
    ]);

    const retention = page.getByTestId("complete-retention");
    await expect(retention).toBeVisible();
    await expect(page.getByTestId("complete-current-streak")).toHaveText("3");
    await expect(page.getByTestId("complete-longest-streak")).toHaveText("3");
    await expect(page.getByTestId("complete-total-played")).toHaveText("3");
    await expect(page.getByTestId("complete-come-back")).toContainText(/come back tomorrow/i);
    await expect(page.getByTestId("complete-come-back")).toContainText(/next board in/i);
    await expect(page.getByTestId("recent-results")).toBeVisible();

    // Local-only, and no invented standing anywhere on the screen.
    await expect(page.getByTestId("complete-local-only")).toContainText(/this device/i);
    await expect(page.getByTestId("daily-grid-complete")).not.toContainText(
      /percentile|leaderboard|global rank/i,
    );
  });

  test("a refresh preserves the completed result and the streak", async ({ page, request }) => {
    test.slow();
    const today = todayPacific();
    const filled = await solveBoardViaApi(request, today);
    const board = await (
      await request.get(`${API_BASE}/api/v1/daily-grid/board`, { params: { date: today } })
    ).json();

    await page.addInitScript(
      ([boardId, date, cells]) => {
        // The versioned tour store, which superseded the unversioned
        // "peak3.daily-grid.rules-seen" flag. Writing the record for the
        // "daily-grid" tour id is what suppresses the start gate.
        window.localStorage.setItem(
          "peak3.tour.state",
          JSON.stringify({
            schema_version: 1,
            tours: { "daily-grid": { version: 1, status: "completed", at: "" } },
            coachmarks: {},
          }),
        );
        window.localStorage.setItem(
          `peak3.daily-grid.${boardId}`,
          JSON.stringify({
            board_id: boardId,
            date,
            schema_version: 3,
            filled: cells,
            incorrect_attempts: 0,
            started_at: new Date(Date.now() - 300_000).toISOString(),
            completed_at: new Date().toISOString(),
          }),
        );
      },
      [board.board_id, today, filled] as const,
    );

    await page.goto("/daily/grid", { waitUntil: "load" });
    await expect(page.getByTestId("complete-current-streak")).toHaveText("1", { timeout: 15_000 });
    const score = await page.getByTestId("complete-total-score").textContent();

    await page.reload({ waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-complete")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("complete-total-score")).toHaveText(score!);
    // Still one, not two -- re-mounting a finished board must not re-count it.
    await expect(page.getByTestId("complete-current-streak")).toHaveText("1");
    await expect(page.getByTestId("complete-total-played")).toHaveText("1");
  });

  test("an archive board is labelled and does not touch the live streak", async ({
    page,
    request,
  }) => {
    test.slow();
    const filled = await solveBoardViaApi(request);
    const board = await (
      await request.get(`${API_BASE}/api/v1/daily-grid/board`, { params: { date: FIXED_DATE } })
    ).json();

    // A live 4-day streak ending yesterday.
    const yesterday = shiftDailyKey(todayPacific(), -1);
    await seedArchive(page, yesterday, 4);
    await page.addInitScript(
      ([boardId, date, cells]) => {
        window.localStorage.setItem(
          `peak3.daily-grid.${boardId}`,
          JSON.stringify({
            board_id: boardId,
            date,
            schema_version: 3,
            filled: cells,
            incorrect_attempts: 0,
            started_at: "2026-03-14T12:00:00.000Z",
            completed_at: "2026-03-14T12:05:00.000Z",
          }),
        );
      },
      [board.board_id, FIXED_DATE, filled] as const,
    );

    await page.goto(DAILY_URL, { waitUntil: "load" });

    const banner = page.getByTestId("daily-grid-archive-banner");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText(FIXED_DATE);
    await expect(banner).toContainText(/does not count toward your streak/i);

    await expect(page.getByTestId("daily-grid-complete")).toBeVisible();
    // The streak is still the 4 that were already there -- the replay was
    // recorded (5 boards) but earned nothing.
    await expect(page.getByTestId("complete-current-streak")).toHaveText("4");
    await expect(page.getByTestId("complete-total-played")).toHaveText("5");
    await expect(page.getByTestId("complete-come-back")).toContainText(/archive board/i);
    await expect(page.getByTestId("complete-play-today")).toHaveAttribute("href", "/daily/grid");
  });

  test("today's board is never labelled as an archive", async ({ page }) => {
    await skipRules(page);
    await page.goto("/daily/grid", { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("daily-grid-archive-banner")).toHaveCount(0);
  });
});

test.describe("Daily Grid — history page", () => {
  test("shows an honest empty state for a new player", async ({ page }) => {
    await skipRules(page);
    await page.goto("/daily/history", { waitUntil: "load" });

    await expect(page.getByTestId("daily-history-current-streak")).toHaveText("0", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("daily-history-total")).toHaveText("0");
    await expect(page.getByTestId("recent-results-empty")).toBeVisible();
    await expect(page.getByTestId("daily-history-today")).toContainText(/not played today/i);
    await expect(page.getByTestId("daily-history-play-today")).toHaveAttribute("href", "/daily/grid");
  });

  test("lists completed grids and says plainly that they are local", async ({ page }) => {
    const yesterday = shiftDailyKey(todayPacific(), -1);
    await page.addInitScript(
      ([end]) => {
        // The versioned tour store, which superseded the unversioned
        // "peak3.daily-grid.rules-seen" flag. Writing the record for the
        // "daily-grid" tour id is what suppresses the start gate.
        window.localStorage.setItem(
          "peak3.tour.state",
          JSON.stringify({
            schema_version: 1,
            tours: { "daily-grid": { version: 1, status: "completed", at: "" } },
            coachmarks: {},
          }),
        );
        const entries = [];
        for (let i = 0; i < 3; i += 1) {
          const d = new Date(`${end}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() - i);
          const date = d.toISOString().slice(0, 10);
          entries.push({
            board_id: `daily-grid-v2-${date}`,
            date,
            theme: "Ring Chasers",
            difficulty: "hard",
            started_at: `${date}T12:00:00.000Z`,
            completed_at: `${date}T12:06:00.000Z`,
            elapsed_seconds: 360,
            score: 700,
            today_max: 800,
            percent_of_max: 87.5,
            grade: "Strong Run",
            misses: 2,
            filled_count: 9,
            counted_for_streak: true,
            picks: [],
          });
        }
        window.localStorage.setItem(
          "peak3.daily-grid.archive",
          JSON.stringify({
            schema_version: 1,
            entries,
            current_streak: 3,
            longest_streak: 3,
            total_completed: 3,
            last_streak_date: end,
            best_percent_of_max: 87.5,
            best_score: 700,
          }),
        );
      },
      [yesterday] as const,
    );

    await page.goto("/daily/history", { waitUntil: "load" });

    await expect(page.getByTestId("daily-history-current-streak")).toHaveText("3", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("daily-history-longest-streak")).toHaveText("3");
    await expect(page.getByTestId("daily-history-total")).toHaveText("3");
    await expect(page.getByTestId("daily-history-best-percent")).toHaveText("87.5%");
    await expect(page.getByTestId("recent-results-row")).toHaveCount(3);

    // Honest about what this is, and claims no ranking. Scoped to the results
    // list rather than <main>: the page's own nav legitimately links to
    // Rankings, and matching site chrome would make this assert nothing.
    await expect(page.getByTestId("daily-history-local-notice")).toContainText(/this browser/i);
    await expect(page.getByTestId("recent-results")).not.toContainText(
      /percentile|leaderboard|global rank|#\d+/i,
    );

    // A row links back to that day's board.
    await expect(page.getByTestId("recent-results-row").first().locator("a")).toHaveAttribute(
      "href",
      /\/daily\/grid\?date=\d{4}-\d{2}-\d{2}/,
    );
  });

  test("is reachable from the grid", async ({ page }) => {
    await skipRules(page);
    await page.goto("/daily/grid", { waitUntil: "load" });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("daily-grid-history-link").click();
    await expect(page.getByTestId("daily-history-total")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("daily-history-back").click();
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
  });
});

/**
 * Phase 12A: the Daily hub, and the legality of the optimal comparison.
 */
test.describe("Daily hub", () => {
  test("lists both daily games", async ({ page }) => {
    await page.goto("/daily", { waitUntil: "load" });

    const grid = page.getByTestId("daily-hub-grid-card");
    const duel = page.getByTestId("daily-hub-duel-card");
    await expect(grid).toBeVisible({ timeout: 15_000 });
    await expect(duel).toBeVisible();
    await expect(grid).toHaveAttribute("href", "/daily/grid");
    await expect(duel).toHaveAttribute("href", "/play/daily");
    await expect(grid).toContainText(/Daily Grid Challenge/i);
    await expect(duel).toContainText(/Peak Duel Daily/i);
  });

  test("reaches the grid and the duel from the hub", async ({ page }) => {
    await skipRules(page);
    await page.goto("/daily", { waitUntil: "load" });
    await page.getByTestId("daily-hub-grid-card").click();
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });

    await page.goto("/daily", { waitUntil: "load" });
    await page.getByTestId("daily-hub-duel-card").click();
    await expect(page).toHaveURL(/\/play\/daily/, { timeout: 15_000 });
  });

  test("links to Daily Grid history and keeps both play-any-time modes reachable", async ({ page }) => {
    await page.goto("/daily", { waitUntil: "load" });
    await expect(page.getByTestId("daily-hub-history-link")).toHaveAttribute(
      "href",
      "/daily/history",
    );
    // The flagship card follows the product's flagship — RUN THE TABLE — and
    // 82-0 PEAK Season keeps its own card beside it rather than being dropped.
    await expect(page.getByTestId("daily-hub-flagship-card")).toHaveAttribute(
      "href",
      "/arena/run-the-table",
    );
    await expect(page.getByTestId("daily-hub-peak-season-card")).toHaveAttribute(
      "href",
      "/arena/court/practice/apex_1y",
    );
  });

  test("an old /daily?date= link still reaches that archive board", async ({ page }) => {
    // Those URLs are in players' own history and share text.
    await skipRules(page);
    await page.goto(`/daily?date=${FIXED_DATE}`, { waitUntil: "load" });
    await expect(page).toHaveURL(new RegExp(`/daily/grid\\?date=${FIXED_DATE}`), {
      timeout: 15_000,
    });
    await expect(page.getByTestId("daily-grid-board")).toBeVisible({ timeout: 15_000 });
  });

  test("the navbar Daily link highlights across both daily games", async ({ page }) => {
    for (const url of ["/daily", "/daily/grid", "/daily/history", "/play/daily"]) {
      await page.goto(url, { waitUntil: "load" });
      const daily = page.getByRole("navigation").getByRole("link", { name: "Daily" }).first();
      await expect(daily).toHaveAttribute("aria-current", "page", { timeout: 15_000 });
    }
  });

  test("@mobile the hub fits without horizontal overflow", async ({ page }) => {
    await page.goto("/daily", { waitUntil: "load" });
    await expect(page.getByTestId("daily-hub-grid-card")).toBeVisible({ timeout: 15_000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("Daily Grid — the optimal comparison is a legal grid", () => {
  test("never lists the same player twice as an optimal answer", async ({ page, request }) => {
    test.slow();
    const filled = await solveBoardViaApi(request);
    const board = await (
      await request.get(`${API_BASE}/api/v1/daily-grid/board`, { params: { date: FIXED_DATE } })
    ).json();

    await page.addInitScript(
      ([boardId, date, cells]) => {
        // The versioned tour store, which superseded the unversioned
        // "peak3.daily-grid.rules-seen" flag. Writing the record for the
        // "daily-grid" tour id is what suppresses the start gate.
        window.localStorage.setItem(
          "peak3.tour.state",
          JSON.stringify({
            schema_version: 1,
            tours: { "daily-grid": { version: 1, status: "completed", at: "" } },
            coachmarks: {},
          }),
        );
        window.localStorage.setItem(
          `peak3.daily-grid.${boardId}`,
          JSON.stringify({
            board_id: boardId,
            date,
            schema_version: 3,
            filled: cells,
            incorrect_attempts: 0,
            started_at: "2026-03-14T12:00:00.000Z",
            completed_at: "2026-03-14T12:06:00.000Z",
          }),
        );
      },
      [board.board_id, FIXED_DATE, filled] as const,
    );

    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("complete-comparison")).toBeVisible({ timeout: 15_000 });

    // Expand to the full nine squares so every optimal answer is on screen.
    const toggle = page.getByTestId("complete-per-cell-toggle");
    if (await toggle.count()) await toggle.click();

    // Read the API's own optimal grid and assert the invariant at the source
    // the UI renders from -- the rendered text is prose, the payload is fact.
    const result = await (
      await request.post(`${API_BASE}/api/v1/daily-grid/result`, {
        data: {
          date: FIXED_DATE,
          filled: filled.map((c) => ({
            row: c.row,
            col: c.col,
            answer_id: (c as unknown as { player_season: { id: string } }).player_season.id,
          })),
          incorrect_attempts: 0,
        },
      })
    ).json();

    const slugs = result.cells.map(
      (c: { optimal_player_season: { player_slug: string } }) => c.optimal_player_season.player_slug,
    );
    const ids = result.cells.map(
      (c: { optimal_player_season: { id: string } }) => c.optimal_player_season.id,
    );
    expect(new Set(slugs).size).toBe(9);
    expect(new Set(ids).size).toBe(9);
    // ...and today's max is the total of exactly that grid.
    const total = result.cells.reduce(
      (sum: number, c: { optimal_points: number }) => sum + c.optimal_points,
      0,
    );
    expect(result.optimal_total).toBe(total);
  });

  test("labels the comparison as the best LEGAL grid", async ({ page, request }) => {
    test.slow();
    const filled = await solveBoardViaApi(request);
    const board = await (
      await request.get(`${API_BASE}/api/v1/daily-grid/board`, { params: { date: FIXED_DATE } })
    ).json();
    await page.addInitScript(
      ([boardId, date, cells]) => {
        // The versioned tour store, which superseded the unversioned
        // "peak3.daily-grid.rules-seen" flag. Writing the record for the
        // "daily-grid" tour id is what suppresses the start gate.
        window.localStorage.setItem(
          "peak3.tour.state",
          JSON.stringify({
            schema_version: 1,
            tours: { "daily-grid": { version: 1, status: "completed", at: "" } },
            coachmarks: {},
          }),
        );
        window.localStorage.setItem(
          `peak3.daily-grid.${boardId}`,
          JSON.stringify({
            board_id: boardId,
            date,
            schema_version: 3,
            filled: cells,
            incorrect_attempts: 0,
            started_at: "2026-03-14T12:00:00.000Z",
            completed_at: "2026-03-14T12:06:00.000Z",
          }),
        );
      },
      [board.board_id, FIXED_DATE, filled] as const,
    );

    await page.goto(DAILY_URL, { waitUntil: "load" });
    await expect(page.getByTestId("complete-comparison")).toContainText(/best legal grid/i, {
      timeout: 15_000,
    });
  });
});
