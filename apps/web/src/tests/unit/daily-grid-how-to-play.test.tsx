/**
 * `HowToPlay.tsx` had no dedicated component test before Batch 9 — only its
 * sibling `StartGate.tsx`'s own `onHowToPlay` callback wiring was covered
 * (daily-grid-start-gate-v2.test.tsx). This pins the panel's own contract:
 * what it renders, and that "Take the walkthrough" only appears when a tour
 * is actually available.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import HowToPlay from "@/components/daily-grid/HowToPlay";

describe("HowToPlay", () => {
  it("renders nothing when closed", () => {
    render(
      <HowToPlay open={false} date="2026-08-01" difficulty="medium" onClose={vi.fn()} />,
    );
    expect(screen.queryByTestId("how-to-play-panel")).not.toBeInTheDocument();
  });

  it("renders the objective, all four steps, and the board line when open", async () => {
    render(
      <HowToPlay
        open
        date="2026-08-01"
        difficulty="hard"
        theme="Ring Chasers"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("how-to-play-panel")).toBeVisible());
    expect(screen.getByTestId("how-to-play-objective")).toHaveTextContent(
      /maximize your PEAK3 total with nine different players/i,
    );
    expect(screen.getAllByTestId("how-to-play-step")).toHaveLength(4);
    expect(screen.getByTestId("how-to-play-board-line")).toHaveTextContent("2026-08-01");
    expect(screen.getByTestId("how-to-play-board-line")).toHaveTextContent("Ring Chasers");
    expect(screen.getByTestId("how-to-play-board-line")).toHaveTextContent(/hard difficulty/i);
  });

  it("omits the walkthrough button when no tour is available", () => {
    render(<HowToPlay open date="2026-08-01" difficulty="medium" onClose={vi.fn()} />);
    expect(screen.queryByTestId("how-to-play-take-tour")).not.toBeInTheDocument();
  });

  it("calls onTakeTour, not onClose, when the walkthrough is requested", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onTakeTour = vi.fn();
    render(
      <HowToPlay
        open
        date="2026-08-01"
        difficulty="medium"
        onClose={onClose}
        onTakeTour={onTakeTour}
      />,
    );

    await user.click(screen.getByTestId("how-to-play-take-tour"));
    expect(onTakeTour).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismisses through both the close control and the primary dismiss action", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HowToPlay open date="2026-08-01" difficulty="medium" onClose={onClose} />);

    await user.click(screen.getByTestId("how-to-play-close"));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("how-to-play-dismiss"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
