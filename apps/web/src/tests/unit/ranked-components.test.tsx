/**
 * Component-level tests for the ranked frontend (spec section W subset):
 * queue idle/waiting/cancel states, and honest disabled/error messaging.
 * RankedScreen's own network calls (rankedApi) and auth (useAuth/getAccessToken)
 * are mocked so these tests exercise only the UI phase transitions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import RankedScreen from "@/components/ranked/RankedScreen";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", email: "test@example.com" } }),
}));

vi.mock("@/lib/auth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("fake-token"),
}));

const joinQueue = vi.fn();
const cancelQueue = vi.fn();
const getQueueStatus = vi.fn();

vi.mock("@/lib/ranked-api", () => ({
  rankedApi: {
    joinQueue: (...args: unknown[]) => joinQueue(...args),
    cancelQueue: (...args: unknown[]) => cancelQueue(...args),
    getQueueStatus: (...args: unknown[]) => getQueueStatus(...args),
    startOrGetGame: vi.fn(),
    getSettlement: vi.fn(),
    submitAction: vi.fn(),
  },
  RankedAPIError: class RankedAPIError extends Error {},
}));

vi.mock("@/lib/analytics", () => ({
  analytics: { track: vi.fn() },
}));

beforeEach(() => {
  joinQueue.mockReset();
  cancelQueue.mockReset();
  getQueueStatus.mockReset();
  mockPush.mockReset();
});

describe("RankedScreen", () => {
  it("shows a join-queue call to action when idle", () => {
    render(<RankedScreen mode="apex_1y" />);
    expect(screen.getByText(/Join 1Y Apex queue/i)).toBeInTheDocument();
  });

  it("explains same-board fairness in the idle state", () => {
    render(<RankedScreen mode="apex_1y" />);
    expect(screen.getByText(/exact same hidden board/i)).toBeInTheDocument();
  });

  it("moves to a waiting state after joining with no opponent yet", async () => {
    joinQueue.mockResolvedValue({ status: "waiting", mode: "apex_1y", queue_entry_id: "e1", match_id: null });
    const user = userEvent.setup();
    render(<RankedScreen mode="apex_1y" />);

    await user.click(screen.getByText(/Join 1Y Apex queue/i));

    await waitFor(() => {
      expect(screen.getByText(/Waiting for an opponent/i)).toBeInTheDocument();
    });
    // Waiting state must offer a way to cancel (keyboard/click accessible button).
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("the waiting live region does not spam — a single polite status container", async () => {
    joinQueue.mockResolvedValue({ status: "waiting", mode: "apex_1y", queue_entry_id: "e1", match_id: null });
    const user = userEvent.setup();
    const { container } = render(<RankedScreen mode="apex_1y" />);
    await user.click(screen.getByText(/Join 1Y Apex queue/i));

    await waitFor(() => {
      expect(screen.getByText(/Waiting for an opponent/i)).toBeInTheDocument();
    });
    const liveRegions = container.querySelectorAll('[aria-live="polite"]');
    expect(liveRegions.length).toBe(1);
  });

  it("cancelling returns to the idle join state", async () => {
    joinQueue.mockResolvedValue({ status: "waiting", mode: "apex_1y", queue_entry_id: "e1", match_id: null });
    cancelQueue.mockResolvedValue({ cancelled: true });
    const user = userEvent.setup();
    render(<RankedScreen mode="apex_1y" />);

    await user.click(screen.getByText(/Join 1Y Apex queue/i));
    await waitFor(() => expect(screen.getByText(/Waiting for an opponent/i)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.getByText(/Join 1Y Apex queue/i)).toBeInTheDocument();
    });
  });

  it("shows an error state with a way back to the queue when join fails", async () => {
    joinQueue.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    render(<RankedScreen mode="apex_1y" />);

    await user.click(screen.getByText(/Join 1Y Apex queue/i));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /back to queue/i })).toBeInTheDocument();
    });
  });

  it("keyboard-only users can activate join and cancel (native buttons, no click-only handlers)", async () => {
    joinQueue.mockResolvedValue({ status: "waiting", mode: "apex_1y", queue_entry_id: "e1", match_id: null });
    cancelQueue.mockResolvedValue({ cancelled: true });
    const user = userEvent.setup();
    render(<RankedScreen mode="apex_1y" />);

    await user.tab();
    expect(screen.getByText(/Join 1Y Apex queue/i)).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByText(/Waiting for an opponent/i)).toBeInTheDocument());
    await user.tab();
    expect(screen.getByRole("button", { name: /cancel/i })).toHaveFocus();
  });
});
