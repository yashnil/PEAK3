"use client";

/**
 * PeakV2ShowdownLive — the $20 Showdown's auction floor (game-feel pass 2).
 *
 * THE HIERARCHY DURING BIDDING, top to bottom of the stage:
 *
 *   the lot        the player and their exact peak, on a card that ENTERS
 *   the bid        the standing figure, the largest numeral on the page,
 *                  swapping hands visibly (`BidTransition`)
 *   the clock      one depleting auction clock, whoever owns it
 *   the controls   the proposed bid, live in the same frame it is stepped,
 *                  and one explicit action ("Bid $7")
 *   the money      what the bid would leave, projected on the budget meter
 *   the rosters    two lineups of five slots, pieces and goals, beside the
 *                  stage on a wide screen and under it on a phone
 *
 * WHAT IS GONE. The settled-lots table under the board (it duplicated the
 * rosters and pulled the eye off the live lot); the auction-log disclosure;
 * the two client beats that held the controls shut while the server clock
 * ran. What replaced them: the SOLD moment plays OVER the stage's top zone
 * and never blocks a control; the last event is one line under the stage;
 * the full history lives in the result.
 *
 * Every field is the same `TwentyDollarPublicState` / `TwentyDollarPrivateState`
 * the room already computed -- no second poll, no second reducer, and no
 * PEAK3 score for a live candidate, because the server does not send one.
 */

import { useMemo, useState, type ReactNode } from "react";
import PeakV2Shell from "../PeakV2Shell";
import PeakV2ArenaLight from "../PeakV2ArenaLight";
import PeakV2GameStatus from "../PeakV2GameStatus";
import PeakV2ShowdownClock from "./PeakV2ShowdownClock";
import PeakV2ShowdownBidControls from "./PeakV2ShowdownBidControls";
import { ResumeRecap, verdictOf } from "@/components/twenty-dollar/LotLedger";
import {
  ActiveSeat,
  BidTransition,
  CardArrival,
  EventMoment,
  ResourceMeter,
  RosterSlotLock,
  TurnClock,
  type EventMomentData,
} from "@/components/game-feel";
import { useArrivals } from "@/lib/game-feel/arrivals";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import {
  STARTING_BUDGET,
  TURN_SECONDS,
  formatDollars,
  lastActionLabel,
  type ResolvedLot,
  type RosterEntry,
  type SeatPublic,
  type TwentyDollarMatchView,
  type TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";
import type { ShowdownPhase } from "@/components/twenty-dollar/useShowdownPhase";

// ---------------------------------------------------------------------------
// A lineup: five slots, a budget meter, an active-seat frame
// ---------------------------------------------------------------------------

function Lineup({
  label,
  seat,
  owner,
  isYou,
  isActive,
  idle,
  publicState,
  projectedBudget,
  reserve,
  targets,
  align,
  turnDeadlineAt,
  turnTotalSeconds,
  railState,
  railLabel,
}: {
  label: string;
  seat: SeatPublic;
  owner: "you" | "rival" | "bot";
  isYou: boolean;
  isActive: boolean;
  idle: boolean;
  publicState: TwentyDollarPublicState;
  projectedBudget: number | null;
  reserve: number;
  /** Slots the live candidate could land in, for the targeted state. */
  targets: ReadonlySet<string>;
  align: "start" | "end";
  /**
   * THE ONE AUTHORITATIVE DEADLINE, shared with the central clock.
   *
   * Passed in rather than derived, and passed as the SAME value the stage's
   * clock counts, so this column and the middle of the room can never
   * disagree about how long is left. It is only handed to the seat the server
   * says is on the clock; every other seat gets `null` and the rail sits
   * quiet. There is no second timer anywhere in this component.
   */
  turnDeadlineAt: number | null;
  turnTotalSeconds: number;
  /** Four states, and none of them is carried by colour alone -- the rail
   *  always prints a word. `pending` is this client's own command in flight:
   *  a neutral hold, not a countdown, because the turn has not transitioned
   *  yet and inventing a clock for it would be inventing authority. */
  railState: "active" | "inactive" | "pending" | "expired";
  railLabel: string;
}) {
  const bySlot = useMemo(() => {
    const map = new Map<string, RosterEntry>();
    for (const entry of seat.roster) if (entry.slot) map.set(entry.slot, entry);
    return map;
  }, [seat.roster]);
  const occupants = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const slot of publicState.slots) out[slot] = bySlot.get(slot)?.player_slug ?? null;
    return out;
  }, [bySlot, publicState.slots]);
  const arrivals = useArrivals(occupants, 460);
  const total = publicState.slots.length;
  const open = total - seat.filled_slots;
  const complete = seat.roster_full;

  return (
    <ActiveSeat
      state={idle ? "idle" : isActive ? "active" : "receded"}
      owner={owner}
      complete={complete}
      className="sd-lineup"
      testId={`td-roster-${seat.seat_index}`}
    >
      <div className="sd-lineup-head" data-align={align}>
        {isActive ? (
          <span data-testid={`td-seat-live-${seat.seat_index}`}>
            <PeakV2GameStatus label={`${label} · on the clock`} state="active" />
          </span>
        ) : (
          <PeakV2GameStatus label={label} state="idle" />
        )}
      </div>

      {/* THE SEAT'S OWN TURN RAIL, immediately above its money.
          A player watching an auction needs to know whose move it is and how
          long they have without looking away from the column they are
          reading. The bar is the SAME deadline the stage's clock counts (see
          `turnDeadlineAt`), so there is one authority and one number. */}
      <div
        className="sd-lineup-rail"
        data-testid={`td-turn-rail-${seat.seat_index}`}
        data-state={railState}
        data-owner={owner}
      >
        <TurnClock
          deadlineAt={railState === "active" ? turnDeadlineAt : null}
          totalSeconds={turnTotalSeconds}
          owner={owner}
          label={railLabel}
          size="sm"
          warnAtSeconds={6}
          testId={`td-turn-rail-clock-${seat.seat_index}`}
          className="sd-rail-clock"
        />
      </div>

      <div className="sd-lineup-money" data-testid={`td-budget-${seat.seat_index}`} data-active={isActive ? "true" : "false"}>
        <ResourceMeter
          label="Budget left"
          value={seat.budget}
          max={STARTING_BUDGET}
          projected={projectedBudget}
          reserve={reserve}
          format={formatDollars}
          tone={isYou ? "accent" : "neutral"}
          size="sm"
          testId={`td-budget-meter-${seat.seat_index}`}
          valueTestId={`td-seat-budget-${seat.seat_index}`}
        />
        <div className="sd-lineup-facts">
          <span className="sd-fact" data-testid={`td-spots-${seat.seat_index}`}>
            <span className="sd-fact-label">{open === 1 ? "Spot left" : "Spots left"}</span>
            <span className="sd-fact-value">{open}</span>
          </span>
          <span className="sd-fact" data-testid={`td-skips-${seat.seat_index}`}>
            <span className="sd-fact-label">{seat.market_skips === 1 ? "Skip left" : "Skips left"}</span>
            <span className="sd-fact-value">{seat.market_skips}</span>
          </span>
        </div>
      </div>

      <ul className="sd-lineup-slots" data-align={align}>
        {publicState.slots.map((slot) => {
          const entry = bySlot.get(slot);
          const beat = arrivals.arrived.includes(slot) ? "arrived" : arrivals.swapped.includes(slot) ? "swapped" : null;
          const state = entry ? "filled" : targets.has(slot) ? "targeted" : "empty";
          return (
            <RosterSlotLock
              key={slot}
              slot={slot}
              state={state}
              beat={beat}
              align={align}
              size="sm"
              tone={owner}
              placeholder={targets.has(slot) ? "Fits here" : "Open"}
              figure={entry ? (entry.autofilled ? "auto" : formatDollars(entry.price)) : "—"}
              testId={`td-slot-${seat.seat_index}-${slot}`}
            >
              {entry ? (
                <span className="sd-slot-player">
                  <PlayerAvatar name={entry.player_name} size={20} imageUrl={entry.headshot_url} />
                  <span className="sd-slot-name">{entry.player_name}</span>
                </span>
              ) : null}
            </RosterSlotLock>
          );
        })}
      </ul>
    </ActiveSeat>
  );
}

// ---------------------------------------------------------------------------
// The SOLD stamp — the previous lot's payoff, over the stage, never blocking
// ---------------------------------------------------------------------------

function SoldStamp({ lot, seatNames, yourSeat, queued }: { lot: ResolvedLot; seatNames: string[]; yourSeat: number | null; queued: number }) {
  const won = lot.winner_seat;
  const mine = won !== null && won === yourSeat;
  const outcome = won === null ? "unsold" : lot.decided_by === "forced_fill" ? "assigned" : mine ? "yours" : "theirs";
  const headline = won === null ? "UNSOLD" : lot.decided_by === "forced_fill" ? "ASSIGNED" : "SOLD";
  const slot = (lot.slot_options ?? [])[0];
  return (
    <div className="sd-sold" data-testid="td-lot-reveal" data-outcome={outcome} data-queued={queued} role="status" aria-live="off">
      <span className="sd-sold-eyebrow" data-testid="td-reveal-lot">
        Lot {lot.lot_index + 1}
      </span>
      <span className="sd-sold-headline">{headline}</span>
      <span className="sd-sold-name">{lot.candidate.player_name}</span>
      <span className="sd-sold-line">
        {won === null ? (
          verdictOf(lot, seatNames, yourSeat)
        ) : (
          <>
            <span className="sd-sold-price">{formatDollars(lot.price)}</span>
            <span className="sd-sold-to">{mine ? "to you" : `to ${seatNames[won] ?? "the other seat"}`}{slot ? ` · ${slot}` : ""}</span>
          </>
        )}
      </span>
      <span className="sd-sold-score" data-testid="td-reveal-score">
        <span className="pk-numeral">{lot.candidate.prime_score.toFixed(1)}</span>
        <span className="sd-sold-score-label"> PEAK3 · {lot.candidate.anchor_season}</span>
      </span>
      {queued > 0 ? (
        <span className="sd-sold-queued" data-testid="td-reveal-queued">
          {queued} more {queued === 1 ? "lot" : "lots"} settling…
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

export interface PeakV2ShowdownLiveProps {
  view: TwentyDollarMatchView;
  seatNames: string[];
  yourSeat: number | null;
  opponentIsBot: boolean;
  phase: ShowdownPhase;
  clockDeadlineAt: number | null;
  turnDeadlineAt: number | null;
  controlsLive: boolean;
  pending: boolean;
  inFlightAction: { command: "bid" | "pass"; amount: number } | null;
  locallyExpired: boolean;
  consequence: string | null;
  reveal: ResolvedLot | null;
  queued: number;
  recap: ResolvedLot[];
  moment: EventMomentData | null;
  onDismissMoment: (id: string) => void;
  onAcknowledgeRecap: () => void;
  error?: { message: string; tone: "board" | "rule" | "retry" | "reload" } | null;
  onExpire: () => void;
  onDismissError?: () => void;
  onAct: (command: "bid" | "pass", amount: number) => Promise<boolean>;
  helpControl?: ReactNode;
  forfeitControl?: ReactNode;
}

export default function PeakV2ShowdownLive({
  view,
  seatNames,
  yourSeat,
  opponentIsBot,
  phase,
  clockDeadlineAt,
  turnDeadlineAt,
  controlsLive,
  pending,
  inFlightAction,
  locallyExpired,
  consequence,
  reveal,
  queued,
  recap,
  moment,
  onDismissMoment,
  onAcknowledgeRecap,
  error = null,
  onExpire,
  onDismissError,
  onAct,
  helpControl,
  forfeitControl,
}: PeakV2ShowdownLiveProps) {
  const publicState = view.public_state;
  const privateState = view.private_state;
  const yourSeatPublic = publicState.seats[yourSeat ?? 0];
  const opponent = publicState.seats.find((s) => s.seat_index !== yourSeat) ?? null;
  const candidate = publicState.candidate;
  const opened = publicState.current_bid > 0;
  const holder = publicState.high_bidder;
  const active = publicState.active_seat;
  const yours = active !== null && active === yourSeat;
  const opponentName = opponent ? (seatNames[opponent.seat_index] ?? "Opponent") : "Opponent";
  const seatless = active === null && phase !== "intro";
  const seatlessBeat = view.turn_phase === "lot_unwinnable" ? "unwinnable" : view.turn_phase === "lot_forced_fill" ? "forced_fill" : null;

  // THE PROPOSED BID lives here so the budget meter can project it.
  //
  // RE-BASED WHEN THE FLOOR MOVES, DERIVED IN RENDER. A new lot or an
  // opponent's raise changes the legal floor; the proposal is keyed to the
  // floor it was made against and falls back to the new minimum the moment
  // the key differs -- in the same render, with no effect that could land a
  // frame after a press and swallow it. While a command is out the sent
  // figure stays locked on screen until the server answers.
  const floorKey = `${publicState.lot_index}:${privateState.minimum_bid}:${privateState.max_bid}`;
  const [proposal, setProposal] = useState<{ key: string; amount: number }>({ key: floorKey, amount: Math.max(1, privateState.minimum_bid) });
  const legalFloor = privateState.minimum_bid <= privateState.max_bid ? Math.max(1, privateState.minimum_bid) : Math.max(0, privateState.max_bid);
  const amount = proposal.key === floorKey || pending ? proposal.amount : legalFloor;
  const setAmount = (next: number) => setProposal({ key: floorKey, amount: next });
  const proposing = controlsLive && privateState.bid_blocked_reason === null && privateState.minimum_bid <= privateState.max_bid;
  const lockedAmount = pending && inFlightAction?.command === "bid" ? inFlightAction.amount : null;
  const projected = lockedAmount !== null ? yourSeatPublic.budget - lockedAmount : proposing ? yourSeatPublic.budget - Math.min(Math.max(amount, privateState.minimum_bid), privateState.max_bid) : null;

  const yourTargets = useMemo(() => new Set(candidate ? privateState.candidate_fits.filter((s) => yourSeatPublic.open_slots.includes(s)) : []), [candidate, privateState.candidate_fits, yourSeatPublic.open_slots]);
  const theirTargets = useMemo(() => new Set(candidate && opponent ? candidate.positions.filter((p) => opponent.open_slots.includes(p)) : []), [candidate, opponent]);

  const bidHolder: "you" | "rival" | "bot" | "none" = !opened || holder === null ? "none" : holder === yourSeat ? "you" : opponentIsBot ? "bot" : "rival";
  const bidCaption = !opened ? "Floor is open" : holder === yourSeat ? "You lead" : `${seatNames[holder ?? -1] ?? "Opponent"} leads`;
  const lastEvent = lastActionLabel(publicState, yourSeat, seatNames);
  const contested = opened && publicState.lot_actions.filter((a) => a.action === "bid").length >= 3;

  const lotLabel = `Lot ${Math.min(publicState.lot_index + 1, publicState.max_lots)} of ${publicState.market_phase === "closeout" ? publicState.max_lots : publicState.standard_market_lots}`;

  /**
   * EACH COLUMN'S TURN RAIL, from the SERVER'S OWN active seat and deadline.
   *
   * Four states, one authority, no second timer: `active` counts the shared
   * `turnDeadlineAt`; `pending` is this client's command in flight, a neutral
   * hold rather than a countdown, because the turn has NOT transitioned yet
   * and starting the next seat's clock from the press would charge the player
   * for their own latency; `expired` is the local clock at zero while the
   * server settles; `inactive` is everything else. Every state prints a word,
   * so nothing here is carried by colour alone.
   */
  const railFor = (seatIndex: number): { state: "active" | "inactive" | "pending" | "expired"; label: string } => {
    const isMine = seatIndex === yourSeat;
    if (pending) {
      // The seat that pressed holds; nobody else's clock has opened yet.
      if (isMine) {
        return {
          state: "pending",
          label:
            inFlightAction?.command === "bid"
              ? `${formatDollars(inFlightAction.amount)} in`
              : "Decision in",
        };
      }
      return { state: "inactive", label: "Waiting" };
    }
    if (phase === "intro") return { state: "inactive", label: "Not started" };
    if (active === null) return { state: "inactive", label: "Between lots" };
    if (active !== seatIndex) return { state: "inactive", label: "Waiting" };
    if (isMine && locallyExpired) return { state: "expired", label: "Time up" };
    return { state: "active", label: isMine ? "Your move" : opponentIsBot ? "Thinking" : "On the clock" };
  };
  const railTotal = TURN_SECONDS;

  return (
    <PeakV2Shell width="live-wide">
      <div className="sd-room py-5" data-arena="live" data-testid="td-game" data-phase={phase} data-contested={contested ? "true" : "false"}>
        <div className="sd-topbar">
          <div className="sd-topbar-left">
            <PeakV2GameStatus label={lotLabel} state="active" labelTestId="td-lot-number" />
            <span className="sd-market" data-testid="td-market-phase" data-phase={publicState.market_phase === "closeout" ? "closeout" : "standard"}>
              {publicState.market_phase === "closeout" ? "Closeout market" : "Standard market"}
            </span>
          </div>
          <div className="sd-topbar-right">
            {helpControl}
            {forfeitControl}
          </div>
        </div>

        {error ? (
          <div role="alert" data-testid="td-error" data-tone={error.tone} className="sd-error">
            <p>{error.message}</p>
            {onDismissError ? (
              <button type="button" data-testid="td-error-dismiss" onClick={onDismissError} className="sd-error-dismiss">
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}

        {recap.length > 0 && (
          <div className="mt-3">
            <ResumeRecap lots={recap} seatNames={seatNames} yourSeat={yourSeat} onDismiss={onAcknowledgeRecap} />
          </div>
        )}

        <div className="sd-table" data-testid="td-table">
          <div className="sd-side sd-side-you">
            <Lineup
              label="You"
              seat={yourSeatPublic}
              owner="you"
              isYou
              isActive={yours}
              idle={seatless || phase === "intro"}
              publicState={publicState}
              projectedBudget={projected}
              reserve={privateState.reserve_floor}
              targets={yourTargets}
              align="start"
              turnDeadlineAt={turnDeadlineAt}
              turnTotalSeconds={railTotal}
              railState={railFor(yourSeat ?? 0).state}
              railLabel={railFor(yourSeat ?? 0).label}
            />
          </div>

          <div className="sd-stage" data-active={yours ? "you" : active !== null ? "them" : "none"}>
            {candidate ? <PeakV2ArenaLight y="-10%" intensity="focus" pulse={yours} /> : null}

            {/* THE SINGLE aria-live turn surface in the room. */}
            <p
              className="sd-turn"
              data-testid="td-turn-indicator"
              data-your-turn={yours ? "true" : "false"}
              data-phase={phase}
              data-seat={active === null ? "none" : yours ? "a" : "b"}
              aria-live="polite"
            >
              <span className={`sd-turn-dot${active !== null && phase === "decide" ? " sd-turn-dot-live" : ""}`} aria-hidden="true" />
              <span className="sd-turn-text">
                {phase === "intro"
                  ? "Auction starting"
                  : phase === "pending"
                    ? // THE PRESS IS THE NEWS, NOT THE REQUEST. This read
                      // "Sending your move", which describes the client's
                      // network state and blanks the room for the whole round
                      // trip; the measured server work behind it is single-
                      // digit milliseconds (`scripts` probe: median 6.1ms for
                      // a bid), so what the player was watching was latency
                      // being narrated at them. It now says what they just
                      // did, and the pending dot beside it carries the "still
                      // confirming" part without taking the floor.
                      inFlightAction?.command === "bid"
                      ? `You bid ${formatDollars(inFlightAction.amount)}`
                      : "You passed"
                    : seatless
                      ? seatlessBeat === "forced_fill"
                        ? "Assigning a stranded position"
                        : seatlessBeat === "unwinnable"
                          ? "Neither roster can use this player"
                          : "Settling the lot"
                      : yours
                        ? lastEvent && !lastEvent.startsWith("You")
                          ? `${lastEvent} — your move`
                          : "Your move"
                        : `${opponentName} is deciding`}
              </span>
            </p>

            {/* THE SOLD MOMENT and the opponent's action, over the stage's top
                zone. Neither intercepts a pointer; the controls below are live. */}
            <div className="sd-overlays" aria-hidden="true">
              {reveal ? <SoldStamp lot={reveal} seatNames={seatNames} yourSeat={yourSeat} queued={queued} /> : null}
            </div>

            {candidate ? (
              <div className="sd-lot" data-testid="td-candidate">
                {/* ONLY THE LOT ITSELF ARRIVES. The clock and the controls
                    under it hold still, so a control is never moving under a
                    finger that is about to press it. */}
                <CardArrival arrivalKey={`${publicState.lot_index}:${candidate.player_slug}`} variant="stage" className="sd-lot-card" testId="td-lot-card">
                <div className="sd-lot-identity">
                  <PlayerAvatar name={candidate.player_name} size={56} imageUrl={candidate.headshot_url} />
                  <span className="sd-lot-name" data-testid="td-candidate-name">{candidate.player_name}</span>
                  <span className="sd-lot-meta" data-testid="td-candidate-season">
                    {candidate.anchor_season}
                    {candidate.team ? ` · ${candidate.team}` : ""}
                  </span>
                  <span className="sd-lot-positions">
                    {candidate.positions.map((position) => (
                      <span key={position} className="sd-lot-position" data-fits-you={yourTargets.has(position) ? "true" : "false"}>
                        {position}
                      </span>
                    ))}
                  </span>
                </div>

                {publicState.lot_kind === "forced_fill" || seatlessBeat === "forced_fill" ? (
                  <p className="sd-lot-note">Assigned without a competitive lot — the other roster could never use this position.</p>
                ) : null}

                <div className="sd-bid" data-testid="td-standing-bid" data-contested={contested ? "true" : "false"}>
                  {/* THE OPPONENT'S ACTION lands right under the figure it
                      changed, never over the player's identity. Hidden from
                      assistive tech: the turn line above already says it. */}
                  {/* AND NOT OVER YOUR OWN DECISION. The moment is the
                      OPPONENT's last action; while this client's command is
                      in flight the same zone is carrying the player's own
                      committed figure ("Your bid · $2 · Confirming"), and a
                      capture caught the moment card sitting on top of it.
                      The turn line above already restates the opponent's
                      action, so nothing is lost by holding it for the length
                      of one request. */}
                  <div className="sd-bid-moment" aria-hidden="true">
                    <EventMoment
                      moment={reveal || phase === "pending" ? null : moment}
                      onDone={onDismissMoment}
                      testId="td-moment"
                      className="sd-moment"
                    />
                  </div>
                  <span className="sd-bid-label">Current bid</span>
                  <BidTransition
                    value={opened ? publicState.current_bid : 0}
                    format={formatDollars}
                    holder={bidHolder}
                    caption={bidCaption}
                    pendingValue={lockedAmount}
                    size="lg"
                    testId="td-bid-transition"
                    valueTestId="td-standing-amount"
                    captionTestId="td-standing-holder"
                  />
                </div>

                </CardArrival>

                <PeakV2ShowdownClock
                  phase={phase}
                  deadlineAt={clockDeadlineAt}
                  activeSeat={active}
                  yourSeat={yourSeat}
                  opponentIsBot={opponentIsBot}
                  opponentName={opponentName}
                  consequence={consequence}
                  opponentDeadlineAt={turnDeadlineAt}
                  heldLabel={seatlessBeat === "unwinnable" ? "No legal fit — passing" : seatlessBeat === "forced_fill" ? "Assigning" : null}
                  pendingCommand={inFlightAction?.command ?? null}
                  pendingAmount={inFlightAction?.amount ?? 0}
                  onExpire={onExpire}
                />

                <p className="sd-sealed">The PEAK3 score is sealed until this lot sells.</p>

                <div className="sd-controls-wrap">
                  <PeakV2ShowdownBidControls
                    publicState={publicState}
                    privateState={privateState}
                    seatNames={seatNames}
                    amount={amount}
                    onAmountChange={setAmount}
                    pending={pending}
                    pendingCommand={inFlightAction?.command ?? null}
                    live={controlsLive}
                    expired={locallyExpired && !pending}
                    onAct={onAct}
                  />
                  {proposing || lockedAmount !== null ? (
                    <p className="sd-projection" data-testid="td-projection">
                      Leaves you {formatDollars(projected ?? yourSeatPublic.budget)}
                      {privateState.reserve_floor > 0 ? ` · ${formatDollars(privateState.reserve_floor)} reserved for open spots` : ""}
                    </p>
                  ) : null}
                </div>

                {lastEvent ? (
                  <p className="sd-ticker" data-testid="td-lot-ticker">
                    {lastEvent}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {opponent ? (
            <div className="sd-side sd-side-them">
              <Lineup
                label={opponentName}
                seat={opponent}
                owner={opponentIsBot ? "bot" : "rival"}
                isYou={false}
                isActive={active === opponent.seat_index}
                idle={seatless || phase === "intro"}
                publicState={publicState}
                projectedBudget={null}
                reserve={0}
                targets={theirTargets}
                align="end"
                turnDeadlineAt={turnDeadlineAt}
                turnTotalSeconds={railTotal}
                railState={railFor(opponent.seat_index).state}
                railLabel={railFor(opponent.seat_index).label}
              />
            </div>
          ) : null}
        </div>
      </div>
    </PeakV2Shell>
  );
}
