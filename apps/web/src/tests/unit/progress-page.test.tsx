/**
 * Page-level tests for /progress. `progression-components.test.tsx` already
 * covers the individual XpProgress/StreakCard/AchievementCard/PersonalRecords
 * components in isolation; these guard the PAGE's composition (auth gate,
 * tabs, error state, and the skill-vs-participation distinction) which had
 * no dedicated test before the Arena Archive visual-polish pass restyled it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import ProgressPage from "@/app/(main)/progress/page";
import type { ProgressionSummary, StreakState, PersonalRecord, Achievement } from "@/lib/progression-api";

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

let authState: { user: { id: string } | null; loading: boolean };
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => authState,
}));

vi.mock("@/lib/auth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("fake-token"),
}));

const getSummary = vi.fn();
const getStreak = vi.fn();
const getRecords = vi.fn();
const getAchievements = vi.fn();
vi.mock("@/lib/progression-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/progression-api")>("@/lib/progression-api");
  return {
    ...actual,
    progressionApi: {
      getSummary: (...a: unknown[]) => getSummary(...a),
      getStreak: (...a: unknown[]) => getStreak(...a),
      getRecords: (...a: unknown[]) => getRecords(...a),
      getAchievements: (...a: unknown[]) => getAchievements(...a),
    },
  };
});

function makeSummary(overrides: Partial<ProgressionSummary> = {}): ProgressionSummary {
  return {
    level: {
      total_xp: 0,
      current_level: 1,
      level_cap: 50,
      xp_into_level: 0,
      xp_for_next_level: 100,
      progress_fraction: 0,
      policy_version: "v1",
    },
    current_streak: 0,
    longest_streak: 0,
    reserve_count: 0,
    reserve_cap: 1,
    achievement_count: 0,
    recent_achievements: [],
    ...overrides,
  };
}

function makeStreak(overrides: Partial<StreakState> = {}): StreakState {
  return {
    current_streak: 0,
    longest_streak: 0,
    last_qualifying_date: null,
    reserve_count: 0,
    reserve_cap: 1,
    policy_version: "v1",
    ...overrides,
  };
}

beforeEach(() => {
  mockPush.mockReset();
  [getSummary, getStreak, getRecords, getAchievements].forEach((m) => m.mockReset());
  authState = { user: { id: "u1" }, loading: false };
  getSummary.mockResolvedValue(makeSummary());
  getStreak.mockResolvedValue(makeStreak());
  getRecords.mockResolvedValue([]);
  getAchievements.mockResolvedValue([]);
});

describe("ProgressPage", () => {
  it("redirects to sign-in when signed out", () => {
    authState = { user: null, loading: false };
    render(<ProgressPage />);
    expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/^\/signin\?returnTo=.*progress/));
  });

  it("preserves the skill-vs-participation distinction copy verbatim", async () => {
    render(<ProgressPage />);
    await waitFor(() => {
      expect(
        screen.getByText(/XP measures your exploration, not your skill\. Level is a participation indicator\./i),
      ).toBeInTheDocument();
    });
  });

  it("shows an error state when progression data fails to load", async () => {
    getSummary.mockRejectedValue(new Error("network down"));
    render(<ProgressPage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/failed to load progression data/i);
    });
  });

  it("switches tabs and shows achievement/record counts in the overview", async () => {
    const achievements: Achievement[] = [
      { key: "a1", category: "onboarding", title: "First Steps", description: "d", requirement_copy: "r", earned: true, earned_at: "2026-08-01T00:00:00Z" },
      { key: "a2", category: "habit", title: "Streaker", description: "d2", requirement_copy: "r2", earned: false, earned_at: null },
    ];
    const records: PersonalRecord[] = [
      { record_type: "draft_efficiency", mode: "apex_1y", record_value: 0.9, higher_is_better: true, source_result_id: "r1", achieved_at: "2026-08-01T00:00:00Z", lineup_model_version: "v1", card_pool_version: "v1", ruleset_version: "v1" },
    ];
    getAchievements.mockResolvedValue(achievements);
    getRecords.mockResolvedValue(records);
    getSummary.mockResolvedValue(makeSummary({ recent_achievements: ["a1"] }));
    getStreak.mockResolvedValue(makeStreak({ current_streak: 3, longest_streak: 5 }));

    const user = userEvent.setup();
    render(<ProgressPage />);

    await screen.findByTestId("level-summary");
    // Achievements StatCard and Records StatCard both read "1" here.
    expect(screen.getAllByText("1")).toHaveLength(2);
    expect(screen.getByText("First Steps")).toBeInTheDocument(); // recent achievement

    await user.click(screen.getByRole("tab", { name: /achievements/i }));
    expect(screen.getByText(/^Earned \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/^Not yet earned \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("Streaker")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /records/i }));
    expect(screen.getByText(/Records are version-scoped/i)).toBeInTheDocument();
  });
});
