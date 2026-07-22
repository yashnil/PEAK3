"use client";

import type { DraftMode, DraftCompletionSummary, ActiveDraftGame } from "@/types/draft";

const STORAGE_KEY = "peak3_draft_progress_v1";

interface StoredProgress {
  schema_version: 1;
  active_game: ActiveDraftGame | null;
  // key: "YYYY-MM-DD", value: mode → completion summary
  daily_completions: Record<string, Partial<Record<DraftMode, DraftCompletionSummary>>>;
  challenge_games: Record<string, string>;  // tokenKey → game_id for resume
}

function emptyProgress(): StoredProgress {
  return {
    schema_version: 1,
    active_game: null,
    daily_completions: {},
    challenge_games: {},
  };
}

export class LocalDraftProgressRepository {
  private load(): StoredProgress {
    if (typeof window === "undefined") return emptyProgress();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyProgress();
      const parsed = JSON.parse(raw);
      if (parsed.schema_version !== 1) return emptyProgress();
      return parsed as StoredProgress;
    } catch {
      return emptyProgress();
    }
  }

  private save(p: StoredProgress): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
      // storage full or blocked — silently fail
    }
  }

  // ── Active game (for resumption) ──────────────────────────────────────────

  getActiveGame(): ActiveDraftGame | null {
    return this.load().active_game;
  }

  saveActiveGame(game: ActiveDraftGame): void {
    const p = this.load();
    p.active_game = game;
    this.save(p);
  }

  clearActiveGame(): void {
    const p = this.load();
    p.active_game = null;
    this.save(p);
  }

  // ── Daily completions ─────────────────────────────────────────────────────

  getDailyCompletion(date: string, mode: DraftMode): DraftCompletionSummary | null {
    const p = this.load();
    return p.daily_completions[date]?.[mode] ?? null;
  }

  hasDailyCompletion(date: string, mode: DraftMode): boolean {
    return this.getDailyCompletion(date, mode) !== null;
  }

  saveDailyCompletion(date: string, mode: DraftMode, summary: DraftCompletionSummary): void {
    const p = this.load();
    if (!p.daily_completions[date]) p.daily_completions[date] = {};
    // Only save the FIRST completion — never overwrite with a replay
    if (!p.daily_completions[date][mode]) {
      p.daily_completions[date][mode] = summary;
    }
    this.save(p);
  }

  getAllDailyCompletions(date: string): Partial<Record<DraftMode, DraftCompletionSummary>> {
    return this.load().daily_completions[date] ?? {};
  }

  // ── Challenge game resumption ─────────────────────────────────────────────

  /** tokenKey: first 16 chars of base64url-encoded token */
  getChallengeGameId(tokenKey: string): string | null {
    return this.load().challenge_games[tokenKey] ?? null;
  }

  saveChallengeGameId(tokenKey: string, gameId: string): void {
    const p = this.load();
    p.challenge_games[tokenKey] = gameId;
    this.save(p);
  }

  clearChallengeGame(tokenKey: string): void {
    const p = this.load();
    delete p.challenge_games[tokenKey];
    this.save(p);
  }
}

export const draftProgress = new LocalDraftProgressRepository();
