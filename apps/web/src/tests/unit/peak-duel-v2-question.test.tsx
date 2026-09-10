/**
 * Peak Duel V2 — the question screen's composition.
 *
 * BOTH MODES NOW DRAW THE FACE-OFF, and this file used to assert the
 * opposite. Endless got framed panels around a full-height VERSUS axis lit
 * by the paired arena wash; Daily was deliberately excluded, on the
 * reasoning that its clock and session dashes already gave the screen an
 * instrument to read.
 *
 * Screenshotting the live game at 1440x900 did not support that. Daily's
 * decision beat rendered two ~24px names and an outlined echo on each side
 * in the top 340px of the viewport, with ~400px of unbroken black beneath —
 * and Daily is the mode most people play. The composition was already
 * built, already tested and already correct; only its scoping was wrong. So
 * the `Daily is untouched` block below is now `Daily gets the same
 * composition`, and it asserts the reversal rather than the old exclusion.
 *
 * What did NOT change, and is still asserted here: both modes share ONE
 * grid with the same `mt-10` header-to-grid gap — the geometry contract
 * `duel-viewport.spec.ts` measures (the left card's top edge is the same y
 * in the question and in the reveal) — both expose the same two semantic
 * buttons with the same labels, and neither reveals any information the
 * answer would (no scores, no ranks, no component values). Daily still
 * carries the countdown on the axis where Endless carries the VS mark.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import PeakDuelV2Question, { type PeakDuelV2QuestionProps } from "@/components/v2/duel/PeakDuelV2Question";
import type { Duel } from "@/types";

afterEach(cleanup);

function duel(): Duel {
  return {
    id: "duel-1",
    left: {
      player_name: "Hakeem Olajuwon",
      player_slug: "hakeem-olajuwon",
      duration_years: 3,
      start_season: "1992-93",
      end_season: "1994-95",
      anchor_season: "1992-93",
      peak_id: "peak-left",
    },
    right: {
      player_name: "Cedric Maxwell",
      player_slug: "cedric-maxwell",
      duration_years: 3,
      start_season: "1979-80",
      end_season: "1981-82",
      anchor_season: "1979-80",
      peak_id: "peak-right",
    },
    difficulty: "Comfortable",
  };
}

function renderQuestion(overrides: Partial<PeakDuelV2QuestionProps> = {}) {
  const props: PeakDuelV2QuestionProps = {
    mode: "endless",
    duel: duel(),
    results: [],
    totalDuels: 30,
    currentIndex: 0,
    selectedPeakId: null,
    submitting: false,
    deadlineAt: null,
    totalArenaPoints: 0,
    currentStreak: 0,
    onSelect: vi.fn(),
    onTimeout: vi.fn(),
    ...overrides,
  };
  const utils = render(<PeakDuelV2Question {...props} />);
  return { ...utils, props };
}

/** The grid both modes share — the geometry contract lives in these classes. */
const SHARED_GRID_CLASSES = ["mt-10", "grid", "grid-cols-1", "items-center", "gap-8", "sm:grid-cols-[1fr_auto_1fr]", "sm:gap-4"];

function faceoffGrid(container: HTMLElement): HTMLElement {
  const grid = container.querySelector(".duel-faceoff");
  if (!(grid instanceof HTMLElement)) throw new Error("face-off grid not rendered");
  return grid;
}

describe("PeakDuelV2Question — Endless composition", () => {
  it("marks the root as endless and renders both sides around a VERSUS axis", () => {
    const { container } = renderQuestion();

    expect(container.firstElementChild).toHaveAttribute("data-duel-mode", "endless");

    const left = screen.getByTestId("duel-card-left");
    const right = screen.getByTestId("duel-card-right");
    expect(left.tagName).toBe("BUTTON");
    expect(right.tagName).toBe("BUTTON");
    expect(left).toHaveAccessibleName("Select Hakeem Olajuwon, 3-year peak, 1992-93 to 1994-95");
    expect(right).toHaveAccessibleName("Select Cedric Maxwell, 3-year peak, 1979-80 to 1981-82");

    const axis = screen.getByTestId("duel-versus-axis");
    expect(axis).toHaveTextContent(/higher peak\?/i);
    expect(screen.getByTestId("peak-duel-v2-versus")).toHaveTextContent("vs");
    // Two court-line hairlines: one above the mark, one below.
    expect(axis.querySelectorAll(".duel-versus-rule")).toHaveLength(2);
    // The stage sits behind the pair as a non-grid (absolute) layer, and it
    // is a FRAME, not a light — see the `lights the pair` case below.
    expect(screen.getByTestId("duel-faceoff-stage")).toHaveAttribute("aria-hidden", "true");

    // DOM order is left, axis, right: the reading order IS the face-off.
    const grid = faceoffGrid(container);
    const order = Array.from(grid.children).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["duel-faceoff-stage", "duel-card-left", "duel-versus-axis", "duel-card-right"]);
  });

  it("keeps the shared grid geometry (same mt-10 grid as Daily)", () => {
    const { container } = renderQuestion();
    const grid = faceoffGrid(container);
    for (const cls of SHARED_GRID_CLASSES) expect(grid.classList.contains(cls), cls).toBe(true);
  });

  it("shows no clock and no session dashes — Endless is untimed", () => {
    renderQuestion();
    expect(screen.queryByTestId("peak-duel-v2-clock")).toBeNull();
    expect(screen.queryByTestId("peak-duel-decision-clock")).toBeNull();
  });

  it("adds no information before the answer: each side is name, window, key hint and the choose echo", () => {
    renderQuestion();
    const left = screen.getByTestId("duel-card-left");
    expect(left.textContent).toBe("Left · ← or AHakeem Olajuwon1992-93 to 1994-95 · 3-yearChoose Olajuwon");
    const right = screen.getByTestId("duel-card-right");
    expect(right.textContent).toBe("Right · → or DCedric Maxwell1979-80 to 1981-82 · 3-yearChoose Maxwell");
    // No score-shaped number anywhere on the screen.
    expect(document.body.textContent).not.toMatch(/\d{2}\.\d/);
  });

  it("carries selection and pending state as attributes, and disables both sides while submitting", () => {
    renderQuestion({ selectedPeakId: "peak-left", submitting: true });
    const left = screen.getByTestId("duel-card-left");
    const right = screen.getByTestId("duel-card-right");
    expect(left).toHaveAttribute("data-selected", "true");
    expect(left).toHaveAttribute("data-pending", "true");
    expect(left).toHaveAttribute("aria-pressed", "true");
    expect(right).toHaveAttribute("data-selected", "false");
    expect(right).toHaveAttribute("data-pending", "false");
    expect(left).toBeDisabled();
    expect(right).toBeDisabled();
  });

  it("a press on either side selects that side's peak", () => {
    const { props } = renderQuestion();
    fireEvent.click(screen.getByTestId("duel-card-right"));
    expect(props.onSelect).toHaveBeenCalledWith("peak-right");
    fireEvent.click(screen.getByTestId("duel-card-left"));
    expect(props.onSelect).toHaveBeenCalledWith("peak-left");
  });

  it("sizes through CSS custom properties whose fallbacks are Daily's values", () => {
    renderQuestion();
    const name = screen.getByTestId("duel-card-left").querySelector(".duel-side-name") as HTMLElement;
    expect(name.style.fontSize).toBe("var(--duel-name-size, 1.25rem)");
    const vs = screen.getByTestId("peak-duel-v2-versus");
    expect(vs.style.fontSize).toBe("var(--duel-vs-size, 1.5rem)");
  });
});

describe("PeakDuelV2Question — Daily gets the same composition", () => {
  it("draws the axis and the stage, exactly as Endless does", () => {
    const { container } = renderQuestion({ mode: "daily", totalDuels: 10, deadlineAt: performance.now() + 10_000 });
    expect(container.firstElementChild).toHaveAttribute("data-duel-mode", "daily");
    // Two hairlines meeting at the instrument on the axis — see the file
    // docstring for why Daily no longer opts out of this.
    expect(container.querySelectorAll(".duel-versus-rule")).toHaveLength(2);
    expect(screen.getByTestId("duel-faceoff-stage")).toHaveAttribute("aria-hidden", "true");
  });

  it("adds NO light of its own — the room is the light", () => {
    // This surface used to carry the paired cool/warm wash, the one
    // documented exception to the single-light rule, from a time when the
    // page behind it was flat black and the pair needed its own direction.
    // `PeakV2ArenaBackdrop` supplies a floodlight, a fill and a vignette on
    // every page now, so keeping the pair meant five gradient layers on the
    // single surface that already had an exception. The exception is retired;
    // this asserts it stays retired, in BOTH modes.
    for (const mode of ["daily", "endless"] as const) {
      cleanup();
      const { container } = renderQuestion({ mode, totalDuels: 10, deadlineAt: performance.now() + 10_000 });
      expect(container.querySelectorAll(".v2-arena-light"), mode).toHaveLength(0);
    }
  });

  it("keeps the clock in the centre column and the same grid geometry", () => {
    const { container } = renderQuestion({ mode: "daily", totalDuels: 10, deadlineAt: performance.now() + 10_000 });
    expect(screen.getByTestId("peak-duel-v2-clock")).toBeInTheDocument();
    expect(screen.queryByTestId("peak-duel-v2-versus")).toBeNull();
    const grid = faceoffGrid(container);
    for (const cls of SHARED_GRID_CLASSES) expect(grid.classList.contains(cls), cls).toBe(true);
    const order = Array.from(grid.children).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["duel-faceoff-stage", "duel-card-left", "duel-versus-axis", "duel-card-right"]);
  });

  it("remounts the pair per matchup so the entrance replays", () => {
    // Without a key on the grid React reuses the subtree and only the text
    // changes, so ten matchups read as one screen with the names swapped.
    // Asserted through behaviour rather than through the key itself: a new
    // duel must produce a NEW left-card element, not the same one mutated.
    const { rerender } = renderQuestion({ mode: "daily", totalDuels: 10, deadlineAt: performance.now() + 10_000 });
    const first = screen.getByTestId("duel-card-left");
    const next = duel();
    next.left = { ...next.left, peak_id: "peak-left-2", player_name: "David Robinson" };
    rerender(
      <PeakDuelV2Question
        mode="daily"
        duel={next}
        results={[]}
        totalDuels={10}
        currentIndex={1}
        selectedPeakId={null}
        submitting={false}
        deadlineAt={performance.now() + 10_000}
        totalArenaPoints={0}
        currentStreak={0}
        onSelect={vi.fn()}
        onTimeout={vi.fn()}
      />,
    );
    expect(screen.getByTestId("duel-card-left")).not.toBe(first);
  });

  it("renders the same side markup as Endless (one component, one geometry)", () => {
    renderQuestion({ mode: "daily", totalDuels: 10, deadlineAt: performance.now() + 10_000 });
    const left = screen.getByTestId("duel-card-left");
    expect(left.textContent).toBe("Left · ← or AHakeem Olajuwon1992-93 to 1994-95 · 3-yearChoose Olajuwon");
    expect(left.classList.contains("duel-side")).toBe(true);
    expect(left.classList.contains("p-2")).toBe(true);
  });
});
