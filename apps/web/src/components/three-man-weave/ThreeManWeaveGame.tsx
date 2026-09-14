"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ArenaResultView,
  TmwMatchView,
  TmwPublicState,
  TmwRoster,
  TmwSlotType,
} from "@/types/three-man-weave";
import {
  TMW_COMMAND_INTRO_SEEN,
  TMW_COMMAND_PICK,
  TMW_COMMAND_REARRANGE,
  TMW_COMMAND_STAGE_PICK,
  TMW_INTRO_SECONDS,
  TMW_MODE,
  TMW_RESOLUTION_TIMEOUT,
  TMW_REVEAL_SECONDS,
  TMW_SLOT_TYPES,
  TMW_TURN_PHASE_ARRIVAL,
  TMW_TURN_PHASE_INTRO,
  TMW_TURN_PHASE_REVEAL,
  TMW_TURN_SECONDS,
} from "@/types/three-man-weave";
import {
  ArenaAPIError,
  commandIdempotencyKey,
  createPracticeMatch,
  getMatch,
  getMatchResults,
  submitCommand,
} from "@/lib/arena-api";
import type { TmwCandidate } from "@/lib/three-man-weave-state";
import {
  candidatesForSeat,
  canPick,
  changedSlots,
  connectionState,
  identityLock,
  isArriving,
  isBriefing,
  isRevealing,
  isYourTurn,
  phaseOf,
  provisionalPick,
  rosterWithPlacements,
  seatLabel,
  slotAbbrev,
} from "@/lib/three-man-weave-state";
import { isNewer, useCommandLane } from "@/lib/game-feel/authoritative";
import { reportHandoff, startActionTimer } from "@/lib/game-feel/action-timing";
import { serverTimingOf } from "@/lib/game-feel/server-timing";
import { EventMoment, type EventMomentData } from "@/components/game-feel";
import { usePrefersReducedMotion } from "@/lib/a11y";
import { modeMeta } from "@/lib/arena-modes";
import HowToPlay from "@/components/arena/HowToPlay";
import { deadlineFromSeconds } from "@/components/shared/ArenaTimer";
import PickOverlay from "./PickOverlay";
import IdentityLockPanel from "./IdentityLockPanel";
import PeakV2TMWCourts from "@/components/v2/tmw/PeakV2TMWCourts";
import PeakV2TMWReveal from "@/components/v2/tmw/PeakV2TMWReveal";
import PeakV2TMWResult from "@/components/v2/tmw/PeakV2TMWResult";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import { StatusChip } from "@/components/ui/StatusChip";

/**
 * POLL CADENCE, BY WHAT THE ROOM IS WAITING FOR.
 *
 * Polling is RECOVERY AND RECONCILIATION, never the channel a player's own
 * action is confirmed on -- every command's response is applied the instant
 * it lands (`applyView`). What polling carries is the OTHER seats' moves and
 * the server's own phase transitions, and its rate follows how soon one of
 * those can happen:
 *
 *   - a seatless phase (briefing, ceremony) ends on the server's own
 *     deadline, swept lazily on reads, so the room polls fast to observe the
 *     handoff crisply -- and this is also what ENDS the phase;
 *   - somebody else's turn can end at any moment, so one second;
 *   - the room's own turn changes only on its own command or on a timeout
 *     sweep, so two seconds is plenty.
 */
const POLL_SEATLESS_MS = 400;
const POLL_OPPONENT_MS = 1000;
const POLL_OWN_TURN_MS = 2000;
/** Slack after the server's own instant (a bot's reply, a seatless deadline). */
const BOT_REPLY_SLACK_MS = 60;
const SEATLESS_SLACK_MS = 60;
/** When the read that should have carried a bot's move did not, read again on this ladder. */
const BOT_RETRY_LADDER_MS = [150, 300, 600, 1000] as const;
/** A selection is staged once it has SETTLED for this long (game-feel pass 4).
 *  Staging exists only so a timeout drafts the player's own choice; sending it
 *  on every press put a round trip in front of the Draft press that followed,
 *  measured at up to 700 ms of queueing on a 750 ms connection. */
const STAGE_SETTLE_MS = 600;
/** ...unless the clock is nearly out, when the choice is staged at once. */
const STAGE_URGENT_MS = 8000;
/** How long one command may stay unanswered before the press reads as an error. */
const COMMAND_TIMEOUT_MS = 15_000;
/**
 * THE PREVIOUS-PICK BEAT. When the seat immediately before you picks, the
 * same snapshot that lands their card also hands you the turn, and the pick
 * surface used to open in that very frame -- over the top of the moment
 * that named their pick, which the overlay's scrim then hid. For this long
 * the room shows the applied state (their card locked on their court, the
 * moment, the clock already yours) before the overlay opens. Presentation
 * over state that is already applied: the server's clock is not paused, no
 * poll changes, and a press anywhere ends the beat at once. Reduced motion
 * collapses it to zero -- the overlay's own "taken this roll" chips carry
 * the same fact.
 */
//
// 200 ms, FROM 900 (game-feel pass 4): the handoff should read as a beat, not
// as a wait. The previous pick's card and its moment still land first; the
// surface follows inside the 120-220 ms handoff band.
export const TMW_PREVIOUS_PICK_BEAT_MS = 200;

/**
 * THE ROOM'S WHOLE STATE, AS ONE OBJECT.
 *
 * A command's response used to fan out into four `useState` setters, and a
 * poll's into two more, so "the swap landed" could paint as a message on one
 * render and a roster on the next. Everything derived from one server
 * snapshot now lands in one `setRoom`, so a render is always ONE match
 * snapshot: rosters, bench, positions, pick number, round, on-the-clock seat,
 * every clock, and the moment that snapshot announces.
 */
interface Room {
  match: TmwMatchView;
  /** YOUR clock: a local monotonic deadline, or null when you cannot act. */
  deadlineAt: number | null;
  /** THE OPEN TURN's clock, whoever is on it. */
  turnDeadlineAt: number | null;
  /** When the open turn began, on the local monotonic clock. */
  turnStartedAt: number | null;
  /** The open turn's full length. The denominator for every bar. */
  turnTotalSeconds: number | null;
  /** What this snapshot just did, for `EventMoment`. */
  moment: EventMomentData | null;
  /** Set when this snapshot handed you the turn on the back of another
   *  seat's pick: the id of the beat holding the pick surface shut. */
  previousPickBeat: string | null;
}

type Source = "initial" | "command" | "poll";

/**
 * THE ARRANGEMENT A PRESS HAS ALREADY ACKNOWLEDGED — the optimistic layer.
 *
 * WHY IT EXISTS. Every decision in this room used to be invisible until the
 * server answered it: press "Draft", press "Move", and the board held the OLD
 * roster for a whole round trip while a blocking "Drafting…" label sat over
 * it. On a laptop next to the API that is 40ms and nobody notices; on the
 * deployed build it is most of a second, and the interface reads as frozen.
 *
 * WHAT IT IS NOT. It is not authority and it is not a rule. `slots` is built
 * by re-seating picks the server has ALREADY validated into the assignment
 * the command carries (`rosterWithPlacements`), and a drafted card carries no
 * scoring card because this client has not been told the season or the score
 * (`provisionalPick`). Nothing here decides legality, scores a roster, ranks
 * a seat or advances a turn -- those remain exactly where they were.
 *
 * HOW IT ENDS. `baseVersion` is the authoritative version it was staged
 * against, and the stage is only applied while the room is still showing that
 * version. Every answer -- acceptance, rejection, transport failure -- lands a
 * newer snapshot or clears the stage explicitly, so a refused move rolls back
 * by being replaced rather than by any undo path of its own.
 */
interface StagedArrangement {
  baseVersion: number;
  seatIndex: number;
  roster: TmwRoster;
  /** The slots the press is waiting on, for the pending treatment. */
  pending: TmwSlotType[];
}

function nominalPhaseSeconds(match: TmwMatchView): number | null {
  // Arrival has no countdown to draw: its length is only a backstop.
  if (match.turn_phase === TMW_TURN_PHASE_ARRIVAL) return null;
  if (match.turn_phase === TMW_TURN_PHASE_INTRO) return TMW_INTRO_SECONDS;
  if (match.turn_phase === TMW_TURN_PHASE_REVEAL) return TMW_REVEAL_SECONDS;
  if (match.turn_phase) return TMW_TURN_SECONDS;
  return null;
}

/** Everything a snapshot says about time, converted ONCE, at the instant it
 *  lands -- never re-derived from a duration held in state. */
function roomFrom(match: TmwMatchView, moment: EventMomentData | null, previousPickBeat: string | null = null): Room {
  // A seatless phase publishes its clock to every seat as `seconds_remaining`
  // even on an API build that sends no `turn_seconds_remaining`.
  const remaining = match.turn_seconds_remaining ?? match.seconds_remaining;
  const turnDeadlineAt = deadlineFromSeconds(remaining);
  const total = match.turn_total_seconds ?? nominalPhaseSeconds(match);
  const elapsed =
    match.turn_elapsed_seconds ??
    (total !== null && remaining !== null && remaining !== undefined
      ? Math.max(0, total - remaining)
      : null);
  const turnStartedAt =
    elapsed !== null && typeof performance !== "undefined" ? performance.now() - elapsed * 1000 : null;
  return {
    match,
    deadlineAt: deadlineFromSeconds(match.seconds_remaining),
    turnDeadlineAt,
    turnStartedAt,
    turnTotalSeconds: total,
    moment,
    previousPickBeat,
  };
}

/**
 * How far two conversions of the same live deadline may differ before the
 * newer one is worth applying, in milliseconds. Below this the "correction"
 * would move the displayed number by less than the tick it is drawn at,
 * while re-rendering every consumer of the deadline. Above it something real
 * happened -- a suspended tab, a slow request -- and the server's number wins.
 */
const DEADLINE_DRIFT_MS = 750;

function driftExceeded(current: number | null, next: number | null): boolean {
  if (current === null || next === null) return current !== next;
  return Math.abs(next - current) > DEADLINE_DRIFT_MS;
}

/**
 * WHAT JUST HAPPENED, read off the two snapshots -- never off a timer, and
 * never off what the client thinks it asked for.
 *
 * A moment is only ever announced for a change the SAME render is drawing,
 * which is the whole point: the "John Stockton ↔ Trae Young" notice cannot
 * appear over a roster that still shows them un-swapped, because both come
 * from `next`.
 */
function describeTransition(
  prev: TmwMatchView,
  next: TmwMatchView,
  source: Source,
  kind: string | null,
): EventMomentData | null {
  if (source === "initial" || next.public_state.is_complete) return null;
  const you = next.your_seat_index;
  const id = `v${next.state_version}`;

  // A rearrangement of your own roster: one move, or one swap.
  if (source === "command" && kind === "rearrange" && you !== null) {
    const before = prev.public_state.rosters.find((r) => r.seat_index === you);
    const after = next.public_state.rosters.find((r) => r.seat_index === you);
    if (before && after) {
      const changed = TMW_SLOT_TYPES.filter(
        (slot) => (before.slots[slot]?.player_slug ?? null) !== (after.slots[slot]?.player_slug ?? null),
      );
      const names = changed.map((slot) => after.slots[slot]?.player_name).filter(Boolean) as string[];
      if (names.length === 2) {
        return { id, kind: "swap", title: `${names[0]} ↔ ${names[1]}`, detail: "Positions swapped", tone: "accent" };
      }
      if (names.length === 1) {
        const slot = changed.find((s) => after.slots[s]) as TmwSlotType | undefined;
        return { id, kind: "move", title: `${names[0]} → ${slot ? slotAbbrev(slot) : "new slot"}`, detail: "Moved", tone: "accent" };
      }
    }
  }

  // Picks that landed in this snapshot, in every roster. Prefer the viewer's
  // own if it is among them (it is the one they just committed); otherwise
  // the newest by round order.
  const arrivals: { seat: number; slot: TmwSlotType; name: string; round: number; timedOut: boolean }[] = [];
  for (const after of next.public_state.rosters) {
    const before = prev.public_state.rosters.find((r) => r.seat_index === after.seat_index);
    for (const slot of TMW_SLOT_TYPES) {
      const pick = after.slots[slot];
      if (pick && !before?.slots[slot]) {
        arrivals.push({
          seat: after.seat_index,
          slot,
          name: pick.player_name,
          round: pick.round_number,
          // A pick that arrived for YOUR seat on a poll is the server's
          // timeout drafting for you -- you never sent it.
          // THE SERVER'S OWN RECORD, NEVER THE TRANSPORT'S SHAPE. This read
          // `source === "poll" && after.seat_index === you` -- "a pick that
          // arrived for your seat on a poll is the server's timeout drafting
          // for you". That is a claim about which HTTP response carried the
          // news, and it was wrong every time a command's own response was
          // slow, lost, retried, or landed behind a newer snapshot: the
          // player picked, the server accepted, the intended player appeared
          // on the roster, and the room announced "Time ran out · drafted for
          // you" over the top of it. `resolution` is written by the one place
          // that knows (`mode._commit`), so the message can only appear when
          // the timeout fallback actually chose.
          timedOut: pick.resolution === TMW_RESOLUTION_TIMEOUT,
        });
      }
    }
  }
  if (arrivals.length === 0) return null;
  const yours = arrivals.find((a) => a.seat === you);
  const pick = source === "command" && yours ? yours : arrivals[arrivals.length - 1];
  const who = pick.seat === you ? "You" : seatLabel(next.seats, pick.seat);
  const handsToYou = pick.seat !== you && handedToYouAfterPick(prev, next);
  return {
    id,
    kind: pick.timedOut ? "timeout" : "pick",
    title: `${pick.name} → ${slotAbbrev(pick.slot)}`,
    detail: pick.timedOut
      ? "Time ran out · drafted for you"
      : `${who} · Round ${pick.round}${handsToYou ? " · You're up" : ""}`,
    tone: pick.timedOut ? "negative" : pick.seat === you ? "accent" : "neutral",
    // The handoff moment stays up for the beat and a little past the
    // overlay opening (where the scrim covers it), never shorter than it.
    durationMs: handsToYou ? TMW_PREVIOUS_PICK_BEAT_MS + 600 : undefined,
  };
}

/**
 * Did THIS snapshot hand you the pick turn on the back of another seat's
 * pick? True only for the mid-round handoff -- previous seat picks, you are
 * next -- read off the two snapshots: their roster gained a card, the open
 * turn moved from not-yours to yours. A round boundary goes through the
 * ceremony instead and never matches; a reload lands as "initial" and never
 * matches either.
 */
function handedToYouAfterPick(prev: TmwMatchView, next: TmwMatchView): boolean {
  const you = next.your_seat_index;
  if (you === null) return false;
  if (!isYourTurn(next) || isYourTurn(prev)) return false;
  if (next.turn_phase && next.turn_phase !== "pick") return false;
  return next.public_state.rosters.some((after) => {
    if (after.seat_index === you) return false;
    const before = prev.public_state.rosters.find((r) => r.seat_index === after.seat_index);
    return TMW_SLOT_TYPES.some((slot) => after.slots[slot] && !before?.slots[slot]);
  });
}

function picksIn(state: TmwPublicState): number {
  return state.rosters.reduce(
    (total, roster) => total + Object.values(roster.slots).filter(Boolean).length,
    0,
  );
}

/**
 * THREE-MAN WEAVE, driven entirely by the server.
 *
 * SERVER-AUTHORITATIVE: every action POSTs and this component replaces its
 * whole room object with the response. Nothing here decides legality, scores
 * a roster, ranks a seat or advances a turn -- it renders what the server
 * projected for THIS seat and sends back commands.
 *
 * THE INTERACTION CONTRACT (game-feel reconstruction), in four rules:
 *
 *   1. ONE SNAPSHOT PER RENDER. See `Room`.
 *   2. NEWER WINS, OLDER IS DROPPED. `applyView` applies a response only if
 *      its `state_version` is newer than what is on screen (`isNewer`), so a
 *      poll that was issued before a command and lands after it cannot roll
 *      the board back -- the race that used to make the NEXT command fail
 *      with a stale version.
 *   3. COMMANDS ARE SERIALIZED, NEVER DROPPED. Every command goes through one
 *      `useCommandLane`. A "Draft" press issued while a background stage
 *      request is still in flight waits for it and then runs against the
 *      version current at THAT moment; it is never silently ignored (the
 *      root cause of "the first click does nothing"). An exclusive command
 *      (pick, rearrange, replay) cannot be queued twice, which is what "one
 *      click, one action" means at the transport layer.
 *   4. THE TIMELINE IS THE SERVER'S. The briefing and the ceremony are short
 *      seatless server turns; the room renders whichever is open against the
 *      turn's published `turn_elapsed_seconds`, never against a local timer,
 *      and offers no way to end either early. A late-joining client lands at
 *      the correct point in the sequence.
 */
export default function ThreeManWeaveGame({
  initialMatch,
}: {
  initialMatch: TmwMatchView;
}) {
  const router = useRouter();
  const [room, setRoom] = useState<Room>(() => roomFrom(initialMatch, null));
  /** The last room applied, readable synchronously inside a command. */
  const latest = useRef<Room>(room);
  const [results, setResults] = useState<ArenaResultView[] | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  /** See `StagedArrangement`. Null whenever the board is showing the server. */
  const [staged, setStaged] = useState<StagedArrangement | null>(null);
  const lane = useCommandLane();
  /** When the read that handed this seat the pick landed; reported once the
   *  pick surface is actually open. See `lib/game-feel/action-timing`. */
  const handoffSince = useRef<number | null>(null);
  const match = room.match;
  const state = match.public_state;

  const applyView = useCallback(
    (next: TmwMatchView, source: Source, kind: string | null = null): boolean => {
      const prev = latest.current;
      const newer = isNewer(
        { version: prev.match.state_version, phase: prev.match.turn_phase },
        { version: next.state_version, phase: next.turn_phase },
      );
      if (!newer) {
        // A poll that changed nothing changes nothing -- except a clock that
        // has drifted far enough (a suspended tab) to be worth correcting.
        const fresh = deadlineFromSeconds(next.seconds_remaining);
        const freshTurn = deadlineFromSeconds(next.turn_seconds_remaining);
        if (driftExceeded(prev.deadlineAt, fresh) || driftExceeded(prev.turnDeadlineAt, freshTurn)) {
          const corrected = { ...prev, deadlineAt: fresh, turnDeadlineAt: freshTurn };
          latest.current = corrected;
          setRoom(corrected);
        }
        return false;
      }
      const moment = describeTransition(prev.match, next, source, kind);
      if (source === "poll" && !isYourTurn(prev.match) && isYourTurn(next)) {
        handoffSince.current = typeof performance !== "undefined" ? performance.now() : null;
      }
      const beat =
        source === "poll" && moment?.kind === "pick" && handedToYouAfterPick(prev.match, next)
          ? `beat:${next.state_version}`
          : null;
      const nextRoom = roomFrom(next, moment, beat);
      latest.current = nextRoom;
      setRoom(nextRoom);
      return true;
    },
    [],
  );

  // -- the previous-pick beat: a hold on the overlay, never on the state ---
  const reducedMotion = usePrefersReducedMotion();
  const previousPickBeat = room.previousPickBeat;
  const endBeat = useCallback((id: string) => {
    setRoom((current) => (current.previousPickBeat === id ? { ...current, previousPickBeat: null } : current));
    if (latest.current.previousPickBeat === id) latest.current = { ...latest.current, previousPickBeat: null };
  }, []);
  useEffect(() => {
    if (!previousPickBeat) return;
    const id = previousPickBeat;
    const hold = reducedMotion ? 0 : TMW_PREVIOUS_PICK_BEAT_MS;
    const timer = window.setTimeout(() => endBeat(id), hold);
    // A press anywhere -- pointer or keyboard -- opens the surface at once.
    const press = () => endBeat(id);
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("keydown", press, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("keydown", press, true);
    };
  }, [previousPickBeat, reducedMotion, endBeat]);

  const phase = phaseOf(match);
  const complete = phase === "complete";
  const briefing = isBriefing(match);
  const arriving = isArriving(match);
  const revealing = isRevealing(match);
  const yourTurn = isYourTurn(match);

  // -- polling: recovery and reconciliation -------------------------------
  //
  // ONE READ AT A TIME (game-feel pass 4). This was a `setInterval`, which does
  // not wait for the previous read: on a 750 ms connection reads overlapped,
  // filled the browser's per-host connection pool, and a poll took 2.2 s at the
  // median and 5 s at p95 -- with every command queued behind them. The next
  // read is now armed only after the previous one settled (`pollEpoch`), and
  // it is TIMED by what the room is waiting for: a seatless beat's own
  // deadline, the instant the server says a bot's move is due, or the ordinary
  // safety cadence.
  const [pollEpoch, setPollEpoch] = useState(0);
  const refresh = useCallback(async () => {
    // Never race a command: its response is newer by construction and is
    // applied the instant it lands.
    if (lane.busyNow()) {
      setPollEpoch((n) => n + 1);
      return;
    }
    try {
      const next = (await getMatch(latest.current.match.match_id)) as TmwMatchView;
      applyView(next, "poll");
      setFailures(0);
    } catch {
      // Counted, not thrown: a transport failure must not clear the board.
      setFailures((count) => count + 1);
    } finally {
      setPollEpoch((n) => n + 1);
    }
  }, [applyView, lane]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const retryStep = useRef(0);
  const scheduledFor = useRef("");
  useEffect(() => {
    if (complete) return;
    const key = `${match.state_version}:${match.turn_seq ?? ""}:${match.turn_phase ?? ""}`;
    if (scheduledFor.current !== key) {
      scheduledFor.current = key;
      retryStep.current = 0;
    }
    const step = retryStep.current;
    retryStep.current += 1;
    let delay: number;
    if (briefing || revealing) {
      const left = match.turn_seconds_remaining ?? match.seconds_remaining ?? null;
      delay =
        !arriving && step === 0 && left !== null
          ? Math.min(POLL_SEATLESS_MS, left * 1000 + SEATLESS_SLACK_MS)
          : POLL_SEATLESS_MS;
    } else if (match.bot_reply_in_seconds !== null && match.bot_reply_in_seconds !== undefined) {
      delay =
        step === 0
          ? match.bot_reply_in_seconds * 1000 + BOT_REPLY_SLACK_MS
          : BOT_RETRY_LADDER_MS[Math.min(step - 1, BOT_RETRY_LADDER_MS.length - 1)];
    } else {
      delay = yourTurn ? POLL_OWN_TURN_MS : POLL_OPPONENT_MS;
    }
    const timer = window.setTimeout(() => void refreshRef.current(), Math.max(40, delay));
    return () => window.clearTimeout(timer);
  }, [
    pollEpoch,
    complete,
    briefing,
    revealing,
    arriving,
    yourTurn,
    match.state_version,
    match.turn_seq,
    match.turn_phase,
    match.bot_reply_in_seconds,
    match.turn_seconds_remaining,
    match.seconds_remaining,
  ]);

  useEffect(() => {
    // A BACKGROUNDED TAB IS THROTTLED, so the first frame back may be stale.
    const wake = () => {
      if (document.visibilityState === "visible") void refreshRef.current();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, []);

  useEffect(() => {
    if (!complete || results) return;
    let cancelled = false;
    getMatchResults(match.match_id)
      .then((response) => {
        if (!cancelled) setResults(response.results);
      })
      .catch(() => {
        /* the result screen simply waits for the next attempt */
      });
    return () => {
      cancelled = true;
    };
  }, [complete, results, match.match_id]);

  // -- commands: one lane, one snapshot per response -----------------------
  const send = useCallback(
    async (commandType: string, payload: Record<string, unknown>, kind: string) => {
      // READ AT SEND TIME, NOT AT PRESS TIME. A command queued behind another
      // executes against the version that is current when it actually runs.
      const current = latest.current.match;
      if (current.your_seat_index === null) return null;
      // A COMMAND THAT NEVER ANSWERS MUST NOT HOLD THE LANE FOREVER. The lane
      // is exclusive while a pick is pending, and polling pauses behind it;
      // a request lost to the network would otherwise leave "Drafting…" on
      // screen for good. After the guard the press reads as an error, the
      // lane frees, and the next poll reconciles whatever actually landed
      // (the idempotency key makes a retry a replay, never a second draft).
      const response = await Promise.race([
        submitCommand(
          current.match_id,
          commandType,
          payload,
          current.state_version,
          // Derived from the action rather than random, so a retry after a
          // dropped response is recognised as a replay instead of acting twice.
          commandIdempotencyKey(current.match_id, current.your_seat_index, current.state_version, commandType, payload),
        ),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () => reject(new ArenaAPIError(0, "The server took too long to answer.", "network_error")),
            COMMAND_TIMEOUT_MS,
          ),
        ),
      ]);
      applyView(response.match as TmwMatchView, "command", kind);
      setFailures(0);
      return response;
    },
    [applyView],
  );

  const describe = (error: unknown, action: string): string => {
    if (error instanceof ArenaAPIError) {
      return error.code === "network_error" ? `Could not reach the server — ${action}.` : error.detail;
    }
    return "Something went wrong.";
  };

  /**
   * STAGE `slots` FOR THIS SEAT AT ONCE, so the press is visible in its own
   * frame. Returns nothing: the caller sends its command as usual, and the
   * authoritative snapshot that answers it retires the stage.
   */
  const stageArrangement = useCallback((roster: TmwRoster, pending: TmwSlotType[]) => {
    const current = latest.current.match;
    if (current.your_seat_index === null) return;
    setStaged({
      baseVersion: current.state_version,
      seatIndex: current.your_seat_index,
      roster,
      pending,
    });
  }, []);

  /**
   * COMMIT A PICK. Exclusive: a second press while one is pending is refused
   * by the lane before anything runs. Queued behind any in-flight stage, so
   * the press is never dropped -- it waits, then drafts exactly what is on
   * screen. Resolves `true` on acceptance so the button can lock.
   */
  const pick = useCallback(
    async (candidate: TmwCandidate, slotType: TmwSlotType): Promise<boolean> => {
      setRejection(null);
      const payload: Record<string, unknown> = {
        player_slug: candidate.player_slug,
        slot_type: slotType,
      };
      // THE SERVER'S OWN PLAN, ECHOED BACK. When a pick needs a rearrangement
      // the arrangement committed is the one the projection said was legal.
      if (candidate.fit.plan) payload.placements = candidate.fit.plan;
      const timer = startActionTimer(latest.current.match.mode, "pick");
      // A DRAFT SUPERSEDES ANY STAGING NOT YET SENT: the pick carries the choice.
      if (stageTimer.current !== null) {
        window.clearTimeout(stageTimer.current);
        stageTimer.current = null;
        lastStageIntent.current = "";
      }
      if (lane.cancel("stage") > 0) lastStageIntent.current = "";
      // THE CARD LANDS ON THE COURT IN THE SAME FRAME AS THE PRESS, without a
      // score -- the season and the PEAK3 number are the server's to state.
      const snapshot = latest.current.match;
      const before = snapshot.public_state.rosters.find(
        (entry) => entry.seat_index === snapshot.your_seat_index,
      );
      if (before && snapshot.your_seat_index !== null) {
        const provisional = provisionalPick(
          candidate,
          slotType,
          snapshot.your_seat_index,
          snapshot.public_state.current_round ?? 0,
        );
        const plan =
          (candidate.fit.plan as Record<string, string> | null) ?? {
            ...Object.fromEntries(
              TMW_SLOT_TYPES.filter((s) => before.slots[s]).map((s) => [
                s,
                before.slots[s]!.player_slug,
              ]),
            ),
            [slotType]: candidate.player_slug,
          };
        const after = rosterWithPlacements(before, plan, provisional);
        stageArrangement(after, changedSlots(before, after));
      }
      try {
        const response = await lane.run("pick", () => send(TMW_COMMAND_PICK, payload, "pick"));
        if (response === null) return false;
        timer.responded(serverTimingOf(response));
        timer.settled(response.accepted || response.replayed ? "accepted" : "refused");
        if (response.accepted || response.replayed) return true;
        setRejection(response.message ?? "That pick was refused.");
        return false;
      } catch (error) {
        timer.settled("failed");
        setRejection(describe(error, "your pick was not sent"));
        setFailures((count) => count + 1);
        return false;
      } finally {
        setStaged(null);
      }
    },
    [lane, send, stageArrangement],
  );

  /**
   * STAGE (or clear) the not-yet-committed choice, server-side. NOT A COMMIT.
   * Non-exclusive and coalesced: rapid selection changes send at most the
   * latest intent, and a pick pressed meanwhile queues behind it rather than
   * being refused. Skipped entirely when the server already holds this exact
   * intent. Failures are swallowed: staging is a convenience for the timeout
   * path (`mode._reduce_timeout`), never the commit.
   */
  const lastStageIntent = useRef<string>("");
  const stageTimer = useRef<number | null>(null);
  const stage = useCallback(
    async (candidate: TmwCandidate | null, slotType: TmwSlotType | null) => {
      const intent = candidate && slotType ? `${candidate.player_slug}@${slotType}` : "clear";
      if (intent === lastStageIntent.current) return;
      lastStageIntent.current = intent;
      const payload: Record<string, unknown> =
        candidate && slotType ? { player_slug: candidate.player_slug, slot_type: slotType } : { clear: true };
      if (stageTimer.current !== null) {
        window.clearTimeout(stageTimer.current);
        stageTimer.current = null;
      }
      const dispatch = () => {
        stageTimer.current = null;
        void lane
          .run(
            "stage",
            async () => {
              const staged = latest.current.match.private_state.staged_pick ?? null;
              const already = staged ? `${staged.player_slug}@${staged.slot_type}` : "clear";
              if (already === intent) return null;
              if (!canPick(latest.current.match)) return null;
              const timer = startActionTimer(latest.current.match.mode, "stage");
              try {
                const response = await send(TMW_COMMAND_STAGE_PICK, payload, "stage");
                timer.responded(serverTimingOf(response));
                timer.settled(response && (response.accepted || response.replayed) ? "accepted" : "refused");
                return response;
              } catch (error) {
                timer.settled("failed");
                throw error;
              }
            },
            { exclusive: false, coalesce: "stage" },
          )
          .catch(() => {
            // Best-effort -- see docstring above.
          });
      };
      // SETTLED SELECTIONS ONLY. A player browsing the list, or pressing Draft
      // straight after choosing, sends no staging request at all; a choice left
      // on the board is staged after `STAGE_SETTLE_MS`, or at once when the
      // clock is nearly out so the timeout still drafts it.
      const deadline = latest.current.deadlineAt;
      const urgent =
        deadline !== null && typeof performance !== "undefined" && deadline - performance.now() < STAGE_URGENT_MS;
      if (urgent) dispatch();
      else stageTimer.current = window.setTimeout(dispatch, STAGE_SETTLE_MS);
    },
    [lane, send],
  );
  useEffect(
    () => () => {
      if (stageTimer.current !== null) window.clearTimeout(stageTimer.current);
    },
    [],
  );

  /**
   * ARRIVAL: TELL THE SERVER THE BRIEFING IS ON THIS SCREEN.
   *
   * The briefing's clock does not start at match creation any more; it starts
   * when every human seat's client has reported having it on screen. This
   * runs after the commit that rendered the briefing (effects follow paint),
   * sends once, and re-arms only if the report did not land -- a duplicate is
   * refused by name on the server and changes nothing.
   */
  const arrivalSent = useRef(false);
  const mayReportArrival = arriving && match.legal_commands.includes(TMW_COMMAND_INTRO_SEEN);
  useEffect(() => {
    if (!mayReportArrival || arrivalSent.current) return;
    arrivalSent.current = true;
    void lane
      .run(
        "intro_seen",
        async () => {
          const timer = startActionTimer(latest.current.match.mode, "intro_seen");
          try {
            const response = await send(TMW_COMMAND_INTRO_SEEN, {}, "intro_seen");
            timer.responded(serverTimingOf(response));
            timer.settled(response && (response.accepted || response.replayed) ? "accepted" : "refused");
            return response;
          } catch (error) {
            timer.settled("failed");
            throw error;
          }
        },
        { exclusive: false },
      )
      .then((response) => {
        if (!response || !(response.accepted || response.replayed)) arrivalSent.current = false;
      })
      .catch(() => {
        arrivalSent.current = false;
      });
  }, [mayReportArrival, lane, send]);

  // A new turn is a new decision: forget the last staged intent so the same
  // selection can be staged again next turn.
  useEffect(() => {
    lastStageIntent.current = "";
  }, [match.turn_seq, match.current_turn_seat_index, state.current_round]);

  const rearrange = useCallback(
    async (placements: Record<string, string>): Promise<boolean> => {
      const timer = startActionTimer(latest.current.match.mode, "rearrange");
      setRejection(null);
      // THE BOARD MOVES ON THE PRESS. The arrangement is the one the command
      // carries, re-seating cards the server already validated; it is marked
      // pending and replaced by whatever the server answers.
      const before = latest.current.match.public_state.rosters.find(
        (entry) => entry.seat_index === latest.current.match.your_seat_index,
      );
      if (before) {
        const after = rosterWithPlacements(before, placements);
        stageArrangement(after, changedSlots(before, after));
      }
      try {
        const response = await lane.run("rearrange", () => send(TMW_COMMAND_REARRANGE, { placements }, "rearrange"));
        if (response === null) return false;
        timer.responded(serverTimingOf(response));
        timer.settled(response.accepted || response.replayed ? "accepted" : "refused");
        if (response.accepted || response.replayed) return true;
        setRejection(response.message ?? "That move was refused.");
        return false;
      } catch (error) {
        timer.settled("failed");
        setRejection(describe(error, "the move was not sent"));
        return false;
      } finally {
        // Whatever happened, the board goes back to the server's own answer.
        setStaged(null);
      }
    },
    [lane, send, stageArrangement],
  );

  const hasBots = match.seats.some((seat) => seat.is_bot);

  /**
   * PLAY AGAIN IS ANOTHER GAME, NOT A UTILITY SCREEN.
   *
   * Against bots: a fresh practice match is created and the route is
   * REPLACED with its own id, so the loader mounts a brand-new room (keyed by
   * match id -- nothing from this one survives: no selection, no moment, no
   * poll). The new match opens on its own server-timed briefing, so the
   * next thing on screen is the intro, then the first roll. A multiplayer
   * table has no rematch primitive yet, so Play Again returns everyone to
   * the lobby with this game preselected -- the rematch-ready room.
   */
  const playAgain = useCallback(async (): Promise<boolean> => {
    const result = await lane.run("replay", async () => {
      if (hasBots) {
        // The same ruleset again: a Franchise or Decade Draft rematches as one.
        const created = await createPracticeMatch(match.mode || TMW_MODE);
        router.replace(`/arena/three-man-weave/${created.match_id}`);
        return true;
      }
      router.push(`/arena/lobby?game=${match.mode || TMW_MODE}`);
      return true;
    });
    return result === true;
  }, [hasBots, lane, router, match.mode]);

  const connection = connectionState(failures);
  const candidates = useMemo(() => candidatesForSeat(match), [match]);
  const lockedEntries = useMemo(() => identityLock(state), [state]);
  const stagedPick = match.private_state.staged_pick ?? null;

  /**
   * WHAT THE BOARD DRAWS: the server's own state, with this seat's in-flight
   * arrangement laid over it while (and only while) the room is still showing
   * the version that arrangement was staged against. One newer snapshot from
   * any source -- the command's own answer, a poll, a rejection -- and the
   * overlay stops applying, which is what makes a refused move roll back
   * without any undo path. Every other seat is untouched.
   */
  const liveStage = staged && staged.baseVersion === match.state_version ? staged : null;
  const viewState = useMemo<TmwPublicState>(() => {
    if (!liveStage) return state;
    return {
      ...state,
      rosters: state.rosters.map((entry) =>
        entry.seat_index === liveStage.seatIndex ? liveStage.roster : entry,
      ),
    };
  }, [state, liveStage]);
  const pendingSlots = liveStage?.pending ?? [];

  const yourRoster =
    viewState.rosters.find((roster) => roster.seat_index === match.your_seat_index) ?? null;
  const picksMade = picksIn(state);

  // THE WHOLE RULE: the ceremony surface is open exactly while the server
  // says a seatless phase is -- the briefing or the reveal. Every seat.
  const ceremonyOpen = (briefing || revealing) && !complete;
  // The previous-pick beat holds only the OVERLAY shut. Your turn, your
  // clock and every command are live underneath it.
  const overlayOpen = !ceremonyOpen && yourTurn && !complete && canPick(match) && previousPickBeat === null;
  useEffect(() => {
    if (!overlayOpen || handoffSince.current === null) return;
    reportHandoff(match.mode, handoffSince.current);
    handoffSince.current = null;
  }, [overlayOpen, match.mode]);

  // A Franchise or Decade Draft shows its own rules in the same room.
  const meta = modeMeta(match.mode) ?? modeMeta(TMW_MODE);
  const pendingKind = lane.pending;
  const busy = pendingKind === "pick" || pendingKind === "rearrange" || pendingKind === "replay";

  // WHO PICKS WHEN THE CEREMONY ENDS. The seatless turns name no seat; the
  // snapshot's `current_seat` is the seat the server will hand the pick to.
  const upNextSeat = match.current_turn_seat_index ?? state.current_seat;
  const nextUp =
    upNextSeat === null || complete
      ? null
      : upNextSeat === match.your_seat_index
        ? "You're up"
        : `${seatLabel(match.seats, upNextSeat)} is up`;

  // No viewport containment any more: the page scrolls and the board's turn
  // strip is `position: sticky` (see PeakV2TMWCourts), so nothing here needs
  // to measure or publish a height.

  const clearMoment = useCallback((id: string) => {
    setRoom((current) => (current.moment?.id === id ? { ...current, moment: null } : current));
    if (latest.current.moment?.id === id) latest.current = { ...latest.current, moment: null };
  }, []);

  return (
    <div
      className="ar-room tmw-room"
      data-arena="live"
      data-testid="tmw-room"
      // The server's own phase, on the room, so a browser test can assert what
      // is on screen AGAINST what the server said rather than against a timer.
      data-turn-phase={match.turn_phase ?? "none"}
      data-turn-seq={match.turn_seq ?? undefined}
      data-beat={previousPickBeat ? "previous-pick" : undefined}
    >
      <PeakV2Shell width="live-wide">
        <header
          className="flex flex-wrap items-center justify-between gap-3 pb-3"
          style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <h1
              className="text-2xl font-bold"
              style={{ fontFamily: "var(--v2-font-display)", color: "var(--v2-text-primary)" }}
            >
              Three-Man Weave
            </h1>
            <StatusChip tone="neutral">{match.rated ? "Rated" : "Unrated"}</StatusChip>
            {hasBots && (
              <StatusChip tone="neutral" data-testid="tmw-bot-badge">
                vs bots
              </StatusChip>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {meta ? <HowToPlay title={meta.name} rules={meta.rules} testId="tmw-rules" /> : null}
          </div>
        </header>

        {connection !== "live" && (
          <p
            data-testid="tmw-connection"
            data-connection={connection}
            role="status"
            className="pk-depth pk-crown mt-3 rounded-lg px-3 py-2.5 text-sm"
            style={{ border: "1px solid var(--v2-border-subtle)", color: "var(--v2-text-secondary)" }}
          >
            {connection === "reconnecting"
              ? "Reconnecting… the board below is the last state we confirmed."
              : "You appear to be offline. The match is still running on the server; this board will catch up when the connection returns."}
          </p>
        )}

        {rejection && (
          <p
            data-testid="tmw-rejection"
            role="alert"
            className="pk-depth pk-crown mt-3 rounded-lg px-3 py-2.5 text-sm"
            style={{ border: "1px solid var(--v2-border-subtle)", color: "var(--v2-text-secondary)" }}
          >
            {rejection}
          </p>
        )}
      </PeakV2Shell>

      {complete && results ? (
        <PeakV2TMWResult
          results={results}
          rosters={state.rosters}
          yourSeatIndex={match.your_seat_index}
          seed={match.match_id}
          onPlayAgain={playAgain}
          playAgainPending={pendingKind === "replay"}
          multiplayer={!hasBots}
          modeName={meta?.name}
        />
      ) : (
        // `relative` so the ceremony overlay and every moment are anchored to
        // THIS box: the courts stay mounted and are its only size contributor.
        <div className="relative" data-testid="tmw-v2-arena-shell">
          <PeakV2TMWCourts
            state={viewState}
            pendingSlots={pendingSlots}
            seats={match.seats}
            yourSeatIndex={match.your_seat_index}
            currentTurnSeatIndex={match.current_turn_seat_index}
            deadlineAt={room.deadlineAt}
            turnDeadlineAt={room.turnDeadlineAt}
            turnTotalSeconds={room.turnTotalSeconds}
            // The roll is not the board's to state until the ceremony has
            // actually shown it.
            rollRevealed={!ceremonyOpen}
            picksMade={picksMade}
            totalPicks={state.total_rounds * match.seat_count}
            onMove={rearrange}
            busy={busy}
            // THE DECISION SURFACE sits under the turn strip, above the
            // courts, in the page's own flow (see PickOverlay).
            decision={
              <PickOverlay
                open={overlayOpen}
                roll={state.current_roll}
                roundNumber={state.current_round}
                pickNumber={picksMade + 1}
                totalRounds={state.total_rounds}
                candidates={candidates}
                roster={yourRoster}
                seats={match.seats}
                yourSeatIndex={match.your_seat_index}
                lockedEntries={lockedEntries}
                stagedPick={stagedPick}
                deadlineAt={room.deadlineAt}
                turnSeconds={room.turnTotalSeconds ?? TMW_TURN_SECONDS}
                busy={busy}
                pendingKind={pendingKind}
                pendingSlots={pendingSlots}
                onPick={pick}
                onStage={stage}
                onMove={rearrange}
                onClose={() => setRejection(null)}
              />
            }
          >
            <IdentityLockPanel entries={lockedEntries} seats={match.seats} />
          </PeakV2TMWCourts>
          <PeakV2TMWReveal
            open={ceremonyOpen}
            phase={briefing ? "intro" : "reveal"}
            turnKey={`${match.match_id}:${match.turn_seq ?? state.current_roll?.roll_id ?? "none"}:${match.turn_phase ?? ""}`}
            roll={state.current_roll}
            roundNumber={state.current_round}
            totalRounds={state.total_rounds}
            seats={match.seats}
            yourSeatIndex={match.your_seat_index}
            seatCount={match.seat_count}
            constraint={state.constraint ?? null}
            upNextSeatIndex={upNextSeat === null || complete ? null : upNextSeat}
            handoffLabel={nextUp ?? undefined}
            arriving={arriving}
            startedAt={room.turnStartedAt}
            totalSeconds={room.turnTotalSeconds ?? (briefing ? TMW_INTRO_SECONDS : TMW_REVEAL_SECONDS)}
          />
          {/* THE MOMENT THIS SNAPSHOT ANNOUNCES -- never over the ceremony,
              which has its own round card. */}
          {!ceremonyOpen ? (
            <EventMoment
              moment={room.moment}
              onDone={clearMoment}
              testId="tmw-moment"
              className={previousPickBeat ? "tmw-moment--handoff" : undefined}
            />
          ) : null}
          {/* THE PREVIOUS-PICK BEAT'S OWN CUE: a quiet line naming the hold
              and the way past it. A press anywhere ends the beat. */}
          {previousPickBeat && !complete ? (
            <button
              type="button"
              className="tmw-previous-pick-beat"
              data-testid="tmw-previous-pick-beat"
              data-beat="previous-pick"
              onClick={() => endBeat(previousPickBeat)}
            >
              <span className="tmw-previous-pick-beat-label">You&apos;re up</span>
              <span className="tmw-previous-pick-beat-hint">Opening your pick · press to open now</span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
