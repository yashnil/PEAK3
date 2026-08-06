"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  newIdempotencyKey,
  twentyDollarApi,
  TwentyDollarAPIError,
  timeoutConsequence,
  waitingLabel,
  type TwentyDollarMatchView,
} from "@/lib/twenty-dollar-api";
import { explainRejection, type AttemptedAction } from "@/lib/arena-rejection";
import { modeMeta } from "@/lib/arena-modes";
import HowToPlay from "@/components/arena/HowToPlay";
import ArenaTimer, { deadlineFromSeconds } from "@/components/shared/ArenaTimer";
import {
  BudgetMeter,
  CandidateCard,
  LotReveal,
  LotTicker,
  RosterBoard,
} from "./AuctionBoard";
import { MissedLotsSummary, SettledLotTray, useLotVisibility } from "./LotLedger";
import BidControls from "./BidControls";
import ShowdownResult from "./ShowdownResult";
import TwentyDollarReceipt, {
  buildShowdownShareText,
  type TwentyDollarReceiptData,
} from "./TwentyDollarReceipt";

/**
 * One $20 Showdown match — the auction room.
 *
 * SERVER-AUTHORITATIVE, LOCAL `useState`. The entire client state is "the last
 * view the server sent", the pattern RTT and head-to-head already use. There is
 * no local reducer mirroring the rules, because a second copy of the rules is a
 * second thing that can disagree with the first.
 *
 * WHAT WENT WRONG HERE, AND WHAT CHANGED
 * ---------------------------------------
 * A player bid `$2` on Stephen Curry, was told "That move was not accepted",
 * and watched the lot settle to the bot for `$1`. Three separate defects, all
 * in this file's neighbourhood:
 *
 *   1. THE ERROR TEXT WAS ALWAYS GENERIC. The API returns the explanation under
 *      `message`; this component read `result.rejection_message`, which does
 *      not exist on the response, so the `||` fallback fired on 100% of
 *      rejections. The server was saying "This match has moved on (you sent
 *      version 1, it is now 2)" and the player was shown a shrug.
 *      `explainRejection` now turns the code plus the returned authoritative
 *      state into the sentence the player actually needs — which lot closed,
 *      who got the player, for how much.
 *   2. THE ERROR NEVER CLEARED. `error` was reset only at the start of the next
 *      submission, so a stale banner sat over subsequent lots. It now clears on
 *      any authoritative transition, and can be dismissed.
 *   3. THE COUNTDOWN WAS STALE BY DESIGN. It was re-seeded from a poll up to
 *      2 s old and ticked locally from there, so a control could read "3" on a
 *      turn that had already expired. It is now converted to a local monotonic
 *      deadline the instant a response lands, and lives in `ArenaTimer` — which
 *      also means a second no longer rerenders the whole board. The server side
 *      of the same fix is `clock.ACTION_GRACE_SECONDS`.
 *
 * THE CLOCK IS STILL THE SERVER'S, AND STILL DECIDES NOTHING HERE. Reaching
 * zero locally stops offering an action that cannot succeed and says "settling"
 * — it never submits, never passes, and never resolves a turn.
 *
 * WHY THIS POLLS. There is no realtime transport anywhere in this codebase.
 * Polling the same authenticated route a human refresh would hit reuses the
 * whole projection and permission model unchanged, and it is what makes a bot's
 * move appear without a background worker. It stops when the match completes.
 */

const POLL_MS = 2000;

export default function TwentyDollarGame({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [view, setView] = useState<TwentyDollarMatchView | null>(null);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [loadFailure, setLoadFailure] = useState<TwentyDollarAPIError | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [locallyExpired, setLocallyExpired] = useState(false);
  // A local monotonic deadline rather than a duration in state. See
  // `ArenaTimer`'s docstring for why a re-seeded duration drifts.
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);

  // Held across retries so a resubmitted click is a REPLAY server-side rather
  // than a second bid. Cleared only when an action completes.
  const pendingKey = useRef<string | null>(null);
  // Guards a poll landing while a command is in flight from overwriting the
  // newer state the command already returned.
  const inFlight = useRef(false);
  // The highest authoritative version this client has applied. A response that
  // is older than what is already on screen is DROPPED rather than rendered:
  // two overlapping requests can complete out of order, and the newer state
  // must win regardless of arrival order.
  const appliedVersion = useRef(-1);

  /**
   * Apply an authoritative view, unless it is older than what is on screen.
   * The single place `view` is written, so the monotonicity rule cannot be
   * bypassed by a new call site.
   */
  const applyView = useCallback((next: TwentyDollarMatchView) => {
    if (next.state_version < appliedVersion.current) return false;
    const advanced = next.state_version > appliedVersion.current;
    appliedVersion.current = next.state_version;
    setView(next);
    setDeadlineAt(deadlineFromSeconds(next.seconds_remaining));
    setLocallyExpired(false);
    // ERRORS CLEAR ON AN AUTHORITATIVE TRANSITION. A rejection explains a
    // moment; once the board has moved past that moment the explanation is
    // history, and leaving it up is the "generic banner that stayed for the
    // rest of the match" defect in a politer form.
    if (advanced) setError(null);
    return true;
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    try {
      const next = await twentyDollarApi.getMatch(matchId);
      if (inFlight.current) return;
      applyView(next);
      setLoadFailure(null);
    } catch (err) {
      const apiError = err as TwentyDollarAPIError;
      setLoadFailure((current) => current ?? apiError);
      setError({
        message:
          apiError.status === 0
            ? "Could not reach the PEAK3 API. The board below is the last state we confirmed."
            : apiError.message,
        code: apiError.code ?? null,
      });
    }
  }, [matchId, applyView]);

  useEffect(() => {
    void load();
  }, [load]);

  const complete = view?.public_state?.phase === "complete";

  // Poll while the match is live. Cleared on unmount and on completion, so a
  // finished match does not keep a timer alive behind a receipt.
  useEffect(() => {
    if (!view || complete) return;
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [view, complete, load]);

  const submit = useCallback(
    async (command: "bid" | "pass", amount: number) => {
      if (!view || busy) return;
      const attempt: AttemptedAction = {
        command,
        amount,
        lotIndex: view.public_state.lot_index,
        standingBid: view.public_state.current_bid,
        wouldSpendSkip: view.private_state.pass_consumes_skip,
      };
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
        // The authoritative state lands FIRST, so the explanation below is
        // derived from the board as it now is rather than from the stale render
        // the click was made against.
        applyView(result.match);
        if (!result.accepted && !result.replayed) {
          // `message` — the field the API actually sends. Reading
          // `rejection_message` here is what discarded every explanation the
          // server ever produced.
          const explained = explainRejection(
            result.rejection_code,
            result.message,
            attempt,
            result.match.public_state,
            result.match.public_state.seat_names ??
              result.match.seats.map((seat) => seat.display_name),
            result.match.your_seat_index,
          );
          setError({ message: explained.message, code: explained.code });
        }
        pendingKey.current = null;
      } catch (err) {
        const apiError = err as TwentyDollarAPIError;
        setError({
          message:
            apiError.status === 0
              ? `Could not reach the PEAK3 API — your ${command === "bid" ? "bid" : "pass"} was not sent. It is safe to try again.`
              : apiError.message,
          code: apiError.code ?? null,
        });
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [matchId, view, busy, applyView],
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

  return (
    <AuctionRoom
      view={view}
      meta={meta}
      error={error}
      busy={busy}
      deadlineAt={deadlineAt}
      locallyExpired={locallyExpired}
      copied={copied}
      onExpire={() => setLocallyExpired(true)}
      onDismissError={() => setError(null)}
      onSubmit={submit}
      onCopy={setCopied}
      onPlayAgain={() => router.push("/arena")}
    />
  );
}

/**
 * The room itself, split out so `useLotVisibility` can key off a state that is
 * guaranteed to exist. Hooks cannot run behind the loading gates above.
 */
function AuctionRoom({
  view,
  meta,
  error,
  busy,
  deadlineAt,
  locallyExpired,
  copied,
  onExpire,
  onDismissError,
  onSubmit,
  onCopy,
  onPlayAgain,
}: {
  view: TwentyDollarMatchView;
  meta: ReturnType<typeof modeMeta>;
  error: { message: string; code: string | null } | null;
  busy: boolean;
  deadlineAt: number | null;
  locallyExpired: boolean;
  copied: boolean;
  onExpire: () => void;
  onDismissError: () => void;
  onSubmit: (command: "bid" | "pass", amount: number) => void;
  onCopy: (value: boolean) => void;
  onPlayAgain: () => void;
}) {
  const publicState = view.public_state;
  const privateState = view.private_state;
  const yourSeat = view.your_seat_index;
  const complete = publicState.phase === "complete";
  const seatNames = useMemo(
    () => publicState.seat_names ?? view.seats.map((s) => s.display_name),
    [publicState.seat_names, view.seats],
  );
  const receipt = publicState.receipt as TwentyDollarReceiptData | undefined;
  const { missed, reveal, acknowledge } = useLotVisibility(view.match_id, publicState);

  const yourTurn = privateState.is_your_turn && !complete;
  const opponentSeats = useMemo(
    () => publicState.seats.filter((seat) => seat.seat_index !== yourSeat),
    [publicState.seats, yourSeat],
  );
  const yourSeatPublic = publicState.seats[yourSeat ?? 0];

  if (complete && receipt) {
    return (
      <div className="td-game ar-room" data-testid="td-game">
        <ShowdownResult
          receipt={receipt}
          publicState={publicState}
          seatNames={seatNames}
          yourSeat={yourSeat}
          onPlayAgain={onPlayAgain}
        >
          <TwentyDollarReceipt receipt={receipt} seatNames={seatNames} yourSeat={yourSeat} />
          <button
            type="button"
            className="td-btn"
            data-testid="td-share"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(buildShowdownShareText(receipt, yourSeat))
                .then(() => onCopy(true));
            }}
          >
            {copied ? "Copied" : "Copy result"}
          </button>
        </ShowdownResult>
      </div>
    );
  }

  return (
    <div className="td-game ar-room" data-testid="td-game">
      <header className="ar-room-head">
        <div className="ar-room-meta">
          <h1 className="ar-room-title">The $20 Showdown</h1>
          <span className="ar-badge" data-testid="td-lot-badge">
            Lot {Math.min(publicState.lot_index + 1, publicState.max_lots)}
          </span>
          {/* THE MARKET PHASE IS NAMED. A player whose roster is still short
              after the standard market needs to know the board has changed its
              rules — it now guarantees them a usable candidate on a bounded
              schedule — rather than noticing the lot numbers went past 24. */}
          <span
            className="ar-badge"
            data-testid="td-market-phase"
            data-phase={publicState.market_phase}
          >
            {publicState.market_phase === "closeout"
              ? "Closeout market"
              : `Standard market · ${publicState.standard_market_lots} lots`}
          </span>
          <span className="ar-badge">{view.rated ? "Rated" : "Unrated"}</span>
        </div>
        <div className="ar-room-tools">
          {meta ? <HowToPlay title={meta.name} rules={meta.rules} testId="td-rules" /> : null}
        </div>
      </header>

      {/* THE ERROR IS DISMISSIBLE AND SELF-CLEARING. It also says what it is:
          a board that moved on reads differently from a move that was illegal,
          and `explainRejection` has already decided which. */}
      {error ? (
        <div className="td-error" role="alert" data-testid="td-error" data-code={error.code ?? ""}>
          <p className="td-error-text">{error.message}</p>
          <button
            type="button"
            className="td-error-dismiss"
            data-testid="td-error-dismiss"
            onClick={onDismissError}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {missed.length > 0 ? (
        <MissedLotsSummary
          lots={missed}
          seatNames={seatNames}
          yourSeat={yourSeat}
          onDismiss={acknowledge}
        />
      ) : null}

      {/* THREE SYMMETRICAL COLUMNS. Both participants get the same panel with
          the same fields in the same order — PART 19's "do not allocate
          structurally different information to the two participants". The
          settled history is no longer one of those fields; it is a full-width
          tray below, so it cannot compress the opponent's roster. */}
      <div className="td-table">
        <div className="td-column td-column-seat">
          <BudgetMeter
            seat={yourSeatPublic}
            skipAllowance={publicState.market_skips_per_seat}
            isYou
            isActive={publicState.active_seat === yourSeat}
            isOpener={publicState.opening_seat === yourSeat}
            label="You"
          />
          <RosterBoard seat={yourSeatPublic} slots={publicState.slots} label="Your five" />
        </div>

        <div className="td-column td-column-centre">
          <CandidateCard
            publicState={publicState}
            fits={privateState.candidate_fits}
            seatNames={seatNames}
            yourSeat={yourSeat}
          />

          {/* THE TIMER IS ITS OWN COMPONENT, ATTACHED TO THE ACTIVE SEAT, and
              says what expiry will cost before it costs it. */}
          <ArenaTimer
            deadlineAt={deadlineAt}
            totalSeconds={20}
            label={
              yourTurn
                ? "YOUR TURN"
                : publicState.active_seat === null
                  ? "Settling the lot"
                  : `${seatNames[publicState.active_seat] ?? "Opponent"} is deciding`
            }
            consequence={
              yourTurn ? timeoutConsequence(privateState, seatNames, publicState) : null
            }
            yours={yourTurn}
            onExpire={onExpire}
            testId="td-timer"
          />

          {/* ONE LOT AT A TIME, ON CENTRE STAGE -- and ABOVE the controls.
              It used to render last in this column, under the bid controls,
              and the review frame showed the revealed score cut off by the
              viewport: the payoff of the lot was the one thing you had to
              scroll for. A run of settled lots is a gap and is reported as one
              above, not stacked here. */}
          {reveal ? (
            <LotReveal lot={reveal} seatNames={seatNames} yourSeat={yourSeat} />
          ) : null}

          <LotTicker
            actions={publicState.lot_actions}
            seatNames={seatNames}
            yourSeat={yourSeat}
          />

          <p className="td-waiting" data-testid="td-waiting" aria-live="polite">
            {locallyExpired && yourTurn
              ? "Time expired — settling this lot…"
              : waitingLabel(publicState, yourSeat, seatNames)}
          </p>

          <BidControls
            publicState={publicState}
            privateState={privateState}
            seatNames={seatNames}
            busy={busy}
            expired={locallyExpired}
            onSubmit={onSubmit}
          />

        </div>

        <div className="td-column td-column-seat">
          {opponentSeats.map((seat) => (
            <div key={seat.seat_index} className="td-column-stack">
              <BudgetMeter
                seat={seat}
                skipAllowance={publicState.market_skips_per_seat}
                isYou={false}
                isActive={publicState.active_seat === seat.seat_index}
                isOpener={publicState.opening_seat === seat.seat_index}
                label={seatNames[seat.seat_index] ?? "Opponent"}
              />
              <RosterBoard
                seat={seat}
                slots={publicState.slots}
                label={`${seatNames[seat.seat_index] ?? "Opponent"}'s five`}
              />
            </div>
          ))}
        </div>
      </div>

      <SettledLotTray
        history={publicState.history}
        seatNames={seatNames}
        yourSeat={yourSeat}
      />
    </div>
  );
}
