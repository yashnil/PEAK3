"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ONE COMPETITIVE TIMING MODEL for the $20 Showdown (SHARED-01).
 *
 * The room used to have no phases at all. It had a server deadline, a local
 * countdown seeded from it, and a pile of `setTimeout`s in unrelated
 * components. Three defects fell out of that, and all three are fixed here
 * rather than patched at their symptoms:
 *
 *  * S20-01. Arriving from the lobby dropped the player straight onto a
 *    running 25-second clock with no idea who they were playing or what a
 *    market skip was.
 *  * S20-02. A new lot appeared and the clock was already counting, so the
 *    read and the decision were the same moment.
 *  * S20-08. `submit()` set `busy` and `inFlight` and NEVER touched
 *    `deadlineAt`, while `ArenaTimer` keys only on `[deadlineAt]`. A bid sent
 *    inside the server's two-second grace window is DESIGNED to be accepted
 *    (`apps/api/tests/test_arena_action_races.py` asserts acceptance up to
 *    1900 ms late) and the UI painted "Time expired — settling this lot…" over
 *    it while it was being accepted.
 *
 * THE PHASES
 * ----------
 *   intro    — pre-match. No clock is displayed, no control is live.
 *   reveal   — a new lot is on the block. The card is readable before the
 *              decision phase opens.
 *   handoff  — an action just landed. It is named, held briefly, and then the
 *              next seat lights up.
 *   decide   — the active seat is on the clock. The only phase with a
 *              countdown and live controls.
 *   pending  — this client has submitted and is waiting for the server. The
 *              countdown is FROZEN and the submitted action is displayed.
 *   settling — no seat is active; the server is resolving the lot.
 *   complete — the auction is over.
 *
 * WHY THE BEATS ARE BUDGETED, AND WHY THAT IS THE HONEST ANSWER
 * -------------------------------------------------------------
 * The server's clock is authoritative and it starts when the turn is opened
 * (`mode.py::_finish` → `deadline_at = data.now + TURN_SECONDS`). A client
 * cannot pause it, and pretending otherwise is exactly the "secretly consumes
 * the 25-second clock" failure S20-02 names.
 *
 * So a beat NEVER runs on borrowed time. `affordableBeat` refuses to spend
 * anything that would push the human's remaining decision window below
 * `MIN_DECISION_SECONDS`. Concretely:
 *
 *   * When the clock is not the human's — the bot's turn, a settling lot, the
 *     pre-match intro before any human turn — a beat is free and runs in full.
 *   * On the human's own fresh 25-second turn there are 7 seconds of headroom
 *     above the floor, which covers the intro and the reveal with room to
 *     spare, and the countdown that then appears is the true server remainder.
 *   * On a resume with 19 seconds left the beat is truncated to 1 second; at
 *     18 or below it is skipped outright and the controls open immediately.
 *
 * That floor is the contract, it is measurable, and `twenty-dollar-phase.test`
 * pins it. Nothing here is "roughly a second, probably fine".
 *
 * REDUCED MOTION GETS THE SAME TIMING. The beats are legibility, not
 * decoration: a reduced-motion user needs the reading beat at least as much as
 * anybody. `prefers-reduced-motion` removes the animation on the surfaces, not
 * the phase.
 */

export type ShowdownPhase =
  | "intro"
  | "reveal"
  | "handoff"
  | "decide"
  | "pending"
  | "settling"
  | "complete";

/** The competitive intro, S20-01. Long enough to read four lines. */
export const INTRO_MS = 3200;
/** The lot reveal beat, S20-02 ("roughly 0.8–1.5s of readable reveal"). */
export const REVEAL_MS = 1100;
/** The inter-turn hold, S20-09 ("500–900ms"). */
export const HANDOFF_MS = 700;

/**
 * The decision window this client refuses to spend. See the module docstring:
 * `TURN_SECONDS` is 25, so a fresh human turn has 7 seconds of headroom and a
 * short one has none.
 */
export const MIN_DECISION_SECONDS = 18;

/**
 * How much of a beat is affordable right now.
 *
 * `onHumanClock` is the whole question. If the countdown running is the
 * player's own, a beat costs them decision time and is capped; if it belongs
 * to the bot, to nobody, or to a turn that has not opened yet, it costs
 * nothing and runs in full.
 */
export function affordableBeat(
  requestedMs: number,
  secondsRemaining: number | null,
  onHumanClock: boolean,
): number {
  if (!onHumanClock || secondsRemaining === null) return requestedMs;
  const spareMs = (secondsRemaining - MIN_DECISION_SECONDS) * 1000;
  if (spareMs <= 0) return 0;
  return Math.min(requestedMs, spareMs);
}

interface Beat {
  kind: "intro" | "reveal" | "handoff";
  /** Identity of the beat, so an unchanged poll cannot restart its timer. */
  key: string;
  /**
   * How long this beat may run, decided ONCE when it opens.
   *
   * THIS USED TO BE RE-DERIVED IN AN EFFECT that listed `secondsRemaining`
   * among its dependencies — and `secondsRemaining` is a float the poll
   * rewrites every two seconds (24.99, 22.99, 20.99…). Every poll therefore
   * tore down the pending `setTimeout` and started a fresh one, so any beat
   * longer than the poll interval could never expire on its own: `INTRO_MS` is
   * 3200 against a 2000 ms poll, which meant the intro was dismissible only by
   * the button. Deciding the duration at the moment the beat opens is both
   * correct and simpler — affordability is a question about the clock as it was
   * when the beat began.
   */
  durationMs: number;
}

export interface ShowdownPhaseInput {
  /** `public_state.lot_index`. */
  lotIndex: number;
  /** `public_state.active_seat`. */
  activeSeat: number | null;
  /** `your_seat_index`. */
  yourSeat: number | null;
  /** `public_state.lot_actions.length` — bumps on every action in the lot. */
  actionCount: number;
  /** `public_state.history.length`, used only to tell a fresh match from a resume. */
  historyLength: number;
  /** `seconds_remaining` as the server last reported it. */
  secondsRemaining: number | null;
  /** The local monotonic deadline the room derived from `seconds_remaining`. */
  deadlineAt: number | null;
  /** True while this client has a command in flight. */
  pending: boolean;
  /** `public_state.phase === "complete"`. */
  complete: boolean;
}

export interface ShowdownPhaseState {
  phase: ShowdownPhase;
  /**
   * The deadline to hand `ArenaTimer`, or null when NOTHING should be
   * counting. Null during the intro, during a beat, and — the S20-08 fix —
   * for as long as a command of this client's is in flight.
   */
  clockDeadlineAt: number | null;
  /** May the human act right now? */
  controlsLive: boolean;
  /** End the intro early, from its own button. */
  dismissIntro: () => void;
}

export function useShowdownPhase(input: ShowdownPhaseInput): ShowdownPhaseState {
  const {
    lotIndex,
    activeSeat,
    yourSeat,
    actionCount,
    historyLength,
    secondsRemaining,
    deadlineAt,
    pending,
    complete,
  } = input;

  const onHumanClock = activeSeat !== null && activeSeat === yourSeat;

  // Read by `openBeat`, which must price a beat against the clock as it is at
  // the moment the beat opens without taking either value as a dependency.
  const clockRef = useRef({ secondsRemaining, onHumanClock });
  clockRef.current = { secondsRemaining, onHumanClock };

  // A FRESH MATCH IS THE ONLY ONE THAT GETS AN INTRO. A reload three lots in
  // must not replay it — the player has already been introduced, and the
  // intro would be spending their clock to tell them something they know.
  const [beat, setBeat] = useState<Beat | null>(() =>
    !complete && historyLength === 0 && lotIndex === 0 && actionCount === 0
      ? {
          kind: "intro",
          key: "intro",
          // The intro opens before any human turn can have been rendered, so
          // it is priced against the clock exactly like any other beat.
          durationMs: affordableBeat(INTRO_MS, secondsRemaining, onHumanClock),
        }
      : null,
  );

  const openBeat = useCallback((kind: Beat["kind"], key: string, requestedMs: number) => {
    const { secondsRemaining: left, onHumanClock: mine } = clockRef.current;
    setBeat({ kind, key, durationMs: affordableBeat(requestedMs, left, mine) });
  }, []);

  // Previous values, so a CHANGE can be told from a poll that returned the
  // same state. Seeded on mount so the first render never fires a beat for a
  // transition that did not happen.
  const previousLot = useRef(lotIndex);
  const previousActions = useRef(actionCount);

  // A NEW LOT IS A REVEAL (S20-02). The card gets a readable beat before the
  // decision phase opens.
  useEffect(() => {
    if (lotIndex === previousLot.current) return;
    previousLot.current = lotIndex;
    previousActions.current = actionCount;
    if (complete) return;
    openBeat("reveal", `reveal:${lotIndex}`, REVEAL_MS);
    // `actionCount` deliberately omitted: it is read, not depended on. A lot
    // change is the trigger; the action count is only being re-baselined.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotIndex, complete, openBeat]);

  // AN ACTION INSIDE THE SAME LOT IS A HANDOFF (S20-09). "YOU RAISED TO $7",
  // hold, then the other side lights up.
  useEffect(() => {
    if (actionCount === previousActions.current) return;
    const grew = actionCount > previousActions.current;
    previousActions.current = actionCount;
    if (!grew || complete) return;
    openBeat("handoff", `handoff:${lotIndex}:${actionCount}`, HANDOFF_MS);
  }, [actionCount, lotIndex, complete, openBeat]);

  // THE BEAT'S OWN TIMER. It depends on the beat's IDENTITY AND NOTHING ELSE,
  // which is the fix described on `Beat.durationMs`: a poll landing mid-beat
  // must not restart the countdown to its end.
  const beatKey = beat?.key ?? null;
  const beatDuration = beat?.durationMs ?? 0;
  useEffect(() => {
    if (beatKey === null) return;
    const clear = () => setBeat((current) => (current?.key === beatKey ? null : current));
    if (beatDuration <= 0) {
      clear();
      return;
    }
    const timer = window.setTimeout(clear, beatDuration);
    return () => window.clearTimeout(timer);
  }, [beatKey, beatDuration]);

  // A COMPLETED MATCH HAS NO BEATS. The result screen replaces the auction.
  useEffect(() => {
    if (complete) setBeat(null);
  }, [complete]);

  const dismissIntro = useCallback(() => {
    setBeat((current) => (current?.kind === "intro" ? null : current));
  }, []);

  const phase: ShowdownPhase = complete
    ? "complete"
    : // PENDING OUTRANKS EVERYTHING (S20-08). The moment this client submits,
      // the countdown stops and the submitted action is what the surface says.
      // It outranks a handoff beat too: the beat is about the OTHER seat's
      // action landing, and our own in-flight command is the more urgent truth.
      pending
      ? "pending"
      : beat
        ? beat.kind
        : activeSeat === null
          ? "settling"
          : "decide";

  return {
    phase,
    // NOTHING COUNTS DOWN OUTSIDE `decide`. This single expression is the
    // S20-08 fix: `pending` produces `null`, `ArenaTimer` renders its idle
    // state, and `onExpire` cannot fire behind a request that the server's
    // grace window is about to accept.
    clockDeadlineAt: phase === "decide" ? deadlineAt : null,
    controlsLive: phase === "decide" && onHumanClock,
    dismissIntro,
  };
}
