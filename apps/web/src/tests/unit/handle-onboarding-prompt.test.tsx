/**
 * HandleOnboardingPrompt (launch-polish IMPLEMENTATION_CONTRACT.md §8).
 *
 * Covers the contract's explicit requirements: shown only for a signed-in,
 * non-anonymous account with no handle yet; prefilled with a suggestion
 * (never blank, never derived from the account's real identity); "Skip for
 * now" never blocks anything and persists for the rest of the session (not
 * forever -- sessionStorage, not localStorage); saving calls the real
 * update endpoint and never auto-saves without the player submitting.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockUseAuth = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

// The prompt reads the route so it can stay out of the way of a live game
// board. Mutable rather than a fixed mock so one test can move "pages".
let mockPathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

const mockGetAccessToken = vi.fn();
vi.mock("@/lib/auth", () => ({
  getAccessToken: () => mockGetAccessToken(),
}));

const mockFetchProfile = vi.fn();
const mockUpdateProfile = vi.fn();
vi.mock("@/lib/profile-api", () => ({
  fetchProfile: (...args: unknown[]) => mockFetchProfile(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
  ProfileAPIError: class ProfileAPIError extends Error {
    status: number;
    code: string | null;
    constructor(status: number, message: string, code: string | null = null) {
      super(message);
      this.name = "ProfileAPIError";
      this.status = status;
      this.code = code;
    }
  },
  handleLooksValid: (h: string) => /^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$/.test(h.trim().toLowerCase()),
}));

import HandleOnboardingPrompt from "@/components/profile/HandleOnboardingPrompt";

const SIGNED_IN_USER = { id: "u1", email: "player@example.com", isAnonymous: false };

// NOT vi.restoreAllMocks(): getAccessToken/useAuth are wired via a small
// indirection function (`() => mockXxx()`) defined ONCE when the module is
// first mocked, precisely so restoring/resetting the underlying vi.fn()
// between tests can never tear down that wiring itself -- only each test's
// OWN mockReturnValue/mockResolvedValue call. `restoreAllMocks` would strip
// the inline vi.fn() mocks' implementations after the first test and never
// reinstate them, since nothing re-runs the vi.mock factory per test.
beforeEach(() => {
  sessionStorage.clear();
  mockUseAuth.mockReset();
  mockGetAccessToken.mockReset().mockResolvedValue("fake-token");
  mockFetchProfile.mockReset();
  mockUpdateProfile.mockReset();
  mockPathname = "/";
});

describe("HandleOnboardingPrompt", () => {
  it("stays hidden while signed out", async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    render(<HandleOnboardingPrompt />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("handle-onboarding-prompt")).not.toBeInTheDocument();
  });

  it("stays hidden for an anonymous session -- handles are a real-account concept", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "anon:1", isAnonymous: true }, loading: false });
    render(<HandleOnboardingPrompt />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("handle-onboarding-prompt")).not.toBeInTheDocument();
    expect(mockFetchProfile).not.toHaveBeenCalled();
  });

  it("stays hidden once the account already has a handle", async () => {
    mockUseAuth.mockReturnValue({ user: SIGNED_IN_USER, loading: false });
    mockFetchProfile.mockResolvedValue({ handle: "already_set", id: "p1" });
    render(<HandleOnboardingPrompt />);
    await waitFor(() => expect(mockFetchProfile).toHaveBeenCalled());
    expect(screen.queryByTestId("handle-onboarding-prompt")).not.toBeInTheDocument();
  });

  it("shows with a non-empty prefilled suggestion for a signed-in, handle-less account", async () => {
    mockUseAuth.mockReturnValue({ user: SIGNED_IN_USER, loading: false });
    mockFetchProfile.mockResolvedValue({ handle: null, id: "p1" });
    render(<HandleOnboardingPrompt />);

    await waitFor(() => expect(screen.getByTestId("handle-onboarding-prompt")).toBeInTheDocument());
    const input = screen.getByTestId("handle-onboarding-input") as HTMLInputElement;
    // Prefilled, never blank -- and never anything that could be the
    // account's real email/name (the mocked user's email never appears).
    expect(input.value.length).toBeGreaterThan(0);
    expect(input.value).not.toMatch(/player@example\.com/);
  });

  it("Skip for now hides the prompt without saving anything", async () => {
    mockUseAuth.mockReturnValue({ user: SIGNED_IN_USER, loading: false });
    mockFetchProfile.mockResolvedValue({ handle: null, id: "p1" });
    render(<HandleOnboardingPrompt />);

    await waitFor(() => expect(screen.getByTestId("handle-onboarding-prompt")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("handle-onboarding-skip"));

    expect(screen.queryByTestId("handle-onboarding-prompt")).not.toBeInTheDocument();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("peak3_handle_prompt_dismissed")).toBe("1");
  });

  it("stays dismissed for the rest of the session after Skip -- a fresh mount does not re-show it", async () => {
    sessionStorage.setItem("peak3_handle_prompt_dismissed", "1");
    mockUseAuth.mockReturnValue({ user: SIGNED_IN_USER, loading: false });
    mockFetchProfile.mockResolvedValue({ handle: null, id: "p1" });
    render(<HandleOnboardingPrompt />);

    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("handle-onboarding-prompt")).not.toBeInTheDocument();
    // Dismissal short-circuits before ever fetching the profile again.
    expect(mockFetchProfile).not.toHaveBeenCalled();
  });

  it("Set handle saves via updateProfile and shows confirmation, without blocking on failure elsewhere", async () => {
    mockUseAuth.mockReturnValue({ user: SIGNED_IN_USER, loading: false });
    mockFetchProfile.mockResolvedValue({ handle: null, id: "p1" });
    mockUpdateProfile.mockResolvedValue({ handle: "court_482", id: "p1" });
    render(<HandleOnboardingPrompt />);

    await waitFor(() => expect(screen.getByTestId("handle-onboarding-prompt")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("handle-onboarding-save"));

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile.mock.calls[0][1]).toHaveProperty("handle");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/handle set/i));
  });
});


// ---------------------------------------------------------------------------
// A live match owns the screen
// ---------------------------------------------------------------------------

describe("during a live Arena match", () => {
  /**
   * THE DEFECT THIS LOCKS OUT, found by the rescue's review capture rather than
   * by any test. The prompt sat on top of the player's OWN roster during a
   * three-seat draft, with a decision clock running -- the one panel a drafter
   * has to read to make their pick, covered by a prompt about a leaderboard
   * they are not submitting to. Both Arena modes also run their own
   * `aria-modal` overlays, so two competing dialogs could be open at once.
   *
   * Suppressed rather than delayed: a match is minutes long, the prompt is
   * session-scoped, and it asks again on the next sign-in anyway.
   */
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: "u-1", isAnonymous: false },
      loading: false,
    });
    mockGetAccessToken.mockResolvedValue("token");
    mockFetchProfile.mockResolvedValue({ handle: null });
  });

  for (const route of [
    "/arena/three-man-weave/2f9b1a4c-0000-4000-8000-000000000001",
    "/arena/twenty-dollar/2f9b1a4c-0000-4000-8000-000000000002",
  ]) {
    it(`stays hidden on ${route}`, async () => {
      mockPathname = route;
      render(<HandleOnboardingPrompt />);
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByTestId("handle-onboarding-prompt")).not.toBeInTheDocument();
    });
  }

  it("still appears on the lobby, which is not a live board", async () => {
    mockPathname = "/arena/lobby";
    render(<HandleOnboardingPrompt />);
    expect(
      await screen.findByTestId("handle-onboarding-prompt"),
    ).toBeInTheDocument();
  });

  it("still appears on the mode landing page, which has no match on it", async () => {
    mockPathname = "/arena/three-man-weave";
    render(<HandleOnboardingPrompt />);
    expect(
      await screen.findByTestId("handle-onboarding-prompt"),
    ).toBeInTheDocument();
  });
});
