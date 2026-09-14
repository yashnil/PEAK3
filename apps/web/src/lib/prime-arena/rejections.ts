/**
 * Plain-language explanations for the rejection codes PRIME CUT and FIND THE
 * PRIME can return, plus the foundation's own.
 *
 * SEPARATE FROM `arena-rejection.ts` ON PURPOSE. That module is written around
 * The $20 Showdown's bid/pass model (its `AttemptedAction` is a bid), and
 * widening it would change copy a tested surface depends on. These two modes
 * share one small, mode-neutral table instead.
 *
 * Every code maps to a sentence about the BOARD or the RULE, never an internal
 * name. An unknown code falls back to the server's own message, then to a
 * generic sentence that says the board below is current.
 */

const MESSAGES: Record<string, string> = {
  // foundation
  stale_state_version: "The table moved on before that reached the server. The board below is current.",
  match_not_live: "This match has ended.",
  match_expired: "This match ran out of time.",
  turn_already_resolved: "That decision window had already closed.",
  not_your_seat: "Only a seated player can act in this match.",
  unknown_command: "That action is not part of this game.",
  ruleset_version_mismatch: "This match was dealt under an older ruleset. Start a new one.",
  mode_not_enabled: "This game is not open yet.",
  // shared rules
  bad_payload: "That action was incomplete. Try again.",
  seat_forfeited: "You conceded this match.",
  match_complete: "The match is over.",
  no_such_seat: "Only a seated player can act in this match.",
  // PRIME CUT
  not_deciding: "There is nothing to decide right now.",
  wrong_card: "That card has already been resolved.",
  already_decided: "Your call on this card is already locked.",
  keeps_full: "All four KEEP slots are used, so this card can only be cut.",
  cuts_full: "All four CUTs are used, so this card can only be kept.",
  // FIND THE PRIME
  wrong_round: "That round has already been revealed.",
  invalid_window: "That window is not part of this career at this length.",
  already_locked: "Your window for this round is already locked.",
};

const FALLBACK = "That action did not go through. The board below is current.";

export function roomErrorMessage(code: string | null | undefined, serverMessage?: string | null): string {
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (serverMessage && serverMessage.trim()) return serverMessage;
  return FALLBACK;
}

export function transportErrorMessage(status: number): string {
  if (status === 0) return "Could not reach the PEAK3 server. Check your connection; the match keeps its state.";
  if (status === 401) return "Your session has expired. Sign in again to keep playing.";
  if (status === 403) return "This match belongs to other players.";
  if (status === 404) return "That match could not be found. Matches expire after two hours.";
  return "The server could not take that action. The board below is current.";
}
