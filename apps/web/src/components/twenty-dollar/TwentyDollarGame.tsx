"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  showdownIdempotencyKey,
  twentyDollarApi,
  TwentyDollarAPIError,
  timeoutConsequence,
  type TwentyDollarMatchView,
} from "@/lib/twenty-dollar-api";
import {
  explainRejection,
  explainTransportError,
  type AttemptedAction,
  type RejectionExplanation,
} from "@/lib/arena-rejection";
import { modeMeta } from "@/lib/arena-modes";
import HowToPlay from "@/components/arena/HowToPlay";
import { deadlineFromSeconds } from "@/components/shared/ArenaTimer";
import {
  AuctionLog,
  AuctionStage,
  LotReveal,
  RosterBoard,
  SeatCard,
  TurnBanner,
} from "./AuctionBoard";
import { ResumeRecap, SettledLotTray, useLotLedger } from "./LotLedger";
import BidControls from "./BidControls";
import MatchIntro from "./MatchIntro";
import ShowdownClock from "./ShowdownClock";
import ShowdownResult from "./ShowdownResult";
import TwentyDollarReceipt, {
  buildShowdownShareText,
  type TwentyDollarReceiptData,
} from "./TwentyDollarReceipt";
import { useShowdownPhase } from "./useShowdownPhase";

/**
 * One $20 Showdown match — the auction room.
 *
 * SERVER-AUTHORITATIVE, LOCAL `useState`. The entire client state is "the last
 * view the server sent". There is no local reducer mirroring the rules, because
 * a second copy of the rules is a second thing that can disagree with the first.
 *
 * THE FOUR DEFECTS THIS FILE OWNED, AND WHAT REPLACED THEM
 * --------------------------------------------------------
 *
 * 1. THE IDEMPOTENCY KEY WAS REUSED ACROSS DIFFERENT INTENTS (S20-02, and the
 *    worst of the four). The room minted one random key, held it in a ref, and
 *    cleared it only on the success path — the `catch` left it set. After a
 *    dropped response the NEXT CLICK OF ANY KIND reused that key, so the server
 *    replayed the verdict it had recorded for a completely different action. If
 *    the lost request had been REJECTED, the retry returned `replayed: true`,
 *    the `if (!accepted && !replayed)` guard suppressed the banner, and the
 *    corrected bid was never sent: a silent no-op under a running clock. The
 *    key is now DERIVED from `(matchId, seat, stateVersion, command, payload)`,
 *    so a retry of the same action replays and a different action is a
 *    different action, with no lifecycle to get wrong. A replayed REJECTION is
 *    now surfaced rather than swallowed.
 *
 * 2. THE COUNTDOWN DID NOT FREEZE ON CLICK (S20-08). `submit()` set `busy` and
 *    `inFlight` and never touched `deadlineAt`, and `ArenaTimer` keys only on
 *    `[deadlineAt]`. See `useShowdownPhase`.
 *
 * 3. "WHILE YOU WERE AWAY" FIRED DURING LIVE PLAY (S20-10). See `LotLedger`.
 *
 * 4. RAW SERVER PROSE REACHED THE BANNER (S20-12). `apiError.message` was
 *    rendered directly in two places, and for a body without a `detail.message`
 *    that string is literally `"HTTP 500"`. Every path now goes through
 *    `explainRejection` or `explainTransportError`.
 *
 * WHY THIS POLLS, AND WHY THE POLL NOW REACTS TO THE TAB. There is no realtime
 * transport in this codebase; polling the same authenticated route a refresh
 * would hit reuses the whole projection and permission model unchanged. What it
 * did not do was notice the tab. A backgrounded tab has its intervals throttled
 * to once a minute or worse, so the first frame back was stale and the local
 * `performance.now()` deadline read zero until a poll re-seeded it. There is
 * now an immediate re-poll on `visibilitychange` and on `focus`. The interval
 * itself no longer depends on `view`, which used to tear it down and recreate
 * it on every single response.
 */

const POLL_MS = 2000;

export default function TwentyDollarGame({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [view, setView] = useState<TwentyDollarMatchView | null>(null);
  const [error, setError] = useState<RejectionExplanation | null>(null);
  const [loadFailure, setLoadFailure] = useState<TwentyDollarAPIError | null>(null);
  const [busy, setBusy] = useState(false);
  const [inFlightAction, setInFlightAction] = useState<{
    command: "bid" | "pass";
    amount: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [locallyExpired, setLocallyExpired] = useState(false);
  // A local monotonic deadline rather than a duration in state. See
  // `ArenaTimer`'s docstring for why a re-seeded duration drifts.
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  // Guards a poll landing while a command is in flight from overwriting the
  // newer state the command already returned.
  const inFlight = useRef(false);
  // The highest authoritative version this client has applied. A response older
  // than what is already on screen is DROPPED rather than rendered: two
  // overlapping requests can complete out of order, and the newer state must
  // win regardless of arrival order.
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
    setSecondsRemaining(next.seconds_remaining);
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
      setError(
        explainTransportError(apiError.status, apiError.code, apiError.message, "load"),
      );
    }
  }, [matchId, applyView]);

  useEffect(() => {
    void load();
  }, [load]);

  const complete = view?.public_state?.phase === "complete";

  // POLL WHILE THE MATCH IS LIVE, and re-poll the instant the tab comes back.
  // `completeRef` rather than a `complete` dependency: the interval used to be
  // torn down and recreated on every response because `view` was a dependency,
  // which is a new timer every two seconds for no reason.
  const completeRef = useRef(complete);
  completeRef.current = complete;
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const tick = () => {
      if (completeRef.current) return;
      void loadRef.current();
    };
    const id = window.setInterval(tick, POLL_MS);

    // A BACKGROUNDED TAB IS THROTTLED, so the first frame back is stale and the
    // local deadline reads zero until a poll re-seeds it. Both events, because
    // a window that is focused without ever having been `hidden` (an alt-tab on
    // some platforms) fires only `focus`.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
    };
  }, []);

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
      const payload = command === "bid" ? { amount } : {};
      // DERIVED, NOT MINTED. See the module docstring: this is the whole of the
      // S20-02 fix. The same click retried produces the same key and replays;
      // any other action produces a different key and is applied.
      const key = showdownIdempotencyKey(
        matchId,
        view.your_seat_index,
        view.state_version,
        command,
        payload,
      );

      setBusy(true);
      setInFlightAction({ command, amount });
      setError(null);
      // THE COUNTDOWN STOPS HERE (S20-08). `useShowdownPhase` reads `busy` and
      // hands `ArenaTimer` a null deadline, so nothing counts down behind the
      // request and `onExpire` cannot fire against an action the server's grace
      // window is about to accept.
      setLocallyExpired(false);
      inFlight.current = true;
      try {
        const result = await twentyDollarApi.submitCommand(
          matchId,
          command,
          payload,
          view.state_version,
          key,
        );
        // The authoritative state lands FIRST, so the explanation below is
        // derived from the board as it now is rather than from the stale render
        // the click was made against.
        applyView(result.match);
        // `replayed` NO LONGER SUPPRESSES THE EXPLANATION. A replayed rejection
        // is still a rejection the player has not been told about, and the old
        // guard turned exactly that case into a silent no-op.
        if (!result.accepted) {
          setError(
            explainRejection(
              result.rejection_code,
              result.message,
              attempt,
              result.match.public_state,
              result.match.public_state.seat_names ??
                result.match.seats.map((seat) => seat.display_name),
              result.match.your_seat_index,
            ),
          );
        }
      } catch (err) {
        const apiError = err as TwentyDollarAPIError;
        setError(
          explainTransportError(apiError.status, apiError.code, apiError.message, command),
        );
      } finally {
        inFlight.current = false;
        setBusy(false);
        setInFlightAction(null);
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
      inFlightAction={inFlightAction}
      deadlineAt={deadlineAt}
      secondsRemaining={secondsRemaining}
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
 * The room itself, split out so the ledger and the phase machine can key off a
 * state that is guaranteed to exist. Hooks cannot run behind the loading gates
 * above.
 */
function AuctionRoom({
  view,
  meta,
  error,
  busy,
  inFlightAction,
  deadlineAt,
  secondsRemaining,
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
  error: RejectionExplanation | null;
  busy: boolean;
  inFlightAction: { command: "bid" | "pass"; amount: number } | null;
  deadlineAt: number | null;
  secondsRemaining: number | null;
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

  const { recap, reveal, queued, acknowledgeRecap } = useLotLedger(
    view.match_id,
    publicState,
  );

  const { phase, clockDeadlineAt, controlsLive, dismissIntro } = useShowdownPhase({
    lotIndex: publicState.lot_index,
    activeSeat: publicState.active_seat,
    yourSeat,
    actionCount: publicState.lot_actions.length,
    historyLength: publicState.history.length,
    secondsRemaining,
    deadlineAt,
    pending: busy,
    complete,
  });

  const yourTurn = privateState.is_your_turn && !complete;
  const opponentSeats = useMemo(
    () => publicState.seats.filter((seat) => seat.seat_index !== yourSeat),
    [publicState.seats, yourSeat],
  );
  const yourSeatPublic = publicState.seats[yourSeat ?? 0];
  const opponentName =
    seatNames[opponentSeats[0]?.seat_index ?? 1] ?? "PEAK3 Bot";

  if (complete && receipt) {
    return (
      <div className="td-game ar-room" data-testid="td-game">
        <ShowdownResult
          receipt={receipt}
          publicState={publicState}
          seatNames={seatNames}
          yourSeat={yourSeat}
          onPlayAgain={onPlayAgain}
          onCopy={() => {
            void navigator.clipboard
              ?.writeText(buildShowdownShareText(receipt, yourSeat))
              .then(() => onCopy(true));
          }}
          copied={copied}
        >
          <TwentyDollarReceipt receipt={receipt} seatNames={seatNames} yourSeat={yourSeat} />
        </ShowdownResult>
      </div>
    );
  }

  return (
    <div className="td-game ar-room" data-testid="td-game" data-phase={phase}>
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

      {/* THE TURN, AT THE TOP OF THE ROOM (S20-03). The only `aria-live` region
          on the board that tracks play: it changes when the turn changes and at
          no other time. */}
      <TurnBanner
        activeSeat={publicState.active_seat}
        yourSeat={yourSeat}
        seatNames={seatNames}
        phase={phase}
      />

      {/* THE ERROR IS DISMISSIBLE AND SELF-CLEARING, and it never carries
          backend wording — `explainRejection` and `explainTransportError` have
          already decided what a player can act on. */}
      {error ? (
        <div
          className="td-error"
          role="alert"
          data-testid="td-error"
          data-code={error.code ?? ""}
          data-tone={error.tone}
        >
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

      {/* THE RECAP IS COMPACT AND IT DOES NOT DISPLACE ANYTHING. It appears only
          across a genuine resume boundary (see `useLotLedger`), shows three rows
          with a "View N more", and sits above a board that is still fully
          rendered underneath it. */}
      {recap.length > 0 ? (
        <ResumeRecap
          lots={recap}
          seatNames={seatNames}
          yourSeat={yourSeat}
          onDismiss={acknowledgeRecap}
        />
      ) : null}

      {/* THREE SYMMETRICAL COLUMNS. Both participants get the same panel with
          the same fields in the same order. The settled history is a full-width
          tray below, so it cannot compress the opponent's roster. */}
      <div className="td-table" data-testid="td-table">
        <div className="td-column td-column-seat">
          <SeatCard
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
          <AuctionStage
            publicState={publicState}
            fits={privateState.candidate_fits}
            seatNames={seatNames}
            yourSeat={yourSeat}
          />

          {/* THE CLOCK, ATTACHED TO THE ACTION, saying what expiry will cost
              before it costs it — and frozen the instant a command goes out.
              It never says WHOSE turn it is; `TurnBanner` above is the single
              turn surface. */}
          <ShowdownClock
            phase={phase}
            deadlineAt={clockDeadlineAt}
            activeSeat={publicState.active_seat}
            yourSeat={yourSeat}
            consequence={
              yourTurn ? timeoutConsequence(privateState, seatNames, publicState) : null
            }
            // A NEW TURN RESTARTS THE COUNT-UP. Lot, action count and seat
            // together identify one turn: any of the three moving means the
            // previous turn is over.
            turnKey={`${publicState.lot_index}:${publicState.lot_actions.length}:${publicState.active_seat ?? "none"}`}
            pendingCommand={inFlightAction?.command ?? null}
            pendingAmount={inFlightAction?.amount ?? 0}
            onExpire={onExpire}
          />

          <BidControls
            publicState={publicState}
            privateState={privateState}
            seatNames={seatNames}
            busy={busy}
            live={controlsLive}
            // NOT WHILE A COMMAND IS IN FLIGHT. `busy` already froze the clock,
            // so `locallyExpired` can only be true for a turn that ran out with
            // nothing sent — which is the only case the expired copy is true of.
            expired={locallyExpired && !busy}
            onSubmit={onSubmit}
          />

          {/* ONE LOT AT A TIME, ON CENTRE STAGE. A run of settled lots is a
              SEQUENCE — `queued` says how many are still coming — rather than a
              catch-up banner over the top of live play. */}
          {reveal ? (
            <LotReveal
              lot={reveal}
              seatNames={seatNames}
              yourSeat={yourSeat}
              queued={queued}
            />
          ) : null}

          {/* ONE TURN SURFACE, NOT FOUR. A `td-waiting` line reading "Your
              move — open or pass." used to sit here, under a `Your move`
              banner, an `ON THE CLOCK` chip on the seat card and a `YOUR TURN`
              clock label. That is TMW-07's "three stacked rows" defect,
              reproduced in the Showdown. The banner says whose turn it is, the
              seat card shows it as a state, the clock shows the time, and the
              controls say what the actions do. Nothing repeats. */}
          <AuctionLog
            actions={publicState.lot_actions}
            seatNames={seatNames}
            yourSeat={yourSeat}
          />
        </div>

        <div className="td-column td-column-seat">
          {opponentSeats.map((seat) => (
            <div key={seat.seat_index} className="td-column-stack">
              <SeatCard
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

      {phase === "intro" ? (
        <MatchIntro
          opponentName={opponentName}
          startingBudget={yourSeatPublic?.budget ?? 20}
          slots={publicState.slots.length}
          marketSkips={publicState.market_skips_per_seat}
          rated={view.rated}
          onDismiss={dismissIntro}
        />
      ) : null}
    </div>
  );
}
