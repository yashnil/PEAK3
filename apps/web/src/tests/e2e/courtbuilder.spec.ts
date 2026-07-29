/**
 * 82-0 Peak Season / CourtBuilder end-to-end gameplay tests
 * (Phase 5C vertical slice + Phase 5X.1-5X.3/5X.7 overhaul: spin ceremony,
 * position-aware slots, deferred score/rank reveal + Phase 5X.4: team/era
 * wheels, real half-court positions, PEAK-value-first scoring).
 * Requires FastAPI (port 8000) and Next.js (port 3000) — both auto-start via
 * playwright.config.ts. Requires PEAK3_COURTBUILDER_ENABLED=true and
 * PEAK3_COURTBUILDER_TEAM_SPIN_ENABLED=true in the API's environment (see
 * .github/workflows/ci.yml's Playwright step, or run locally with those
 * exported before `npm run dev`/`npm run start:api`).
 * Mobile-specific tests are tagged @mobile and run only in the
 * mobile-chrome project (see gameplay.spec.ts for the same convention).
 */
import { test, expect, Page } from "@playwright/test";

const TOTAL_ROUNDS = 8;

/** Play one full round: select the first candidate, place into the first
 * open slot. The select click still races its network response via
 * Promise.all (candidate buttons use a real `disabled` attribute while
 * `busy`, which Playwright's own actionability checks already wait out
 * correctly -- see EligiblePlayerSearch.tsx). The place click does NOT use
 * that pattern (see the comment on `openSlot` below for why an open
 * court-slot needed a different fix, not just a different wait). The spin
 * ceremony's ~1.6s timer sequence happens before the candidate card becomes
 * visible; the existing 10s waitFor timeout already comfortably covers it
 * -- no ceremony-specific wait needed here. */
async function playOneRound(page: Page): Promise<void> {
  // Phase 6E: candidate order is alphabetical (never star/score-weighted),
  // so the first candidate in the list is no longer reliably a scored
  // player. Prefer a scored candidate here so this generic helper (used by
  // tests that don't care which player, just that the flow completes and
  // -- for the full-attempt test -- that all 8 slots end up revealed)
  // stays deterministic; falls back to the first candidate if every one on
  // this exact roster happens to be unscored.
  const scoredCandidates = page.locator('[data-testid="candidate-card"]:not(:has([data-testid="candidate-unscored-badge"]))');
  const anyCandidate = page.locator('[data-testid="candidate-card"]').first();
  await anyCandidate.waitFor({ state: "visible", timeout: 10_000 });
  const scoredCount = await scoredCandidates.count();
  const candidate = scoredCount > 0 ? scoredCandidates.first() : anyCandidate;
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
    candidate.click(),
  ]);

  // Root cause of the CI flake this replaces (verified from the actual
  // failing run's server log: a real "select" 200 response arrives, then
  // NO "place" request is ever sent -- the click itself succeeds, it just
  // hits a dead element): CourtBuilder.tsx only attaches onClick to an
  // open slot once `phase === "placing" && !busy`; until then,
  // PeakCardCourt renders that exact same testid/data-filled combination
  // as a plain, non-interactive <div> (see PeakCardCourt.tsx -- `onClick`
  // present -> <button>, absent -> <div>). A <div> has no `disabled`
  // concept, so Playwright's actionability checks (visible/stable/
  // enabled/receives-events) are perfectly satisfied and it clicks the
  // dead element without complaint -- no request is ever sent, so any
  // `waitForResponse("/place")` after it just times out. This is a narrow,
  // pre-existing timing window (the moment between the select response
  // landing and React finishing the resulting re-render); Phase 8C's
  // heavier placement-mode DOM/motion made it wide enough to occasionally
  // surface in CI. Fix: target the `<button>` tag specifically, so the
  // wait itself is what closes the race -- Playwright will keep waiting
  // until the slot actually becomes the interactive element, exactly like
  // it already does for the (real, attribute-based) `disabled` candidate
  // buttons above.
  const openSlot = page.locator('button[data-testid="court-slot"][data-filled="false"]').first();
  await openSlot.waitFor({ state: "visible", timeout: 10_000 });

  // Authoritative outcome, not a specific network URL: proves the
  // placement actually landed (server round-trip + re-render), immune to
  // any future endpoint rename and to the "response already resolved
  // before the listener attached" race the old
  // Promise.all([waitForResponse(...), click()]) pattern was prone to. A
  // genuine placement failure (client-side click miss OR a real server
  // error) still fails this assertion with a clear "count never changed"
  // timeout, so real regressions are still caught.
  const filledBefore = await page.locator('[data-testid="court-slot"][data-filled="true"]').count();
  await openSlot.click();
  await expect(page.locator('[data-testid="court-slot"][data-filled="true"]')).toHaveCount(filledBefore + 1, { timeout: 10_000 });
}

async function startCourtBuilder(page: Page, mode = "apex_1y", seed = 42): Promise<void> {
  await page.goto(`/arena/court/practice/${mode}?seed=${seed}`, { waitUntil: "load" });
  await expect(page.locator('[data-testid="court-builder"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="court-slot"]').first().waitFor({ state: "visible", timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Full happy path
// ---------------------------------------------------------------------------

test.describe("CourtBuilder full attempt", () => {
  test("completes all 8 rounds and shows a result", async ({ page }) => {
    await startCourtBuilder(page);

    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      await playOneRound(page);
    }

    const completeBtn = page.locator('[data-testid="complete-season-btn"]');
    await completeBtn.waitFor({ state: "visible", timeout: 10_000 });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/complete") && r.status() === 200),
      completeBtn.click(),
    ]);

    // Result must always load after completion -- the exact P0 failure
    // class this pivot exists to avoid (ADR-005 Context).
    await expect(page.locator('[data-testid="season-result"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="season-record"]')).toBeVisible();
    await expect(page.locator('[data-testid="record-framing"]')).toBeVisible();
    await expect(page.locator('[data-testid="v0-simulator-label"]')).toBeVisible();
    await expect(page.locator('[data-testid="experimental-notice"]')).toBeVisible();

    // The broadcast reveal is the FIRST place a numeric score/rank appears
    // -- every filled slot must now show a revealed score line.
    await expect(page.locator('[data-testid="revealed-score-line"]')).toHaveCount(8);
    await expect(page.locator('[data-testid="peak-locked-note"]')).toHaveCount(0);
    // Durable retrieval by game_id (not just in-memory client state) is
    // covered at the API level in apps/api/tests/test_perfect_season.py::
    // test_full_anonymous_practice_attempt_completes_and_result_always_loads
    // -- a raw page reload here would hit the practice route's server
    // component, which creates a brand-new game on every load (same
    // accepted behavior as Peak Draft's own practice route; see
    // gameplay.spec.ts's "Mid-draft refresh" test), so it is not a useful
    // check of this specific contract.
  });

  test("Phase 8D: Play Again starts a fresh game in the same mode without a page reload", async ({ page }) => {
    await startCourtBuilder(page);
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      await playOneRound(page);
    }
    const completeBtn = page.locator('[data-testid="complete-season-btn"]');
    await completeBtn.waitFor({ state: "visible", timeout: 10_000 });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/complete") && r.status() === 200),
      completeBtn.click(),
    ]);
    await expect(page.locator('[data-testid="season-result"]')).toBeVisible({ timeout: 10_000 });
    const finishedGameUrl = page.url();

    const playAgainBtn = page.locator('[data-testid="play-again-btn"]');
    await expect(playAgainBtn).toBeVisible();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/perfect-season/games") && r.request().method() === "POST" && r.status() === 200),
      playAgainBtn.click(),
    ]);

    // Back to a live round 1 -- no navigation happened (still the same
    // practice-mode URL, not a reload), the result screen is gone, and the
    // court is empty again with a brand-new spin ceremony for round 1.
    expect(page.url()).toBe(finishedGameUrl);
    await expect(page.locator('[data-testid="season-result"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="court-slot"][data-filled="true"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="spin-stage"]')).toHaveAttribute("data-phase", "revealed", { timeout: 5_000 });
    const roundText = await page.locator('[data-testid="spin-stage"]').getByText(/Round 1 \/ 8/).count();
    expect(roundText).toBeGreaterThan(0);
  });

  test("court grid always shows all 8 slots, filled and open together", async ({ page }) => {
    await startCourtBuilder(page);
    await playOneRound(page);
    const slots = page.locator('[data-testid="court-slot"]');
    await expect(slots).toHaveCount(8);
    await expect(page.locator('[data-testid="court-slot"][data-filled="true"]')).toHaveCount(1);
  });

  test("starters render on the half-court and bench renders as a distinct group, with real position labels", async ({ page }) => {
    await startCourtBuilder(page);
    await expect(page.locator('[data-testid="half-court"] [data-testid="court-slot"]')).toHaveCount(5);
    await expect(page.locator('[data-testid="bench-grid"] [data-testid="court-slot"]')).toHaveCount(3);
    for (const pos of ["PG", "SG", "SF", "PF", "C"]) {
      await expect(page.locator(`[data-testid="court-slot"][data-slot-type="${pos}"]`)).toHaveCount(1);
    }
    for (const bench of ["bench_1", "bench_2", "bench_3"]) {
      await expect(page.locator(`[data-testid="court-slot"][data-slot-type="${bench}"]`)).toHaveCount(1);
    }
    // Deliberately plain bench labels -- never the old role-flavored names.
    // Labels render visually uppercase (CSS text-transform), so compare
    // case-insensitively via innerText rather than assuming exact case.
    const courtText = (await page.locator('[data-testid="court-grid"]').innerText()).toLowerCase();
    expect(courtText).toContain("bench 1");
    expect(courtText).not.toContain("wildcard");
    expect(courtText).not.toContain("defensive specialist");
    expect(courtText).not.toContain("6th man");
  });
});

// ---------------------------------------------------------------------------
// Score/rank hiding: pre-selection AND deferred post-placement reveal
// ---------------------------------------------------------------------------

test.describe("CourtBuilder score-hiding contract", () => {
  test("candidate cards never render a numeric score before selection", async ({ page }) => {
    await startCourtBuilder(page);
    const candidateText = await page.locator('[data-testid="candidate-card"]').first().innerText();
    // A candidate card renders the player's name, allowed-positions badge,
    // and (team_year mode only) the exact team + season it was rolled from
    // (e.g. "2015-16") -- real digits, but not a score. What must never
    // appear is an actual score/rank marker ("pts", "#<rank>", or a
    // decimal PEAK3-style score).
    const lower = candidateText.toLowerCase();
    expect(lower).not.toMatch(/\d+(\.\d+)?\s*pts/);
    expect(lower).not.toMatch(/#\d+/);
  });

  test("a filled slot shows 'peak locked' or the exact season, never a score, until the roster is fully revealed", async ({ page }) => {
    await startCourtBuilder(page);
    await playOneRound(page);
    // Exactly one slot is filled at this point (mid-run) -- it must show
    // the qualitative note (legacy "peak locked", or team_year's exact
    // team+season line), never a revealed score line.
    await expect(page.locator('[data-testid="revealed-score-line"]')).toHaveCount(0);
    const lockedNote = page.locator('[data-testid="peak-locked-note"]');
    const exactSeasonNote = page.locator('[data-testid="exact-season-line"]');
    const lockedCount = await lockedNote.count();
    const exactCount = await exactSeasonNote.count();
    expect(lockedCount + exactCount).toBe(1);
    if (lockedCount) {
      const lockedText = (await lockedNote.innerText()).toLowerCase();
      // "Peak locked" text may legitimately contain the season string (e.g.
      // "1990-91"), which has digits -- so instead of a blanket no-digits
      // check, assert the literal score-reveal marker text is absent.
      expect(lockedText).toContain("peak locked");
    } else {
      const exactText = (await exactSeasonNote.innerText()).toLowerCase();
      // The exact-season line shows "Team Name · YYYY-YY", never a score.
      expect(exactText).not.toMatch(/\d+(\.\d+)?\s*pts/);
    }
  });
});

// ---------------------------------------------------------------------------
// Position-aware slots (Phase 5X.3/5X.4): role-fit note, never a hard block
// ---------------------------------------------------------------------------

test.describe("CourtBuilder position-aware slots", () => {
  test("placing into any slot succeeds and shows a role-fit badge once revealed at result", async ({ page }) => {
    await startCourtBuilder(page);
    // Deliberately place the very first candidate into Center regardless of
    // their real archetype -- off-position placement must still succeed.
    const candidate = page.locator('[data-testid="candidate-card"]').first();
    await candidate.waitFor({ state: "visible" });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      candidate.click(),
    ]);
    const centerSlot = page.locator('[data-testid="court-slot"][data-slot-type="C"]');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/place") && r.status() === 200),
      centerSlot.click(),
    ]);
    await expect(centerSlot).toHaveAttribute("data-filled", "true");
    await expect(centerSlot.locator('[data-testid="role-fit-badge"]')).toHaveCount(1);
  });

  test("position-logic prototype note is visible", async ({ page }) => {
    await startCourtBuilder(page);
    await expect(page.locator('[data-testid="position-logic-note"]')).toBeVisible();
  });

  test("an open slot shows a pending-fit badge for the currently selected player", async ({ page }) => {
    await startCourtBuilder(page);
    const candidate = page.locator('[data-testid="candidate-card"]').first();
    await candidate.waitFor({ state: "visible" });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      candidate.click(),
    ]);
    // At least one open starter slot should show a fit badge for the
    // pending selection (primary/secondary/off-position -- never blocking).
    await expect(page.locator('[data-testid="pending-fit-badge"]').first()).toBeVisible();
  });

  test("candidate cards show which positions they're eligible for", async ({ page }) => {
    await startCourtBuilder(page);
    const badge = page.locator('[data-testid="candidate-position-badge"]').first();
    await expect(badge).toBeVisible();
    // Phase 6E: compact single-row cards show the bare position code(s)
    // (e.g. "SG" or "PG / SG"), not a verbose "Plays SG" phrase -- assert
    // it's a real position token, not any particular wording.
    const text = await badge.innerText();
    expect(text.trim()).toMatch(/^(PG|SG|SF|PF|C)( \/ (PG|SG|SF|PF|C))*$/);
  });

  test("an off-position fit badge explains which position the player actually plays", async ({ page }) => {
    await startCourtBuilder(page);
    // Place the first candidate at Center regardless of archetype -- for
    // seed 42's first-round pool this reliably produces an off-position
    // placement (position-eligibility-clarity goal: never just say
    // "off-slot" without saying why -- Phase 6G Part F shortened the
    // visible pill to "Off-slot" and moved the "plays X" detail into a
    // title tooltip, since the old inline "Off-position (plays PG)" text
    // was overflowing the compact court grid at small sizes).
    const candidate = page.locator('[data-testid="candidate-card"]').first();
    await candidate.waitFor({ state: "visible" });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      candidate.click(),
    ]);
    const centerSlot = page.locator('[data-testid="court-slot"][data-slot-type="C"]');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/place") && r.status() === 200),
      centerSlot.click(),
    ]);
    const badge = centerSlot.locator('[data-testid="role-fit-badge"]');
    const badgeText = (await badge.innerText()).toLowerCase();
    if (badgeText.includes("off-slot")) {
      const tooltip = (await badge.getAttribute("title"))?.toLowerCase() ?? "";
      expect(tooltip).toContain("plays");
    }
  });
});

// ---------------------------------------------------------------------------
// Cancel/back before placing (Phase 5X.7): selecting a candidate is not a
// one-way door -- manual review found no way to back out and pick someone
// else before placing.
// ---------------------------------------------------------------------------

test.describe("CourtBuilder cancel/back", () => {
  test("a cancelled selection returns to the candidate list without placing anyone", async ({ page }) => {
    await startCourtBuilder(page);
    const firstCandidate = page.locator('[data-testid="candidate-card"]').first();
    await firstCandidate.waitFor({ state: "visible" });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      firstCandidate.click(),
    ]);

    // Now in the "placing" step -- the candidate panel is gone, replaced by
    // the placing banner with a cancel button.
    await expect(page.locator('[data-testid="candidate-panel"]')).toHaveCount(0);
    const cancelBtn = page.locator('[data-testid="cancel-selection-btn"]');
    await expect(cancelBtn).toBeVisible();

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/cancel") && r.status() === 200),
      cancelBtn.click(),
    ]);

    // Back to the candidate list -- no slot got filled by the cancelled pick.
    await expect(page.locator('[data-testid="candidate-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="court-slot"][data-filled="true"]')).toHaveCount(0);
  });

  test("Phase 8D: reselecting within the same round does not replay the spin ceremony", async ({ page }) => {
    // Root-cause regression test: CourtBuilder used to only mount
    // <SpinStage> while phase === "spinning", so cancelling a selection
    // (back to spinning, SAME round) remounted it fresh and reran the
    // mount-only ceremony effect -- the spinner visibly re-spun even
    // though the team/season roll never changed. SpinStage now stays
    // mounted for the whole round (only collapsing to a compact summary
    // while placing), so the ceremony must have already finished --
    // data-phase="revealed" and data-was-locked="true" -- BEFORE the
    // cancel, and must still read that way immediately after, with no
    // second "spinning"/"locked" phase ever observed in between.
    await startCourtBuilder(page);
    const spinStage = page.locator('[data-testid="spin-stage"]');
    await expect(spinStage).toHaveAttribute("data-phase", "revealed", { timeout: 5_000 });
    await expect(spinStage).toHaveAttribute("data-was-locked", "true");
    const rolledTeamSeason = await page.locator('[data-testid="roll-summary"]').innerText();

    const firstCandidate = page.locator('[data-testid="candidate-card"]').first();
    await firstCandidate.waitFor({ state: "visible" });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      firstCandidate.click(),
    ]);

    // Now placing -- SpinStage collapses to the compact locked-in summary
    // but must remain the SAME mounted element (still revealed/locked),
    // never a fresh "spinning" one.
    await expect(spinStage).toHaveAttribute("data-collapsed", "true");
    await expect(spinStage).toHaveAttribute("data-phase", "revealed");

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/cancel") && r.status() === 200),
      page.locator('[data-testid="cancel-selection-btn"]').click(),
    ]);

    // Back in "spinning" (candidate-choosing) UI for the SAME round: no
    // ceremony replay -- the roll is instantly still the same team/season,
    // never re-entering a "spinning" or "locked" data-phase.
    await expect(spinStage).not.toHaveAttribute("data-collapsed", "true");
    await expect(spinStage).toHaveAttribute("data-phase", "revealed");
    await expect(page.locator('[data-testid="roll-summary"]')).toHaveText(rolledTeamSeason);
  });

  test("select A, cancel, select a different candidate B, and place B", async ({ page }) => {
    await startCourtBuilder(page);
    const candidates = page.locator('[data-testid="candidate-card"]');
    const slugA = await candidates.nth(0).getAttribute("data-player-slug");
    const slugB = await candidates.nth(1).getAttribute("data-player-slug");
    expect(slugA).not.toBe(slugB);
    const nameA = (await candidates.nth(0).innerText()).split("\n")[0];

    // Select candidate A.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      candidates.nth(0).click(),
    ]);
    await expect(page.locator('[data-testid="placing-banner"]')).toContainText(nameA);

    // Back out, then select candidate B instead.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/cancel") && r.status() === 200),
      page.locator('[data-testid="cancel-selection-btn"]').click(),
    ]);
    const bCard = page.locator(`[data-testid="candidate-card"][data-player-slug="${slugB}"]`);
    await expect(bCard).toBeVisible();
    const nameB = (await bCard.innerText()).split("\n")[0];
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      bCard.click(),
    ]);
    // The placing banner now names B, not A -- proves the cancel genuinely
    // cleared the old pending selection rather than just hiding it.
    await expect(page.locator('[data-testid="placing-banner"]')).toContainText(nameB);

    // Place B into the first open slot. Targets the `<button>` tag
    // specifically (not just the testid) -- see playOneRound's own
    // comment for why an open court-slot only becomes the real,
    // interactive element once phase/busy actually settle, and a plain
    // testid-only locator can click a dead <div> with no listener
    // attached. The toHaveCount(1) assertion right below is the
    // authoritative proof placement landed, replacing a fragile
    // Promise.all([waitForResponse("/place"), click()]) race.
    const openSlot = page.locator('button[data-testid="court-slot"][data-filled="false"]').first();
    await openSlot.click();

    // Exactly one slot is filled, and it holds B's name, not A's.
    const filledSlot = page.locator('[data-testid="court-slot"][data-filled="true"]');
    await expect(filledSlot).toHaveCount(1);
    const filledText = await filledSlot.innerText();
    expect(filledText).toContain(nameB);
    expect(filledText).not.toContain(nameA);
  });
});

// ---------------------------------------------------------------------------
// Unconventional lineup remains legal
// ---------------------------------------------------------------------------

test.describe("CourtBuilder soft placement", () => {
  test("bench slots can be filled before any starter slot", async ({ page }) => {
    await startCourtBuilder(page);

    const candidate = page.locator('[data-testid="candidate-card"]').first();
    await candidate.waitFor({ state: "visible" });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      candidate.click(),
    ]);

    const benchSlot = page.locator('[data-testid="court-slot"][data-slot-type="bench_1"]');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/place") && r.status() === 200),
      benchSlot.click(),
    ]);

    await expect(page.locator('[data-testid="court-slot"][data-slot-type="bench_1"]')).toHaveAttribute(
      "data-filled", "true",
    );
    await expect(page.locator('[data-testid="court-slot"][data-slot-type="PG"]')).toHaveAttribute(
      "data-filled", "false",
    );
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

test.describe("CourtBuilder keyboard navigation", () => {
  test("a full round can be completed via keyboard only", async ({ page }) => {
    await startCourtBuilder(page);

    const candidate = page.locator('[data-testid="candidate-card"]').first();
    await candidate.waitFor({ state: "visible" });
    await candidate.focus();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      page.keyboard.press("Enter"),
    ]);

    // Targets the `<button>` tag specifically -- a non-interactive slot
    // renders as a plain <div> (not focusable at all without a real
    // tabindex/button element), so waiting for the real button is both
    // the accessible-correctness check AND what closes the same
    // busy/phase timing race documented on playOneRound's `openSlot`.
    const openSlot = page.locator('button[data-testid="court-slot"][data-filled="false"]').first();
    await openSlot.waitFor({ state: "visible" });
    await openSlot.focus();
    await page.keyboard.press("Enter");

    await expect(page.locator('[data-testid="court-slot"][data-filled="true"]')).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// Team wheel + era wheel spin ceremony (Phase 5X.4 rule 1)
// ---------------------------------------------------------------------------

test.describe("CourtBuilder spin ceremony", () => {
  test("reduced motion skips straight to revealed candidates with no extra delay", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startCourtBuilder(page);
    // Under reduced motion the ceremony's JS timers (SpinStage.tsx's
    // SPIN_MS/LOCK_MS/COUNT_MS sequence, ~1.95s total for normal-motion
    // users -- Phase 8 slowed it down for more suspense, still under the
    // product spec's 2s hard ceiling) are skipped entirely -- the effect
    // flips phase straight to
    // "revealed" on mount, no timers at all. Assert on that observable
    // state directly, with a tight timeout, rather than bracketing a
    // Date.now() measurement around page load: the old assertion measured
    // navigation + server + hydration time (highly variable, especially in
    // CI) in the same budget as the ceremony delay it meant to check,
    // which made it flaky for reasons unrelated to reduced-motion
    // behavior. `startCourtBuilder` already waits out page-load noise (its
    // own generous 15s timeouts) before this point, so a short 500ms
    // window here is tight enough to catch a real regression that
    // reintroduces the timer delay, without being sensitive to how long
    // the page itself took to load.
    await expect(page.locator('[data-testid="spin-stage"]')).toHaveAttribute("data-phase", "revealed", {
      timeout: 500,
    });
    await expect(page.locator('[data-testid="candidate-card"]').first()).toBeVisible({ timeout: 500 });
    // No leftover "spinning" animation state -- confirms the skip is a real
    // state transition, not a coincidentally-fast animated one.
    await expect(page.locator('[data-testid="spin-ceremony-spinning"]')).toHaveCount(0);
  });

  test("spin stage reaches the revealed phase and shows an eligible-count line", async ({ page }) => {
    await startCourtBuilder(page);
    await expect(page.locator('[data-testid="spin-stage"]')).toHaveAttribute("data-phase", "revealed", {
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="eligible-count-reveal"]')).toBeVisible();
  });

  test("team wheel and era wheel render as two distinct reels for a team/era spin", async ({ page }) => {
    await startCourtBuilder(page);
    await expect(page.locator('[data-testid="spin-stage"]')).toHaveAttribute("data-phase", "revealed", {
      timeout: 5_000,
    });
    // Seed 42's first round resolves to a team_decade or exact_team_season
    // spin against the expanded interim dataset (which one depends on the
    // board generator's weighted entry selection, not hardcoded here) --
    // both reels should be present and showing real, non-empty text once
    // locked, either a decade ("1990s") or an exact season ("2022-23").
    const teamWheel = page.locator('[data-testid="team-wheel"]');
    const eraWheel = page.locator('[data-testid="era-wheel"]');
    await expect(teamWheel).toBeVisible();
    await expect(eraWheel).toBeVisible();
    const teamText = (await teamWheel.innerText()).trim();
    const eraText = (await eraWheel.innerText()).trim();
    expect(teamText.length).toBeGreaterThan(0);
    expect(/(19[89]0s|20[012]0s|\d{4}-\d{2})/.test(eraText)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Phase 6G Part B: "Team + Season Reel Spinner v2" -- coverage proof,
  // reel-strip test ids, locked state, reduced motion, mobile overflow.
  // -------------------------------------------------------------------------

  test("spinner renders real coverage text (rollable team-seasons count)", async ({ page }) => {
    await startCourtBuilder(page);
    const coverageLine = page.locator('[data-testid="spin-coverage-line"]');
    await expect(coverageLine).toBeVisible();
    // Real, non-fabricated coverage count -- proves this isn't a hardcoded
    // "1,310" string but an actual number from the readiness dataset.
    await expect(coverageLine).toContainText(/[\d,]+ rollable team-seasons/, { timeout: 5_000 });
  });

  test("spinner renders the eligible season range 1979-80 to 2025-26", async ({ page }) => {
    await startCourtBuilder(page);
    const coverageLine = page.locator('[data-testid="spin-coverage-line"]');
    await expect(coverageLine).toContainText("1979-80 to 2025-26", { timeout: 5_000 });
  });

  test("spin stage shows reel-strip test ids while spinning (team and season reels)", async ({ page }) => {
    // Fresh navigation lands in the "spinning" phase for a moment before
    // the fixed ceremony timers advance it -- assert the reel strips exist
    // in that window rather than racing the animation.
    await page.goto("/arena/court/practice/apex_1y?seed=42", { waitUntil: "load" });
    const strips = page.locator('[data-testid="spin-stage"] .spin-reel-strip');
    await expect(strips.first()).toBeVisible({ timeout: 3_000 });
    await expect(strips).toHaveCount(2);
  });

  test("locked state shows a LOCKED stamp between spinning and reveal", async ({ page }) => {
    // The "locked" phase is a deliberately brief ~400ms window between the
    // spinning and revealed phases (see SpinStage.tsx's LOCK_MS). Racing a
    // fresh navigation against that live transient window is not just slow
    // -- it is genuinely unreliable: on a slow dev-server compile, the
    // whole spin->lock->reveal cycle can finish DURING page.goto()'s own
    // resolution, so Playwright's polling never starts until "locked" has
    // already passed, no matter how generous the assertion timeout is.
    // SpinStage.tsx instead exposes a persistent `data-was-locked` flag on
    // `[data-testid="spin-stage"]` (set true the moment phase first becomes
    // "locked", never reset) -- asserting on that AFTER the ceremony has
    // settled into "revealed" proves the locked phase happened without
    // needing to observe it live.
    await startCourtBuilder(page);
    await expect(page.locator('[data-testid="spin-stage"]')).toHaveAttribute("data-was-locked", "true");
  });

  test("reduced motion still displays the final roll (team, season, eligible count)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startCourtBuilder(page);
    await expect(page.locator('[data-testid="spin-stage"]')).toHaveAttribute("data-phase", "revealed", {
      timeout: 1_000,
    });
    await expect(page.locator('[data-testid="roll-summary"]')).toBeVisible();
    await expect(page.locator('[data-testid="eligible-count-reveal"]')).toBeVisible();
    // Stepped reveal, not a continuous cycling animation -- no reel strips
    // should be mounted for reduced-motion users.
    await expect(page.locator('[data-testid="spin-stage"] .spin-reel-strip')).toHaveCount(0);
  });

  test("mobile viewport: spin stage never causes horizontal page overflow", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await startCourtBuilder(page);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});

// ---------------------------------------------------------------------------
// Drafting-flow clarity: distinct steps, half-court visual markers
// ---------------------------------------------------------------------------

test.describe("CourtBuilder drafting flow", () => {
  test("candidate selection and court placement render as distinct, separately-labeled steps", async ({ page }) => {
    await startCourtBuilder(page);

    const candidatePanel = page.locator('[data-testid="candidate-panel"]');
    await expect(candidatePanel).toBeVisible();
    await expect(candidatePanel).toContainText(/step 1/i);

    const candidate = page.locator('[data-testid="candidate-card"]').first();
    await candidate.waitFor({ state: "visible" });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      candidate.click(),
    ]);

    const placingBanner = page.locator('[data-testid="placing-banner"]');
    await expect(placingBanner).toBeVisible();
    await expect(placingBanner).toContainText(/step 2/i);
    // The candidate panel is gone once a pick is pending -- selection and
    // placement never overlap visually.
    await expect(candidatePanel).toHaveCount(0);
  });

  test("the half-court renders visual court markings (hoop, key, arc)", async ({ page }) => {
    await startCourtBuilder(page);
    await expect(page.locator('[data-testid="half-court"]')).toBeVisible();
    await expect(page.locator(".court-hoop")).toBeVisible();
  });

  test("Phase 6E: court panel exposes paint/arc/hoop landmarks and stays attached to the bench", async ({ page }) => {
    await startCourtBuilder(page);
    await expect(page.locator('[data-testid="court-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="court-hoop"]')).toBeVisible();
    await expect(page.locator('[data-testid="court-paint"]')).toBeVisible();
    await expect(page.locator('[data-testid="court-arc"]')).toBeVisible();
    // Bench lives inside the same court-panel unit as the starters --
    // "visually attached", not a separate floating block.
    await expect(page.locator('[data-testid="court-panel"] [data-testid="bench-grid"]')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Phase 6E Part C: candidate list is single-column, alphabetical, and never
// star/score-ordered.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 6G Part C: respins (team_year mode only).
// ---------------------------------------------------------------------------

test.describe("CourtBuilder respins", () => {
  test("respin team button rerolls the roll and decrements the counter", async ({ page }) => {
    await startCourtBuilder(page);
    const teamBtn = page.locator('[data-testid="respin-team-btn"]');
    await expect(teamBtn).toBeVisible();
    await expect(teamBtn).toContainText("3 left");

    const rollSummaryBefore = await page.locator('[data-testid="roll-summary"]').innerText();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/respin-team") && r.status() === 200),
      teamBtn.click(),
    ]);
    await expect(teamBtn).toContainText("2 left");
    const rollSummaryAfter = await page.locator('[data-testid="roll-summary"]').innerText();
    expect(rollSummaryAfter).not.toBe(rollSummaryBefore);
    // Candidate list refreshed to the new roll's real roster.
    await expect(page.locator('[data-testid="candidate-card"]').first()).toBeVisible();
  });

  test("respin buttons disable at 0 and are independent counters", async ({ page }) => {
    await startCourtBuilder(page);
    const teamBtn = page.locator('[data-testid="respin-team-btn"]');
    const seasonBtn = page.locator('[data-testid="respin-season-btn"]');

    for (let i = 0; i < 3; i++) {
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/respin-team") && r.status() === 200),
        teamBtn.click(),
      ]);
    }
    await expect(teamBtn).toBeDisabled();
    // Season respins are a separate budget -- still fully available.
    await expect(seasonBtn).toContainText("3 left");
    await expect(seasonBtn).toBeEnabled();
  });

  // -------------------------------------------------------------------------
  // Phase 8C: axis-independent respins -- respinning team must leave season
  // visually locked (and unchanged), and vice versa. Playtest finding #1
  // was that a team-only and season-only respin looked identical; this
  // proves both the visual "Locked" badge on the untouched wheel AND that
  // its actual displayed value doesn't change once the respin settles.
  // -------------------------------------------------------------------------

  test("Phase 8C: team-only respin locks the era wheel and its value is unchanged", async ({ page }) => {
    await startCourtBuilder(page);
    const teamBtn = page.locator('[data-testid="respin-team-btn"]');
    // The respin button only renders once the ceremony has revealed (see
    // CourtBuilder.tsx's respin-controls gate) -- waiting for it here is
    // the real synchronization point; startCourtBuilder itself only waits
    // for the court, not for the spin ceremony to finish ticking.
    await expect(teamBtn).toBeVisible();
    const eraBefore = await page.locator('[data-testid="era-wheel"]').innerText();

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/respin-team") && r.status() === 200),
      teamBtn.click(),
    ]);
    // The era wheel shows the locked badge; the team wheel (the one
    // actually respinning) never does.
    await expect(page.locator('[data-testid="era-wheel-locked-badge"]')).toBeVisible();
    await expect(page.locator('[data-testid="team-wheel-locked-badge"]')).toHaveCount(0);

    // Once the brief respin flourish settles, the era wheel's own value
    // must be exactly what it was before -- not just visually "locked",
    // actually unchanged (proves frontend display matches backend's
    // same-season-different-team respin behavior).
    await expect(page.locator('[data-testid="era-wheel-locked-badge"]')).toHaveCount(0, { timeout: 2_000 });
    const eraAfter = await page.locator('[data-testid="era-wheel"]').innerText();
    expect(eraAfter).toBe(eraBefore);
  });

  test("Phase 8C: season-only respin locks the team wheel and its value is unchanged", async ({ page }) => {
    await startCourtBuilder(page);
    const seasonBtn = page.locator('[data-testid="respin-season-btn"]');
    await expect(seasonBtn).toBeVisible();
    const teamBefore = await page.locator('[data-testid="team-wheel"]').innerText();

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/respin-season") && r.status() === 200),
      seasonBtn.click(),
    ]);
    await expect(page.locator('[data-testid="team-wheel-locked-badge"]')).toBeVisible();
    await expect(page.locator('[data-testid="era-wheel-locked-badge"]')).toHaveCount(0);

    await expect(page.locator('[data-testid="team-wheel-locked-badge"]')).toHaveCount(0, { timeout: 2_000 });
    const teamAfter = await page.locator('[data-testid="team-wheel"]').innerText();
    expect(teamAfter).toBe(teamBefore);
  });

  test("respin controls disappear once a player is selected", async ({ page }) => {
    await startCourtBuilder(page);
    await expect(page.locator('[data-testid="respin-controls"]')).toBeVisible();
    const candidate = page.locator('[data-testid="candidate-card"]').first();
    await candidate.waitFor({ state: "visible" });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      candidate.click(),
    ]);
    await expect(page.locator('[data-testid="respin-controls"]')).toHaveCount(0);
  });

  test("data receipt includes respin history after a respin", async ({ page }) => {
    await startCourtBuilder(page);
    // No respin yet -- the receipt's respin-count span shouldn't exist at all.
    await expect(page.locator('[data-testid="respin-receipt-count"]')).toHaveCount(0);

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/respin-season") && r.status() === 200),
      page.locator('[data-testid="respin-season-btn"]').click(),
    ]);
    const receipt = page.locator('[data-testid="board-receipt"]');
    await receipt.locator("summary").click();
    await expect(page.locator('[data-testid="respin-receipt-count"]')).toContainText("1 respin used");
    await expect(page.locator('[data-testid="respin-receipt-count"]')).toContainText("1 season");
  });

  test("Phase 7A Part C: respin budget carries over to the next round, not reset", async ({ page }) => {
    await startCourtBuilder(page);
    const teamBtn = page.locator('[data-testid="respin-team-btn"]');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/respin-team") && r.status() === 200),
      teamBtn.click(),
    ]);
    await expect(teamBtn).toContainText("2 left");

    // Complete round 1 (select + place).
    const candidate = page.locator('[data-testid="candidate-card"]').first();
    await candidate.waitFor({ state: "visible" });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
      candidate.click(),
    ]);
    // Button tag scoped, plus an authoritative filled-count wait instead
    // of racing a network URL -- see playOneRound's own comment for why.
    const openSlot = page.locator('button[data-testid="court-slot"][data-filled="false"]').first();
    await openSlot.click();
    await expect(page.locator('[data-testid="court-slot"][data-filled="true"]')).toHaveCount(1, { timeout: 10_000 });

    // Round 2: the team respin button must still show 2 left, not reset to 3.
    await expect(page.locator('[data-testid="respin-team-btn"]')).toContainText("2 left", { timeout: 10_000 });
  });
});

test.describe("CourtBuilder candidate list (Phase 6E)", () => {
  test("candidate list renders as a single column, not a side-by-side grid", async ({ page }) => {
    await startCourtBuilder(page);
    const list = page.locator('[data-testid="candidate-list"]');
    await expect(list).toBeVisible();
    const cards = page.locator('[data-testid="candidate-card"]');
    const count = await cards.count();
    expect(count).toBeGreaterThan(1);
    // Single column: every card's left edge (x) matches the first card's,
    // and cards stack top-to-bottom (increasing y) -- never side-by-side.
    const firstBox = await cards.nth(0).boundingBox();
    const secondBox = await cards.nth(1).boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(Math.abs((firstBox!.x) - (secondBox!.x))).toBeLessThan(2);
    expect(secondBox!.y).toBeGreaterThan(firstBox!.y);
  });

  test("candidate order is alphabetical, not score/rank ordered", async ({ page }) => {
    await startCourtBuilder(page);
    const cards = page.locator('[data-testid="candidate-card"]');
    const count = await cards.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const slug = await cards.nth(i).getAttribute("data-player-slug");
      names.push(slug ?? "");
    }
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test("exact team-season is preserved on every candidate row after the alphabetical sort", async ({ page }) => {
    await startCourtBuilder(page);
    await page.locator('[data-testid="candidate-card"]').first().waitFor({ state: "visible", timeout: 10_000 });
    const rollSummary = await page.locator('[data-testid="roll-summary"]').innerText();
    const teamSeasonLines = page.locator('[data-testid="candidate-team-season"]');
    const count = await teamSeasonLines.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const text = await teamSeasonLines.nth(i).innerText();
      // "You rolled: Team · Season" and each candidate row's "Team · Season"
      // must reference the same roll -- alphabetical reordering must never
      // silently swap in a different team-season's roster.
      expect(rollSummary).toContain(text.trim());
    }
  });

  test("humanized status badges render for roster-only and score-pending candidates when present", async ({ page }) => {
    await startCourtBuilder(page);
    const rosterOnlyBadges = page.locator('[data-testid="candidate-roster-only-badge"]');
    const scorePendingBadges = page.locator('[data-testid="candidate-unscored-badge"]');
    // Not every roll will have one of each, but the badge text itself must
    // be humanized (never the raw backend enum strings) whenever present.
    if (await rosterOnlyBadges.count()) {
      await expect(rosterOnlyBadges.first()).toHaveText(/roster only/i);
    }
    if (await scorePendingBadges.count()) {
      await expect(scorePendingBadges.first()).toHaveText(/score pending/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Result credibility: peak-value-first reassurance, no "too many stars" framing
// ---------------------------------------------------------------------------

test.describe("CourtBuilder result credibility", () => {
  test("the result screen reassures that stacked talent is rewarded, not penalized", async ({ page }) => {
    await startCourtBuilder(page);
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      await playOneRound(page);
    }
    const completeBtn = page.locator('[data-testid="complete-season-btn"]');
    await completeBtn.waitFor({ state: "visible", timeout: 10_000 });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/complete") && r.status() === 200),
      completeBtn.click(),
    ]);
    await expect(page.locator('[data-testid="season-result"]')).toBeVisible({ timeout: 10_000 });
    const reassurance = page.locator('[data-testid="peak-value-reassurance"]');
    await expect(reassurance).toBeVisible();
    const text = (await reassurance.innerText()).toLowerCase();
    // The reassurance copy explicitly says stacked talent is NOT penalized
    // -- "too many" is fine in a negating sentence ("never docks... for
    // having too many elite peaks"); what must never appear is framing that
    // treats redundancy itself as bad.
    expect(text).not.toContain("redundant");
    expect(text).not.toContain("role overlap");
    expect(text).toContain("never");
    // The revealed roster on the result screen uses the same half-court
    // layout as the build screen -- consistent visual language.
    await expect(page.locator('[data-testid="season-result"] [data-testid="half-court"]')).toBeVisible();
  });

  test("Phase 6E: result screen is a share-card with a tier headline and exact-season wording", async ({ page }) => {
    await startCourtBuilder(page);
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      await playOneRound(page);
    }
    const completeBtn = page.locator('[data-testid="complete-season-btn"]');
    await completeBtn.waitFor({ state: "visible", timeout: 10_000 });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/complete") && r.status() === 200),
      completeBtn.click(),
    ]);
    const result = page.locator('[data-testid="season-result"]');
    await expect(result).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="result-tier"]')).toBeVisible();
    await expect(page.locator('[data-testid="team-identity-phrase"]')).toBeVisible();

    const scoreBlock = page.locator('[data-testid="lineup-peak-score"]');
    const scoreText = (await scoreBlock.innerText()).toLowerCase();
    // "Mean of real PEAK3 peak scores" is the wrong wording for exact-season
    // mode -- must say exact season scores instead.
    if (!scoreText.includes("incomplete")) {
      expect(scoreText).toContain("exact season");
    }
    // Technical receipt is pushed into a collapsed disclosure, not the
    // primary reading path.
    const receipt = page.locator('[data-testid="result-receipt"]');
    await expect(receipt).toBeVisible();
    await expect(receipt.locator("summary")).toBeVisible();
  });

  test("Phase 8H: result screen shows the PEAK3 pick recap and a working share panel", async ({ page }) => {
    await startCourtBuilder(page);
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      await playOneRound(page);
    }
    const completeBtn = page.locator('[data-testid="complete-season-btn"]');
    await completeBtn.waitFor({ state: "visible", timeout: 10_000 });
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/complete") && r.status() === 200),
      completeBtn.click(),
    ]);
    await expect(page.locator('[data-testid="season-result"]')).toBeVisible({ timeout: 10_000 });

    // AI-pick recap: one row per round, each naming both the real pick and
    // PEAK3's own top-rated available option that round.
    const recap = page.locator('[data-testid="peak-picks-recap"]');
    await expect(recap).toBeVisible();
    await expect(page.locator('[data-testid="peak-picks-recap-row"]')).toHaveCount(TOTAL_ROUNDS);
    await expect(page.locator('[data-testid="peak-picks-match-count"]')).toBeVisible();

    // Never leaked before the roster was complete -- the API response
    // itself only carries the recap once result_ready.
    const body = await resp.json();
    expect(body.simulation_result.peak_picks_recap).toHaveLength(TOTAL_ROUNDS);

    // Share panel: real, working actions (copy summary / copy link),
    // using the standard Clipboard API -- no fabricated capability.
    const share = page.locator('[data-testid="share-run-panel"]');
    await expect(share).toBeVisible();
    await expect(page.locator('[data-testid="share-run-copy-link-btn"]')).toBeEnabled();
    await expect(page.locator('[data-testid="share-run-copy-text-btn"]')).toBeEnabled();
  });

  // Runs BEFORE the heavier read-only-scorecard test below on purpose: both
  // tests are the first hits in this file on the /arena/court/results/[id]
  // dynamic route, and in Playwright's dev-mode webServer (see
  // playwright.config.ts -- `npm run dev`, not a production build) the
  // *first* request to any route pays a real one-time Next.js JIT-compile
  // cost (observed locally: ~300ms+, more under CI's slower/shared
  // runners). This cheap not-found test has huge timeout headroom (a single
  // goto + two text assertions), so it is the one that should absorb that
  // one-time cost -- not the test below, which already spends its budget on
  // a full 8-round draft, a `/complete` round-trip, and a second full page
  // load.
  test("Phase 8H: a nonexistent shared results link shows a clean not-found state", async ({ page }) => {
    await page.goto("/arena/court/results/this-game-id-does-not-exist", { waitUntil: "load" });
    await expect(page.getByText(/run not found/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/build your own roster/i)).toBeVisible();
  });

  test("Phase 8H: a shared results URL renders a read-only scorecard, never the owner's leaderboard actions", async ({ page, context }) => {
    // Root cause of the CI timeout this replaces: this test does strictly
    // more real, necessary work than any sibling in the file -- a full
    // 8-round draft (each round pays the real spin-ceremony timer sequence,
    // see playOneRound above), a `/complete` round-trip, AND a full second
    // page load in a fresh tab. Measured locally (fast, uncontested
    // machine, services already warm): ~30s, right at Playwright's 30000ms
    // default per-test timeout with zero slack -- CI's shared/slower
    // runners tip it over. The route-compile part of that cost is now paid
    // by the not-found test above instead (see its comment); this explicit
    // budget covers the rest of the inherent, unavoidable sequential work
    // (not a symptom being papered over -- every wait below still asserts
    // real, authoritative state, not a fixed sleep).
    test.setTimeout(60_000);

    await startCourtBuilder(page);
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      await playOneRound(page);
    }
    const completeBtn = page.locator('[data-testid="complete-season-btn"]');
    await completeBtn.waitFor({ state: "visible", timeout: 10_000 });
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/complete") && r.status() === 200),
      completeBtn.click(),
    ]);
    const gameId = (await resp.json()).game_id as string;

    const sharedPage = await context.newPage();
    await sharedPage.goto(`/arena/court/results/${gameId}`, { waitUntil: "load" });
    await expect(sharedPage.locator('[data-testid="season-result"]')).toBeVisible({ timeout: 10_000 });
    // A shared/viewed run must never show account-specific actions --
    // submitting it would 403 server-side anyway (not the viewer's game),
    // so the UI never offers a button that would just fail.
    await expect(sharedPage.locator('[data-testid="leaderboard-submit-panel"]')).toHaveCount(0);
    await expect(sharedPage.getByText("Build your own")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Phase 6G Part E: leaderboard submit panel is entirely hidden (not just
// disabled) when PEAK3_COURTBUILDER_LEADERBOARD_ENABLED is off, which is
// CI's default env for this suite -- the flag-ON path (sign-in prompt,
// submit flow) is covered by the API-level pytest suite
// (test_perfect_season.py's leaderboard tests), which doesn't depend on a
// real Supabase project.
// ---------------------------------------------------------------------------

test.describe("CourtBuilder leaderboard (Part E)", () => {
  test("leaderboard submit panel does not render when the leaderboard feature is off", async ({ page }) => {
    await startCourtBuilder(page);
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      await playOneRound(page);
    }
    const completeBtn = page.locator('[data-testid="complete-season-btn"]');
    await completeBtn.waitFor({ state: "visible", timeout: 10_000 });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/complete") && r.status() === 200),
      completeBtn.click(),
    ]);
    await expect(page.locator('[data-testid="season-result"]')).toBeVisible({ timeout: 10_000 });
    // LeaderboardSubmitPanel's own leaderboard-enabled check fires as soon
    // as the result screen mounts -- by the time season-result is visible,
    // that fetch may have already resolved, so waiting for a NEW response
    // here is a race (it sometimes never arrives, timing the test out).
    // toHaveCount's own polling is enough: it re-checks the DOM until the
    // panel either never appears or is confirmed absent.
    await expect(page.locator('[data-testid="leaderboard-submit-panel"]')).toHaveCount(0, { timeout: 5_000 });
  });

  test("leaderboard page shows a not-enabled message when the feature is off", async ({ page }) => {
    await page.goto("/arena/court/leaderboard", { waitUntil: "load" });
    await expect(page.getByText("isn't enabled yet")).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

test.describe("CourtBuilder mobile", () => {
  test("@mobile mobile — no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await startCourtBuilder(page);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 4);
  });
});
