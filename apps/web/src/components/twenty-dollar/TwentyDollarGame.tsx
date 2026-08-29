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
import { BOT_DISPLAY_NAME, modeMeta } from "@/lib/arena-modes";
import HowToPlay from "@/components/arena/HowToPlay";
import { deadlineFromSeconds } from "@/components/shared/ArenaTimer";
import { useLotLedger } from "./LotLedger";
import { buildShowdownShareText, type TwentyDollarReceiptData } from "./TwentyDollarReceipt";
import { useShowdownPhase } from "./useShowdownPhase";
import PeakV2ShowdownIntro from "@/components/v2/showdown/PeakV2ShowdownIntro";
import PeakV2ShowdownLive from "@/components/v2/showdown/PeakV2ShowdownLive";
import PeakV2ShowdownResult from "@/components/v2/showdown/PeakV2ShowdownResult";

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
 *
 * WHY A BOT'S MOVE COULD TAKE UP TO ~3.2s TO APPEAR, AND WHAT NARROWS IT. The
 * server applies a pending bot's move lazily, on the next authoritated read,
 * once `BOT_THINK_SECONDS` (1.2s, `apps/api/app/services/arena/bots.py`) has
 * elapsed since its turn opened — there is no push. Left to the fixed
 * `POLL_MS` cadence alone, a bot move that becomes due one tick late can sit
 * unseen for up to another full interval on top of the think time. Every
 * submit that hands the turn to a seat other than the player's own now also
 * arms one extra one-shot poll timed just past `BOT_THINK_FLOOR_MS`, so the
 * player's own action is what schedules the read most likely to catch the
 * reply, instead of leaving it to chance against a clock that was already
 * running before the click.
 */

const POLL_MS = 2000;

/** MIRRORS `nba_peak.twenty_dollar.config.BOT_THINK_SECONDS_MIN`, and is NOT
 *  authoritative for anything.
 *
 *  The server draws a per-turn deliberation of 2.6-4.2s from the match seed and
 *  enforces it against the turn's stored `opened_at`. This constant exists only
 *  to time the one extra READ below; nothing here gates rendering. A view that
 *  arrives sooner than this is applied the instant it lands (`applyView` is
 *  ordered by `state_version`, never by a timer), so the client can never sit
 *  on an action the server has already committed.
 *
 *  It was 1200ms, mirroring the platform default the mode used to fall back
 *  to. That default sat BELOW `POLL_MS`, which is exactly why the bot's move
 *  used to arrive in the same poll that opened its turn and no opponent was
 *  ever seen thinking. Left at 1200 it would now fire before the earliest
 *  possible reply and waste the request. */
const BOT_THINK_FLOOR_MS = 2600;
const BOT_FOLLOW_UP_POLL_MS = BOT_THINK_FLOOR_MS + 200;

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
  // THE OPEN TURN'S DEADLINE, WHOEVER IS ON IT. Distinct from `deadlineAt`,
  // which is null while the opponent decides — the null that made this room
  // draw their turn as a count-UP of elapsed time. See `ShowdownClock`.
  const [turnDeadlineAt, setTurnDeadlineAt] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  // Guards a poll landing while a command is in flight from overwriting the
  // newer state the command already returned.
  const inFlight = useRef(false);
  // The highest authoritative version this client has applied. A response older
  // than what is already on screen is DROPPED rather than rendered: two
  // overlapping requests can complete out of order, and the newer state must
  // win regardless of arrival order.
  const appliedVersion = useRef(-1);
  // The one armed-but-not-yet-fired bot follow-up poll (see the module
  // docstring). Re-arming clears whatever was already pending so a fast
  // human — pass, then bid, then pass again — cannot stack timers that all
  // fire into the same `load()` guard for no benefit.
  const botFollowUpTimer = useRef<number | null>(null);

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
    setTurnDeadlineAt(deadlineFromSeconds(next.turn_seconds_remaining));
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
      if (botFollowUpTimer.current !== null) {
        window.clearTimeout(botFollowUpTimer.current);
        botFollowUpTimer.current = null;
      }
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
        // THE TURN JUST LEFT THE HUMAN'S HANDS. If it is now on the clock for
        // anyone else — bot or opponent — arm one extra poll timed just past
        // `BOT_THINK_FLOOR_MS` so a bot's reply is read as soon as it is
        // likely to be due, rather than waiting on whatever is left of the
        // fixed interval. Harmless against a human opponent: the poll simply
        // finds them still deciding and the normal interval carries on.
        if (botFollowUpTimer.current !== null) {
          window.clearTimeout(botFollowUpTimer.current);
          botFollowUpTimer.current = null;
        }
        const nextActive = result.match.public_state.active_seat;
        if (
          result.match.public_state.phase !== "complete" &&
          nextActive !== null &&
          nextActive !== result.match.your_seat_index
        ) {
          botFollowUpTimer.current = window.setTimeout(() => {
            botFollowUpTimer.current = null;
            void loadRef.current();
          }, BOT_FOLLOW_UP_POLL_MS);
        }
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

  /**
   * The two LIFECYCLE commands: end the intro, concede the match.
   *
   * Deliberately not routed through `submit`. That function exists to place an
   * auction move and to explain a refused one in the language of bidding —
   * `AttemptedAction` carries a standing bid and whether a skip would be spent,
   * and neither means anything here. These two change the shape of the match
   * rather than the state of a lot.
   *
   * BOTH ARE SERVER-RESOLVED, which is the whole point. A client that merely
   * hid the intro would leave the player looking at a board that refuses every
   * action; a client that merely navigated away from a forfeit would leave a
   * live match on the server for the same player to rejoin.
   */
  const sendLifecycle = useCallback(
    async (command: "showdown_skip_intro" | "showdown_forfeit") => {
      if (!view || busy) return;
      setBusy(true);
      setError(null);
      inFlight.current = true;
      try {
        const result = await twentyDollarApi.submitCommand(
          matchId,
          command,
          {},
          view.state_version,
          showdownIdempotencyKey(
            matchId,
            view.your_seat_index,
            view.state_version,
            command,
            {},
          ),
        );
        applyView(result.match);
        // A REFUSED SKIP IS NOT WORTH A BANNER: the only way it fails is that
        // the intro already ended, which is what the player asked for. A
        // refused FORFEIT is worth one — they meant to leave and are still here.
        if (!result.accepted && command === "showdown_forfeit") {
          setError(
            explainTransportError(
              409,
              result.rejection_code ?? null,
              result.message ?? "",
              "load",
            ),
          );
        }
      } catch (err) {
        const apiError = err as TwentyDollarAPIError;
        if (command === "showdown_forfeit") {
          setError(
            explainTransportError(apiError.status, apiError.code, apiError.message, "load"),
          );
        }
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
      inFlightAction={inFlightAction}
      deadlineAt={deadlineAt}
      turnDeadlineAt={turnDeadlineAt}
      secondsRemaining={secondsRemaining}
      locallyExpired={locallyExpired}
      copied={copied}
      onExpire={() => setLocallyExpired(true)}
      onDismissError={() => setError(null)}
      onSubmit={submit}
      onSkipIntro={() => void sendLifecycle("showdown_skip_intro")}
      onForfeit={() => void sendLifecycle("showdown_forfeit")}
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
  turnDeadlineAt,
  secondsRemaining,
  locallyExpired,
  copied,
  onExpire,
  onDismissError,
  onSubmit,
  onSkipIntro,
  onForfeit,
  onCopy,
  onPlayAgain,
}: {
  view: TwentyDollarMatchView;
  meta: ReturnType<typeof modeMeta>;
  error: RejectionExplanation | null;
  busy: boolean;
  inFlightAction: { command: "bid" | "pass"; amount: number } | null;
  deadlineAt: number | null;
  /** The open turn's deadline, whoever holds it. See `ShowdownClock`. */
  turnDeadlineAt: number | null;
  secondsRemaining: number | null;
  locallyExpired: boolean;
  copied: boolean;
  onExpire: () => void;
  onDismissError: () => void;
  onSubmit: (command: "bid" | "pass", amount: number) => void;
  /** End the server's intro turn early. */
  onSkipIntro: () => void;
  /** Concede the match. Resolved server-side; see `mode._forfeit`. */
  onForfeit: () => void;
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

  const { recap, reveal, queued, revealedHistory, acknowledgeRecap } = useLotLedger(
    view.match_id,
    publicState,
  );

  const { phase, clockDeadlineAt, controlsLive } = useShowdownPhase({
    lotIndex: publicState.lot_index,
    activeSeat: publicState.active_seat,
    yourSeat,
    actionCount: publicState.lot_actions.length,
    secondsRemaining,
    deadlineAt,
    pending: busy,
    complete,
    // THE SERVER'S OWN PHASE. The intro is a real turn now, so the room renders
    // what the server published rather than guessing "this looks like a fresh
    // match" and pricing a beat against a clock it does not own.
    introOpen: view.turn_phase === "intro",
  });

  const yourTurn = privateState.is_your_turn && !complete;
  const opponentSeats = useMemo(
    () => publicState.seats.filter((seat) => seat.seat_index !== yourSeat),
    [publicState.seats, yourSeat],
  );
  const yourSeatPublic = publicState.seats[yourSeat ?? 0];
  const opponentName =
    seatNames[opponentSeats[0]?.seat_index ?? 1] ?? BOT_DISPLAY_NAME;

  if (complete && receipt) {
    const onCopyResult = () => {
      void navigator.clipboard
        ?.writeText(buildShowdownShareText(receipt, yourSeat))
        .then(() => onCopy(true));
    };
    return (
      <div data-testid="td-game" data-phase="complete">
        <PeakV2ShowdownResult
          receipt={receipt}
          publicState={publicState}
          seatNames={seatNames}
          yourSeat={yourSeat}
          onPlayAgain={onPlayAgain}
          onCopy={onCopyResult}
          copied={copied}
        />
      </div>
    );
  }

  // V2's own live board — same already-computed state/handlers, no second
  // poll or reducer. Built once here so it composes with the intro overlay
  // exactly like legacy's `MatchIntro` (mounted OVER an already-live board,
  // never gating it) rather than as a separate first screen.
  const v2Live = (
    <PeakV2ShowdownLive
      publicState={publicState}
      privateState={privateState}
      seatNames={seatNames}
      yourSeat={yourSeat}
      phase={phase}
      clockDeadlineAt={clockDeadlineAt}
      turnDeadlineAt={turnDeadlineAt}
      controlsLive={controlsLive}
      busy={busy}
      inFlightAction={inFlightAction}
      locallyExpired={locallyExpired}
      consequence={yourTurn ? timeoutConsequence(privateState, seatNames, publicState) : null}
      revealedHistory={revealedHistory}
      reveal={reveal}
      queued={queued}
      recap={recap}
      onAcknowledgeRecap={acknowledgeRecap}
      error={error}
      onExpire={onExpire}
      onDismissError={onDismissError}
      onSubmit={onSubmit}
      helpControl={meta ? <HowToPlay title={meta.name} rules={meta.rules} testId="td-rules" /> : null}
      forfeitControl={<ForfeitControl onConfirm={onForfeit} busy={busy} />}
    />
  );

  return (
    <>
      {v2Live}
      {phase === "intro" ? (
        <PeakV2ShowdownIntro
          opponentName={opponentName}
          startingBudget={yourSeatPublic?.budget ?? 20}
          slots={publicState.slots.length}
          marketSkips={publicState.market_skips_per_seat}
          rated={view.rated}
          onDismiss={onSkipIntro}
        />
      ) : null}
    </>
  );
}

/**
 * FORFEIT MATCH — a secondary control that takes two deliberate actions.
 *
 * WHY IT EXISTS. Without it the only way out of a Showdown is to close the tab,
 * which leaves the opponent watching a clock tick out lot after lot and leaves
 * a live match on the server for the same player to be dropped back into on
 * their next visit. Conceding is a real move, so it is a real command.
 *
 * WHY IT IS TWO CLICKS AND NOT ONE. It ends the match with a loss and cannot be
 * undone, and it sits in the room's header a short distance from "How to play".
 * A single mis-click there would be the worst possible outcome of a mis-click,
 * so the first press only reveals the confirmation, the destructive choice is
 * never the one under the cursor, and Escape backs out. It is deliberately NOT
 * a `window.confirm`: that is unstyleable, unannounceable, and blocks the poll.
 */
function ForfeitControl({ onConfirm, busy }: { onConfirm: () => void; busy: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!confirming) return;
    // Focus lands on CANCEL, never on the destructive choice.
    cancelRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setConfirming(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  if (!confirming) {
    return (
      <button
        type="button"
        className="ar-btn td-forfeit"
        data-testid="td-forfeit"
        onClick={() => setConfirming(true)}
      >
        Forfeit match
      </button>
    );
  }

  return (
    <div className="td-forfeit-confirm" data-testid="td-forfeit-confirm" role="group"
      aria-label="Confirm forfeit">
      <p className="td-forfeit-question">Concede this match?</p>
      <button
        type="button"
        ref={cancelRef}
        className="ar-btn"
        data-testid="td-forfeit-cancel"
        onClick={() => setConfirming(false)}
      >
        Keep playing
      </button>
      <button
        type="button"
        className="ar-btn td-forfeit-go"
        data-testid="td-forfeit-confirm-button"
        disabled={busy}
        onClick={onConfirm}
      >
        {busy ? "Conceding…" : "Forfeit"}
      </button>
    </div>
  );
}
