"use client";

import { useEffect, useRef, useState } from "react";

import type { ArenaSeatPublic, TmwPick, TmwPublicState } from "@/types/three-man-weave";
import { TMW_SLOT_LABELS } from "@/types/three-man-weave";
import { pickFeed } from "@/lib/three-man-weave-state";

/**
 * WHOSE TURN IT IS, WHAT A BOT IS DOING, AND WHAT IT JUST DID.
 *
 * THE DEFECT. Manual acceptance found that "bot picks appear with little
 * visible transition — the user cannot quickly see what the bot selected, where
 * it was placed, or what changed", and separately that "the active participant
 * is indicated by tiny text and a small badge". Both are the same absence: the
 * board rendered the RESULT of every bot turn and none of the turn itself. A
 * seat went from empty to filled between two polls and nothing marked the
 * moment.
 *
 * The server already produces everything needed. A bot's think time is
 * deterministic and enforced against `arena_turns.opened_at`
 * (`bots.bot_think_seconds_for`, 1–5 s for this mode), so the board genuinely
 * does render the bot on the clock before it renders its move — the client
 * simply had nowhere to say so.
 *
 * TWO STATES, ONE TRAY:
 *
 *   SCOUTING — a bot holds the clock and has not moved. An animated line names
 *              the seat. This is the 1.2–3.5 s window PART 9 asks for, and it
 *              is the server's own delay rather than a client-side pause.
 *   REVEALED — a new pick has appeared. The player, the eligible franchise
 *              season and the slot are shown together for a beat before the
 *              tray returns to idle, and the pick feed carries it from then on.
 *
 * THE SCORE APPEARS ONLY AFTER PLACEMENT (PART 9 step 7). It is on the card in
 * the roster, which is already rendered by the time this tray shows the reveal.
 */

/** How long a revealed pick holds centre stage before the tray idles. */
const REVEAL_HOLD_MS = 2600;

export default function BotPickReveal({
  state,
  seats,
  currentTurnSeatIndex,
  yourSeatIndex,
}: {
  state: TmwPublicState;
  seats: ArenaSeatPublic[];
  currentTurnSeatIndex: number | null;
  yourSeatIndex: number | null;
}) {
  const feed = pickFeed(state);
  const [revealed, setRevealed] = useState<TmwPick | null>(null);
  // WHICH PICKS THIS CLIENT HAS ALREADY SEEN, as a set of slugs rather than an
  // index. `pickFeed` sorts by round descending and then by SEAT, so in a snake
  // its last element is not the newest pick — round 2 runs C-B-A but sorts
  // A-B-C. Diffing a set is order-independent and cannot be broken by a future
  // change to that sort.
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const slugs = new Set(feed.map((pick) => pick.player_slug));
    if (seen.current === null) {
      // First render of an in-progress match must not replay every pick that
      // already happened; only picks that ARRIVE while mounted are revealed.
      seen.current = slugs;
      return;
    }
    const fresh = feed.filter((pick) => !seen.current!.has(pick.player_slug));
    seen.current = slugs;
    if (fresh.length === 0) return;
    // If several arrived at once (a poll that spanned two bot turns), show the
    // one from the highest round — the most recent thing that happened.
    const newest = fresh.reduce((best, pick) =>
      pick.round_number > best.round_number ? pick : best,
    );
    setRevealed(newest);
    const timer = window.setTimeout(() => setRevealed(null), REVEAL_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [feed]);

  const activeSeat =
    currentTurnSeatIndex === null
      ? null
      : (seats.find((seat) => seat.seat_index === currentTurnSeatIndex) ?? null);
  const scouting = !!activeSeat?.is_bot && !revealed && !state.is_complete;

  if (revealed) {
    const seat = seats.find((s) => s.seat_index === revealed.seat_index);
    const isYours = revealed.seat_index === yourSeatIndex;
    return (
      <section
        className="tmw-reveal"
        data-testid="tmw-bot-reveal"
        data-state="revealed"
        /* WHOSE pick this is, on the element. The tray reveals your own picks
           too -- the copy says so -- but nothing exposed that, so a review
           capture waiting for "a bot's pick was revealed" photographed the
           player's own pick instead and could not tell. */
        data-yours={isYours ? "true" : "false"}
        aria-live="polite"
      >
        <p className="tmw-reveal-who">
          {isYours ? "You drafted" : `${seat?.display_name ?? "A bot"} drafted`}
        </p>
        <p className="tmw-reveal-name" data-testid="tmw-reveal-name">
          {revealed.player_name}
        </p>
        <p className="tmw-reveal-meta">
          {revealed.scoring_card
            ? `${revealed.scoring_card.season} ${revealed.scoring_card.team_id}`
            : "—"}
          {" · "}
          <span data-testid="tmw-reveal-slot">
            {TMW_SLOT_LABELS[revealed.slot_type] ?? revealed.slot_type}
          </span>
        </p>
      </section>
    );
  }

  if (scouting) {
    return (
      <section
        className="tmw-reveal"
        data-testid="tmw-bot-reveal"
        data-state="scouting"
        aria-live="polite"
      >
        <p className="tmw-reveal-who">{activeSeat?.display_name ?? "A bot"} is scouting</p>
        <p className="tmw-reveal-scouting" aria-hidden="true">
          <span />
          <span />
          <span />
        </p>
      </section>
    );
  }

  return null;
}

/**
 * The one-line status every surface reads: whose pick it is, in words that need
 * no legend.
 *
 * PART 8: "Top status should clearly read 'Your pick' or 'The Enforcer is
 * selecting'. Do not rely on tiny corner text."
 */
export function turnHeadline(
  seats: ArenaSeatPublic[],
  currentTurnSeatIndex: number | null,
  yourSeatIndex: number | null,
  complete: boolean,
): string {
  if (complete) return "Draft complete";
  if (currentTurnSeatIndex === null) return "Rolling the next franchise and decade";
  if (currentTurnSeatIndex === yourSeatIndex) return "Your pick";
  const seat = seats.find((s) => s.seat_index === currentTurnSeatIndex);
  return `${seat?.display_name ?? "The other seat"} is selecting`;
}
