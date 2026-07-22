/**
 * Privacy-safe typed analytics events for PEAK3.
 * Phase 1: console.debug only — no external service wired.
 * Replace the `emit` implementation when integrating an analytics provider.
 */

export type AnalyticsEvent =
  | { type: "daily_board_opened"; mode: string; date: string; has_prior_completion: boolean }
  | { type: "daily_game_started"; mode: string; date: string }
  | { type: "daily_game_completed"; mode: string; date: string; lineup_peak_rating: number; draft_efficiency: number | null }
  | { type: "challenge_created"; mode: string; board_type: string }
  | { type: "challenge_opened"; mode: string; board_label: string }
  | { type: "challenge_started"; mode: string }
  | { type: "challenge_completed"; mode: string; outcome: string }
  | { type: "challenge_shared"; mode: string }
  // Phase 3.1 progression events
  | { type: "xp_awarded"; xp_amount: number; event_type: string }
  | { type: "level_reached"; new_level: number }
  | { type: "personal_record_set"; record_type: string; mode: string }
  | { type: "achievement_awarded"; achievement_key: string; category: string }
  | { type: "streak_advanced"; current_streak: number }
  | { type: "streak_reserve_earned" }
  | { type: "streak_reserve_consumed"; current_streak: number }
  | { type: "streak_reset" }
  | { type: "progression_viewed"; surface: string }
  // Phase 4.0 ranked events — never include opponent identity/picks, raw
  // integrity signals, or exact rating deltas beyond what the result screen
  // already shows the player themselves.
  | { type: "ranked_queue_viewed"; mode: string }
  | { type: "ranked_queue_joined"; mode: string }
  | { type: "ranked_queue_cancelled"; mode: string }
  | { type: "ranked_match_created"; mode: string }
  | { type: "ranked_match_started"; mode: string }
  | { type: "ranked_match_completed"; mode: string }
  | { type: "ranked_match_settled"; mode: string; outcome: string }
  | { type: "ranked_match_forfeited"; mode: string }
  | { type: "ranked_match_invalidated"; mode: string }
  | { type: "placement_advanced"; mode: string; valid_matches_completed: number }
  | { type: "placement_completed"; mode: string }
  | { type: "rating_changed"; mode: string }
  | { type: "division_changed"; mode: string }
  | { type: "ranked_leaderboard_viewed"; mode: string };

// DO NOT include: raw tokens, email, IP, future offers, secrets, player selections,
// opponent identity/picks, raw integrity signals, service-role details, exact
// private IP/location data

function emit(event: AnalyticsEvent): void {
  if (process.env.NODE_ENV !== "production") {
    console.debug("[peak3:analytics]", event.type, event);
  }
  // TODO Phase 3: send to analytics provider
  // analyticsClient.track(event.type, event);
}

export const analytics = { track: emit };
