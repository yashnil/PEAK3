"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  newIdempotencyKey,
  twentyDollarApi,
  TwentyDollarAPIError,
  waitingLabel,
  type TwentyDollarMatchView,
} from "@/lib/twenty-dollar-api";
import {
  AuctionHistory,
  BudgetMeter,
  CandidateCard,
  RosterBoard,
  RoundReveal,
  TiePriorityToken,
} from "./AuctionBoard";
import BidControls from "./BidControls";
import TwentyDollarReceipt, {
  buildShowdownShareText,
  type TwentyDollarReceiptData,
} from "./TwentyDollarReceipt";

/**
 * One $20 Showdown match.
 *
 * SERVER-AUTHORITATIVE, LOCAL `useState`. No Redux, no Zustand -- the entire
 * client state is "the last view the server sent", which is the pattern RTT and
 * head-to-head already use. There is no local reducer mirroring the rules,
 * because a second copy of the rules is a second thing that can disagree with
 * the first.
 *
 * WHY THIS POLLS. A sealed-bid round is simultaneous: this seat needs to learn
 * that the other seat locked, and there is no realtime transport anywhere in
 * this codebase (verified -- zero WebSocket/SSE/Realtime call sites). Polling
 * against the same authenticated route a human refresh would hit reuses the
 * whole projection and permission model unchanged. It stops the moment the
 * match completes, and while this seat is waiting for its own turn it is the
 * only thing driving the board forward.
 *
 * The poll interval is deliberately not a countdown: `seconds_remaining` comes
 * from the server on every view, so the clock displayed is the server's, not a
 * local timer that could drift and let a player believe they had time they did
 * not.
 */

const POLL_MS = 2000;

export default function TwentyDollarGame({ matchId }: { matchId: string }) {
  const [view, setView] = useState<TwentyDollarMatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Held across retries so a resubmitted click is a REPLAY server-side rather
  // than a second bid. Cleared only when an action completes.
  const pendingKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await twentyDollarApi.getMatch(matchId));
      setError(null);
    } catch (err) {
      const apiError = err as TwentyDollarAPIError;
      setError(
        apiError.status === 0
          ? "Could not reach the PEAK3 API."
          : apiError.message,
      );
    }
  }, [matchId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while the match is live. Cleared on unmount and on completion, so a
  // finished match does not keep a timer alive behind a receipt.
  useEffect(() => {
    if (!view || view.public_state?.phase === "complete") return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [view, load]);

  const submit = useCallback(
    async (command: "bid" | "pass", amount: number) => {
      if (!view) return;
      setBusy(true);
      setError(null);
      if (!pendingKey.current) pendingKey.current = newIdempotencyKey();
      try {
        const result = await twentyDollarApi.submitCommand(
          matchId,
          command,
          command === "bid" ? { amount } : {},
          view.state_version,
          pendingKey.current,
        );
        if (!result.accepted) {
          // The server's own message, not a rewritten one: it names the real
          // constraint (a bid ceiling, a roster that could not be completed).
          setError(result.rejection_message || "That move was not accepted.");
        } else {
          setView(result.match);
        }
        pendingKey.current = null;
      } catch (err) {
        const apiError = err as TwentyDollarAPIError;
        setError(
          apiError.status === 0
            ? "Could not reach the PEAK3 API. Your bid was not sent."
            : apiError.message,
        );
      } finally {
        setBusy(false);
      }
    },
    [matchId, view],
  );

  if (error && !view) {
    return (
      <p className="td-error" role="alert" data-testid="td-error">
        {error}
      </p>
    );
  }
  if (!view) {
    return (
      <p className="td-loading" data-testid="td-loading">
        Loading the auction…
      </p>
    );
  }

  const publicState = view.public_state;
  const privateState = view.private_state;
  const yourSeat = view.your_seat_index;
  const seatNames =
    publicState.seat_names ?? view.seats.map((s) => s.display_name);
  const lastRound =
    publicState.history.length > 0
      ? publicState.history[publicState.history.length - 1]
      : null;
  const complete = publicState.phase === "complete";
  const receipt = (view as unknown as { receipt?: TwentyDollarReceiptData }).receipt;

  return (
    <div className="td-game" data-testid="td-game">
      <header className="td-header">
        <h1 className="td-title">The $20 Showdown</h1>
        <TiePriorityToken
          holderSeat={publicState.tie_priority_seat}
          holderName={seatNames[publicState.tie_priority_seat] ?? "the other seat"}
          youHoldIt={publicState.tie_priority_seat === yourSeat}
        />
      </header>

      {error ? (
        <p className="td-error" role="alert" data-testid="td-error">
          {error}
        </p>
      ) : null}

      <div className="td-budgets">
        {publicState.seats.map((seat) => (
          <BudgetMeter
            key={seat.seat_index}
            seat={seat}
            label={seat.seat_index === yourSeat ? "You" : seatNames[seat.seat_index] ?? "Opponent"}
          />
        ))}
      </div>

      {!complete ? (
        <>
          <CandidateCard publicState={publicState} fits={privateState.candidate_fits} />

          <p className="td-waiting" data-testid="td-waiting" aria-live="polite">
            {waitingLabel(publicState, yourSeat)}
            {view.seconds_remaining !== null
              ? ` ${Math.ceil(view.seconds_remaining)}s left.`
              : ""}
          </p>

          <BidControls
            publicState={publicState}
            privateState={privateState}
            disabled={busy || !view.legal_commands.includes("bid")}
            onSubmit={submit}
          />
        </>
      ) : null}

      {complete && lastRound ? (
        <RoundReveal round={lastRound} seatNames={seatNames} yourSeat={yourSeat} />
      ) : null}

      <div className="td-rosters">
        {publicState.seats.map((seat) => (
          <RosterBoard
            key={seat.seat_index}
            seat={seat}
            slots={publicState.slots}
            label={seat.seat_index === yourSeat ? "Your" : `${seatNames[seat.seat_index]}'s`}
          />
        ))}
      </div>

      {complete && receipt ? (
        <>
          <TwentyDollarReceipt receipt={receipt} seatNames={seatNames} yourSeat={yourSeat} />
          <button
            type="button"
            className="td-btn"
            data-testid="td-share"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(buildShowdownShareText(receipt, yourSeat))
                .then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy result"}
          </button>
        </>
      ) : null}

      <AuctionHistory
        history={publicState.history}
        seatNames={seatNames}
        yourSeat={yourSeat}
      />
    </div>
  );
}
