/**
 * Unit tests for Phase 3.1 progression components.
 *
 * Covers:
 * - XpProgress: progressbar ARIA, level display, cap state, compact mode
 * - StreakCard: streak display, reserve badge, zero state, full vs compact
 * - AchievementCard: earned/unearned states, category label, description toggle
 * - ResultProgressMoment: priority ordering, max-2 items, empty state
 * - PersonalRecords: empty state, grouping, formatting
 * - ProgressSummary: compact/full modes, achievement count
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import { XpProgress } from "@/components/progression/XpProgress";
import { StreakCard } from "@/components/progression/StreakCard";
import { AchievementCard } from "@/components/progression/AchievementCard";
import { ResultProgressMoment } from "@/components/progression/ResultProgressMoment";
import { PersonalRecords } from "@/components/progression/PersonalRecords";
import { ProgressSummary } from "@/components/progression/ProgressSummary";
import type {
  LevelSummary,
  StreakState,
  Achievement,
  PersonalRecord,
  ResultProgressMoment as MomentType,
  ProgressionSummary,
} from "@/lib/progression-api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeLevel = (overrides: Partial<LevelSummary> = {}): LevelSummary => ({
  total_xp: 250,
  current_level: 2,
  level_cap: 50,
  xp_into_level: 150,
  xp_for_next_level: 200,
  progress_fraction: 0.75,
  policy_version: "v1.0",
  ...overrides,
});

const makeStreak = (overrides: Partial<StreakState> = {}): StreakState => ({
  current_streak: 5,
  longest_streak: 7,
  last_qualifying_date: "2026-06-15",
  reserve_count: 0,
  reserve_cap: 1,
  policy_version: "v1.0",
  ...overrides,
});

const makeAchievement = (overrides: Partial<Achievement> = {}): Achievement => ({
  key: "first_game",
  category: "onboarding",
  title: "First Peak",
  description: "Completed your first valid game.",
  requirement_copy: "Complete any valid game.",
  earned: true,
  earned_at: "2026-06-15T12:00:00Z",
  ...overrides,
});

const makeRecord = (overrides: Partial<PersonalRecord> = {}): PersonalRecord => ({
  record_type: "lineup_score",
  mode: "apex_1y",
  record_value: 85.5,
  higher_is_better: true,
  source_result_id: "result-1",
  achieved_at: "2026-06-15T12:00:00Z",
  lineup_model_version: "experimental_lineup_v3",
  card_pool_version: "v3",
  ruleset_version: "ruleset_v3",
  ...overrides,
});

const makeMoment = (overrides: Partial<MomentType> = {}): MomentType => ({
  xp_awarded: 100,
  new_level: null,
  new_personal_records: [],
  new_achievements: [],
  streak_advanced: false,
  streak_reserve_earned: false,
  streak_reserve_consumed: false,
  current_streak: 1,
  ...overrides,
});

const makeSummary = (overrides: Partial<ProgressionSummary> = {}): ProgressionSummary => ({
  level: makeLevel(),
  current_streak: 5,
  longest_streak: 7,
  reserve_count: 0,
  reserve_cap: 1,
  achievement_count: 3,
  recent_achievements: ["first_game", "apex_explorer"],
  ...overrides,
});

// ---------------------------------------------------------------------------
// XpProgress
// ---------------------------------------------------------------------------

describe("XpProgress", () => {
  it("renders a progressbar with ARIA attributes", () => {
    render(<XpProgress level={makeLevel()} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeTruthy();
    expect(bar.getAttribute("aria-valuenow")).toBe("75");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("displays the current level number", () => {
    render(<XpProgress level={makeLevel({ current_level: 5 })} />);
    expect(screen.getByText(/Lv 5/i)).toBeTruthy();
  });

  it("shows XP progress text in full mode", () => {
    render(<XpProgress level={makeLevel({ xp_into_level: 150, xp_for_next_level: 200 })} />);
    expect(screen.getByText("150 / 200 XP")).toBeTruthy();
  });

  it("shows 'Max' when at level cap", () => {
    render(<XpProgress level={makeLevel({ current_level: 50, level_cap: 50 })} />);
    expect(screen.getByText("Max")).toBeTruthy();
  });

  it("aria-label includes level and percentage", () => {
    render(<XpProgress level={makeLevel({ current_level: 2, progress_fraction: 0.75 })} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-label")).toMatch(/Level 2/);
    expect(bar.getAttribute("aria-label")).toMatch(/75%/);
  });

  it("compact mode hides XP text", () => {
    const { container } = render(<XpProgress level={makeLevel()} compact />);
    expect(container.textContent).not.toMatch(/XP/);
  });
});

// ---------------------------------------------------------------------------
// StreakCard
// ---------------------------------------------------------------------------

describe("StreakCard", () => {
  it("shows current streak count", () => {
    render(<StreakCard streak={makeStreak({ current_streak: 5 })} />);
    expect(screen.getByLabelText(/Current streak: 5 days/i)).toBeTruthy();
  });

  it("shows longest streak", () => {
    render(<StreakCard streak={makeStreak({ longest_streak: 12 })} />);
    expect(screen.getByLabelText(/Longest streak: 12 days/i)).toBeTruthy();
  });

  it("shows reserve badge when reserve_count > 0", () => {
    render(<StreakCard streak={makeStreak({ reserve_count: 1 })} />);
    expect(screen.getByLabelText(/Reserve day available/i)).toBeTruthy();
  });

  it("hides reserve badge when reserve_count === 0", () => {
    render(<StreakCard streak={makeStreak({ reserve_count: 0 })} />);
    expect(screen.queryByLabelText(/Reserve day available/i)).toBeNull();
  });

  it("shows start prompt when streak is zero", () => {
    render(<StreakCard streak={makeStreak({ current_streak: 0 })} />);
    expect(screen.getByText(/Complete today/i)).toBeTruthy();
  });

  it("compact mode shows inline flame and count", () => {
    render(<StreakCard streak={makeStreak({ current_streak: 3 })} compact />);
    expect(screen.getByRole("img", { name: /streak flame/i })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("compact mode shows reserve badge when available", () => {
    render(<StreakCard streak={makeStreak({ reserve_count: 1 })} compact />);
    expect(screen.getByLabelText(/Reserve day available/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AchievementCard
// ---------------------------------------------------------------------------

describe("AchievementCard", () => {
  it("renders earned achievement with checkmark", () => {
    render(<AchievementCard achievement={makeAchievement({ earned: true })} />);
    expect(screen.getByText("✓")).toBeTruthy();
  });

  it("renders unearned achievement with circle", () => {
    render(<AchievementCard achievement={makeAchievement({ earned: false })} />);
    expect(screen.getByText("○")).toBeTruthy();
  });

  it("shows title", () => {
    render(<AchievementCard achievement={makeAchievement({ title: "First Peak" })} />);
    expect(screen.getByText("First Peak")).toBeTruthy();
  });

  it("shows category label", () => {
    render(<AchievementCard achievement={makeAchievement({ category: "onboarding" })} />);
    expect(screen.getByText("onboarding")).toBeTruthy();
  });

  it("ARIA label reflects earned state", () => {
    render(<AchievementCard achievement={makeAchievement({ title: "First Peak", earned: true })} />);
    expect(screen.getByRole("article", { name: /First Peak — earned/i })).toBeTruthy();
  });

  it("ARIA label reflects unearned state", () => {
    render(<AchievementCard achievement={makeAchievement({ title: "Challenger", earned: false })} />);
    expect(screen.getByRole("article", { name: /Challenger — not yet earned/i })).toBeTruthy();
  });

  it("shows description when showDescription=true and earned", () => {
    const ach = makeAchievement({ earned: true, description: "Completed your first valid game." });
    render(<AchievementCard achievement={ach} showDescription />);
    expect(screen.getByText("Completed your first valid game.")).toBeTruthy();
  });

  it("shows requirement_copy when showDescription=true and not earned", () => {
    const ach = makeAchievement({
      earned: false,
      description: "Should not show",
      requirement_copy: "Complete any valid game.",
    });
    render(<AchievementCard achievement={ach} showDescription />);
    expect(screen.getByText("Complete any valid game.")).toBeTruthy();
    expect(screen.queryByText("Should not show")).toBeNull();
  });

  it("hides description when showDescription=false", () => {
    const ach = makeAchievement({ earned: true, description: "Completed your first valid game." });
    render(<AchievementCard achievement={ach} />);
    expect(screen.queryByText("Completed your first valid game.")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ResultProgressMoment
// ---------------------------------------------------------------------------

describe("ResultProgressMoment", () => {
  it("returns null when nothing to show", () => {
    const { container } = render(
      <ResultProgressMoment moment={makeMoment({ xp_awarded: 0 })} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows XP when awarded", () => {
    render(<ResultProgressMoment moment={makeMoment({ xp_awarded: 100 })} />);
    expect(screen.getByText("+100")).toBeTruthy();
  });

  it("shows new level when level-up occurs", () => {
    render(<ResultProgressMoment moment={makeMoment({ new_level: 3 })} />);
    expect(screen.getByText("Level 3")).toBeTruthy();
  });

  it("shows personal record", () => {
    render(
      <ResultProgressMoment
        moment={makeMoment({
          xp_awarded: 0,
          new_personal_records: [{ record_type: "lineup_score", mode: "apex_1y", value: 90.0, previous_value: null }],
        })}
      />
    );
    expect(screen.getByText(/90\.0/)).toBeTruthy();
  });

  it("shows streak advancement", () => {
    render(
      <ResultProgressMoment
        moment={makeMoment({ xp_awarded: 0, streak_advanced: true, current_streak: 4 })}
      />
    );
    expect(screen.getByText(/4 days?/i)).toBeTruthy();
  });

  it("prioritizes achievement over XP", () => {
    render(
      <ResultProgressMoment
        moment={makeMoment({ xp_awarded: 100, new_achievements: ["first_game"] })}
        achievementTitles={{ first_game: "First Peak" }}
      />
    );
    expect(screen.getByText("First Peak")).toBeTruthy();
    // Both fit in the 2-item limit: achievement + XP
    expect(screen.getByText("+100")).toBeTruthy();
  });

  it("shows at most 2 items", () => {
    render(
      <ResultProgressMoment
        moment={makeMoment({
          xp_awarded: 100,
          new_level: 3,
          new_achievements: ["a1", "a2"],
          streak_advanced: true,
          current_streak: 5,
        })}
        achievementTitles={{ a1: "Title A", a2: "Title B" }}
      />
    );
    const container = screen.getByRole("region");
    const children = container.querySelectorAll(".flex.items-center.justify-between");
    expect(children.length).toBeLessThanOrEqual(2);
  });

  it("has aria role=region with label", () => {
    render(<ResultProgressMoment moment={makeMoment({ xp_awarded: 50 })} />);
    expect(screen.getByRole("region", { name: /Your progression this game/i })).toBeTruthy();
  });

  it("shows draft efficiency as percentage", () => {
    render(
      <ResultProgressMoment
        moment={makeMoment({
          xp_awarded: 0,
          new_personal_records: [{ record_type: "draft_efficiency", mode: "apex_1y", value: 0.875, previous_value: null }],
        })}
      />
    );
    expect(screen.getByText("87.5%")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PersonalRecords
// ---------------------------------------------------------------------------

describe("PersonalRecords", () => {
  it("shows empty state when no records", () => {
    render(<PersonalRecords records={[]} />);
    expect(screen.getByText(/No personal records yet/i)).toBeTruthy();
  });

  it("displays a record value", () => {
    render(<PersonalRecords records={[makeRecord({ record_value: 85.5 })]} />);
    expect(screen.getByText("85.5")).toBeTruthy();
  });

  it("formats draft_efficiency as percentage", () => {
    render(
      <PersonalRecords
        records={[makeRecord({ record_type: "draft_efficiency", record_value: 0.875 })]}
      />
    );
    expect(screen.getByText("87.5%")).toBeTruthy();
  });

  it("formats daily_percentile as Top X%", () => {
    render(
      <PersonalRecords
        records={[makeRecord({ record_type: "daily_percentile", record_value: 5.2 })]}
      />
    );
    expect(screen.getByText("Top 5.2%")).toBeTruthy();
  });

  it("groups records by record_type", () => {
    const records = [
      makeRecord({ record_type: "lineup_score", mode: "apex_1y" }),
      makeRecord({ record_type: "draft_efficiency", mode: "apex_1y" }),
    ];
    render(<PersonalRecords records={records} />);
    expect(screen.getByText("Lineup Score")).toBeTruthy();
    expect(screen.getByText("Draft Efficiency")).toBeTruthy();
  });

  it("articles have aria-labels including record type and mode", () => {
    render(<PersonalRecords records={[makeRecord()]} />);
    const articles = screen.getAllByRole("article");
    expect(articles[0].getAttribute("aria-label")).toMatch(/Lineup Score/);
    expect(articles[0].getAttribute("aria-label")).toMatch(/1Y Apex/);
  });
});

// ---------------------------------------------------------------------------
// ProgressSummary
// ---------------------------------------------------------------------------

describe("ProgressSummary", () => {
  const streak = makeStreak();

  it("compact mode shows XpProgress and StreakCard", () => {
    render(<ProgressSummary summary={makeSummary()} streakState={streak} compact />);
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByRole("img", { name: /streak flame/i })).toBeTruthy();
  });

  it("compact mode shows achievement count when > 0", () => {
    render(<ProgressSummary summary={makeSummary({ achievement_count: 3 })} streakState={streak} compact />);
    expect(screen.getByText(/3 achievements/i)).toBeTruthy();
  });

  it("full mode renders level progress and streak card", () => {
    render(<ProgressSummary summary={makeSummary()} streakState={streak} />);
    // Full XpProgress (not compact): shows XP text
    expect(screen.getByText(/XP/i)).toBeTruthy();
    // StreakCard (full): shows "Daily Streak" heading
    expect(screen.getByText("Daily Streak")).toBeTruthy();
  });

  it("full mode shows view profile link", () => {
    render(<ProgressSummary summary={makeSummary()} streakState={streak} />);
    expect(screen.getByText(/View profile/i)).toBeTruthy();
  });

  it("compact mode uses singular 'achievement' for count of 1", () => {
    render(
      <ProgressSummary
        summary={makeSummary({ achievement_count: 1 })}
        streakState={streak}
        compact
      />
    );
    expect(screen.getByText("1 achievement")).toBeTruthy();
  });

  it("compact mode hides achievement count when 0", () => {
    const { container } = render(
      <ProgressSummary
        summary={makeSummary({ achievement_count: 0 })}
        streakState={streak}
        compact
      />
    );
    expect(container.textContent).not.toMatch(/achievement/i);
  });
});
