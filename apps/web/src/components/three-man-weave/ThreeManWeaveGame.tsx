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
  candidatesForSeat,
  canPick,
  connectionState,
  identityLock,
  isYourTurn,
  phaseOf,
  turnOrder,
} from "@/lib/three-man-weave-state";
import { modeMeta } from "@/lib/arena-modes";
import HowToPlay from "@/components/arena/HowToPlay";
import DraftOrderStrip from "./DraftOrderStrip";
import IdentityLockPanel from "./IdentityLockPanel";
import MoveDialog from "./MoveDialog";
import PickOverlay from "./PickOverlay";
import PodiumReceipt from "./PodiumReceipt";
import RosterBoard from "./RosterBoard";
import SeatCourt from "./SeatCourt";
import WeaveSpinner from "./WeaveSpinner";

/** How often to re-read the match while it is someone else's turn. */
const POLL_MS = 2000;

/**
 * THREE-MAN WEAVE, driven entirely by the server.
 *
 * SERVER-AUTHORITATIVE, exactly like `CourtBuilder` and `RunTheTableGame`:
 * every action POSTs and this component replaces its whole match object with
 * the response. Nothing here decides legality, scores a roster, ranks a seat or
 * advances a turn -- it renders what the server projected for THIS seat and
 * sends back commands.
 *
 * THE LAYOUT IS THE PRODUCT DECISION. The three rosters are the page; the
 * spinner sits above them and the pick overlay above that. The previous
 * arrangement put a candidate list first and pushed all three courts below the
 * fold, so the thing you were choosing FOR was the thing you had to scroll
 * past. Here the board never moves and never disappears, including while the
 * overlay is open.
 *
 * THE OVERLAY OPENS ONLY AFTER THE SPINNER LANDS. `revealedRoll` gates it, so a
 * player is never asked to choose from a roll they have not been shown -- which
 * is also why the reveal callback and not the animation drives it.
 *
 * WHY POLLING RATHER THAN A SOCKET. The foundation exposes the match and its
 * event log over plain HTTP and stamps `seconds_remaining` as a DURATION so a
 * client with a skewed clock still counts down correctly. Polling that is a few
 * lines and degrades gracefully.
 *
 * TIMEOUTS ARE THE SERVER'S. This component never resolves one. It shows the
 * countdown the server sent; when a turn expires the server's sweep commits the
 * deterministic auto-pick and the next poll simply shows a board where that
 * seat has picked.
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
  const [countdown, setCountdown] = useState<number | null>(
    initialMatch.seconds_remaining,
  );
  const [revealedRoll, setRevealedRoll] = useState<string | null>(null);
  const [moveSlot, setMoveSlot] = useState<TmwSlotType | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

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
        setCountdown(next.seconds_remaining);
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

  // Local countdown between polls, purely so the number moves every second. It
  // is re-seeded from the server on every refresh and is never used to decide
  // anything -- the authoritative deadline lives on the server.
  useEffect(() => {
    if (complete || countdown === null) return;
    const timer = window.setInterval(() => {
      setCountdown((value) => (value === null ? null : Math.max(0, value - 1)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [complete, countdown]);

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
        setCountdown(response.match.seconds_remaining);
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
    [send],
  );

  const rearrange = useCallback(
    async (placements: Record<string, string>) => {
      setBusy(true);
      setMoveError(null);
      try {
        const response = await send(TMW_COMMAND_REARRANGE, { placements });
        if (!response) return;
        if (response.accepted || response.replayed) {
          setMoveSlot(null);
        } else {
          setMoveError(response.message ?? "That move was refused.");
        }
      } catch (error) {
        setMoveError(describe(error, "the move was not sent"));
      } finally {
        setBusy(false);
      }
    },
    [send],
  );

  const connection = connectionState(failures);
  const yourTurn = isYourTurn(match);
  const candidates = useMemo(() => candidatesForSeat(match), [match]);
  const yourRoster =
    state.rosters.find((roster) => roster.seat_index === match.your_seat_index) ??
    null;
  const rollRevealed =
    !!state.current_roll && revealedRoll === state.current_roll.roll_id;
  const overlayOpen = yourTurn && !complete && rollRevealed && canPick(match);
  const picksMade = state.rosters.reduce(
    (total, roster) => total + Object.values(roster.slots).filter(Boolean).length,
    0,
  );

  const meta = modeMeta("three_man_weave");
  const hasBots = match.seats.some((seat) => seat.is_bot);

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
          onPlayAgain={() => router.push("/arena/three-man-weave")}
        />
      ) : (
        <>
          <WeaveSpinner
            roll={state.current_roll}
            roundNumber={state.current_round}
            totalRounds={state.total_rounds}
            onRevealComplete={() =>
              setRevealedRoll(state.current_roll?.roll_id ?? null)
            }
          />

          <DraftOrderStrip
            order={turnOrder(state, match.seat_count)}
            seats={match.seats}
            yourSeatIndex={match.your_seat_index}
            secondsRemaining={countdown}
          />

          <RosterBoard
            state={state}
            seats={match.seats}
            yourSeatIndex={match.your_seat_index}
            currentTurnSeatIndex={match.current_turn_seat_index}
            justPickedSlug={justPicked}
            secondsRemaining={countdown}
            onMoveRequest={(slot) => {
              setMoveError(null);
              setMoveSlot(slot);
            }}
          />

          <IdentityLockPanel entries={identityLock(state)} seats={match.seats} />

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
            secondsRemaining={countdown}
            busy={busy}
            onPick={pick}
            // A turn you must resolve has no cancel, so closing simply returns
            // to the board -- the overlay reopens on the next render because
            // `overlayOpen` is derived from the server's own turn state, and
            // that is the correct behaviour: the clock is still running.
            onClose={() => setRejection(null)}
          />

          <MoveDialog
            open={moveSlot !== null}
            roster={yourRoster}
            fromSlot={moveSlot}
            busy={busy}
            error={moveError}
            onCommit={rearrange}
            onClose={() => {
              setMoveSlot(null);
              setMoveError(null);
            }}
          />
        </>
      )}

      {/* The final board, kept below the receipt so a completed match still
          shows every roster it produced. */}
      {complete && results && (
        <div className="tmw-board-grid" data-testid="tmw-final-courts">
          {state.rosters.map((roster) => (
            <SeatCourt
              key={roster.seat_index}
              roster={roster}
              seat={match.seats.find((seat) => seat.seat_index === roster.seat_index)}
              isYou={roster.seat_index === match.your_seat_index}
              isOnTurn={false}
              justPickedSlug={null}
            />
          ))}
        </div>
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
