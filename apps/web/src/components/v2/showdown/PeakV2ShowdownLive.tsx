"use client";

/**
 * PeakV2ShowdownLive — the $20 Showdown's auction floor (game-feel pass 2;
 * broadcast-bench pass).
 *
 * THE HIERARCHY DURING BIDDING, top to bottom of the stage:
 *
 *   possession     one strip naming who controls the lot, pointing at the
 *                  bench that holds it (the room's single aria-live line)
 *   the lot        the player and their exact peak, on a card that ENTERS,
 *                  with which bench has an open spot for them
 *   the bid        the standing figure, the largest numeral on the page,
 *                  underlined in the colour of the bench that holds it
 *   the clock      one depleting auction clock, whoever owns it
 *   the controls   the proposed bid, live in the same frame it is stepped,
 *                  and one explicit action ("Bid $7")
 *
 * THE SIDES ARE BENCHES, NOT CARDS. Each one is a scoreboard for its seat:
 * name, whether it is on the clock, what it has done on THIS lot (leads,
 * outbid, passed, used a skip), the money (with the bid ceiling and the
 * reserve for your own seat), spots and skips as counts and pips, the flags
 * that make a late lot tense (final open spot, reserve lock, no skips left),
 * and the five slots. The active bench is lit in its owner's colour; the
 * other recedes through its SURFACE, never through `opacity` on its text.
 * Below 1024px the benches fall under the stage, so a two-cell scorebug
 * above the stage keeps both budgets and open spots on screen while bidding.
 *
 * WHAT DOES NOT MOVE. Only the lot card arrives; the clock and the controls
 * sit outside it. The SOLD banner plays over the stage's top strip with
 * `pointer-events: none` and never gates a control.
 *
 * Every field is the same `TwentyDollarPublicState` / `TwentyDollarPrivateState`
 * the room already computed -- no second poll, no second reducer, no rule
 * re-derived here, and no PEAK3 score for a live candidate, because the server
 * does not send one.
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
  type TwentyDollarPrivateState,
  type TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";
import type { ShowdownPhase } from "@/components/twenty-dollar/useShowdownPhase";

type Owner = "you" | "rival" | "bot";

// ---------------------------------------------------------------------------
// Bench facts — read from published fields, never a rule re-derived
// ---------------------------------------------------------------------------

type LotStatusKind = "leading" | "bid" | "out" | "waiting" | "idle";

/** What this seat has done on the CURRENT lot, in a few words. */
export function lotStatusOf(
  seat: SeatPublic,
  publicState: TwentyDollarPublicState,
  { idle, idleLabel }: { idle: boolean; isActive: boolean; idleLabel: string },
): { kind: LotStatusKind; label: string } {
  if (idle || !publicState.candidate) return { kind: "idle", label: idleLabel };
  if (publicState.current_bid > 0 && publicState.high_bidder === seat.seat_index) {
    return { kind: "leading", label: `Leads at ${formatDollars(publicState.current_bid)}` };
  }
  const passes = publicState.lot_actions.filter((a) => a.seat_index === seat.seat_index && a.action === "pass");
  const lastPass = passes[passes.length - 1];
  if (lastPass) {
    return {
      kind: "out",
      label: lastPass.timed_out ? "Out · clock expired" : lastPass.consumed_skip ? "Skipped · 1 skip spent" : "Passed",
    };
  }
  if (seat.roster_full) return { kind: "out", label: "Roster complete" };
  if (!seat.in_lot) return { kind: "out", label: "Out of this lot" };
  if (seat.lot_bid > 0) return { kind: "bid", label: `Outbid at ${formatDollars(seat.lot_bid)}` };
  // Not "Deciding" for the seat on the clock: its rail and the stage clock
  // already say whose move it is.
  return { kind: "waiting", label: "No action yet" };
}

/**
 * The flags that make a late lot tense. Only for states the server publishes
 * directly: a seat's open spots and skips (public), and -- for your own seat
 * only -- the bid ceiling and the reserve lock (private).
 */
export function benchFlagsOf(
  seat: SeatPublic,
  slotCount: number,
  publicState: TwentyDollarPublicState,
  privateState: TwentyDollarPrivateState | null,
): string[] {
  const flags: string[] = [];
  const open = slotCount - seat.filled_slots;
  if (seat.roster_full) return flags;
  if (open === 1) flags.push("Final open spot");
  if (privateState) {
    const floor = Math.max(1, privateState.minimum_bid);
    if (privateState.bid_blocked_reason === "insufficient_reserve") {
      flags.push("Reserve lock");
    } else if (publicState.candidate && privateState.in_lot && privateState.max_bid >= floor && privateState.max_bid <= 3 && privateState.max_bid < seat.budget) {
      flags.push(`Only ${formatDollars(privateState.max_bid)} biddable`);
    }
  }
  if (seat.market_skips === 0) flags.push("No skips left");
  return flags;
}

const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

/** The surname, for the five-across slot strip on a phone, where a full name
 *  cannot fit a fifth of 358px. The full name stays in the DOM beside it. */
export function slotShortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => !NAME_SUFFIXES.has(part.toLowerCase()));
  return parts.length > 1 ? parts[parts.length - 1] : name;
}

function Pips({ total, on }: { total: number; on: number }) {
  return (
    <span className="sd-pips" aria-hidden="true">
      {Array.from({ length: Math.max(0, total) }, (_, index) => (
        <span key={index} className="sd-pip" data-on={index < on ? "true" : "false"} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// A bench: identity, this lot, money, spots and skips, five slots
// ---------------------------------------------------------------------------

function Lineup({
  label,
  seat,
  owner,
  isYou,
  isActive,
  idle,
  idleLabel,
  publicState,
  privateState,
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
  owner: Owner;
  isYou: boolean;
  isActive: boolean;
  idle: boolean;
  idleLabel: string;
  publicState: TwentyDollarPublicState;
  /** Your own seat's private state; `null` for the opponent's bench. */
  privateState: TwentyDollarPrivateState | null;
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
  const status = lotStatusOf(seat, publicState, { idle, isActive, idleLabel });
  const flags = benchFlagsOf(seat, total, publicState, privateState);
  const ceiling =
    privateState && publicState.candidate && !idle && privateState.max_bid >= Math.max(1, privateState.minimum_bid) && privateState.bid_blocked_reason !== "insufficient_reserve"
      ? privateState.max_bid
      : null;

  return (
    <ActiveSeat
      state={idle ? "idle" : isActive ? "active" : "receded"}
      owner={owner}
      complete={complete}
      className={`sd-lineup${flags.length > 0 ? " sd-lineup-tense" : ""}`}
      testId={`td-roster-${seat.seat_index}`}
    >
      <div className="sd-bench-head" data-align={align}>
        <div className="sd-bench-id">
          <span className="sd-bench-role">{isYou ? "Your bench" : owner === "bot" ? "Bot opponent" : "Opponent"}</span>
          <span className="sd-bench-name">{label}</span>
        </div>
        {/* NO SECOND TURN LABEL. The rail directly below already prints
            "Your move" / "Thinking" / "Waiting" with the seconds; a status
            here repeated it ("WAITING" twice on the idle bench). The seat's
            on-the-clock marker stays for assistive tech and the lit frame
            carries it visually. */}
        {isActive ? (
          <span className="sr-only" data-testid={`td-seat-live-${seat.seat_index}`}>
            On the clock
          </span>
        ) : complete ? (
          <span className="sd-bench-waiting">Roster set</span>
        ) : null}
      </div>

      {/* THE SEAT'S OWN TURN RAIL, immediately under its name. The bar is the
          SAME deadline the stage's clock counts (see `turnDeadlineAt`), so
          there is one authority and one number. */}
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

      <p className="sd-bench-lot" data-testid={`td-lot-status-${seat.seat_index}`} data-kind={status.kind} data-align={align}>
        <span className="sd-bench-lot-label">This lot</span>
        <span className="sd-bench-lot-value">{status.label}</span>
      </p>

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
        {!complete ? (
          <p className="sd-bench-reach" data-align={align}>
            <span>
              <strong className="pk-numeral">{formatDollars(seat.budget)}</strong> for {open} open {open === 1 ? "spot" : "spots"}
            </span>
            {ceiling !== null ? (
              <span>
                bid up to <strong className="pk-numeral">{formatDollars(ceiling)}</strong>
              </span>
            ) : null}
          </p>
        ) : null}
        <div className="sd-lineup-facts" data-align={align}>
          <span className="sd-fact" data-testid={`td-spots-${seat.seat_index}`}>
            <span className="sd-fact-label">{open === 1 ? "Spot left" : "Spots left"}</span>
            {/* Pips BEFORE the count in DOM order (CSS `order` draws them
                under it): the e2e suite reads a stat's count as its last span. */}
            <Pips total={total} on={seat.filled_slots} />
            <span className="sd-fact-value">{open}</span>
          </span>
          <span className="sd-fact" data-testid={`td-skips-${seat.seat_index}`}>
            <span className="sd-fact-label">{seat.market_skips === 1 ? "Skip left" : "Skips left"}</span>
            <Pips total={publicState.market_skips_per_seat} on={seat.market_skips} />
            <span className="sd-fact-value">{seat.market_skips}</span>
          </span>
        </div>
      </div>

      {flags.length > 0 ? (
        <ul className="sd-bench-flags" data-align={align} data-testid={`td-bench-flags-${seat.seat_index}`}>
          {flags.map((flag) => (
            <li key={flag} className="sd-flag">
              {flag}
            </li>
          ))}
        </ul>
      ) : null}

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
                  <span className="sd-slot-name">
                    <span className="sd-slot-name-full">{entry.player_name}</span>
                    <span className="sd-slot-name-short" aria-hidden="true">
                      {slotShortName(entry.player_name)}
                    </span>
                  </span>
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
// The scorebug — both benches in one line, for screens where they are below
// ---------------------------------------------------------------------------

function ScoreBug({
  seats,
  yourSeat,
  seatNames,
  opponentOwner,
  active,
  slotCount,
}: {
  seats: SeatPublic[];
  yourSeat: number | null;
  seatNames: string[];
  opponentOwner: Owner;
  active: number | null;
  slotCount: number;
}) {
  // Decorative duplicate of the two benches below it: hidden from assistive
  // tech, which reads the benches themselves.
  return (
    <div className="sd-scorebug" aria-hidden="true">
      {seats.map((seat) => {
        const mine = seat.seat_index === yourSeat;
        const open = slotCount - seat.filled_slots;
        return (
          <div
            key={seat.seat_index}
            className="sd-bug"
            data-owner={mine ? "you" : opponentOwner}
            data-active={active === seat.seat_index ? "true" : "false"}
            data-align={mine ? "start" : "end"}
          >
            <span className="sd-bug-name">{mine ? "You" : (seatNames[seat.seat_index] ?? "Opponent")}{active === seat.seat_index ? " · on the clock" : ""}</span>
            <span className="sd-bug-money pk-numeral">{formatDollars(seat.budget)}</span>
            <span className="sd-bug-meta">
              {seat.roster_full ? "Roster set" : `${open} open`} · {seat.market_skips} {seat.market_skips === 1 ? "skip" : "skips"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The SOLD banner — the previous lot's payoff, over the top strip, never blocking
// ---------------------------------------------------------------------------

function SoldStamp({ lot, seatNames, yourSeat, queued }: { lot: ResolvedLot; seatNames: string[]; yourSeat: number | null; queued: number }) {
  const won = lot.winner_seat;
  const mine = won !== null && won === yourSeat;
  const outcome = won === null ? "unsold" : lot.decided_by === "forced_fill" ? "assigned" : mine ? "yours" : "theirs";
  const headline = won === null ? "UNSOLD" : lot.decided_by === "forced_fill" ? "ASSIGNED" : "SOLD";
  const slot = (lot.slot_options ?? [])[0];
  return (
    <div className="sd-sold" data-testid="td-lot-reveal" data-outcome={outcome} data-queued={queued} data-lot={lot.lot_index} role="status" aria-live="off">
      <span className="sd-sold-flash" aria-hidden="true" />
      <span className="sd-sold-row">
        <span className="sd-sold-eyebrow" data-testid="td-reveal-lot">
          Lot {lot.lot_index + 1}
        </span>
        <span className="sd-sold-headline">{headline}</span>
        {won !== null ? <span className="sd-sold-price pk-numeral">{formatDollars(lot.price)}</span> : null}
      </span>
      <span className="sd-sold-line">
        <span className="sd-sold-name">{lot.candidate.player_name}</span>
        {won === null ? (
          <span className="sd-sold-to">{verdictOf(lot, seatNames, yourSeat)}</span>
        ) : (
          <span className="sd-sold-to">
            {mine ? "to you" : `to ${seatNames[won] ?? "the other seat"}`}
            {slot ? ` · ${slot}` : ""}
          </span>
        )}
        <span className="sd-sold-score" data-testid="td-reveal-score">
          <span className="pk-numeral">{lot.candidate.prime_score.toFixed(1)}</span>
          <span className="sd-sold-score-label"> PEAK3 · {lot.candidate.anchor_season}</span>
        </span>
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
  const opponentOwner: Owner = opponentIsBot ? "bot" : "rival";
  const seatless = active === null && phase !== "intro";
  const seatlessBeat = view.turn_phase === "lot_unwinnable" ? "unwinnable" : view.turn_phase === "lot_forced_fill" ? "forced_fill" : null;
  const idleLabel = phase === "intro" ? "Not started" : "Between lots";

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

  const bidHolder: "you" | "rival" | "bot" | "none" = !opened || holder === null ? "none" : holder === yourSeat ? "you" : opponentOwner;
  const bidCaption = !opened
    ? `No bid yet · opens at ${formatDollars(Math.max(1, publicState.minimum_bid))}`
    : holder === yourSeat
      ? "You lead"
      : `${seatNames[holder ?? -1] ?? "Opponent"} leads`;
  const lastEvent = lastActionLabel(publicState, yourSeat, seatNames);
  const contested = opened && publicState.lot_actions.filter((a) => a.action === "bid").length >= 3;
  const momentShown = moment !== null && !reveal && phase !== "pending";
  // THE HANDOFF BETWEEN LOTS (pass 5). While the previous lot's SOLD beat is
  // still playing, the lot underneath is the NEXT one -- said in words, so the
  // new name reads as an arrival rather than a swap under the banner.
  const nextOnBlock = reveal !== null && candidate !== null && publicState.lot_index > reveal.lot_index;
  const botThinking = opponentIsBot && phase === "decide" && active !== null && active !== yourSeat;

  // THE STAKES OF THIS PRESS, on your own turn only, from published fields.
  const yourOpen = publicState.slots.length - yourSeatPublic.filled_slots;
  const stakes: string[] = [];
  if (controlsLive && candidate) {
    if (yourOpen === 1 && yourTargets.size > 0) stakes.push("Winning this lot completes your roster");
    const floor = Math.max(1, privateState.minimum_bid);
    if (privateState.bid_blocked_reason === null && privateState.max_bid === floor) stakes.push(`Only one legal bid: ${formatDollars(floor)}`);
    if (!privateState.can_pass) stakes.push("No skip left to decline with");
  }

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
      <div
        className="sd-room py-5"
        data-arena="live"
        data-testid="td-game"
        data-phase={phase}
        data-contested={contested ? "true" : "false"}
        data-bot-thinking={botThinking ? "true" : "false"}
        data-sold-beat={reveal ? "true" : "false"}
      >
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
          <ScoreBug
            seats={[yourSeatPublic, ...(opponent ? [opponent] : [])]}
            yourSeat={yourSeat}
            seatNames={seatNames}
            opponentOwner={opponentOwner}
            active={phase === "intro" ? null : active}
            slotCount={publicState.slots.length}
          />

          <div className="sd-side sd-side-you">
            <Lineup
              label="You"
              seat={yourSeatPublic}
              owner="you"
              isYou
              isActive={yours}
              idle={seatless || phase === "intro"}
              idleLabel={idleLabel}
              publicState={publicState}
              privateState={privateState}
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

            {/* THE SINGLE aria-live turn surface in the room — and the
                possession strip: which bench controls the lot right now. */}
            <p
              className="sd-turn"
              data-testid="td-turn-indicator"
              data-your-turn={yours ? "true" : "false"}
              data-phase={phase}
              data-seat={active === null ? "none" : yours ? "a" : "b"}
              aria-live="polite"
            >
              <span className="sd-turn-arrow" data-dir="left" aria-hidden="true" />
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
              <span className="sd-turn-arrow" data-dir="right" aria-hidden="true" />
            </p>

            {/* THE SOLD MOMENT, over the stage's top strip. It never
                intercepts a pointer; the controls below are live. */}
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
                    <span className="sd-lot-eyebrow" data-next={nextOnBlock ? "true" : "false"} data-testid="td-lot-eyebrow">
                      {nextOnBlock ? "Next on the block" : "On the block"}
                      {publicState.lot_kind === "uncontested" ? " · uncontested" : ""}
                    </span>
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
                    <span className="sd-sealed">PEAK3 score sealed until sold</span>
                    {/* WHO HAS A PLACE FOR HIM. Your side is the server's own
                        feasibility answer (`candidate_fits`); the other side is
                        only which of his positions are still open on that
                        bench, and says exactly that. */}
                    <span className="sd-lot-fits">
                      <span className="sd-lot-fit" data-owner="you" data-on={yourTargets.size > 0 ? "true" : "false"}>
                        {yourTargets.size > 0 ? `Fits you at ${[...yourTargets].join("/")}` : "No fit on your bench"}
                      </span>
                      {opponent ? (
                        <span className="sd-lot-fit" data-owner={opponentOwner} data-on={theirTargets.size > 0 ? "true" : "false"}>
                          {theirTargets.size > 0 ? `${opponentName} has ${[...theirTargets].join("/")} open` : `${opponentName} has no open ${candidate.positions.join("/")}`}
                        </span>
                      ) : null}
                    </span>
                  </div>

                  {publicState.lot_kind === "forced_fill" || seatlessBeat === "forced_fill" ? (
                    <p className="sd-lot-note">Assigned without a competitive lot — the other roster could never use this position.</p>
                  ) : null}

                  <div className="sd-bid" data-testid="td-standing-bid" data-contested={contested ? "true" : "false"} data-holder={bidHolder}>
                    <span className="sd-bid-label">{contested ? "Bidding war · standing bid" : "Standing bid"}</span>
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

                  {/* THE NEWS ROW — one reserved line under the standing bid.
                      It carries the last action on the lot; the opponent's
                      moment ("raises to $2 · You are outbid") takes the same
                      line for its beat. It used to hang BELOW the bid as an
                      overlay, where it covered "To act", the timer bar and the
                      sealed line at the exact moment a player needs the clock.
                      The row's height is always reserved, so nothing under it
                      moves when a moment arrives or leaves. The moment is held
                      off while this client's own command is in flight (the
                      clock zone is carrying the committed figure) and while a
                      SOLD banner plays. */}
                  <div className="sd-bid-news" data-moment={momentShown ? "true" : "false"}>
                    {lastEvent ? (
                      <p className="sd-ticker" data-testid="td-lot-ticker">
                        {lastEvent}
                      </p>
                    ) : null}
                    <div className="sd-bid-moment" aria-hidden="true">
                      <EventMoment
                        moment={reveal || phase === "pending" ? null : moment}
                        onDone={onDismissMoment}
                        testId="td-moment"
                        className="sd-moment"
                      />
                    </div>
                  </div>
                </CardArrival>

                {/* THE PADDLE: the clock and the hands, in one dock under the
                    block. Nothing in here moves when a lot arrives. */}
                <div className="sd-dock">
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

                <div className="sd-controls-wrap">
                  {stakes.length > 0 ? (
                    <ul className="sd-stakes" data-testid="td-stakes">
                      {stakes.map((line) => (
                        <li key={line} className="sd-flag">
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : null}
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
                </div>
              </div>
            ) : null}
          </div>

          {opponent ? (
            <div className="sd-side sd-side-them">
              <Lineup
                label={opponentName}
                seat={opponent}
                owner={opponentOwner}
                isYou={false}
                isActive={active === opponent.seat_index}
                idle={seatless || phase === "intro"}
                idleLabel={idleLabel}
                publicState={publicState}
                privateState={null}
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
