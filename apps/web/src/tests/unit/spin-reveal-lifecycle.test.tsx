/**
 * The shared roll ceremony's lifecycle — IDLE -> SPINNING -> LOCKING ->
 * REVEALED — and the invariant that motivated it: THE FINAL VALUE IS NEVER
 * ON SCREEN BEFORE THE SPIN.
 *
 * The server decides the roll before the first frame (it has to; the reel
 * spins TO it), so "not leaked" cannot mean "not known" — it means the reel
 * does not exist until the ceremony is turning. `SpinReel` starts its
 * animation on MOUNT, so mounting it during IDLE made the wheel turn and
 * land inside a stage that is supposed to be armed-and-undecided: measured
 * live in Three-Man Weave, the reel reached `done` ~1.6s in, entirely behind
 * the opening card, and the ceremony then advanced to SPINNING with the
 * answer already sitting there under a caption reading "Rolling…".
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import PeakV2SpinReveal from "@/components/v2/PeakV2SpinReveal";

const AXES = [
  { label: "Franchise", value: "Detroit Pistons", pool: ["Boston Celtics", "Detroit Pistons"], testId: "ax-franchise" },
  { label: "Decade", value: "2000s", pool: ["1990s", "2000s"], testId: "ax-decade" },
];

function renderAt(stage: "idle" | "spinning" | "locking" | "revealed") {
  return render(
    <PeakV2SpinReveal axes={AXES} runKey="roll-1" stage={stage} testId="ceremony" />,
  );
}

describe("PeakV2SpinReveal — the ceremony's own lifecycle", () => {
  it("IDLE mounts no reel at all, so there is nothing on screen to leak", () => {
    renderAt("idle");
    expect(screen.queryByTestId("ax-franchise-reel")).toBeNull();
    expect(screen.queryByTestId("ax-decade-reel")).toBeNull();
    // ...and the decided value is nowhere in the rendered output.
    expect(screen.queryByText("Detroit Pistons")).toBeNull();
    expect(screen.getByTestId("ceremony")).toHaveAttribute("data-stage", "idle");
    expect(screen.getByTestId("ceremony")).toHaveAttribute("data-revealed", "false");
  });

  it("the armed slot still reserves the reel's own window, so mounting it moves nothing", () => {
    const { container } = renderAt("idle");
    // One armed placeholder per axis, in the value slot the reel will occupy.
    expect(container.querySelectorAll(".v2-spin-axis-armed")).toHaveLength(AXES.length);
    expect(container.querySelectorAll(".v2-spin-axis-value")).toHaveLength(AXES.length);
  });

  it("SPINNING is when the reels exist — and they carry the answer as data from t=0", () => {
    renderAt("spinning");
    const franchise = screen.getByTestId("ax-franchise-reel");
    expect(franchise).toBeInTheDocument();
    // The reel cannot resolve to anything else: a test can assert the target
    // without racing the animation.
    expect(franchise).toHaveAttribute("data-final-value", "Detroit Pistons");
    expect(screen.getByTestId("ax-decade-reel")).toHaveAttribute("data-final-value", "2000s");
    expect(screen.getByTestId("ceremony")).toHaveAttribute("data-revealed", "false");
  });

  it("LOCKING is still not revealed", () => {
    renderAt("locking");
    expect(screen.getByTestId("ceremony")).toHaveAttribute("data-stage", "locking");
    expect(screen.getByTestId("ceremony")).toHaveAttribute("data-revealed", "false");
  });

  it("REVEALED announces the landed values exactly once, through one live region", () => {
    renderAt("revealed");
    expect(screen.getByTestId("ceremony")).toHaveAttribute("data-revealed", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      /Rolled Franchise Detroit Pistons, Decade 2000s\./i,
    );
  });

  it("says nothing to assistive tech before the values are readable", () => {
    renderAt("spinning");
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("the shell keeps the same axis structure at every stage — it never morphs", () => {
    const shapes = (["idle", "spinning", "locking", "revealed"] as const).map((stage) => {
      const { container, unmount } = renderAt(stage);
      const shape = {
        axes: container.querySelectorAll(".v2-spin-axis").length,
        values: container.querySelectorAll(".v2-spin-axis-value").length,
        labels: container.querySelectorAll(".v2-spin-axis-label").length,
        actions: container.querySelectorAll(".v2-spin-axis-action").length,
      };
      unmount();
      return shape;
    });
    // Identical structure at every stage: a ceremony whose container grows
    // as it resolves reads as a layout bug, not as a reveal.
    shapes.forEach((shape) => expect(shape).toEqual(shapes[0]));
  });

  it("a long axis value does not change the shell's structure", () => {
    const { container } = render(
      <PeakV2SpinReveal
        axes={[
          { label: "Franchise", value: "Portland Trail Blazers", pool: ["Portland Trail Blazers"], testId: "a" },
          { label: "Decade", value: "2010s", pool: ["2010s"], testId: "b" },
        ]}
        runKey="roll-long"
        stage="revealed"
        testId="ceremony"
      />,
    );
    expect(container.querySelectorAll(".v2-spin-axis")).toHaveLength(2);
    // The value window is a fixed clipping slot, so an over-long franchise
    // ellipsises inside it rather than widening the axis.
    expect(container.querySelector(".v2-spin-axis-value")).toBeTruthy();
  });
});
