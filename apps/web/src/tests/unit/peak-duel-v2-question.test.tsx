/**
 * Peak Duel V2 — the question screen's two compositions.
 *
 * ENDLESS draws the face-off as two framed panels around a full-height
 * VERSUS axis, lit by the paired arena wash; DAILY keeps the compact
 * clock-in-the-centre layout the reveal choreography was built against.
 * Both share ONE grid with the same `mt-10` header-to-grid gap — the
 * geometry contract `duel-viewport.spec.ts` measures (the left card's top
 * edge is the same y in the question and in the reveal) — and both expose
 * the same two semantic buttons, the same labels, and NO information the
 * answer would reveal (no scores, no ranks, no component values).
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
    // The paired wash sits behind the pair as a non-grid (absolute) layer.
    expect(screen.getByTestId("duel-faceoff-stage")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("duel-faceoff-stage").querySelectorAll(".v2-arena-light")).toHaveLength(2);

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

describe("PeakDuelV2Question — Daily is untouched", () => {
  it("marks the root as daily and renders neither the axis rules nor the stage", () => {
    const { container } = renderQuestion({ mode: "daily", totalDuels: 10, deadlineAt: performance.now() + 10_000 });
    expect(container.firstElementChild).toHaveAttribute("data-duel-mode", "daily");
    expect(container.querySelectorAll(".duel-versus-rule")).toHaveLength(0);
    expect(screen.queryByTestId("duel-faceoff-stage")).toBeNull();
    // Daily's paired wash is still the header-band light it always was.
    expect(container.querySelectorAll(".v2-arena-light")).toHaveLength(2);
  });

  it("keeps the clock in the centre column and the same grid geometry", () => {
    const { container } = renderQuestion({ mode: "daily", totalDuels: 10, deadlineAt: performance.now() + 10_000 });
    expect(screen.getByTestId("peak-duel-v2-clock")).toBeInTheDocument();
    expect(screen.queryByTestId("peak-duel-v2-versus")).toBeNull();
    const grid = faceoffGrid(container);
    for (const cls of SHARED_GRID_CLASSES) expect(grid.classList.contains(cls), cls).toBe(true);
    const order = Array.from(grid.children).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["duel-card-left", "duel-versus-axis", "duel-card-right"]);
  });

  it("renders the same side markup as Endless (one component, one geometry)", () => {
    renderQuestion({ mode: "daily", totalDuels: 10, deadlineAt: performance.now() + 10_000 });
    const left = screen.getByTestId("duel-card-left");
    expect(left.textContent).toBe("Left · ← or AHakeem Olajuwon1992-93 to 1994-95 · 3-yearChoose Olajuwon");
    expect(left.classList.contains("duel-side")).toBe(true);
    expect(left.classList.contains("p-2")).toBe(true);
  });
});
