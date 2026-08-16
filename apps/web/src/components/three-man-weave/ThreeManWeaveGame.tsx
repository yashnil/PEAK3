"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ArenaResultView,
  TmwMatchView,
  TmwSlotType,
} from "@/types/three-man-weave";
import {
  TMW_COMMAND_PICK,
  TMW_COMMAND_REARRANGE,
  TMW_COMMAND_SKIP_INTRO,
  TMW_COMMAND_SKIP_REVEAL,
  TMW_OPENING_REVEAL_SECONDS,
  TMW_REVEAL_SECONDS,
  TMW_TURN_PHASE_INTRO,
  TMW_TURN_PHASE_REVEAL,
} from "@/types/three-man-weave";
import {
  ArenaAPIError,
  commandIdempotencyKey,
  getMatch,
  getMatchResults,
  submitCommand,
} from "@/lib/arena-api";
import type { TmwCandidate } from "@/lib/three-man-weave-state";
import {
  TMW_TIMEOUT_CONSEQUENCE,
  candidatesForSeat,
  canPick,
  connectionState,
  identityLock,
  isRevealing,
  isYourTurn,
  phaseOf,
  seatLabel,
} from "@/lib/three-man-weave-state";
import { modeMeta } from "@/lib/arena-modes";
import HowToPlay from "@/components/arena/HowToPlay";
import { deadlineFromSeconds } from "@/components/shared/ArenaTimer";
import GameIntro from "@/components/shared/GameIntro";
import IdentityLockPanel from "./IdentityLockPanel";
import PickOverlay from "./PickOverlay";
import PodiumReceipt from "./PodiumReceipt";
import RosterBoard from "./RosterBoard";
import TurnStatus from "./TurnStatus";
import WeaveSpinner from "./WeaveSpinner";

const TMW_INTRO_RULES = [
  { label: "Shared roll", detail: "one real franchise and decade, rolled once for all three drafters" },
  { label: "Snake order", detail: "pick order reverses every round, so nobody drafts last twice" },
  { label: "Beat the clock", detail: "click a legal player before time runs out, or a weak fallback is assigned for you" },
];

/**
 * Has this browser already dismissed the briefing for this specific match?
 *
 * Scoped to `matchId` rather than to the mode in general, so it reads
 * exactly once per match (round 1 of a fresh draft) and never again on a
 * reload/resume mid-draft -- the same "resume is safe" guarantee the rest
 * of this component already gives the server-driven state. Resilient to
 * blocked storage the same way `twenty-dollar-seen.ts` is: a read failure
 * is "not seen yet" (never crashes into showing nothing), a write failure
 * is silently swallowed (the intro just reappears next visit, not a
 * functional bug).
 */
const TMW_INTRO_SEEN_PREFIX = "peak3.tmw.intro-seen.";

function hasSeenIntro(matchId: string): boolean {
  try {
    return window.localStorage.getItem(TMW_INTRO_SEEN_PREFIX + matchId) === "1";
  } catch {
    return false;
  }
}

function markIntroSeen(matchId: string): void {
  try {
    window.localStorage.setItem(TMW_INTRO_SEEN_PREFIX + matchId, "1");
  } catch {
    // Blocked storage: the intro will simply show again next visit.
  }
}

/** How often to re-read the match while it is someone else's turn. */
const POLL_MS = 2000;

/**
 * How often to re-read the match WHILE THE CEREMONY IS RUNNING.
 *
 * The reveal is 3.2 seconds and the ordinary poll is 2 seconds, so at the
 * normal rate the handoff from ceremony to pick panel could be observed up to a
 * full poll late -- a second of dimmed board with nothing happening on it. The
 * faster rate is bounded twice over: it applies only while `turn_phase` is
 * `reveal`, and that phase is at most a few seconds long by the server's own
 * deadline. The interval reverts the moment the phase changes.
 *
 * It is also what ENDS the ceremony. The foundation's clock is swept lazily, on
 * reads (`clock.enforce`), so the player waiting on the reveal is the one whose
 * own polling fires its expiry.
 */
const REVEAL_POLL_MS = 400;

/** The human decision window, in seconds. Matches the mode's own
 *  `turn_seconds`; used only to draw the timer's progress arc, never to decide
 *  anything — the deadline itself is always the server's. */
const TURN_SECONDS = 45;

/**
 * THREE-MAN WEAVE, driven entirely by the server.
 *
 * SERVER-AUTHORITATIVE: every action POSTs and this component replaces its
 * whole match object with the response. Nothing here decides legality, scores a
 * roster, ranks a seat or advances a turn -- it renders what the server
 * projected for THIS seat and sends back commands.
 *
 * THE LAYOUT IS THE PRODUCT DECISION. The three teams are the page; the turn
 * status sits above them and the pick surface above that. There is now exactly
 * ONE turn-status region (TMW-07): the spinner banner, the "X is selecting"
 * band, the "X is scouting / X drafted" tray and the eighteen-chip snake strip
 * (TMW-08) are all gone, and `TurnStatus` carries what they collectively said.
 *
 * ================================================================
 * THE REVEAL IS A SERVER PHASE (SHARED-01, TMW-06)
 * ================================================================
 * WHAT THE DEFECT WAS. `WeaveSpinner` owned a client `setTimeout` for the
 * ~2270ms ceremony and this component gated the pick overlay on the callback it
 * fired, while the server had stamped the 45-second turn deadline when the turn
 * OPENED. On the first pick of every round the player lost the whole ceremony,
 * plus up to one 2000ms poll, off a clock that was visibly counting down behind
 * an overlay that would not open.
 *
 * WHAT THE FIRST REPAIR WAS, AND WHY IT IS GONE. It gated the ceremony on
 * `!yourTurn`: mount it only while no human decision window is open. That did
 * remove the race, by removing the product requirement -- on every round the
 * human led, the ceremony simply never played. It was a workaround for a client
 * timer, and there is no client timer any more.
 *
 * WHAT IT IS NOW. The mode opens a real turn in `phase="reveal"`
 * (`three_man_weave/mode.py`): it belongs to no seat, accepts no command from
 * anybody -- human or bot -- and carries its own deadline. When it expires the
 * foundation's sweep fires a timeout and the mode answers by opening the pick
 * turn with a FULL `TURN_SECONDS` measured from the END of the reveal. So the
 * rule this room follows is now a single line of state:
 *
 *     THE CEREMONY IS OPEN EXACTLY WHILE `turn_phase === "reveal"`.
 *
 * Which means, and each of these is a property the workaround did not have:
 *
 *   * it plays on EVERY round, including round 1 and including the rounds the
 *     human leads, because it no longer costs them a second of their clock;
 *   * it is the same ceremony for all three seats -- `seconds_remaining` is
 *     published to every seat when a turn names none, so all three count the
 *     same beat down;
 *   * a RELOAD MID-CEREMONY resumes it with the time the server says is left.
 *     It is state, not an animation this client happens to be part-way
 *     through, so it is never restarted from full and never skipped;
 *   * the pick overlay cannot open over it, because the phase that opens the
 *     overlay is the phase the ceremony is not.
 *
 * WHY POLLING RATHER THAN A SOCKET. The foundation exposes the match and its
 * event log over plain HTTP and stamps `seconds_remaining` as a DURATION so a
 * client with a skewed clock still counts down correctly.
 *
 * TIMEOUTS ARE THE SERVER'S. This component never resolves one. It shows the
 * countdown the server sent; when a turn expires the server's sweep commits the
 * deterministic fallback and the next poll shows a board where that seat has
 * picked. Reaching zero locks the local controls (`PickOverlay`) and asks for a
 * refresh, and does nothing else.
 */
export default function ThreeManWeaveGame({
  initialMatch,
}: {
  initialMatch: TmwMatchView;
}) {
  const router = useRouter();
  const [match, setMatch] = useState<TmwMatchView>(initialMatch);
  // Gameplay-polish: the shared briefing, shown once per match regardless of
  // how the player reached it (this mode's own lobby, the Arena hub's quick-
  // practice flow, a direct link, a resume). Rendered as an OVERLAY on top of
  // the room below, not as a gate on what mounts -- `WeaveSpinner`'s opening
  // reveal is a real, already-ticking server turn (`TMW_OPENING_REVEAL_
  // SECONDS`), and delaying its mount behind this dialog would decouple its
  // visual ceremony from that clock, exactly the class of bug this pass was
  // told not to recreate. The dialog's focus trap and backdrop already
  // prevent any actual interaction with the room while it's open; the
  // ceremony underneath is free to keep running its own real clock.
  const [introOpen, setIntroOpen] = useState(() => !hasSeenIntro(initialMatch.match_id));
  const [results, setResults] = useState<ArenaResultView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [justPicked, setJustPicked] = useState<string | null>(null);
  // A LOCAL MONOTONIC DEADLINE, not a duration in state. A duration re-seeded
  // from a two-second poll and ticked down locally drifts, so a control could
  // read "3" on a turn the server had already closed. See `ArenaTimer`.
  const [deadlineAt, setDeadlineAt] = useState<number | null>(
    deadlineFromSeconds(initialMatch.seconds_remaining),
  );
  // THE OPEN TURN'S DEADLINE, WHOEVER IS ON IT. Distinct from `deadlineAt`,
  // which is null while somebody else is deciding — that null is why the
  // opponent's wait used to be timed locally and drawn as a count-UP. See
  // `TurnStatus`.
  const [turnDeadlineAt, setTurnDeadlineAt] = useState<number | null>(
    deadlineFromSeconds(initialMatch.turn_seconds_remaining),
  );

  // Guards a poll landing while a command is in flight from overwriting the
  // newer state the command already returned.
  const inFlight = useRef(false);
  /**
   * The last state the client applied, readable without re-arming the poll.
   *
   * `refresh` must be able to compare the response against what is already on
   * screen, and it must NOT take `match` as a dependency to do it: that would
   * re-create the callback on every state change and restart the poll interval
   * with it, so the interval would never actually run to completion during an
   * active turn.
   */
  const applied = useRef<{
    version: number;
    phase: string | null;
    deadlineAt: number | null;
    turnDeadlineAt: number | null;
  }>({
    version: initialMatch.state_version,
    phase: initialMatch.turn_phase ?? null,
    deadlineAt: deadlineFromSeconds(initialMatch.seconds_remaining),
    turnDeadlineAt: deadlineFromSeconds(initialMatch.turn_seconds_remaining),
  });

  const phase = phaseOf(match);
  const complete = phase === "complete";
  const revealing = isRevealing(match);
  const state = match.public_state;

  /**
   * A POLL THAT CHANGED NOTHING MUST CHANGE NOTHING. (TMW-D3)
   *
   * The match object was replaced wholesale on every 2s poll, so `candidates`
   * — a `useMemo` on `match` — produced a brand new array of brand new
   * candidate objects, and the entire pick list re-rendered twice a minute-long
   * turn, under a clock, while the player was aiming at a row. Re-seeding
   * `deadlineAt` from every response did the same thing a second way: a fresh
   * number every two seconds re-ran `ArenaTimer`'s effect and re-rendered every
   * consumer of the deadline.
   *
   * Neither is needed. `state_version` is the server's own answer to "did
   * anything happen", and the deadline is a duration converted at the instant
   * it lands, so two conversions of the same live turn differ only by the round
   * trip. So: replace the match only when the version or the phase actually
   * moved, and re-seed the deadline only when it has drifted far enough to be
   * worth a repaint.
   *
   * THIS IS NOT A CACHE AND IT CANNOT GO STALE. Every real transition — a pick,
   * a timeout sweep, the reveal ending — increments `state_version`, so it is
   * exactly the no-op polls that are dropped.
   */
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    try {
      const next = (await getMatch(match.match_id)) as TmwMatchView;
      if (!inFlight.current) {
        const phase = next.turn_phase ?? null;
        const moved =
          next.state_version !== applied.current.version || phase !== applied.current.phase;
        if (moved) {
          applied.current = { ...applied.current, version: next.state_version, phase };
          setMatch(next);
        }
        const fresh = deadlineFromSeconds(next.seconds_remaining);
        if (driftExceeded(applied.current.deadlineAt, fresh) || moved) {
          applied.current = { ...applied.current, deadlineAt: fresh };
          setDeadlineAt(fresh);
        }
        const freshTurn = deadlineFromSeconds(next.turn_seconds_remaining);
        if (driftExceeded(applied.current.turnDeadlineAt, freshTurn) || moved) {
          applied.current = { ...applied.current, turnDeadlineAt: freshTurn };
          setTurnDeadlineAt(freshTurn);
        }
      }
      setFailures(0);
    } catch {
      // Counted, not thrown: a transport failure must not clear the board.
      setFailures((count) => count + 1);
    }
  }, [match.match_id]);

  useEffect(() => {
    if (complete) return;
    // Faster while the ceremony is running, so the handoff to the pick panel is
    // crisp rather than up to a poll late. Bounded by the phase itself: this
    // effect re-arms at the ordinary rate the moment `revealing` goes false.
    const timer = window.setInterval(refresh, revealing ? REVEAL_POLL_MS : POLL_MS);
    return () => window.clearInterval(timer);
  }, [complete, refresh, revealing]);

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

  const send = useCallback(
    async (commandType: string, payload: Record<string, unknown>) => {
      if (match.your_seat_index === null) return null;
      inFlight.current = true;
      try {
        const response = await submitCommand(
          match.match_id,
          commandType,
          payload,
          match.state_version,
          // Derived from the action rather than random, so a retry after a
          // dropped response is recognised as a replay instead of acting twice.
          commandIdempotencyKey(
            match.match_id,
            match.your_seat_index,
            match.state_version,
            commandType,
            payload,
          ),
        );
        const next = response.match as TmwMatchView;
        const fresh = deadlineFromSeconds(next.seconds_remaining);
        const freshTurn = deadlineFromSeconds(next.turn_seconds_remaining);
        applied.current = {
          version: next.state_version,
          phase: next.turn_phase ?? null,
          deadlineAt: fresh,
          turnDeadlineAt: freshTurn,
        };
        setMatch(next);
        setDeadlineAt(fresh);
        setTurnDeadlineAt(freshTurn);
        setFailures(0);
        return response;
      } finally {
        inFlight.current = false;
      }
    },
    [match.match_id, match.state_version, match.your_seat_index],
  );

  const pick = useCallback(
    async (candidate: TmwCandidate, slotType: TmwSlotType) => {
      // ONE ACTIVE REQUEST AT A TIME (SHARED-02). The controls disable on
      // `busy`, and this is the second half of that promise: a double-submit
      // through a keyboard repeat or a fast double-click cannot start a second
      // command while the first is unresolved.
      if (busy || inFlight.current) return;
      setBusy(true);
      setRejection(null);
      const payload: Record<string, unknown> = {
        player_slug: candidate.player_slug,
        slot_type: slotType,
      };
      // THE SERVER'S OWN PLAN, ECHOED BACK. When a pick needs a rearrangement
      // the arrangement committed is the one the projection said was legal --
      // never a client re-derivation, which could differ and would then be
      // refused at the exact moment a player expected a pick to land.
      if (candidate.fit.plan) payload.placements = candidate.fit.plan;
      try {
        const response = await send(TMW_COMMAND_PICK, payload);
        if (!response) return;
        if (response.accepted || response.replayed) {
          setJustPicked(candidate.player_slug);
        } else {
          setRejection(response.message ?? "That pick was refused.");
        }
      } catch (error) {
        setRejection(describe(error, "your pick was not sent"));
        setFailures((count) => count + 1);
      } finally {
        setBusy(false);
      }
    },
    [busy, send],
  );

  const rearrange = useCallback(
    async (placements: Record<string, string>) => {
      if (busy || inFlight.current) return;
      setBusy(true);
      setRejection(null);
      try {
        const response = await send(TMW_COMMAND_REARRANGE, { placements });
        if (!response) return;
        if (!response.accepted && !response.replayed) {
          // `message` is the field the API actually sends.
          setRejection(response.message ?? "That move was refused.");
        }
      } catch (error) {
        setRejection(describe(error, "the move was not sent"));
      } finally {
        setBusy(false);
      }
    },
    [busy, send],
  );

  /**
   * END THE CEREMONY EARLY.
   *
   * A REAL COMMAND, not a local dismiss: the pick turn does not exist until the
   * reveal turn closes, so hiding the overlay here would hand the player a
   * board that refuses every action. The RESPONSE is returned to the caller
   * rather than swallowed here -- `dismissIntro` is the one place that decides
   * whether a rejection or a dropped request is safe to ignore, because only
   * it knows whether the phase this call was trying to end is gating the only
   * entry point into the room. See `dismissIntro` for why that distinction
   * matters.
   */
  const skipReveal = useCallback(async () => {
    if (busy || inFlight.current) return null;
    setBusy(true);
    try {
      return await send(TMW_COMMAND_SKIP_REVEAL, {});
    } catch {
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, send]);

  /**
   * END THE PRE-MATCH BRIEFING EARLY -- THE AUTHORITATIVE HALF OF THE FIX.
   *
   * Every match now opens on `TMW_TURN_PHASE_INTRO` (see `apps/api/app/
   * services/three_man_weave/mode.py::PHASE_INTRO`): a real, seatless server
   * turn that nothing else -- not the ceremony, not any pick turn -- can
   * begin until it ends. `OPENING_REVEAL_SECONDS` being generously sized was
   * an earlier, INSUFFICIENT attempt at this: it protected a normal-length
   * read and nothing else, whereas the actual requirement is that no length
   * of time spent on this dialog -- one second or arbitrarily long -- may
   * ever consume any of it. This command is a real server call, not a local
   * dismiss, for the same reason `skipReveal` is: hiding the dialog without
   * it would leave the client believing a game had started that the server
   * had not yet begun. The response is returned rather than swallowed -- see
   * `dismissIntro`.
   */
  const skipIntro = useCallback(async () => {
    if (busy || inFlight.current) return null;
    setBusy(true);
    try {
      return await send(TMW_COMMAND_SKIP_INTRO, {});
    } catch {
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, send]);

  /**
   * DISMISSING THE DIALOG SENDS WHICHEVER SEATLESS PHASE IS ACTUALLY OPEN --
   * AND DOES NOT CLOSE THE DIALOG UNTIL THE SERVER CONFIRMS IT MOVED.
   *
   * THE DEADLOCK THIS FIXES (production regression). `markIntroSeen` writes to
   * localStorage FOREVER for this match id, and the dialog's own initial-open
   * state (`useState(() => !hasSeenIntro(...))`) only ever reads that flag
   * once, on mount. The previous version called `markIntroSeen` and closed the
   * dialog THE INSTANT the button was pressed, before the server had answered
   * at all: `skipIntro`/`skipReveal` fired the command and swallowed whatever
   * came back, success or not. A single dropped response, a stale
   * `expected_state_version`, or the `busy`/`inFlight` guard above simply
   * declining to send (a fast double-press) all left `PHASE_INTRO` (or
   * `PHASE_REVEAL`) open on the SERVER while the CLIENT had already thrown
   * away its only door out of it -- the dialog will not reopen on this
   * browser, ever, for this match, and nothing else in the room can act
   * during a seatless phase (`isBriefing`/`isRevealing` gate `canPick`
   * unconditionally). The room then sits exactly as reported: the roll
   * already visible (drawn at match creation), "Rolling the next franchise
   * and decade" (`current_turn_seat_index` is null throughout both seatless
   * phases), "Standing by", and no legal command anywhere -- for up to
   * `INTRO_SECONDS` (30 minutes) until the server's own backstop abandons the
   * match outright.
   *
   * THE FIX. Closing the dialog is now conditioned on the SERVER'S answer,
   * read off the response's own `match.turn_phase` rather than off whether
   * this particular command was the one `accepted`: a rejection can still
   * carry proof the match already moved past the gate (a resolved race with
   * another seat's dismiss, or a replay of an earlier attempt that actually
   * landed), and that must close the dialog exactly as a fresh acceptance
   * would. Only when the authoritative phase is STILL a seatless one does the
   * dialog stay open and mounted -- with `starting` disabling its buttons
   * while a request is in flight, never leaving the player with no door at
   * all. A retry press is always available, and because the mode never
   * caches a REJECTION under a request that never reached the server (a
   * dropped/timed-out fetch), a genuine transport failure heals on the very
   * next press.
   */
  const dismissIntro = useCallback(() => {
    const phaseAtDismiss = match.turn_phase;
    const request =
      phaseAtDismiss === TMW_TURN_PHASE_INTRO
        ? skipIntro()
        : phaseAtDismiss === TMW_TURN_PHASE_REVEAL
          ? skipReveal()
          : null;
    if (request === null) {
      // Nothing to gate on -- the dialog should not normally still be open
      // once the match has left both seatless phases, but closing it is
      // always safe in that case.
      markIntroSeen(initialMatch.match_id);
      setIntroOpen(false);
      return;
    }
    void request.then((response) => {
      // THE DIALOG GATES `PHASE_INTRO` ONLY. Once the authoritative phase has
      // left it -- for "reveal" exactly as much as for "pick" or anything
      // past it -- `GameIntro` has nothing left to do: `WeaveSpinner` already
      // renders the ceremony on its own, gated by `turn_phase` alone (see
      // `ceremonyOpen` below), so leaving this dialog open through "reveal"
      // would stack a second gate over the same phase for no reason.
      const settledPhase = response?.match.turn_phase ?? match.turn_phase;
      if (settledPhase !== TMW_TURN_PHASE_INTRO) {
        markIntroSeen(initialMatch.match_id);
        setIntroOpen(false);
      } else {
        setRejection(
          response?.message ??
            "Could not enter the draft room — check your connection and try again.",
        );
      }
    });
  }, [initialMatch.match_id, match.turn_phase, skipIntro, skipReveal]);

  const connection = connectionState(failures);
  const yourTurn = isYourTurn(match);
  const candidates = useMemo(() => candidatesForSeat(match), [match]);
  const lockedEntries = useMemo(() => identityLock(state), [state]);
  const yourRoster =
    state.rosters.find((roster) => roster.seat_index === match.your_seat_index) ??
    null;
  const picksMade = state.rosters.reduce(
    (total, roster) => total + Object.values(roster.slots).filter(Boolean).length,
    0,
  );

  // THE WHOLE RULE. Not "unless it is your turn", not "unless we already showed
  // it": the ceremony is open exactly while the server says the open turn is
  // the reveal. Every seat, every round.
  const ceremonyOpen = revealing && !complete;
  /** Round one, before anybody has drafted: the ceremony that runs the matchup
   *  card first, and therefore the one the server gave a longer window. */
  const openingCeremony = picksMade === 0 && state.current_round === 1;

  // ...and therefore the decision surface is closed while it is. `canPick`
  // already subtracts the reveal phase; `revealing` is repeated here because
  // this is the line a future reader will check, and it should state the rule
  // rather than depend on a helper doing so.
  const overlayOpen = !revealing && yourTurn && !complete && canPick(match);

  const meta = modeMeta("three_man_weave");
  const hasBots = match.seats.some((seat) => seat.is_bot);
  const introVisual = (
    <div className="tmw-intro-visual" aria-hidden="true">
      {match.seats.map((seat) => (
        <div
          className="tmw-intro-seat"
          key={seat.seat_index}
          data-you={seat.seat_index === match.your_seat_index}
        >
          <span className="tmw-intro-seat-order">{seat.seat_index + 1}</span>
          <span className="tmw-intro-seat-name">
            {seat.seat_index === match.your_seat_index ? "You" : seat.display_name}
          </span>
        </div>
      ))}
      <span className="tmw-intro-clock">⏱</span>
    </div>
  );
  // WHO PICKS WHEN THE CEREMONY ENDS. The reveal turn names no seat, so
  // `current_turn_seat_index` is null throughout it -- and the handoff line is
  // most useful precisely then. The snapshot's `current_seat` is the seat the
  // server will hand the pick turn to, so it answers for both phases.
  const upNextSeat = match.current_turn_seat_index ?? state.current_seat;
  const nextUp =
    upNextSeat === null || complete
      ? null
      : upNextSeat === match.your_seat_index
        ? "You're up"
        : `${seatLabel(match.seats, upNextSeat)} is up`;

  return (
    <div
      // `.pk-atmosphere` is the arena's lighting rig as a class: two
      // floodlights and the court grid, defined once in globals.css. The room
      // is where it belongs -- a draft happens IN a building, and every panel
      // below now sits on a lit floor rather than on a flat page. The grid
      // pitch is widened for this room in `three-man-weave.css`.
      className="ar-room tmw-room pk-atmosphere"
      data-testid="tmw-room"
      // The server's own phase, on the room, so a browser test can assert what
      // is on screen AGAINST what the server said rather than against a timer.
      data-turn-phase={match.turn_phase ?? "none"}
    >
      <GameIntro
        open={introOpen}
        onStart={dismissIntro}
        onSkip={dismissIntro}
        eyebrow="Multiplayer · Rapid draft"
        title="Three-Man Weave"
        objective="Three drafters, six rounds, one shared franchise and decade per round — build the best three-player lineup PEAK3 can rate."
        rules={TMW_INTRO_RULES}
        visual={introVisual}
        accent="var(--comp-rec)"
        startLabel="Enter the draft room"
        // Disabled while `dismissIntro`'s request is in flight -- a second
        // press before the server confirms the phase moved must not fire a
        // second command (see `dismissIntro`).
        starting={busy}
        testId="tmw-game-intro"
      />
      <header className="ar-room-head">
        <div className="ar-room-meta">
          <h1 className="ar-room-title">Three-Man Weave</h1>
          <span className="ar-badge">{match.rated ? "Rated" : "Unrated"}</span>
          {hasBots && (
            <span className="ar-badge" data-testid="tmw-bot-badge">
              vs bots
            </span>
          )}
        </div>
        <div className="ar-room-tools">
          {/* "How to play" is always available, which is what lets the opening
              sequence stay a matchup rather than become a tutorial (TMW-13). */}
          {meta ? (
            <HowToPlay title={meta.name} rules={meta.rules} testId="tmw-rules" />
          ) : null}
        </div>
      </header>

      {connection !== "live" && (
        <p
          data-testid="tmw-connection"
          data-connection={connection}
          role="status"
          className="ar-notice"
        >
          {connection === "reconnecting"
            ? "Reconnecting… the board below is the last state we confirmed."
            : "You appear to be offline. The match is still running on the server; this board will catch up when the connection returns."}
        </p>
      )}

      {rejection && (
        <p data-testid="tmw-rejection" role="alert" className="ar-notice">
          {rejection}
        </p>
      )}

      {complete && results ? (
        <PodiumReceipt
          results={results}
          rosters={state.rosters}
          yourSeatIndex={match.your_seat_index}
          seed={match.match_id}
          onPlayAgain={() => router.push("/arena/three-man-weave")}
        />
      ) : (
        <>
          <WeaveSpinner
            open={ceremonyOpen}
            roll={state.current_roll}
            roundNumber={state.current_round}
            totalRounds={state.total_rounds}
            seats={match.seats}
            yourSeatIndex={match.your_seat_index}
            handoffLabel={nextUp ?? undefined}
            // Round one opens on the matchup: title, the three competitors with
            // you marked, the objective, then the roll (TMW-13).
            showIntro={openingCeremony}
            // THE CEREMONY'S CLOCK IS THE SERVER'S. Both of these come from the
            // reveal turn, so a reload mid-ceremony resumes at the right beat.
            deadlineAt={deadlineAt}
            // THE DENOMINATOR MUST BE THE WINDOW THE SERVER ACTUALLY OPENED.
            // Round one's ceremony carries the matchup card and is longer
            // (`OPENING_REVEAL_SECONDS`); using one number for both would put
            // every stage boundary in the wrong place on one of them.
            revealSeconds={
              openingCeremony ? TMW_OPENING_REVEAL_SECONDS : TMW_REVEAL_SECONDS
            }
            onSkip={skipReveal}
            skipping={busy}
          />

          <TurnStatus
            state={state}
            seats={match.seats}
            currentTurnSeatIndex={match.current_turn_seat_index}
            yourSeatIndex={match.your_seat_index}
            complete={complete}
            pickNumber={picksMade + 1}
            totalPicks={state.total_rounds * match.seat_count}
            deadlineAt={deadlineAt}
            opponentDeadlineAt={turnDeadlineAt}
            turnSeconds={TURN_SECONDS}
            timeoutConsequence={TMW_TIMEOUT_CONSEQUENCE}
            // Expiry is not a resolution -- it is a prompt to go and read the
            // one the server already committed.
            onExpire={() => {
              void refresh();
            }}
          />

          <RosterBoard
            state={state}
            seats={match.seats}
            yourSeatIndex={match.your_seat_index}
            currentTurnSeatIndex={match.current_turn_seat_index}
            justPickedSlug={justPicked}
            onMove={rearrange}
            busy={busy}
          />

          <IdentityLockPanel entries={lockedEntries} seats={match.seats} />

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
            deadlineAt={deadlineAt}
            turnSeconds={TURN_SECONDS}
            busy={busy}
            onPick={pick}
            onMove={rearrange}
            // A turn you must resolve has no cancel, so closing simply returns
            // to the board -- the overlay reopens on the next render because
            // `overlayOpen` is derived from the server's own turn state, and
            // that is the correct behaviour: the clock is still running.
            onClose={() => setRejection(null)}
          />
        </>
      )}
    </div>
  );
}

/**
 * How far two conversions of the same live deadline may differ before the
 * newer one is worth applying, in milliseconds.
 *
 * Both are `performance.now() + seconds_remaining * 1000`, computed one poll
 * apart, so on a healthy connection they differ only by the round trip. Below
 * this the "correction" would move the displayed number by less than the tick
 * it is drawn at, while re-rendering every consumer of the deadline. Above it
 * something real happened — a new turn, a suspended tab, a slow request — and
 * the server's number wins.
 */
const DEADLINE_DRIFT_MS = 750;

function driftExceeded(current: number | null, next: number | null): boolean {
  if (current === null || next === null) return current !== next;
  return Math.abs(next - current) > DEADLINE_DRIFT_MS;
}

function describe(error: unknown, action: string): string {
  if (error instanceof ArenaAPIError) {
    return error.code === "network_error"
      ? `Could not reach the server — ${action}.`
      : error.detail;
  }
  return "Something went wrong.";
}
