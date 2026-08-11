"use client";
import { useEffect, useRef, useState } from "react";

import type {
  ArenaSeatPublic,
  TmwPick,
  TmwPublicState,
} from "@/types/three-man-weave";
import { TMW_SLOT_LABELS } from "@/types/three-man-weave";
import {
  filledCount,
  pickFeed,
  pickedHeadline,
  seatAccent,
  seatLabel,
  turnHeadline,
} from "@/lib/three-man-weave-state";
import ArenaTimer, { useRemainingSeconds } from "@/components/shared/ArenaTimer";

/**
 * ONE TURN-STATUS SURFACE (TMW-07, TMW-08).
 *
 * WHAT THIS REPLACES. The room used to stack four separate strips describing
 * the same turn: the spinner banner, a "whose pick" bar, a "X is scouting /
 * X drafted" tray (`BotPickReveal`), and an eighteen-chip snake strip
 * (`DraftOrderStrip`). Three of them said the same thing in three registers a
 * few pixels apart and the fourth published a rule -- A-B-C then C-B-A -- that
 * never changes and belongs in How to Play. All four are deleted; this is the
 * one region, and it carries exactly what a drafter needs mid-turn:
 *
 *   * Round X of 6 and pick Y of 18;
 *   * the current franchise x decade;
 *   * WHO is on the clock, by name, in a sentence;
 *   * that seat's roster progress;
 *   * one clock.
 *
 * THE POST-PICK BEAT LIVES HERE TOO. "The Spark selected Bradley Beal" holds
 * for a moment on this same line and then returns to the next seat, instead of
 * appearing in a separate tray below. One state, one place.
 *
 * TWO CLOCKS, AND BOTH OF THEM COUNT DOWN
 * ---------------------------------------
 * When the turn is YOURS the clock is `ArenaTimer` driven by the server's own
 * deadline, and it names its consequence.
 *
 * WHEN THE TURN BELONGS TO A BOT IT IS THE SAME CLOCK. This used to count UP
 * -- "Deliberating 1s, 2s, 3s" -- for an honest reason: the API published
 * `seconds_remaining` only to the seat that owned the turn, so there was no bot
 * deadline to count down to and the room refused to invent one. The right fix
 * was to publish the fact rather than to keep working around its absence: a
 * turn deadline is not hidden information, and the server now sends
 * `turn_seconds_remaining` to every seat. So the opponent's wait reads
 * "Deliberating 8s, 7s, 6s" against the SERVER's deadline, in the same
 * direction and the same language as the human's own clock, and a player can
 * finally tell whether the bot is nearly done or has just started.
 *
 * The count-up remains as the fallback for the one case that still has no
 * deadline -- a turn whose remaining time the server did not publish -- rather
 * than showing nothing at all.
 *
 * ACCESSIBILITY. Exactly one polite live region, on the headline, so a turn
 * change is announced and a ticking number never is. `ArenaTimer` keeps its own
 * threshold announcements at 10s and 5s.
 */
export default function TurnStatus({
  state,
  seats,
  currentTurnSeatIndex,
  yourSeatIndex,
  complete,
  pickNumber,
  totalPicks,
  deadlineAt,
  opponentDeadlineAt = null,
  turnSeconds,
  timeoutConsequence,
  onExpire,
}: {
  state: TmwPublicState;
  seats: ArenaSeatPublic[];
  currentTurnSeatIndex: number | null;
  yourSeatIndex: number | null;
  complete: boolean;
  pickNumber: number;
  totalPicks: number;
  deadlineAt: number | null;
  /** The open turn's deadline when it belongs to SOMEBODY ELSE. See the
   *  module docstring; `null` falls back to the count-up. */
  opponentDeadlineAt?: number | null;
  turnSeconds: number;
  timeoutConsequence: string;
  onExpire?: () => void;
}) {
  const yourTurn = currentTurnSeatIndex !== null && currentTurnSeatIndex === yourSeatIndex;
  const activeSeat =
    currentTurnSeatIndex === null
      ? null
      : (seats.find((seat) => seat.seat_index === currentTurnSeatIndex) ?? null);
  const activeRoster =
    currentTurnSeatIndex === null
      ? null
      : (state.rosters.find((roster) => roster.seat_index === currentTurnSeatIndex) ?? null);

  const justPicked = useJustPicked(state);
  const opponentOnClock = !complete && !yourTurn && !!activeSeat;
  const elapsed = useBotElapsed(
    opponentOnClock,
    // The turn key. Restarts at a genuine turn boundary and at no other time --
    // seat index alone would miss the snake turnaround, where the same seat
    // takes two turns back to back across a round boundary.
    `${currentTurnSeatIndex}:${state.current_round}:${pickNumber}`,
  );
  // THE SERVER'S DEADLINE FOR WHOEVER IS ON THE CLOCK. Null only when the
  // server published none, in which case the count-up survives as the fallback
  // rather than the panel showing nothing.
  const remaining = useRemainingSeconds(opponentOnClock ? opponentDeadlineAt : null);
  const botClock =
    !opponentOnClock
      ? null
      : remaining !== null
        ? { seconds: remaining, direction: "down" as const }
        : elapsed !== null
          ? { seconds: elapsed, direction: "up" as const }
          : null;

  const headline = justPicked
    ? pickedHeadline(seats, justPicked, yourSeatIndex)
    : turnHeadline(seats, currentTurnSeatIndex, yourSeatIndex, complete);

  return (
    <section
      /* THE LIVE PANEL IS SPOTLIT, IN THE ACTIVE SEAT'S COLOUR. `.pk-spotlight`
         is the shared "this is where the game is" treatment -- deliberately a
         different thing from the focus ring, which is about where the KEYBOARD
         is, and which is frequently on a different element at the same moment.
         The ring's colour comes from `--pk-spotlight`, which `.tmw-turnbar`
         re-scopes from the seat's own fill, so a blue seat's turn does not
         light the room gold.

         It is applied only while a turn is genuinely open: a spotlight that
         never goes out is a border. `.pk-crown` adds the lit top hairline that
         makes the bar read as a mounted board. */
      className={`tmw-turnbar pk-crown${
        currentTurnSeatIndex !== null && !complete ? " pk-spotlight" : ""
      }`}
      data-testid="tmw-turnbar"
      data-yours={yourTurn ? "true" : "false"}
      data-seat-accent={currentTurnSeatIndex === null ? undefined : seatAccent(currentTurnSeatIndex)}
      aria-label="Turn status"
    >
      <div className="tmw-turnbar-meta">
        <p className="tmw-turnbar-round" data-testid="tmw-turnbar-round">
          <span className="pk-numeral">
            Round {state.current_round ?? "—"} of {state.total_rounds}
          </span>
          <span className="tmw-turnbar-dot" aria-hidden="true">
            ·
          </span>
          <span className="pk-numeral">
            Pick {Math.min(pickNumber, totalPicks)} of {totalPicks}
          </span>
        </p>
        {state.current_roll ? (
          <p className="tmw-turnbar-roll" data-testid="tmw-turnbar-roll">
            {state.current_roll.franchise_display_name}
            <span className="tmw-turnbar-decade">{state.current_roll.decade}</span>
          </p>
        ) : null}
      </div>

      <div className="tmw-turnbar-who">
        {/* THE ONLY LIVE REGION IN THE ROOM. It updates when the turn does and
            at no other time -- a per-second region would talk over everything
            else on the page. */}
        <p
          className="tmw-turnbar-headline"
          data-testid="tmw-turn-spotlight"
          data-yours={yourTurn ? "true" : "false"}
          data-state={justPicked ? "selected" : "on-clock"}
          aria-live="polite"
        >
          {headline}
        </p>
        {justPicked ? (
          <p className="tmw-turnbar-sub" data-testid="tmw-turn-picked-detail">
            {justPicked.scoring_card
              ? `${justPicked.scoring_card.season} ${justPicked.scoring_card.team_id} · `
              : ""}
            {TMW_SLOT_LABELS[justPicked.slot_type] ?? justPicked.slot_type}
          </p>
        ) : activeRoster ? (
          <p className="tmw-turnbar-sub" data-testid="tmw-turn-progress">
            <span className="pk-numeral">{filledCount(activeRoster)}/6</span> drafted
            {currentTurnSeatIndex !== null && currentTurnSeatIndex !== yourSeatIndex
              ? ` · ${seatLabel(seats, currentTurnSeatIndex)}`
              : ""}
          </p>
        ) : null}
      </div>

      {yourTurn ? (
        <ArenaTimer
          deadlineAt={deadlineAt}
          totalSeconds={turnSeconds}
          label="Your pick"
          consequence={timeoutConsequence}
          yours
          onExpire={onExpire}
          testId="tmw-turn-clock"
        />
      ) : botClock !== null && !justPicked ? (
        /* THE OPPONENT'S CLOCK, COUNTING DOWN against the server's own turn
           deadline — the same direction and the same language as the human's.
           `data-direction` is on the element so a test asserts which of the two
           it is showing rather than inferring it from a number that happens to
           be falling. See the module docstring. */
        <div
          className="tmw-bot-clock"
          data-testid="tmw-bot-clock"
          data-direction={botClock.direction}
          data-seat-accent={
            currentTurnSeatIndex === null ? undefined : seatAccent(currentTurnSeatIndex)
          }
        >
          <span className="tmw-bot-clock-label">Deliberating</span>
          <span className="tmw-bot-clock-value pk-numeral" aria-hidden="true">
            {botClock.seconds}s
          </span>
          <span className="tmw-bot-clock-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      ) : (
        <div className="tmw-bot-clock tmw-bot-clock--idle" data-testid="tmw-bot-clock">
          <span className="tmw-bot-clock-label">
            {complete ? "Draft over" : justPicked ? "Selected" : "Standing by"}
          </span>
        </div>
      )}
    </section>
  );
}

/** How long a revealed pick holds the headline before it returns to the turn. */
const PICKED_HOLD_MS = 2200;

/**
 * The pick that ARRIVED while this client was mounted, or null.
 *
 * Diffed as a SET of slugs rather than by index: `pickFeed` sorts by round
 * descending and then by seat, so in a snake its last element is not the newest
 * pick -- round 2 runs C-B-A but sorts A-B-C.
 */
function useJustPicked(state: TmwPublicState): TmwPick | null {
  const feed = pickFeed(state);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  // THE EFFECT IS KEYED ON A STRING, NOT ON THE ARRAY.
  //
  // `pickFeed` builds a fresh array on every render and the room replaces its
  // whole match object on every two-second poll, so an effect with `[feed]` in
  // its deps re-ran constantly -- and the version this replaces armed its
  // dismissal timer INSIDE that effect. The next re-render's cleanup cleared
  // the timer and the early return never re-armed it, so a revealed pick could
  // stick on screen for the rest of the match. Detection and dismissal are two
  // effects now, and detection only fires when the drafted set actually
  // changes.
  const signature = feed
    .map((entry) => entry.player_slug)
    .sort()
    .join("|");

  const [revealed, setRevealed] = useState<TmwPick | null>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const current = feedRef.current;
    const slugs = new Set(current.map((entry) => entry.player_slug));
    if (seen.current === null) {
      // A mid-match mount must not replay every pick that already happened.
      seen.current = slugs;
      return;
    }
    const fresh = current.filter((entry) => !seen.current!.has(entry.player_slug));
    seen.current = slugs;
    if (fresh.length === 0) return;
    // Several may land in one poll that spanned two bot turns; show the newest.
    setRevealed(
      fresh.reduce((best, entry) =>
        entry.round_number > best.round_number ? entry : best,
      ),
    );
  }, [signature]);

  useEffect(() => {
    if (!revealed) return;
    const timer = window.setTimeout(() => setRevealed(null), PICKED_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  return revealed;
}

/** Whole seconds since this client first saw the current turn, or null. */
function useBotElapsed(active: boolean, turnKey: string): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setElapsed(null);
      return;
    }
    const started = performance.now();
    setElapsed(0);
    const id = window.setInterval(() => {
      setElapsed(Math.floor((performance.now() - started) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [active, turnKey]);

  return elapsed;
}
