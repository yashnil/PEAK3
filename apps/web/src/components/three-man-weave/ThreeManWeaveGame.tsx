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
  TMW_REVEAL_SECONDS,
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
import IdentityLockPanel from "./IdentityLockPanel";
import PickOverlay from "./PickOverlay";
import PodiumReceipt from "./PodiumReceipt";
import RosterBoard from "./RosterBoard";
import TurnStatus from "./TurnStatus";
import WeaveSpinner from "./WeaveSpinner";

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

  // Guards a poll landing while a command is in flight from overwriting the
  // newer state the command already returned.
  const inFlight = useRef(false);

  const phase = phaseOf(match);
  const complete = phase === "complete";
  const revealing = isRevealing(match);
  const state = match.public_state;

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    try {
      const next = await getMatch(match.match_id);
      if (!inFlight.current) {
        setMatch(next as TmwMatchView);
        setDeadlineAt(deadlineFromSeconds(next.seconds_remaining));
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
        setMatch(response.match as TmwMatchView);
        setDeadlineAt(deadlineFromSeconds(response.match.seconds_remaining));
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

  // ...and therefore the decision surface is closed while it is. `canPick`
  // already subtracts the reveal phase; `revealing` is repeated here because
  // this is the line a future reader will check, and it should state the rule
  // rather than depend on a helper doing so.
  const overlayOpen = !revealing && yourTurn && !complete && canPick(match);

  const meta = modeMeta("three_man_weave");
  const hasBots = match.seats.some((seat) => seat.is_bot);
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
      className="ar-room tmw-room"
      data-testid="tmw-room"
      // The server's own phase, on the room, so a browser test can assert what
      // is on screen AGAINST what the server said rather than against a timer.
      data-turn-phase={match.turn_phase ?? "none"}
    >
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
            showIntro={picksMade === 0 && state.current_round === 1}
            // THE CEREMONY'S CLOCK IS THE SERVER'S. Both of these come from the
            // reveal turn, so a reload mid-ceremony resumes at the right beat.
            deadlineAt={deadlineAt}
            revealSeconds={TMW_REVEAL_SECONDS}
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

function describe(error: unknown, action: string): string {
  if (error instanceof ArenaAPIError) {
    return error.code === "network_error"
      ? `Could not reach the server — ${action}.`
      : error.detail;
  }
  return "Something went wrong.";
}
