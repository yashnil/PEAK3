import type { LocalProgress, DailyCompletion, DuelResult } from "@/types";

const STORAGE_KEY = "peak3_arena_progress";
const SCHEMA_VERSION = 1;

const DEFAULT_PROGRESS: LocalProgress = {
  schema_version: SCHEMA_VERSION,
  daily_completions: {},
  endless_high_score: 0,
  endless_best_streak: 0,
  lifetime_attempts: 0,
  lifetime_correct: 0,
  preferred_duration: 3,
  settings: {
    reduced_motion: false,
  },
};

export class LocalProgressRepository {
  private data: LocalProgress;

  constructor() {
    this.data = this.load();
  }

  load(): LocalProgress {
    if (typeof window === "undefined") return { ...DEFAULT_PROGRESS };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_PROGRESS };
      const parsed = JSON.parse(raw);
      // Version migration
      if (parsed.schema_version !== SCHEMA_VERSION) {
        return { ...DEFAULT_PROGRESS };
      }
      // Merge with defaults for any missing keys
      return {
        ...DEFAULT_PROGRESS,
        ...parsed,
        daily_completions: parsed.daily_completions ?? {},
        settings: { ...DEFAULT_PROGRESS.settings, ...(parsed.settings ?? {}) },
      };
    } catch {
      return { ...DEFAULT_PROGRESS };
    }
  }

  private save(): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // localStorage can be full or blocked
    }
  }

  getAll(): LocalProgress {
    return { ...this.data };
  }

  getDailyCompletion(date: string, years: number): DailyCompletion | null {
    const key = `${date}-${years}yr`;
    return this.data.daily_completions[key] ?? null;
  }

  recordDailyCompletion(
    date: string,
    years: number,
    results: DuelResult[]
  ): void {
    const key = `${date}-${years}yr`;
    const correct = results.filter((r) => r.correct).length;
    const total = results.length;
    const arena_points = results.reduce(
      (sum, r) => sum + r.arena_points_awarded,
      0
    );
    let streak = 0;
    let bestStreak = 0;
    for (const r of results) {
      if (r.correct) {
        streak++;
        if (streak > bestStreak) bestStreak = streak;
      } else {
        streak = 0;
      }
    }
    this.data.daily_completions[key] = {
      date,
      years,
      correct,
      total,
      arena_points,
      best_streak: bestStreak,
      results: results.map((r) => ({
        correct: r.correct,
        difficulty: r.difficulty,
      })),
      completed_at: new Date().toISOString(),
    };
    this.data.lifetime_attempts += total;
    this.data.lifetime_correct += correct;
    this.save();
  }

  recordAnswer(correct: boolean): void {
    this.data.lifetime_attempts++;
    if (correct) this.data.lifetime_correct++;
    this.save();
  }

  updateEndlessScore(score: number, streak: number): void {
    if (score > this.data.endless_high_score) {
      this.data.endless_high_score = score;
    }
    if (streak > this.data.endless_best_streak) {
      this.data.endless_best_streak = streak;
    }
    this.save();
  }

  setPreferredDuration(years: number): void {
    this.data.preferred_duration = years;
    this.save();
  }

  setReducedMotion(value: boolean): void {
    this.data.settings.reduced_motion = value;
    this.save();
  }

  reset(): void {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
    this.data = { ...DEFAULT_PROGRESS, daily_completions: {}, settings: { ...DEFAULT_PROGRESS.settings } };
  }
}

// Singleton
let _repo: LocalProgressRepository | null = null;

export function getProgressRepository(): LocalProgressRepository {
  if (!_repo) _repo = new LocalProgressRepository();
  return _repo;
}

export function buildShareText(
  date: string,
  results: DuelResult[]
): string {
  const correct = results.filter((r) => r.correct).length;
  const total = results.length;
  const points = results.reduce((s, r) => s + r.arena_points_awarded, 0);
  let streak = 0;
  let bestStreak = 0;
  for (const r of results) {
    if (r.correct) {
      streak++;
      if (streak > bestStreak) bestStreak = streak;
    } else {
      streak = 0;
    }
  }
  const squares = results
    .map((r) => (r.correct ? "🟩" : "🟥"))
    .join("");
  return [
    `PEAK3 Arena — ${date}`,
    `${correct}/${total} correct`,
    `${points.toLocaleString()} Arena Points`,
    `Best streak: ${bestStreak}`,
    squares,
    "peak3.arena",
  ].join("\n");
}
