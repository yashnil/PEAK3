import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import GameIntro from "@/components/shared/GameIntro";

const RULES = [
  { label: "Snake draft", detail: "pick order reverses each round" },
  { label: "Shared rolls", detail: "one franchise and decade for everyone" },
];

function renderIntro(overrides: Partial<Parameters<typeof GameIntro>[0]> = {}) {
  const onStart = vi.fn();
  const onSkip = vi.fn();
  render(
    <GameIntro
      open
      onStart={onStart}
      onSkip={onSkip}
      eyebrow="Multiplayer"
      title="Three-Man Weave"
      objective="Draft the best three-player lineup from a shared franchise and decade."
      rules={RULES}
      {...overrides}
    />,
  );
  return { onStart, onSkip };
}

describe("GameIntro", () => {
  it("renders the mode name, objective and rules, and takes no game action on mount", () => {
    const { onStart, onSkip } = renderIntro();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Three-Man Weave — how to play");
    expect(screen.getByText("Three-Man Weave")).toBeInTheDocument();
    expect(
      screen.getByText("Draft the best three-player lineup from a shared franchise and decade."),
    ).toBeInTheDocument();
    expect(screen.getByText("Snake draft", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Shared rolls", { exact: false })).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("focuses the Start action so a keyboard player can press Enter immediately", async () => {
    renderIntro();
    await waitFor(() => expect(screen.getByTestId("game-intro-start")).toHaveFocus());
  });

  it("fires onStart when Start is pressed, and only then", async () => {
    const user = userEvent.setup();
    const { onStart, onSkip } = renderIntro();
    await user.click(screen.getByTestId("game-intro-start"));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("fires onSkip when Skip is pressed", async () => {
    const user = userEvent.setup();
    const { onStart, onSkip } = renderIntro();
    await user.click(screen.getByTestId("game-intro-skip"));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("treats Escape as Skip", async () => {
    const user = userEvent.setup();
    const { onSkip } = renderIntro();
    await user.keyboard("{Escape}");
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("treats a backdrop click as Skip", async () => {
    const user = userEvent.setup();
    const { onSkip } = renderIntro();
    const backdrop = document.querySelector("[data-pk-dialog-backdrop]");
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed, so a mounted-but-hidden intro can never leak game content", () => {
    renderIntro({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables Start while a start request is in flight", () => {
    renderIntro({ starting: true });
    expect(screen.getByTestId("game-intro-start")).toBeDisabled();
  });

  it("renders an optional mechanic visual inside a labelled window", () => {
    renderIntro({ visual: <div data-testid="mini-reel">reel preview</div> });
    expect(screen.getByTestId("game-intro-visual")).toContainElement(
      screen.getByTestId("mini-reel"),
    );
  });
});
