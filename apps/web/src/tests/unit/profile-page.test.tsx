/**
 * Page-level tests for /profile — previously zero coverage at this level
 * (profile-api.test.ts only covers the API client). Added during the Arena
 * Archive visual-polish pass that restructured this page (identity ->
 * competitive status -> account settings) to guard the auth gate, identity
 * display, and settings-form behavior survived the restructure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import ProfilePage from "@/app/(main)/profile/page";
import type { Profile } from "@/lib/profile-api";

const mockPush = vi.fn();
// A stable object reference, not a fresh literal per call — the real
// next/navigation useRouter() is stable across renders, and this page's
// effect depends on `router`; an unstable mock re-fires it on every
// keystroke, re-fetching the profile and wiping in-progress form state.
const mockRouter = { push: mockPush };
vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

let authState: { user: { id: string; email?: string; name?: string } | null; loading: boolean; supabaseEnabled: boolean; signOut: () => Promise<void> };
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => authState,
}));

vi.mock("@/lib/auth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("fake-token"),
}));

const fetchProfile = vi.fn();
const updateProfile = vi.fn();
vi.mock("@/lib/profile-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/profile-api")>("@/lib/profile-api");
  return {
    ...actual,
    fetchProfile: (...args: unknown[]) => fetchProfile(...args),
    updateProfile: (...args: unknown[]) => updateProfile(...args),
  };
});

vi.mock("@/lib/ranked-api", () => ({
  rankedApi: { getRating: vi.fn().mockResolvedValue(null) },
}));

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "p1",
    handle: null,
    display_name: null,
    bio: null,
    region: null,
    avatar_key: null,
    is_public: false,
    history_public: false,
    joined_at: "2026-01-15T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockPush.mockReset();
  fetchProfile.mockReset();
  updateProfile.mockReset();
  authState = {
    user: { id: "u1", email: "player@example.com" },
    loading: false,
    supabaseEnabled: true,
    signOut: vi.fn().mockResolvedValue(undefined),
  };
});

describe("ProfilePage", () => {
  it("redirects to sign-in with a returnTo when signed out", () => {
    authState = { ...authState, user: null };
    render(<ProfilePage />);
    expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/^\/signin\?returnTo=.*profile/));
  });

  it("shows the anonymous-play message when Supabase isn't configured", () => {
    authState = { ...authState, user: null, supabaseEnabled: false };
    fetchProfile.mockResolvedValue(makeProfile());
    render(<ProfilePage />);
    expect(screen.getByText(/authentication is not configured/i)).toBeInTheDocument();
  });

  it("shows the signed-in email as identity when no display name is set", async () => {
    fetchProfile.mockResolvedValue(makeProfile());
    render(<ProfilePage />);
    await waitFor(() => {
      expect(screen.getAllByText("player@example.com").length).toBeGreaterThan(0);
    });
  });

  it("prefers the display name and shows the handle once both are set", async () => {
    fetchProfile.mockResolvedValue(makeProfile({ display_name: "Court Vision", handle: "court_227" }));
    render(<ProfilePage />);
    await waitFor(() => {
      expect(screen.getByText("Court Vision")).toBeInTheDocument();
      expect(screen.getByText(/@court_227/)).toBeInTheDocument();
    });
  });

  it("saves the profile and shows a confirmation", async () => {
    fetchProfile.mockResolvedValue(makeProfile({ joined_at: "2026-01-15T00:00:00Z" }));
    updateProfile.mockResolvedValue(makeProfile({ handle: "new_handle" }));
    const user = userEvent.setup();
    render(<ProfilePage />);

    // Wait for the profile fetch to actually land (not just for the form to
    // mount) before typing — the form renders immediately with empty fields
    // and the fetch's `setHandle(p.handle ?? "")` would otherwise overwrite
    // whatever was just typed if it resolves mid-keystroke.
    await screen.findByText(/joined/i);
    await user.type(screen.getByLabelText(/handle/i), "new_handle");
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/profile saved/i);
    });
    expect(updateProfile).toHaveBeenCalledWith("fake-token", expect.objectContaining({ handle: "new_handle" }));
  });

  it("shows an error state when the profile fails to load", async () => {
    fetchProfile.mockRejectedValue(new Error("network down"));
    render(<ProfilePage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/failed to load profile/i);
    });
  });

  it("still links to Progress and History and can sign out", async () => {
    fetchProfile.mockResolvedValue(makeProfile());
    render(<ProfilePage />);
    await screen.findByRole("link", { name: /progress/i });
    expect(screen.getByRole("link", { name: /progress/i })).toHaveAttribute("href", "/progress");
    expect(screen.getByRole("link", { name: /history/i })).toHaveAttribute("href", "/history");
    expect(screen.getByTestId("profile-signout")).toBeInTheDocument();
  });
});
