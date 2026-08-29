/**
 * TMW Pass 7 (human acceptance testing, task §10/§11/§21): reveal geometry
 * stability and current-drafter visibility, for the V2 components that had
 * no dedicated unit coverage before this pass (`PeakV2TMWReveal`,
 * `PeakV2TMWCourts`).
 *
 * NOTE ON SCOPE: jsdom has no real layout engine (`getBoundingClientRect`
 * always returns zeros), so the *actual* pixel-stable geometry claim is
 * verified live via Playwright against the running dev server (see this
 * pass's report), not here. What CAN be verified in jsdom, and is verified
 * below, is the STRUCTURAL invariant the geometry fix depends on: the
 * handoff-label line and both intro/ceremony blocks stay mounted in the
 * document across every stage, with only `visibility`/`opacity` changing —
 * never conditionally added or removed, which is what would cause a size
 * change in a real browser.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/a11y", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/a11y")>();
  return { ...actual, usePrefersReducedMotion: () => true };
});

import PeakV2TMWReveal from "@/components/v2/tmw/PeakV2TMWReveal";
import PeakV2TMWCourts from "@/components/v2/tmw/PeakV2TMWCourts";
import { deadlineFromSeconds } from "@/components/shared/ArenaTimer";
import type { ArenaSeatPublic, TmwPublicState, TmwRoll } from "@/types/three-man-weave";

const SEATS: ArenaSeatPublic[] = [
  { seat_index: 0, display_name: "You", is_bot: false, status: "active", bot_rating: null },
  { seat_index: 1, display_name: "Rim Runner", is_bot: true, status: "active", bot_rating: 50 },
  { seat_index: 2, display_name: "The Enforcer", is_bot: true, status: "active", bot_rating: 50 },
];

const ROLL: TmwRoll = {
  round_number: 1,
  roll_id: "roll-1",
  franchise_id: "DEN",
  franchise_display_name: "Denver Nuggets",
  decade: "2020s",
  eligible_slugs: ["a", "b"],
  candidates: [],
};

describe("PeakV2TMWReveal — reserved geometry (task §10)", () => {
  it("reserves the handoff-label line in the DOM even before it has anything to say (never pops in)", () => {
    render(
      <PeakV2TMWReveal
        roll={ROLL}
        roundNumber={1}
        totalRounds={6}
        seats={SEATS}
        yourSeatIndex={0}
        showIntro={false}
        revealSeconds={4.6}
        handoffLabel={undefined}
      />,
    );
    // Under reduced motion the ceremony settles immediately (`resolved`),
    // but with no handoffLabel the reserved line still renders -- just a
    // single space, per the component's own `{handoffLabel || " "}` --
    // never omitted from the tree.
    const franchise = screen.getByText("Denver Nuggets");
    expect(franchise).toBeInTheDocument();
  });

  it("keeps both the intro block and the ceremony block mounted simultaneously (same grid area), never swapping one out for the other", () => {
    const { container } = render(
      <PeakV2TMWReveal
        roll={ROLL}
        roundNumber={1}
        totalRounds={6}
        seats={SEATS}
        yourSeatIndex={0}
        showIntro
        revealSeconds={9.2}
        handoffLabel="Rim Runner is up"
      />,
    );
    // The intro heading and the round/roll heading are BOTH present in the
    // document at once -- reduced motion resolves the ceremony instantly,
    // but the intro block must still be mounted (only hidden), which this
    // asserts by finding both, rather than only whichever is "active".
    expect(screen.getByText("Three-Man", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Round 1 of 6/)).toBeInTheDocument();
    // Both stacked blocks share the same grid area, which is the mechanism
    // that reserves height to the taller of the two rather than resizing.
    const stackedNodes = Array.from(container.querySelectorAll('[style*="grid-area"]'));
    expect(stackedNodes.length).toBeGreaterThanOrEqual(2);
    stackedNodes.forEach((node) => {
      expect((node as HTMLElement).style.gridArea).toBe("stack");
    });
  });

  it("shows the real rolled franchise and decade, never a placeholder, once resolved", () => {
    render(
      <PeakV2TMWReveal
        roll={ROLL}
        roundNumber={2}
        totalRounds={6}
        seats={SEATS}
        yourSeatIndex={0}
        showIntro={false}
        revealSeconds={4.6}
      />,
    );
    expect(screen.getByText("Denver Nuggets")).toBeInTheDocument();
    expect(screen.getByText("2020s")).toBeInTheDocument();
  });

  // Final closure pass, task §2: the ONE-TIME match-open transition. Before
  // this pass, `roll === null` (the true first frame of a match, before the
  // server's first roll has arrived) rendered a single short <p> OUTSIDE the
  // "stack" grid -- a different, smaller subtree than the loaded case, which
  // is exactly what made the container's real height jump the instant `roll`
  // populated. No prior test in this file ever exercised `roll={null}` (every
  // case above uses the fixed `ROLL` constant) -- this was a real, previously
  // uncovered gap, not a re-regression of the already-fixed per-round case.
  it("reserves the SAME grid-stack structure before the first roll arrives (roll=null) as once it has (task §2)", () => {
    const { container } = render(
      <PeakV2TMWReveal
        roll={null}
        roundNumber={null}
        totalRounds={6}
        seats={SEATS}
        yourSeatIndex={0}
        showIntro
        revealSeconds={9.2}
      />,
    );
    // The intro block (seats/totalRounds only, never `roll`) and the
    // ceremony block (now unconditionally mounted, with an em-dash
    // placeholder standing in for each `SpinReel`) must both be present,
    // sharing the same `gridArea: "stack"` -- the identical structural
    // invariant already asserted above for the loaded case.
    expect(screen.getByText("Three-Man", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Rolling the next franchise and decade…")).toBeInTheDocument();
    const stackedNodes = Array.from(container.querySelectorAll('[style*="grid-area"]'));
    expect(stackedNodes.length).toBeGreaterThanOrEqual(2);
    stackedNodes.forEach((node) => {
      expect((node as HTMLElement).style.gridArea).toBe("stack");
    });
    // No real franchise/decade text should appear yet -- only the em-dash
    // placeholders reserving the reel's exact font token/size.
    expect(screen.queryByTestId("tmw-roll-franchise")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tmw-roll-decade")).not.toBeInTheDocument();
  });

  it("keeps the underlying roll result unchanged once it arrives, after having rendered roll=null first", () => {
    const { rerender } = render(
      <PeakV2TMWReveal
        roll={null}
        roundNumber={null}
        totalRounds={6}
        seats={SEATS}
        yourSeatIndex={0}
        showIntro={false}
        revealSeconds={4.6}
      />,
    );
    rerender(
      <PeakV2TMWReveal
        roll={ROLL}
        roundNumber={1}
        totalRounds={6}
        seats={SEATS}
        yourSeatIndex={0}
        showIntro={false}
        revealSeconds={4.6}
      />,
    );
    expect(screen.getByText("Denver Nuggets")).toBeInTheDocument();
    expect(screen.getByText("2020s")).toBeInTheDocument();
  });
});

function baseTmwState(overrides: Partial<TmwPublicState> = {}): TmwPublicState {
  return {
    mode_version: "v1",
    formula_version: "v1",
    slot_types: ["PG", "SG", "SF", "PF", "C", "bench_1"],
    total_rounds: 6,
    current_round: 1,
    current_seat: 1,
    is_complete: false,
    rosters: [
      { seat_index: 0, slots: {}, complete: false },
      { seat_index: 1, slots: {}, complete: false },
      { seat_index: 2, slots: {}, complete: false },
    ],
    drafted_identities: [],
    used_roll_ids: [],
    current_roll: ROLL,
    ...overrides,
  };
}

describe("PeakV2TMWCourts — current drafter is unmistakable (task §11)", () => {
  it("names the on-the-clock seat and the real roll in one always-visible line", () => {
    render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={1}
        deadlineAt={null}
        picksMade={0}
        totalPicks={18}
      />,
    );
    expect(screen.getByText(/Denver Nuggets/)).toBeInTheDocument();
    expect(screen.getByText(/2020s/)).toBeInTheDocument();
    // WHOSE PICK IT IS now lives beside the countdown in the instrument
    // strip, and on the active court's own header — not appended to the roll
    // line as well. It used to be said in all three places at once; the rule
    // this test protects ("the current drafter is unmistakable") is
    // unchanged, it just has one home instead of three.
    expect(screen.getByTestId("tmw-on-the-clock")).toHaveTextContent(/Rim Runner/);
  });

  it("says 'You' when it is the viewer's own turn, not their seat's display name", () => {
    render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={0}
        deadlineAt={null}
        picksMade={0}
        totalPicks={18}
      />,
    );
    expect(screen.getByTestId("tmw-on-the-clock")).toHaveTextContent(/Your pick/i);
  });

  it("shows no VISIBLE on-the-clock line once the match is complete", () => {
    render(
      <PeakV2TMWCourts
        state={baseTmwState({ is_complete: true })}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={1}
        deadlineAt={null}
        picksMade={18}
        totalPicks={18}
      />,
    );
    // A finished match has nobody on the clock, so the instrument strip has
    // nothing to name and renders no on-the-clock element at all. (The
    // reserved-width placeholder this used to assert on belonged to the roll
    // line's duplicate copy, which is gone — with it, so is the wrap-point
    // hazard it existed to neutralise.)
    expect(screen.queryByTestId("tmw-on-the-clock")).toBeNull();
  });
});

// Final closure pass, task §5: a visual evaluator once saw a possible
// transient four-digit number in the TMW header, not reliably reproduced by
// eye. Traced candidate mechanism: `PeakV2TMWCourts`'s instrument timer
// rendered whenever `remaining !== null`, with no gate on whether a seat was
// actually on the clock -- unlike legacy `TurnStatus`, which only ever shows
// a clock when `yourTurn`/`activeSeat` is true. During `PHASE_INTRO`/
// `PHASE_REVEAL` (seatless turns), the backend populates the viewer's own
// `seconds_remaining` with up to ~1800 (the 30-minute intro backstop), and
// that value flows into the same `deadlineAt` prop this component receives.
// `PeakV2Timer` renders the raw seconds with no formatting. The test below
// reproduced this deterministically (rendered the literal text "1798")
// before the fix; it now asserts the fixed, gated behaviour.
describe("PeakV2TMWCourts — header timer during a seatless phase (task §5)", () => {
  it("REPRODUCED, then fixed: no seat on the clock + an intro-scale deadlineAt used to render a literal 4-digit number", () => {
    // Deterministic reproduction of the reported (but not reliably
    // eyeballed) glitch: before the fix, this exact shape rendered
    // `[data-testid="peak-v2-timer-value"]` as the literal text "1798" --
    // confirmed by running this test against the pre-fix component. The
    // server publishes exactly this shape during `PHASE_INTRO`/
    // `PHASE_REVEAL` (seatless turns): `deadlineAt` carries the ~30-minute
    // intro backstop while `currentTurnSeatIndex` is null.
    const introDeadline = deadlineFromSeconds(1798);
    render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={null}
        deadlineAt={introDeadline}
        picksMade={0}
        totalPicks={18}
      />,
    );
    expect(screen.queryByTestId("peak-v2-timer-value")).not.toBeInTheDocument();
  });

  it("still shows the timer normally once a real seat is genuinely on the clock", () => {
    const turnDeadline = deadlineFromSeconds(30);
    render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={1}
        deadlineAt={turnDeadline}
        picksMade={0}
        totalPicks={18}
      />,
    );
    expect(screen.getByTestId("peak-v2-timer-value")).toHaveTextContent("30");
  });
});

// Follow-up closure pass: the outer shell (`tmw-v2-arena-shell`, measured in
// the describe block above) was dimensionally stable but not viewport-
// contained -- live measurement showed its bottom edge 55px below the
// viewport at 1280x800 and ~177px below at 390x844. Fixed by capping the
// content to a `--tmw-viewport-cap` CSS custom property (published by the
// ancestor in `ThreeManWeaveGame.tsx` from a real `getBoundingClientRect()`
// measurement) and splitting a pinned header from a scrollable court region.
// jsdom has no real layout engine, so what's asserted here is the
// STRUCTURAL contract the live-browser measurement depends on: the
// scrollable region exists, is capped relative to the published variable,
// and the header/round/timer content is NOT inside it (so it can never
// scroll out of reach), while the court/roster content IS.
describe("PeakV2TMWCourts — viewport containment (follow-up closure pass)", () => {
  function findScrollRegion(container: HTMLElement): HTMLElement {
    const candidates = Array.from(container.querySelectorAll<HTMLElement>("div")).filter((el) =>
      el.className.includes("overflow-y-auto"),
    );
    expect(candidates.length).toBe(1);
    return candidates[0];
  }

  it("caps the scrollable court region to the published --tmw-viewport-cap variable, not an unbounded height", () => {
    const { container } = render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={1}
        deadlineAt={null}
        picksMade={0}
        totalPicks={18}
      />,
    );
    const scrollRegion = findScrollRegion(container);
    expect(scrollRegion.style.maxHeight).toContain("--tmw-viewport-cap");
  });

  it("keeps the header (title, round/pick status, on-the-clock line) OUTSIDE the scrollable region", () => {
    const { container } = render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={1}
        deadlineAt={null}
        picksMade={0}
        totalPicks={18}
      />,
    );
    const scrollRegion = findScrollRegion(container);
    const title = screen.getByText("Three-Man Weave");
    // `PeakV2TMWCourt` also names the on-the-clock seat on its own card (a
    // different, court-scoped "On the clock" instance) -- this test cares
    // specifically about the shared instrument row's copy, which is always
    // the first "On the clock" text in document order (it precedes every
    // court component).
    const onClockLine = screen.getAllByText(/On the clock/)[0];
    expect(scrollRegion.contains(title)).toBe(false);
    expect(scrollRegion.contains(onClockLine)).toBe(false);
  });

  it("keeps the court/roster content INSIDE the scrollable region", () => {
    const { container } = render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={1}
        deadlineAt={null}
        picksMade={0}
        totalPicks={18}
      />,
    );
    const scrollRegion = findScrollRegion(container);
    // "Open" slot labels only render inside the roster/court cards.
    const openSlots = screen.getAllByText("Open");
    expect(openSlots.length).toBeGreaterThan(0);
    openSlots.forEach((slot) => expect(scrollRegion.contains(slot)).toBe(true));
  });
});

describe("PeakV2TMWCourts — the roll is not stated before it is revealed", () => {
  /**
   * design-review/13: the round-one franchise and decade were legible on the
   * board BEHIND the intro overlay, before any reel had spun. The server
   * knows the roll before the ceremony starts — it has to, the reel spins to
   * it — but the presentation must still honour the reveal.
   */
  it("hides the roll line while the ceremony is still running", () => {
    render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={1}
        deadlineAt={null}
        rollRevealed={false}
        picksMade={0}
        totalPicks={18}
      />,
    );
    expect(screen.queryByText(/Denver Nuggets/)).toBeNull();
    expect(screen.queryByText(/2020s/)).toBeNull();
  });

  it("shows it the moment the ceremony has revealed it", () => {
    render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={1}
        deadlineAt={null}
        rollRevealed
        picksMade={0}
        totalPicks={18}
      />,
    );
    expect(screen.getByText(/Denver Nuggets/)).toBeInTheDocument();
  });
});

describe("PeakV2TMWCourts — one clock, visible to every seat", () => {
  /**
   * `seconds_remaining` is only populated when the open turn is YOURS or
   * nobody's, so with another seat on the clock the header had nothing to
   * count and rendered no timer at all (design-review/14 — "On the clock —
   * Stretch Five" with no countdown anywhere). `turn_seconds_remaining` is
   * the open turn's own clock and the server publishes it to every seat.
   */
  it("counts the OPEN TURN's clock while another seat is picking", () => {
    render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={SEATS}
        yourSeatIndex={0}
        // Seat 1 is picking, so this viewer's own clock is null...
        currentTurnSeatIndex={1}
        deadlineAt={null}
        // ...but the match clock is published to them anyway.
        turnDeadlineAt={deadlineFromSeconds(31)}
        picksMade={0}
        totalPicks={18}
      />,
    );
    expect(screen.getByTestId("peak-v2-timer-value")).toHaveTextContent("31");
  });

  it("names who the clock belongs to, rather than how many players are undrafted", () => {
    render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={1}
        deadlineAt={null}
        turnDeadlineAt={deadlineFromSeconds(31)}
        picksMade={0}
        totalPicks={18}
      />,
    );
    expect(screen.getByTestId("tmw-on-the-clock")).toHaveTextContent(/Rim Runner/);
    expect(screen.queryByText(/undrafted/i)).toBeNull();
  });

  it("falls back to the viewer's own clock if an older API sends no match clock", () => {
    render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={0}
        deadlineAt={deadlineFromSeconds(12)}
        picksMade={0}
        totalPicks={18}
      />,
    );
    expect(screen.getByTestId("peak-v2-timer-value")).toHaveTextContent("12");
  });
});

describe("PeakV2TMWCourts — the bench shows what it is worth", () => {
  /**
   * Three-Man Weave's `lineup_score` is a FLAT, equally-weighted mean over
   * all six cards (`nba_peak/three_man_weave/evaluation.py::_tmw_talent_core`)
   * — unlike 82-0, there is no starters/bench split. The bench pick moves the
   * final number exactly as much as the point guard does, so rendering it as
   * a bare name with no season, no team and no PEAK3 value
   * (design-review/14) understated the single most under-rated decision in
   * the draft.
   */
  const BENCH_PICK = {
    player_slug: "bernard-king",
    player_name: "Bernard King",
    positions: ["SF", "PF"],
    eligibility: {
      franchise_id: "NYK",
      franchise_display_name: "New York Knicks",
      decade: "1980s",
      seasons: [
        { season: "1983-84", team_code: "NYK", games_played: 77, via: "direct_team_season" },
      ],
    },
    scoring_card: {
      season: "1983-84",
      team_id: "NYK",
      team_name: "New York Knicks",
      prime_score: 73.2,
      score_source: "exact_team_stint",
      is_multi_team_season: false,
      formula_version: "peak3_v1",
    },
  } as unknown as NonNullable<TmwPublicState["rosters"][number]["slots"]["bench_1"]>;

  function renderWithBench() {
    render(
      <PeakV2TMWCourts
        state={baseTmwState({
          rosters: [
            { seat_index: 0, slots: { bench_1: BENCH_PICK }, complete: false },
            { seat_index: 1, slots: {}, complete: false },
            { seat_index: 2, slots: {}, complete: false },
          ],
        })}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={1}
        deadlineAt={null}
        turnDeadlineAt={deadlineFromSeconds(31)}
        picksMade={1}
        totalPicks={18}
      />,
    );
  }

  // `getAll*`: the courts render a desktop and a narrow variant, so every
  // seat's board legitimately appears more than once in the DOM.
  it("renders the bench player's PEAK3 value, exactly as a starter's is rendered", () => {
    renderWithBench();
    expect(screen.getAllByText("73.2").length).toBeGreaterThan(0);
  });

  it("renders the bench player's season and team, not just their name", () => {
    renderWithBench();
    const meta = screen.getAllByTestId("tmw-slot-season-bench_1");
    expect(meta.length).toBeGreaterThan(0);
    expect(meta[0]).toHaveTextContent("1983-84");
    expect(meta[0]).toHaveTextContent("NYK");
  });

  it("labels the slot BENCH, never the raw `bench_1` key", () => {
    renderWithBench();
    expect(screen.queryByText("bench_1")).toBeNull();
    expect(screen.getAllByText(/^Bench$/i).length).toBeGreaterThan(0);
  });
});

describe("PeakV2TMWCourts — the live turn is legible, from real state only", () => {
  const BOT_SEATS = [
    { seat_index: 0, display_name: "You", is_bot: false },
    { seat_index: 1, display_name: "Rim Runner", is_bot: true },
    { seat_index: 2, display_name: "The Closer", is_bot: true },
  ] as unknown as typeof SEATS;

  function renderCourts(currentTurnSeatIndex: number | null) {
    render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={BOT_SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={currentTurnSeatIndex}
        deadlineAt={null}
        turnDeadlineAt={deadlineFromSeconds(31)}
        rollRevealed
        picksMade={0}
        totalPicks={18}
      />,
    );
  }

  it("a BOT on the clock is shown as deliberating, on its own court", () => {
    renderCourts(1);
    // The seat the SERVER says is on the clock — not a guess, not a timer.
    const thinking = screen.getAllByTestId("tmw-thinking");
    expect(thinking.length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("tmw-seat-status-1")[0]).toHaveTextContent(/Thinking/i);
  });

  it("only the seat actually on the clock deliberates", () => {
    renderCourts(1);
    expect(screen.getAllByTestId("tmw-seat-status-2")[0]).not.toHaveTextContent(/Thinking/i);
    expect(screen.getAllByTestId("tmw-seat-status-0")[0]).not.toHaveTextContent(/Thinking/i);
  });

  it("the HUMAN on the clock is told it is their pick, never 'Thinking'", () => {
    renderCourts(0);
    expect(screen.getAllByTestId("tmw-seat-status-0")[0]).toHaveTextContent(/Your pick/i);
    expect(screen.queryAllByTestId("tmw-thinking")).toHaveLength(0);
  });

  it("nobody deliberates when no seat owns the turn", () => {
    renderCourts(null);
    expect(screen.queryAllByTestId("tmw-thinking")).toHaveLength(0);
  });

  it("does not caption all three courts with the same standing band", () => {
    // `edgeBandFor` is real data, but for most of a draft every seat shares a
    // band and three courts each reading "Level with the field" distinguishes
    // nobody. Suppressed while the bands agree.
    renderCourts(1);
    expect(screen.queryAllByText(/Level with the field/i)).toHaveLength(0);
  });
});
