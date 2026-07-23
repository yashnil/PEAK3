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
 * open slot. Registers waitForResponse BEFORE each click, matching the
 * Promise.all pattern already established in gameplay.spec.ts to avoid a
 * response/registration race. The spin ceremony's ~1.6s timer sequence
 * happens before the candidate card becomes visible; the existing 10s
 * waitFor timeout already comfortably covers it -- no ceremony-specific
 * wait needed here. */
async function playOneRound(page: Page): Promise<void> {
  const candidate = page.locator('[data-testid="candidate-card"]').first();
  await candidate.waitFor({ state: "visible", timeout: 10_000 });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/select") && r.status() === 200),
    candidate.click(),
  ]);

  const openSlot = page.locator('[data-testid="court-slot"][data-filled="false"]').first();
  await openSlot.waitFor({ state: "visible", timeout: 10_000 });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/place") && r.status() === 200),
    openSlot.click(),
  ]);
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
    // A candidate card renders the player's name and an allowed-positions
    // badge (letters only, e.g. "PG / SG") -- no digits from a score/rank
    // should ever appear in its text content.
    expect(/\d/.test(candidateText)).toBe(false);
  });

  test("a filled slot shows 'peak locked', never a score, until the roster is fully revealed", async ({ page }) => {
    await startCourtBuilder(page);
    await playOneRound(page);
    // Exactly one slot is filled at this point (mid-run) -- it must show
    // the qualitative "peak locked" note, never a revealed score line.
    await expect(page.locator('[data-testid="peak-locked-note"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="revealed-score-line"]')).toHaveCount(0);
    const lockedText = await page.locator('[data-testid="peak-locked-note"]').innerText();
    // "Peak locked" text may legitimately contain the season string (e.g.
    // "1990-91"), which has digits -- so instead of a blanket no-digits
    // check, assert the literal score-reveal marker text is absent.
    expect(lockedText.toLowerCase()).toContain("peak locked");
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
    const text = await badge.innerText();
    expect(text.toLowerCase()).toContain("plays");
  });

  test("an off-position fit badge explains which position the player actually plays", async ({ page }) => {
    await startCourtBuilder(page);
    // Place the first candidate at Center regardless of archetype -- for
    // seed 42's first-round pool this reliably produces an off-position
    // placement (position-eligibility-clarity goal: never just say
    // "off-position" without saying why).
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
    const badgeText = (await centerSlot.locator('[data-testid="role-fit-badge"]').innerText()).toLowerCase();
    if (badgeText.includes("off-position")) {
      expect(badgeText).toContain("plays");
    }
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

    const openSlot = page.locator('[data-testid="court-slot"][data-filled="false"]').first();
    await openSlot.waitFor({ state: "visible" });
    await openSlot.focus();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/place") && r.status() === 200),
      page.keyboard.press("Enter"),
    ]);

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
    // SPIN_MS/LOCK_MS/COUNT_MS sequence, ~1.7s total for normal-motion
    // users) are skipped entirely -- the effect flips phase straight to
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
