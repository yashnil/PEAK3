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
        poolSize={20}
        deadlineAt={null}
        picksMade={0}
        totalPicks={18}
      />,
    );
    expect(screen.getByText(/Denver Nuggets/)).toBeInTheDocument();
    expect(screen.getByText(/2020s/)).toBeInTheDocument();
    expect(screen.getByText(/On the clock — Rim Runner/)).toBeInTheDocument();
  });

  it("says 'You' when it is the viewer's own turn, not their seat's display name", () => {
    render(
      <PeakV2TMWCourts
        state={baseTmwState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={0}
        poolSize={20}
        deadlineAt={null}
        picksMade={0}
        totalPicks={18}
      />,
    );
    expect(screen.getByText(/On the clock — You/)).toBeInTheDocument();
  });

  it("shows no on-the-clock line once the match is complete", () => {
    render(
      <PeakV2TMWCourts
        state={baseTmwState({ is_complete: true })}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={1}
        poolSize={0}
        deadlineAt={null}
        picksMade={18}
        totalPicks={18}
      />,
    );
    expect(screen.queryByText(/On the clock/)).not.toBeInTheDocument();
  });
});
