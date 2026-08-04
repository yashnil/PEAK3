"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  newIdempotencyKey,
  twentyDollarApi,
  TwentyDollarAPIError,
  waitingLabel,
  type TwentyDollarMatchView,
} from "@/lib/twenty-dollar-api";
import { modeMeta } from "@/lib/arena-modes";
import HowToPlay from "@/components/arena/HowToPlay";
import {
  AuctionHistory,
  BudgetMeter,
  CandidateCard,
  LotReveal,
  LotTicker,
  RosterBoard,
} from "./AuctionBoard";
import BidControls from "./BidControls";
import TwentyDollarReceipt, {
  buildShowdownShareText,
  type TwentyDollarReceiptData,
} from "./TwentyDollarReceipt";

/**
 * One $20 Showdown match — the auction room.
 *
 * SERVER-AUTHORITATIVE, LOCAL `useState`. No Redux, no Zustand: the entire
 * client state is "the last view the server sent", the pattern RTT and
 * head-to-head already use. There is no local reducer mirroring the rules,
 * because a second copy of the rules is a second thing that can disagree with
 * the first.
 *
 * THE CLOCK IS THE SERVER'S, AND ONLY THE ACTIVE SEAT HAS ONE
 * ------------------------------------------------------------
 * `seconds_remaining` is sent to exactly one seat -- the one whose turn is
 * open -- and it is a DURATION, so a client with a skewed wall clock still
 * counts down correctly. Three rules follow, and all three are the fix for the
 * reported "a lot advanced before I could bid":
 *
 *   1. THE COUNTDOWN IS DISPLAY ONLY. It never triggers a submission, never
 *      disables a control, and reaching zero locally does nothing. The server
 *      owns the timeout; a client that raced it would be a client that could
 *      pass on its own behalf a moment early.
 *   2. A MISSING OR STALE DEADLINE IS NOT A PASS. `null` means "not your turn",
 *      which is exactly when there is nothing to count. The old surface treated
 *      an absent clock as a live one and rendered a zeroed timer on a turn the
 *      player had never been given.
 *   3. THE TIMER RESTARTS ON `state_version`, not on every render. A poll that
 *      returns the same state leaves the countdown where it is, so it decreases
 *      smoothly instead of jittering back up every two seconds.
 *
 * WHY THIS POLLS. There is no realtime transport anywhere in this codebase.
 * Polling the same authenticated route a human refresh would hit reuses the
 * whole projection and permission model unchanged, and it is what makes the
 * opponent's move -- and a bot's -- appear without a background worker. It
 * stops the moment the match completes.
 */

const POLL_MS = 2000;

export default function TwentyDollarGame({ matchId }: { matchId: string }) {
  const [view, setView] = useState<TwentyDollarMatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailure, setLoadFailure] = useState<TwentyDollarAPIError | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Held across retries so a resubmitted click is a REPLAY server-side rather
  // than a second bid. Cleared only when an action completes.
  const pendingKey = useRef<string | null>(null);
  // Guards a poll landing while a command is in flight from overwriting the
  // newer state the command already returned.
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    try {
      const next = await twentyDollarApi.getMatch(matchId);
      if (inFlight.current) return;
      setView(next);
      setLoadFailure(null);
    } catch (err) {
      const apiError = err as TwentyDollarAPIError;
      setLoadFailure((current) => current ?? apiError);
      setError(
        apiError.status === 0 ? "Could not reach the PEAK3 API." : apiError.message,
      );
    }
  }, [matchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const complete = view?.public_state?.phase === "complete";

  // Poll while the match is live. Cleared on unmount and on completion, so a
  // finished match does not keep a timer alive behind a receipt.
  useEffect(() => {
    if (!view || complete) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [view, complete, load]);

  // Re-seed the countdown ONLY when the authoritative state moves. See rule 3
  // in this module's docstring.
  const stateVersion = view?.state_version ?? -1;
  const serverSeconds = view?.seconds_remaining ?? null;
  useEffect(() => {
    setCountdown(serverSeconds);
  }, [stateVersion, serverSeconds]);

  // Local tick, purely so the number moves between polls. It decides nothing.
  useEffect(() => {
    if (countdown === null || complete) return;
    const id = window.setInterval(() => {
      setCountdown((value) => (value === null ? null : Math.max(0, value - 1)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [countdown, complete]);

  const submit = useCallback(
    async (command: "bid" | "pass", amount: number) => {
      if (!view || busy) return;
      setBusy(true);
      setError(null);
      inFlight.current = true;
      if (!pendingKey.current) pendingKey.current = newIdempotencyKey();
      try {
        const result = await twentyDollarApi.submitCommand(
          matchId,
          command,
          command === "bid" ? { amount } : {},
          view.state_version,
          pendingKey.current,
        );
        if (!result.accepted && !result.replayed) {
          // The server's own message, not a rewritten one: it names the real
          // constraint (a bid ceiling, a roster that could not be completed,
          // a turn that had already moved on).
          setError(result.rejection_message || "That move was not accepted.");
        }
        setView(result.match);
        pendingKey.current = null;
      } catch (err) {
        const apiError = err as TwentyDollarAPIError;
        setError(
          apiError.status === 0
            ? "Could not reach the PEAK3 API. Your bid was not sent."
            : apiError.message,
        );
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [matchId, view, busy],
  );

  const meta = modeMeta("twenty_dollar");

  // ---- gates -------------------------------------------------------------

  if (loadFailure && !view) {
    const notYours = loadFailure.status === 403;
    return (
      <div className="ar-error" role="alert" data-testid="td-match-error">
        <p className="ar-error-code">{notYours ? "Not your seat" : "Match not found"}</p>
        <h1 className="ar-error-title">
          {notYours
            ? "This auction belongs to someone else"
            : "We could not find that auction"}
        </h1>
        <p className="ar-error-body">
          {notYours
            ? "Only the two bidders seated in a match can open it. If a friend sent you a room code, join from the multiplayer lobby instead."
            : "That match id does not resolve. Matches expire after two hours, so a link copied from an old session may have outlived its game."}
        </p>
        <div className="ar-panel-actions">
          <Link className="ar-btn ar-btn-primary" href="/arena/lobby">
            Back to multiplayer
          </Link>
          <Link className="ar-btn" href="/arena">
            Every PEAK3 game
          </Link>
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="ar-room">
        <p className="ar-notice" data-testid="td-loading">
          Loading the auction…
        </p>
      </div>
    );
  }

  const publicState = view.public_state;
  const privateState = view.private_state;
  const yourSeat = view.your_seat_index;
  const seatNames =
    publicState.seat_names ?? view.seats.map((s) => s.display_name);
  const lastLot =
    publicState.history.length > 0
      ? publicState.history[publicState.history.length - 1]
      : null;
  const receipt = publicState.receipt as TwentyDollarReceiptData | undefined;

  return (
    <div className="td-game ar-room" data-testid="td-game">
      <header className="ar-room-head">
        <div className="ar-room-meta">
          <h1 className="ar-room-title">The $20 Showdown</h1>
          <span className="ar-badge">
            Lot {Math.min(publicState.lot_index + 1, publicState.max_lots)}
          </span>
          <span className="ar-badge">{view.rated ? "Rated" : "Unrated"}</span>
        </div>
        <div className="ar-room-tools">
          {meta ? (
            <HowToPlay title={meta.name} rules={meta.rules} testId="td-rules" />
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="td-error" role="alert" data-testid="td-error">
          {error}
        </p>
      ) : null}

      {/* Both budgets, both roster panels, and the block in the middle. The
          desktop layout puts the whole game on one screen; below the grid
          breakpoint the columns stack in reading order (you, the block, your
          opponent). */}
      <div className="td-table">
        <div className="td-column">
          {publicState.seats.map((seat) => (
            <BudgetMeter
              key={seat.seat_index}
              seat={seat}
              isYou={seat.seat_index === yourSeat}
              isActive={publicState.active_seat === seat.seat_index}
              isOpener={publicState.opening_seat === seat.seat_index}
              label={
                seat.seat_index === yourSeat
                  ? "You"
                  : (seatNames[seat.seat_index] ?? "Opponent")
              }
            />
          ))}
          <RosterBoard
            seat={publicState.seats[yourSeat ?? 0]}
            slots={publicState.slots}
            label="Your five"
          />
        </div>

        <div className="td-column td-column-centre">
          {!complete ? (
            <>
              <CandidateCard
                publicState={publicState}
                fits={privateState.candidate_fits}
                seatNames={seatNames}
                yourSeat={yourSeat}
                secondsRemaining={countdown}
              />
              <LotTicker
                actions={publicState.lot_actions}
                seatNames={seatNames}
                yourSeat={yourSeat}
              />
              <p className="td-waiting" data-testid="td-waiting" aria-live="polite">
                {waitingLabel(publicState, yourSeat, seatNames)}
              </p>
              <BidControls
                publicState={publicState}
                privateState={privateState}
                seatNames={seatNames}
                busy={busy}
                onSubmit={submit}
              />
            </>
          ) : null}

          {lastLot ? (
            <LotReveal lot={lastLot} seatNames={seatNames} yourSeat={yourSeat} />
          ) : null}
        </div>

        <div className="td-column">
          {publicState.seats
            .filter((seat) => seat.seat_index !== yourSeat)
            .map((seat) => (
              <RosterBoard
                key={seat.seat_index}
                seat={seat}
                slots={publicState.slots}
                label={`${seatNames[seat.seat_index] ?? "Opponent"}'s five`}
              />
            ))}
          <AuctionHistory
            history={publicState.history}
            seatNames={seatNames}
            yourSeat={yourSeat}
          />
        </div>
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
    </div>
  );
}
