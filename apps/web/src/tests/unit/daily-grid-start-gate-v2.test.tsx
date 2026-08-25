/**
 * Daily Grid StartGate (Pass 3 UI cutover). V2 is the only shipped
 * presentation now — `StartGate.tsx` no longer branches on UI version at
 * all — so this proves the gate renders with the three actions and
 * `data-testid`s the app relies on, and reuses the exact same handlers
 * `DailyGridGame.tsx` already passes, without any change at the call site.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StartGate from "@/components/daily-grid/StartGate";

function renderGate(overrides: Partial<Parameters<typeof StartGate>[0]> = {}) {
  const onHowToPlay = vi.fn();
  const onStart = vi.fn();
  const onSkipTourAndStart = vi.fn();
  render(
    <StartGate
      date="2026-07-30"
      difficulty="medium"
      theme="Two-Way Night"
      onHowToPlay={onHowToPlay}
      onStart={onStart}
      onSkipTourAndStart={onSkipTourAndStart}
      {...overrides}
    />,
  );
  return { onHowToPlay, onStart, onSkipTourAndStart };
}

describe("Daily Grid StartGate", () => {
  it("renders the V2 shell with all three actions and the expected data-testids", () => {
    render(
      <StartGate
        date="2026-07-30"
        difficulty="medium"
        theme="Two-Way Night"
        onHowToPlay={() => {}}
        onStart={() => {}}
        onSkipTourAndStart={() => {}}
      />,
    );
    expect(screen.getByTestId("peak-v2-shell")).toBeInTheDocument();
    expect(screen.getByTestId("daily-grid-start-gate")).toBeInTheDocument();
    expect(screen.getByTestId("start-daily-grid")).toBeInTheDocument();
    expect(screen.getByTestId("daily-grid-gate-how-to-play")).toBeInTheDocument();
    expect(screen.getByTestId("daily-grid-gate-skip-tour")).toBeInTheDocument();
    expect(screen.getByText(/Today.s Daily Grid/)).toBeInTheDocument();
  });

  it("shows the date/theme/difficulty line and the finality constraint", () => {
    render(
      <StartGate
        date="2026-07-30"
        difficulty="medium"
        theme="Two-Way Night"
        onHowToPlay={() => {}}
        onStart={() => {}}
        onSkipTourAndStart={() => {}}
      />,
    );
    expect(screen.getByTestId("daily-grid-gate-board-line")).toHaveTextContent("2026-07-30");
    expect(screen.getByTestId("daily-grid-gate-board-line")).toHaveTextContent("Two-Way Night");
    expect(screen.getByTestId("daily-grid-gate-board-line")).toHaveTextContent("medium");
    expect(screen.getByTestId("daily-grid-gate-timer-note")).toHaveTextContent(/final/i);
  });

  it("reuses the exact same handlers — no duplicated Daily Grid logic", async () => {
    const user = userEvent.setup();
    const { onStart, onHowToPlay, onSkipTourAndStart } = renderGate();

    await user.click(screen.getByTestId("daily-grid-gate-how-to-play"));
    expect(onHowToPlay).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("start-daily-grid"));
    expect(onStart).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("daily-grid-gate-skip-tour"));
    expect(onSkipTourAndStart).toHaveBeenCalledTimes(1);
  });

  it("disables both start actions while `starting` is true", () => {
    renderGate({ starting: true });
    expect(screen.getByTestId("start-daily-grid")).toBeDisabled();
    expect(screen.getByTestId("daily-grid-gate-skip-tour")).toBeDisabled();
  });
});
