/**
 * Product telemetry for PRIME CUT and FIND THE PRIME, through the one existing
 * pipe (`analytics.track`, the closed allowlist, DNT/GPC and the server gate).
 *
 * WHAT IS NEVER SENT: a card's or window's PEAK3 score before its heat or round
 * has resolved, the player's name, another seat's choice, or any identifier.
 * A decision is reported after it is made; a round's score after its reveal.
 * Values are small integers and short slugs only.
 */
import { analytics } from "@/lib/analytics";

export type PrimeMode = "prime_cut" | "find_the_prime";

export const primeTelemetry = {
  opened(mode: PrimeMode) {
    analytics.track({ type: "game_opened", mode, surface: "arena_match" });
  },
  matchStarted(mode: PrimeMode, source: string, ruleset: string) {
    analytics.track({ type: "arena_match_started", mode, source, ruleset });
  },
  roundStarted(mode: PrimeMode, stage: number, durationYears: number) {
    analytics.track({ type: "arena_round_started", mode, stage, duration_years: durationYears });
  },
  promptShown(mode: PrimeMode, stage: number, cardIndex: number) {
    analytics.track({ type: "arena_prompt_shown", mode, stage, card_index: cardIndex });
  },
  decision(mode: PrimeMode, detail: { stage: number; decision: string; cardIndex?: number; forced?: boolean }) {
    analytics.track({
      type: "arena_decision",
      mode,
      stage: detail.stage,
      card_index: detail.cardIndex,
      decision: detail.decision,
      forced: detail.forced ?? false,
    });
  },
  timeout(mode: PrimeMode, stage: number, decision: string, cardIndex?: number) {
    analytics.track({ type: "arena_timeout", mode, stage, card_index: cardIndex, decision });
  },
  roundCompleted(mode: PrimeMode, stage: number, durationYears: number, score?: number) {
    analytics.track({
      type: "arena_round_completed",
      mode,
      stage,
      duration_years: durationYears,
      score: score === undefined ? undefined : Math.round(score * 10) / 10,
    });
  },
  matchCompleted(
    mode: PrimeMode,
    detail: { outcome?: string; placement?: number; score?: number | null; durationSeconds?: number; bots: number },
  ) {
    analytics.track({
      type: "arena_match_completed",
      mode,
      outcome: detail.outcome,
      placement: detail.placement,
      score: detail.score === null || detail.score === undefined ? undefined : Math.round(detail.score * 10) / 10,
      duration_seconds: detail.durationSeconds,
      bots: detail.bots,
    });
  },
  rematch(mode: PrimeMode) {
    analytics.track({ type: "arena_rematch", mode });
  },
  abandoned(mode: PrimeMode, stage: number) {
    analytics.track({ type: "arena_match_abandoned", mode, stage });
  },
};
