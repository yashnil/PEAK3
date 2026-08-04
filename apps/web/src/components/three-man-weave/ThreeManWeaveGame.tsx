"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ArenaResultView,
  TmwMatchView,
  TmwSlotType,
} from "@/types/three-man-weave";
import { TMW_COMMAND_PICK } from "@/types/three-man-weave";
import {
  ArenaAPIError,
  commandIdempotencyKey,
  getMatch,
  getMatchResults,
  submitCommand,
} from "@/lib/arena-api";
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
import PickPanel from "./PickPanel";
import PodiumReceipt from "./PodiumReceipt";
import RollReveal from "./RollReveal";
import SeatCourt from "./SeatCourt";

/** How often to re-read the match while it is someone else's turn. */
const POLL_MS = 2000;

/**
 * THREE-MAN WEAVE, driven entirely by the server.
 *
 * SERVER-AUTHORITATIVE, exactly like `CourtBuilder` and `RunTheTableGame`:
 * every action POSTs and this component replaces its whole match object with
 * the response. Nothing here decides legality, scores a roster, ranks a seat
 * or advances a turn — it renders what the server projected for THIS seat and
 * sends back commands. Local `useState` only; no Redux, no Zustand.
 *
 * WHY POLLING RATHER THAN A SOCKET. The foundation exposes the match and its
 * event log over plain HTTP and stamps `seconds_remaining` as a DURATION so a
 * client with a skewed clock still counts down correctly. Polling that is a
 * few lines and degrades gracefully; a socket would be a second transport to
 * keep in sync with the same authoritative state. If a live channel arrives
 * later it replaces `refresh()` and nothing else.
 *
 * RECONNECT IS A FIRST-CLASS STATE, not an error. A failed poll is not a
 * refused move — the match may be perfectly healthy while this browser cannot
 * reach it — so consecutive failures escalate "live" -> "reconnecting" ->
 * "offline" and the surface says so, while the last known good projection
 * stays on screen. There is nothing to lose by staying rendered: the server
 * holds the truth and the next successful poll replaces it wholesale.
 *
 * TIMEOUTS ARE THE SERVER'S. This component never resolves one. It shows the
 * countdown the server sent, and when a turn expires the server's clock sweep
 * commits the deterministic auto-pick; the next poll simply shows a board
 * where that seat has picked. A client that raced the sweep would be a client
 * that could forfeit someone else's turn.
 */
export default function ThreeManWeaveGame({ initialMatch }: { initialMatch: TmwMatchView }) {
  const [match, setMatch] = useState<TmwMatchView>(initialMatch);
  const [results, setResults] = useState<ArenaResultView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [justPicked, setJustPicked] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(initialMatch.seconds_remaining);

  // Guards a poll landing while a command is in flight from overwriting the
  // newer state the command already returned.
  const inFlight = useRef(false);

  const phase = phaseOf(match);
  const complete = phase === "complete";

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

  // Poll while the match is live. Stops dead once it completes — a finished
  // match has nothing left to change.
  useEffect(() => {
    if (complete) return;
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [complete, refresh]);

  // Local countdown between polls, purely so the number moves every second.
  // It is re-seeded from the server on every refresh and is never used to
  // decide anything — the authoritative deadline lives on the server.
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
        /* the podium simply waits for the next attempt */
      });
    return () => {
      cancelled = true;
    };
  }, [complete, results, match.match_id]);

  const pick = useCallback(
    async (playerSlug: string, slotType: TmwSlotType) => {
      if (match.your_seat_index === null) return;
      setBusy(true);
      setRejection(null);
      inFlight.current = true;
      const payload = { player_slug: playerSlug, slot_type: slotType };
      try {
        const response = await submitCommand(
          match.match_id,
          TMW_COMMAND_PICK,
          payload,
          match.state_version,
          // Derived from the action rather than random, so a retry after a
          // dropped response is recognised as a replay instead of drafting
          // twice.
          commandIdempotencyKey(
            match.match_id,
            match.your_seat_index,
            match.state_version,
            TMW_COMMAND_PICK,
            payload,
          ),
        );
        setMatch(response.match as TmwMatchView);
        setCountdown(response.match.seconds_remaining);
        setFailures(0);
        if (response.accepted || response.replayed) {
          setJustPicked(playerSlug);
        } else {
          setRejection(response.message ?? "That pick was refused.");
        }
      } catch (error) {
        const message =
          error instanceof ArenaAPIError
            ? error.code === "network_error"
              ? "Could not reach the server — your pick was not sent."
              : error.detail
            : "Something went wrong.";
        setRejection(message);
        setFailures((count) => count + 1);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [match.match_id, match.state_version, match.your_seat_index],
  );

  const state = match.public_state;
  const connection = connectionState(failures);
  const yourTurn = isYourTurn(match);
  const candidates = candidatesForSeat(match);

  const disabledReason = yourTurn
    ? canPick(match)
      ? null
      : "No legal pick for your roster on this roll."
    : complete
      ? "The draft is over."
      : "Waiting for the other seats.";

  const meta = modeMeta("three_man_weave");

  return (
    <div className="ar-room" data-testid="tmw-room">
      {/* Room chrome, so a live draft reads as a PEAK3 surface rather than a
          bare grid of panels. Round-of-six lives in `RollReveal`, which reads
          it from the server -- it is deliberately not restated here, where a
          test could not catch it drifting. */}
      <header className="ar-room-head">
        <div className="ar-room-meta">
          <h1 className="ar-room-title">Three-Man Weave</h1>
          <span className="ar-badge">{match.rated ? "Rated" : "Unrated"}</span>
          {match.seats.some((seat) => seat.is_bot) ? (
            <span className="ar-badge" data-testid="tmw-bot-badge">
              vs PEAK3 Bot
            </span>
          ) : null}
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
          className="rounded border px-3 py-2 text-xs"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
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
          className="rounded border px-3 py-2 text-xs"
          style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
        >
          {rejection}
        </p>
      )}

      {complete && results ? (
        <PodiumReceipt
          results={results}
          rosters={state.rosters}
          yourSeatIndex={match.your_seat_index}
        />
      ) : (
        <>
          <DraftOrderStrip
            order={turnOrder(state, match.seat_count)}
            seats={match.seats}
            yourSeatIndex={match.your_seat_index}
            secondsRemaining={countdown}
          />

          <RollReveal
            roll={state.current_roll}
            roundNumber={state.current_round}
            totalRounds={state.total_rounds}
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <PickPanel
              candidates={candidates}
              busy={busy}
              disabledReason={disabledReason}
              onPick={pick}
            />
            <IdentityLockPanel entries={identityLock(state)} seats={match.seats} />
          </div>
        </>
      )}

      {/* All three rosters, always — a draft is open information, and reading
          what your opponents still need is the whole strategy. */}
      <div className="grid gap-3 md:grid-cols-3" data-testid="tmw-courts">
        {state.rosters.map((roster) => (
          <SeatCourt
            key={roster.seat_index}
            roster={roster}
            seat={match.seats.find((seat) => seat.seat_index === roster.seat_index)}
            isYou={roster.seat_index === match.your_seat_index}
            isOnTurn={!complete && match.current_turn_seat_index === roster.seat_index}
            justPickedSlug={justPicked}
          />
        ))}
      </div>
    </div>
  );
}
