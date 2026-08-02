/**
 * GuidedTour (W3).
 *
 * The tour is onboarding, which means every one of its failure modes is a
 * first-impression failure: a walkthrough that will not close, that traps focus
 * on nothing, that reappears forever, that opens over a battle animation, or
 * that crashes because someone renamed a `data-tour-id`. Each of those is a
 * case below.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GuidedTour, TourLauncher, findTourTarget } from "@/components/ui/GuidedTour";
import { RUN_THE_TABLE_TOUR, RUN_THE_TABLE_TOUR_VERSION } from "@/components/ui/tour-steps";
import { markTourSeen, shouldAutoStartTour } from "@/lib/tour-state";

const TOUR = "run-the-table";

/** A laid-out `data-tour-id` target. jsdom reports a zero rect for everything,
 *  so the rect is stubbed — that is the only way to exercise the spotlight. */
function mountTarget(tourId: string, rect = { top: 120, left: 80, width: 300, height: 160 }) {
  const el = document.createElement("div");
  el.setAttribute("data-tour-id", tourId);
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  el.scrollIntoView = vi.fn();
  document.body.appendChild(el);
  return el;
}

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe("first run", () => {
  it("auto-starts on the very first visit", async () => {
    render(<GuidedTour />);
    expect(await screen.findByTestId("guided-tour-popover")).toBeInTheDocument();
  });

  it("shows the first step and its progress as '1 of 7'", async () => {
    render(<GuidedTour />);
    await screen.findByTestId("guided-tour-popover");
    expect(screen.getByTestId("guided-tour-progress")).toHaveTextContent("1 of 7");
    expect(screen.getByTestId("guided-tour-title")).toHaveTextContent(RUN_THE_TABLE_TOUR[0].title);
  });

  it("does NOT auto-start once it has been seen at this version", () => {
    markTourSeen(TOUR, RUN_THE_TABLE_TOUR_VERSION, "completed");
    render(<GuidedTour />);
    expect(screen.queryByTestId("guided-tour-popover")).toBeNull();
  });

  it("auto-starts again after a version bump", async () => {
    markTourSeen(TOUR, RUN_THE_TABLE_TOUR_VERSION, "completed");
    render(<GuidedTour version={RUN_THE_TABLE_TOUR_VERSION + 1} />);
    expect(await screen.findByTestId("guided-tour-popover")).toBeInTheDocument();
  });
});

describe("blocked", () => {
  /**
   * W4 raises `blocked` for a destructive confirmation and for the battle
   * reveal. A spotlight that lands on top of either is worse than no
   * onboarding at all.
   */
  it("suppresses the auto-start entirely while blocked", () => {
    render(<GuidedTour blocked />);
    expect(screen.queryByTestId("guided-tour-popover")).toBeNull();
  });

  it("leaves the stored preference untouched while blocked, so nothing is lost", () => {
    render(<GuidedTour blocked />);
    expect(shouldAutoStartTour(TOUR, RUN_THE_TABLE_TOUR_VERSION)).toBe(true);
  });

  it("auto-starts once the block clears — deferred, not cancelled", async () => {
    const { rerender } = render(<GuidedTour blocked />);
    expect(screen.queryByTestId("guided-tour-popover")).toBeNull();
    rerender(<GuidedTour blocked={false} />);
    expect(await screen.findByTestId("guided-tour-popover")).toBeInTheDocument();
  });
});

describe("navigation", () => {
  it("steps forward and back, and Back is disabled on the first step", async () => {
    render(<GuidedTour />);
    await screen.findByTestId("guided-tour-popover");

    expect(screen.getByTestId("guided-tour-back")).toBeDisabled();

    await userEvent.click(screen.getByTestId("guided-tour-next"));
    expect(screen.getByTestId("guided-tour-progress")).toHaveTextContent("2 of 7");
    expect(screen.getByTestId("guided-tour-title")).toHaveTextContent(RUN_THE_TABLE_TOUR[1].title);

    await userEvent.click(screen.getByTestId("guided-tour-back"));
    expect(screen.getByTestId("guided-tour-progress")).toHaveTextContent("1 of 7");
    expect(screen.getByTestId("guided-tour-back")).toBeDisabled();
  });

  it("finishes on the last step and records completion", async () => {
    render(<GuidedTour />);
    await screen.findByTestId("guided-tour-popover");

    for (let i = 0; i < RUN_THE_TABLE_TOUR.length - 1; i += 1) {
      await userEvent.click(screen.getByTestId("guided-tour-next"));
    }
    expect(screen.getByTestId("guided-tour-progress")).toHaveTextContent("7 of 7");
    expect(screen.getByTestId("guided-tour-next")).toHaveTextContent(/done/i);

    await userEvent.click(screen.getByTestId("guided-tour-next"));
    await waitFor(() => expect(screen.queryByTestId("guided-tour-popover")).toBeNull());
    expect(shouldAutoStartTour(TOUR, RUN_THE_TABLE_TOUR_VERSION)).toBe(false);
  });
});

describe("dismissal", () => {
  it("Skip closes it and stops it coming back", async () => {
    render(<GuidedTour />);
    await screen.findByTestId("guided-tour-popover");
    await userEvent.click(screen.getByTestId("guided-tour-skip"));
    await waitFor(() => expect(screen.queryByTestId("guided-tour-popover")).toBeNull());
    expect(shouldAutoStartTour(TOUR, RUN_THE_TABLE_TOUR_VERSION)).toBe(false);
  });

  it("the close button closes it and stops it coming back", async () => {
    render(<GuidedTour />);
    await screen.findByTestId("guided-tour-popover");
    await userEvent.click(screen.getByTestId("guided-tour-close"));
    await waitFor(() => expect(screen.queryByTestId("guided-tour-popover")).toBeNull());
    expect(shouldAutoStartTour(TOUR, RUN_THE_TABLE_TOUR_VERSION)).toBe(false);
  });

  it("Escape closes it", async () => {
    render(<GuidedTour />);
    await screen.findByTestId("guided-tour-popover");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("guided-tour-popover")).toBeNull());
    expect(shouldAutoStartTour(TOUR, RUN_THE_TABLE_TOUR_VERSION)).toBe(false);
  });
});

describe("focus", () => {
  it("moves focus into the popover on open", async () => {
    render(<GuidedTour />);
    const popover = await screen.findByTestId("guided-tour-popover");
    await waitFor(() =>
      expect(popover === document.activeElement || popover.contains(document.activeElement)).toBe(
        true,
      ),
    );
  });

  it("returns focus to the control that opened it", async () => {
    // Seen already, so the launcher is the only thing that can open it and the
    // captured "previously focused element" is unambiguously the button.
    markTourSeen(TOUR, RUN_THE_TABLE_TOUR_VERSION, "completed");
    render(<TourLauncher />);
    const launcher = screen.getByTestId("tour-launcher");

    await userEvent.click(launcher);
    await screen.findByTestId("guided-tour-popover");

    await userEvent.click(screen.getByTestId("guided-tour-skip"));
    await waitFor(() => expect(document.activeElement).toBe(launcher));
  });

  it("exposes the popover as a labelled modal dialog", async () => {
    render(<GuidedTour />);
    const popover = await screen.findByTestId("guided-tour-popover");
    expect(popover).toHaveAttribute("role", "dialog");
    expect(popover).toHaveAttribute("aria-modal", "true");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByTestId("guided-tour-title")).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName(RUN_THE_TABLE_TOUR[0].title);
  });
});

describe("replay from Help", () => {
  it("does not auto-start for a returning player, but the Help control still opens it", async () => {
    markTourSeen(TOUR, RUN_THE_TABLE_TOUR_VERSION, "completed");
    render(<TourLauncher />);
    expect(screen.queryByTestId("guided-tour-popover")).toBeNull();

    await userEvent.click(screen.getByTestId("tour-launcher"));
    expect(await screen.findByTestId("guided-tour-popover")).toBeInTheDocument();
    expect(screen.getByTestId("guided-tour-progress")).toHaveTextContent("1 of 7");
  });

  it("disables the Help control while the tour is blocked", () => {
    markTourSeen(TOUR, RUN_THE_TABLE_TOUR_VERSION, "completed");
    render(<TourLauncher blocked />);
    expect(screen.getByTestId("tour-launcher")).toBeDisabled();
  });

  it("a completed replay does not overwrite the record with a skip", async () => {
    markTourSeen(TOUR, RUN_THE_TABLE_TOUR_VERSION, "completed");
    render(<TourLauncher />);
    await userEvent.click(screen.getByTestId("tour-launcher"));
    await screen.findByTestId("guided-tour-popover");

    for (let i = 0; i < RUN_THE_TABLE_TOUR.length; i += 1) {
      await userEvent.click(screen.getByTestId("guided-tour-next"));
    }
    await waitFor(() => expect(screen.queryByTestId("guided-tour-popover")).toBeNull());
    expect(shouldAutoStartTour(TOUR, RUN_THE_TABLE_TOUR_VERSION)).toBe(false);
  });
});

describe("targets", () => {
  it("spotlights a laid-out target", async () => {
    mountTarget("rtt-run-map");
    render(<GuidedTour />);
    await screen.findByTestId("guided-tour-popover");
    const ring = await screen.findByTestId("guided-tour-spotlight");
    // 8px of padding on every side of the stubbed 80,120 300×160 rect.
    expect(ring).toHaveStyle({ top: "112px", left: "72px" });
  });

  it("prefers the laid-out element when the same id is rendered twice", () => {
    mountTarget("rtt-credits", { top: 0, left: 0, width: 0, height: 0 });
    const visible = mountTarget("rtt-credits", { top: 40, left: 40, width: 120, height: 40 });
    expect(findTourTarget(["rtt-credits"])).toBe(visible);
  });

  it("falls through to the next candidate id when the first is absent", () => {
    const strip = mountTarget("rtt-progress-strip");
    expect(findTourTarget(["rtt-run-map", "rtt-progress-strip"])).toBe(strip);
  });

  it("degrades gracefully when every target is missing", async () => {
    // Nothing is mounted: no `data-tour-id` exists anywhere. This is the normal
    // case on the start gate.
    render(<GuidedTour />);
    const popover = await screen.findByTestId("guided-tour-popover");
    expect(popover).toBeInTheDocument();
    expect(screen.queryByTestId("guided-tour-spotlight")).toBeNull();
    expect(screen.getByTestId("guided-tour").dataset.placement).toBe("center");
    // Still fully operable — the step is shown, never silently skipped.
    expect(screen.getByTestId("guided-tour-progress")).toHaveTextContent("1 of 7");
    await userEvent.click(screen.getByTestId("guided-tour-next"));
    expect(screen.getByTestId("guided-tour-progress")).toHaveTextContent("2 of 7");
  });

  it("does not crash when a target disappears between steps", async () => {
    const el = mountTarget("rtt-run-map");
    render(<GuidedTour />);
    await screen.findByTestId("guided-tour-spotlight");
    el.remove();
    await userEvent.click(screen.getByTestId("guided-tour-next"));
    expect(screen.getByTestId("guided-tour-progress")).toHaveTextContent("2 of 7");
  });

  it("scrolls the target into view", async () => {
    const el = mountTarget("rtt-run-map");
    render(<GuidedTour />);
    await screen.findByTestId("guided-tour-popover");
    expect(el.scrollIntoView).toHaveBeenCalled();
  });
});

describe("reduced motion", () => {
  it("marks the overlay as un-animated and scrolls instantly", async () => {
    stubReducedMotion(true);
    const el = mountTarget("rtt-run-map");
    render(<GuidedTour />);
    await screen.findByTestId("guided-tour-popover");

    expect(screen.getByTestId("guided-tour")).toHaveAttribute("data-motion", "none");
    expect(el.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "auto" }),
    );
  });

  it("animates normally when reduced motion is not requested", async () => {
    stubReducedMotion(false);
    const el = mountTarget("rtt-run-map");
    render(<GuidedTour />);
    await screen.findByTestId("guided-tour-popover");

    expect(screen.getByTestId("guided-tour")).toHaveAttribute("data-motion", "auto");
    expect(el.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
  });
});

describe("step content", () => {
  it("ships exactly the seven briefed steps, each with at least one target", () => {
    expect(RUN_THE_TABLE_TOUR).toHaveLength(7);
    for (const step of RUN_THE_TABLE_TOUR) {
      expect(step.targets.length).toBeGreaterThan(0);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });

  it("names the five official PEAK3 components in the lane step, unrenamed", () => {
    const lane = RUN_THE_TABLE_TOUR.find((s) => s.id === "lane-profile");
    expect(lane).toBeDefined();
    const text = `${lane?.body} ${lane?.detail ?? ""}`;
    for (const label of [
      "Statistical Impact",
      "Traditional Production",
      "Individual Recognition",
      "Playoff Rate Impact",
      "Team Result",
    ]) {
      expect(text).toContain(label);
    }
  });

  it("says the internal name of a Front Office Perk rather than hiding it", () => {
    const perk = RUN_THE_TABLE_TOUR.find((s) => s.id === "front-office-perks");
    expect(`${perk?.body} ${perk?.detail ?? ""}`).toContain("System");
  });
});
