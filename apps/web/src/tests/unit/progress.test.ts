import { describe, it, expect, beforeEach } from "vitest";
import { LocalProgressRepository, buildShareText } from "@/lib/progress";
import type { DuelResult } from "@/types";

const makeResult = (correct: boolean, points: number = 200): DuelResult => ({
  duel_id: "duel-1",
  selected_peak_id: "left-id",
  correct,
  arena_points_awarded: correct ? points : 0,
  difficulty: "Tricky",
  score_gap: 5.0,
  answer_response: {} as import("@/types").AnswerResponse,
});

describe("LocalProgressRepository", () => {
  let repo: LocalProgressRepository;

  beforeEach(() => {
    localStorage.clear();
    repo = new LocalProgressRepository();
  });

  it("loads default progress when storage is empty", () => {
    const data = repo.getAll();
    expect(data.schema_version).toBe(1);
    expect(data.daily_completions).toEqual({});
    expect(data.endless_high_score).toBe(0);
    expect(data.lifetime_attempts).toBe(0);
  });

  it("getDailyCompletion returns null before recording", () => {
    expect(repo.getDailyCompletion("2026-06-28", 3)).toBeNull();
  });

  it("recordDailyCompletion persists completion", () => {
    const results = [makeResult(true), makeResult(false), makeResult(true)];
    repo.recordDailyCompletion("2026-06-28", 3, results);

    const completion = repo.getDailyCompletion("2026-06-28", 3);
    expect(completion).not.toBeNull();
    expect(completion?.correct).toBe(2);
    expect(completion?.total).toBe(3);
    expect(completion?.arena_points).toBe(400);
    expect(completion?.years).toBe(3);
  });

  it("recordDailyCompletion with different years creates separate entries", () => {
    const results = [makeResult(true)];
    repo.recordDailyCompletion("2026-06-28", 3, results);
    repo.recordDailyCompletion("2026-06-28", 1, results);

    expect(repo.getDailyCompletion("2026-06-28", 3)).not.toBeNull();
    expect(repo.getDailyCompletion("2026-06-28", 1)).not.toBeNull();
    expect(repo.getDailyCompletion("2026-06-29", 3)).toBeNull();
  });

  it("updateEndlessScore tracks high score", () => {
    repo.updateEndlessScore(1000, 5);
    expect(repo.getAll().endless_high_score).toBe(1000);

    repo.updateEndlessScore(500, 10);
    expect(repo.getAll().endless_high_score).toBe(1000); // didn't decrease

    repo.updateEndlessScore(2000, 3);
    expect(repo.getAll().endless_high_score).toBe(2000);
  });

  it("updateEndlessScore tracks best streak", () => {
    repo.updateEndlessScore(0, 5);
    repo.updateEndlessScore(0, 3);
    expect(repo.getAll().endless_best_streak).toBe(5);
  });

  it("recordAnswer increments lifetime counters", () => {
    repo.recordAnswer(true);
    repo.recordAnswer(true);
    repo.recordAnswer(false);
    const data = repo.getAll();
    expect(data.lifetime_attempts).toBe(3);
    expect(data.lifetime_correct).toBe(2);
  });

  it("reset clears all data", () => {
    repo.recordDailyCompletion("2026-06-28", 3, [makeResult(true)]);
    repo.reset();
    const data = repo.getAll();
    expect(data.daily_completions).toEqual({});
    expect(data.lifetime_attempts).toBe(0);
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorage.setItem("peak3_arena_progress", "not valid json{{");
    const freshRepo = new LocalProgressRepository();
    expect(freshRepo.getAll().schema_version).toBe(1);
    expect(freshRepo.getAll().lifetime_attempts).toBe(0);
  });

  it("handles wrong schema version by resetting", () => {
    localStorage.setItem(
      "peak3_arena_progress",
      JSON.stringify({ schema_version: 999, lifetime_attempts: 999 })
    );
    const freshRepo = new LocalProgressRepository();
    expect(freshRepo.getAll().lifetime_attempts).toBe(0);
  });

  it("best_streak calculation is correct", () => {
    const results = [
      makeResult(true),
      makeResult(true),
      makeResult(false),
      makeResult(true),
      makeResult(true),
      makeResult(true),
    ];
    repo.recordDailyCompletion("2026-06-28", 3, results);
    const completion = repo.getDailyCompletion("2026-06-28", 3);
    expect(completion?.best_streak).toBe(3);
  });
});

describe("buildShareText", () => {
  it("produces well-formed share text", () => {
    const results: DuelResult[] = [
      makeResult(true, 200),
      makeResult(true, 250),
      makeResult(false),
      makeResult(true, 180),
    ];
    const text = buildShareText("2026-06-28", results);
    expect(text).toContain("PEAK3 Arena");
    expect(text).toContain("3/4 correct");
    expect(text).toContain("🟩");
    expect(text).toContain("🟥");
    expect(text).not.toContain("undefined");
  });

  it("includes streak in share text", () => {
    const results: DuelResult[] = [
      makeResult(true),
      makeResult(true),
      makeResult(true),
    ];
    const text = buildShareText("2026-06-28", results);
    expect(text).toContain("Best streak: 3");
  });
});
