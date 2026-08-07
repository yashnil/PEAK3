"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ArenaResultView,
  TmwMatchView,
  TmwSlotType,
} from "@/types/three-man-weave";
import { TMW_COMMAND_PICK, TMW_COMMAND_REARRANGE } from "@/types/three-man-weave";
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
 * THE REVEAL/CLOCK RACE, AND HOW IT WAS REMOVED (SHARED-01, TMW-06)
 * ================================================================
 * WHAT IT WAS. `WeaveSpinner` owned a client `setTimeout` for the 2270ms
 * ceremony and this component gated the pick overlay on the callback it fired.
 * The server stamps the 45-second turn deadline when the turn OPENS -- the same
 * reducer output that reveals the roll (`mode.py`, `_open_round` +
 * `open_turn`) -- so on the first pick of every round the player lost roughly
 * 2.3 seconds, plus up to one 2000ms poll, of a clock that was visibly counting
 * down behind an overlay that would not open. A ceremony cannot be allowed to
 * spend a decision window that is already running.
 *
 * THE FIX IS A RULE, NOT A SHORTER TIMER:
 *
 *     THE CEREMONY IS MOUNTED ONLY WHILE NO HUMAN DECISION WINDOW IS OPEN.
 *
 * `ceremonyOpen` is derived from the server's own turn state on every render,
 * so:
 *
 *   * when a bot leads the round (two seats in three, and every round the snake
 *     hands to a bot) the full-focus ceremony plays over the dimmed board
 *     inside the bot's 4-10 second think window and costs nobody anything;
 *   * when the HUMAN leads the round the ceremony never mounts at all. The pick
 *     surface opens on the same frame the turn does, with zero client-side
 *     delay, and the franchise x decade reveal animates inside its own header
 *     (`PickOverlay`, `.tmw-overlay-title`) with every control live;
 *   * if a bot resolves faster than the ceremony (a short seeded think time,
 *     a fast poll), the arrival of the human's turn unmounts the ceremony on
 *     the very next render rather than making them wait it out.
 *
 * Nothing downstream waits for `onRevealComplete`; it only records that the
 * ceremony for this roll has been shown.
 *
 * WHAT WOULD BE BETTER, AND WHY IT IS NOT HERE. A real server-side reveal
 * phase -- `deadline_at` stamped after the reveal rather than at `_open_round`,
 * with the phase reconstructible on reconnect -- is the correct end state and
 * is what SHARED-01 asks for. It requires moving the deadline in
 * `apps/api/app/services/three_man_weave/mode.py`, which is owned by the
 * correctness workstream in this pass. The rule above is not a smaller version
 * of that fix; it is a different one, and it is airtight against the specific
 * defect: a client ceremony can never overlap a running human clock, because
 * the two are mutually exclusive by construction.
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
  /** The roll whose opening ceremony has already been shown (or skipped). */
  const [ceremonyShownFor, setCeremonyShownFor] = useState<string | null>(null);

  // Guards a poll landing while a command is in flight from overwriting the
  // newer state the command already returned.
  const inFlight = useRef(false);

  const phase = phaseOf(match);
  const complete = phase === "complete";
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
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [complete, refresh]);

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

  const rollId = state.current_roll?.roll_id ?? null;

  // THE ONE RULE THAT REMOVES THE RACE. See the module docstring: the ceremony
  // exists only while no human decision window is open.
  const ceremonyOpen =
    !!rollId && !complete && !yourTurn && ceremonyShownFor !== rollId;

  // Your turn arriving retires this roll's ceremony immediately -- both so it
  // unmounts mid-animation when a bot resolves fast, and so it cannot reappear
  // later in the same round when the clock moves on to another seat.
  useEffect(() => {
    if (rollId && yourTurn && ceremonyShownFor !== rollId) {
      setCeremonyShownFor(rollId);
    }
  }, [rollId, yourTurn, ceremonyShownFor]);

  const overlayOpen = yourTurn && !complete && canPick(match);

  const meta = modeMeta("three_man_weave");
  const hasBots = match.seats.some((seat) => seat.is_bot);
  const nextUp =
    match.current_turn_seat_index === null
      ? null
      : match.current_turn_seat_index === match.your_seat_index
        ? "You're up"
        : `${seatLabel(match.seats, match.current_turn_seat_index)} is up`;

  return (
    <div className="ar-room tmw-room" data-testid="tmw-room">
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
            onRevealComplete={() => setCeremonyShownFor(rollId)}
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
