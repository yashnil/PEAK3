"use client";

/**
 * PeakV2ShowdownLive — the $20 Showdown LIVE auction (Pass 3).
 *
 * Verified against the reference (E2 page 19): YOUR ROSTER / CURRENT LOT +
 * BID + CLOCK (dominant, center) / OPPONENT ROSTER — a televised player
 * market, not a finance terminal. One warm controlled light on the current
 * player, real settled-lot ticker (`SettledLotTray`, reused verbatim — a
 * secondary disclosure, not the visual focus). Every field below is the
 * exact same `TwentyDollarPublicState`/`TwentyDollarPrivateState`
 * `AuctionRoom` already computed — no second poll, no second reducer.
 *
 * Forced-fill note: `publicState.autofilled` marks a lot the server filled
 * without a competitive bid (union-eligibility/closeout auto-assign) — this
 * renders a plain "Auto-filled — not a competitive lot" statement rather
 * than dressing it as a normal sale, so it is never mistaken for one.
 */

import type { ReactNode } from "react";
import PeakV2Shell from "../PeakV2Shell";
import PeakV2ArenaLight from "../PeakV2ArenaLight";
import PeakV2GameStatus from "../PeakV2GameStatus";
import PeakV2Score from "../PeakV2Score";
import PeakV2Rule from "../PeakV2Rule";
import PeakV2ShowdownClock from "./PeakV2ShowdownClock";
import PeakV2ShowdownBidControls from "./PeakV2ShowdownBidControls";
import { SettledLotTray, ResumeRecap } from "@/components/twenty-dollar/LotLedger";
import { TurnBanner, LotReveal } from "@/components/twenty-dollar/AuctionBoard";
import { formatDollars, type TwentyDollarPublicState, type TwentyDollarPrivateState, type ResolvedLot } from "@/lib/twenty-dollar-api";
import type { ShowdownPhase } from "@/components/twenty-dollar/useShowdownPhase";

function SlotList({
  slots,
  bySlot,
  align,
}: {
  slots: string[];
  bySlot: Map<string, { player_name: string; price: number; autofilled: boolean }>;
  align: "start" | "end";
}) {
  return (
    <ul className="mt-1 flex flex-col">
      {slots.map((slot) => {
        const entry = bySlot.get(slot);
        return (
          <li
            key={slot}
            className="flex items-center justify-between gap-2 py-1.5"
            style={{ borderBottom: "1px solid var(--v2-border-subtle)", flexDirection: align === "end" ? "row-reverse" : "row" }}
          >
            <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.625rem", color: "var(--v2-text-muted)", flexShrink: 0 }}>{slot}</span>
            {entry ? (
              <span className="truncate" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 600, color: "var(--v2-text-primary)" }}>
                {entry.player_name}
              </span>
            ) : (
              <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>Open</span>
            )}
            <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", color: "var(--v2-text-secondary)", flexShrink: 0 }}>
              {entry ? (entry.autofilled ? "auto" : formatDollars(entry.price)) : "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function RosterColumn({
  label,
  seatIndex,
  budget,
  filledSlots,
  totalSlots,
  marketSkips,
  isActive,
  roster,
  slots,
  align,
}: {
  label: string;
  seatIndex: number;
  budget: number;
  filledSlots: number;
  totalSlots: number;
  marketSkips: number;
  isActive: boolean;
  roster: { slot: string | null; player_name: string; price: number; autofilled: boolean }[];
  slots: string[];
  align: "start" | "end";
}) {
  const bySlot = new Map(roster.filter((r) => r.slot).map((r) => [r.slot as string, r]));
  return (
    <div className="flex flex-col gap-3" style={{ textAlign: align === "end" ? "right" : "left" }}>
      <div className="flex items-baseline justify-between gap-2" style={{ flexDirection: align === "end" ? "row-reverse" : "row" }}>
        {isActive ? (
          <span data-testid={`td-seat-live-${seatIndex}`}>
            <PeakV2GameStatus label={`${label} · on the clock`} state="active" />
          </span>
        ) : (
          <PeakV2GameStatus label={label} state="idle" />
        )}
      </div>
      <div className="flex gap-4" style={{ flexDirection: align === "end" ? "row-reverse" : "row" }}>
        <span
          data-testid={`td-budget-${seatIndex}`}
          data-active={isActive ? "true" : "false"}
        >
          <span data-testid={`td-seat-budget-${seatIndex}`}>
            <PeakV2Score value={formatDollars(budget)} label="Budget left" tone="accent" />
          </span>
        </span>
        <PeakV2Score value={`${filledSlots}/${totalSlots}`} label="Roster" />
        <PeakV2Score value={marketSkips} label="Skips" />
      </div>
      {/* Mobile: the current lot owns the viewport (see the parent's DOM
          order); each roster collapses to this one disclosure so it is
          compact-but-reachable rather than pushing the lot below the fold.
          Desktop keeps the plain always-open list. */}
      <details className="sm:hidden">
        <summary
          style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)", cursor: "pointer" }}
        >
          {filledSlots}/{totalSlots} slots filled — view roster
        </summary>
        <SlotList slots={slots} bySlot={bySlot} align={align} />
      </details>
      <div className="hidden sm:block">
        <SlotList slots={slots} bySlot={bySlot} align={align} />
      </div>
    </div>
  );
}

export interface PeakV2ShowdownLiveProps {
  publicState: TwentyDollarPublicState;
  privateState: TwentyDollarPrivateState;
  seatNames: string[];
  yourSeat: number | null;
  phase: ShowdownPhase;
  clockDeadlineAt: number | null;
  turnDeadlineAt: number | null;
  controlsLive: boolean;
  busy: boolean;
  inFlightAction: { command: "bid" | "pass"; amount: number } | null;
  locallyExpired: boolean;
  consequence: string | null;
  revealedHistory: ResolvedLot[];
  /** Lots that settled while THIS client was live — a REVEAL QUEUE played
   *  one at a time (`LotReveal`, reused as-is), distinct from `recap`
   *  below. `null` when nothing is currently revealing. See
   *  `LotLedger.tsx`'s own docstring for why the two are never conflated. */
  reveal: ResolvedLot | null;
  /** How many more lots are queued behind the one currently revealing. */
  queued: number;
  /** Lots that settled across a genuine resume boundary (`ResumeRecap`,
   *  reused as-is) — the "while you were away" catch-up, never confused
   *  with the live reveal queue above. */
  recap: ResolvedLot[];
  onAcknowledgeRecap: () => void;
  /** A rejected command or transport failure, already translated into
   *  player-facing words by `explainRejection`/`explainTransportError` —
   *  this component never sees raw server prose. `null` when there is
   *  nothing to report. */
  error?: { message: string; tone: "board" | "rule" | "retry" | "reload" } | null;
  onExpire: () => void;
  onDismissError?: () => void;
  onSubmit: (command: "bid" | "pass", amount: number) => void;
  /** "How to play" (`HowToPlay`, `data-testid="td-rules"`) — reused as-is
   *  rather than rebuilt: a native `<details>` disclosure that needs no
   *  visual re-skin to keep working, and the room loses no functionality
   *  just because the shell around it changed. */
  helpControl?: ReactNode;
  /** "Forfeit match" (`ForfeitControl`) — same reuse reasoning as
   *  `helpControl`: without it the only way out of a live match under V2 is
   *  closing the tab, which strands the opponent on a ticking clock. */
  forfeitControl?: ReactNode;
}

export default function PeakV2ShowdownLive({
  publicState,
  privateState,
  seatNames,
  yourSeat,
  phase,
  clockDeadlineAt,
  turnDeadlineAt,
  controlsLive,
  busy,
  inFlightAction,
  locallyExpired,
  consequence,
  revealedHistory,
  reveal,
  queued,
  recap,
  onAcknowledgeRecap,
  error = null,
  onExpire,
  onDismissError,
  onSubmit,
  helpControl,
  forfeitControl,
}: PeakV2ShowdownLiveProps) {
  const yourSeatPublic = publicState.seats[yourSeat ?? 0];
  const opponentSeats = publicState.seats.filter((s) => s.seat_index !== yourSeat);
  const opponent = opponentSeats[0];
  const candidate = publicState.candidate;
  const opened = publicState.current_bid > 0;
  const holder = publicState.high_bidder;
  const uncontestedForcedFill = publicState.autofilled;

  return (
    <PeakV2Shell width="live-wide">
      <div className="py-6" data-testid="td-game">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <PeakV2GameStatus label={`Lot ${Math.min(publicState.lot_index + 1, publicState.max_lots)} of ${publicState.market_phase === "closeout" ? publicState.max_lots : publicState.standard_market_lots}`} state="active" />
            <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
              {publicState.market_phase === "closeout" ? "Closeout market" : "Standard market"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {helpControl}
            {forfeitControl}
          </div>
        </div>

        {/* THE SINGLE aria-live turn surface in the room (see legacy
            `TurnBanner`'s own comment for why it lives here and nowhere
            else) — reused as-is rather than rebuilt: it is the accessible
            "whose turn is it" contract every player, sighted or not, needs,
            and it was previously silently dropped for V2 players. */}
        <TurnBanner
          activeSeat={publicState.active_seat}
          yourSeat={yourSeat}
          seatNames={seatNames}
          phase={phase}
        />

        <PeakV2Rule spacing="sm" />

        {/* THE ERROR IS DISMISSIBLE AND SELF-CLEARING, same contract as
            legacy's `td-error` — this was previously computed by the room
            (`explainRejection`/`explainTransportError`) and silently
            dropped on the floor for V2 players: a rejected bid produced no
            feedback at all, just a clock and controls resetting with no
            explanation. `tone` picks the same board/rule/retry/reload
            distinction the message itself was already written for; only
            `retry`/`reload` — genuine failures, not "the board moved on
            under you" — get the negative color, so an ordinary "someone
            else acted first" explanation does not read as an error the
            player caused. */}
        {error ? (
          <div
            role="alert"
            data-testid="td-error"
            data-tone={error.tone}
            className="mt-3 flex items-start justify-between gap-4"
            style={{
              borderLeft: `2px solid ${error.tone === "retry" || error.tone === "reload" ? "var(--v2-color-negative)" : "var(--v2-color-accent)"}`,
              paddingLeft: "0.75rem",
            }}
          >
            <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}>
              {error.message}
            </p>
            {onDismissError ? (
              <button
                type="button"
                data-testid="td-error-dismiss"
                onClick={onDismissError}
                className="shrink-0"
                style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 600, color: "var(--v2-text-muted)" }}
              >
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}

        {/* "While you were away" — lots that settled across a genuine
            resume boundary, reused verbatim (see `LotLedger.tsx`'s own
            docstring on why this is distinct from the live reveal queue
            below and never confused with it). Previously silently dropped
            for V2 players. */}
        {recap.length > 0 && (
          <div className="mt-3">
            <ResumeRecap lots={recap} seatNames={seatNames} yourSeat={yourSeat} onDismiss={onAcknowledgeRecap} />
          </div>
        )}

        {/* Lots that settle WHILE this client is live — played one at a
            time, each holding centre stage, reused verbatim from legacy's
            `LotReveal`. */}
        {reveal && (
          <div className="mt-3">
            <LotReveal lot={reveal} seatNames={seatNames} yourSeat={yourSeat} queued={queued} />
          </div>
        )}

        {/* Mobile: the lot owns the viewport first (`order-1`); each roster
            is a compact disclosure below it. Desktop drops the ordering for
            the real three-column grid.

            `lg:border-x` + `lg:px-10` (colour set via `style`, width gated
            by the breakpoint class, same convention as everywhere else in
            this file) draws the two rosters and the center lot into ONE
            connected market rather than three independently floating
            blocks separated only by a wide flex gap — a hairline seam, not
            a card border, per the brief's "hairlines, not nested cards."
            `gap-8 lg:gap-6` gives back a little of the width that seam
            spends. */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr_220px] lg:gap-6" data-testid="td-table">
          <div className="order-2 lg:order-none">
            <RosterColumn
              label="You"
              seatIndex={yourSeatPublic.seat_index}
              budget={yourSeatPublic.budget}
              filledSlots={yourSeatPublic.filled_slots}
              totalSlots={publicState.slots.length}
              marketSkips={yourSeatPublic.market_skips}
              isActive={publicState.active_seat === yourSeat}
              roster={yourSeatPublic.roster}
              slots={publicState.slots}
              align="start"
            />
          </div>

          <div
            className="relative order-1 min-w-0 border-x-0 lg:order-none lg:border-x lg:px-10"
            style={{ borderColor: "var(--v2-border-subtle)" }}
          >
            {/* `pulse` — "a currently-active focus" is exactly this prop's
                documented use (`PeakV2ArenaLight`'s own docstring): the one
                lot up for bid right now, not a static backdrop. */}
            {candidate ? <PeakV2ArenaLight y="-8%" intensity="focus" pulse /> : null}
            {candidate ? (
              <div className="relative flex flex-col items-center py-4 text-center">
                {/* The lot's identity is the reason this whole screen
                    exists — it was rendering at the SAME "UI/PLAYER
                    IDENTITY" size a roster row uses. A bespoke, larger
                    treatment here (still the UI typeface/weight — no
                    display-serif per CLAUDE.md's typography roles, since
                    this is identity, not a cinematic moment) rather than
                    stretching the shared `PeakV2PlayerIdentity` primitive,
                    which every other roster row on this exact screen still
                    uses unchanged. */}
                <span
                  style={{
                    fontFamily: "var(--v2-font-ui)",
                    fontWeight: 700,
                    fontSize: "1.75rem",
                    letterSpacing: "-0.012em",
                    color: "var(--v2-text-primary)",
                  }}
                >
                  {candidate.player_name}
                </span>
                <span
                  className="mt-1"
                  style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}
                >
                  {`${candidate.anchor_season}${candidate.team ? ` · ${candidate.team}` : ""} · ${candidate.positions.join("/")}`}
                </span>

                {uncontestedForcedFill ? (
                  <p className="mt-3 text-xs font-semibold" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-color-accent)" }}>
                    Auto-filled — not a competitive lot
                  </p>
                ) : null}

                <div className="mt-6 flex items-start justify-center gap-10">
                  <div className="text-center">
                    <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--v2-text-muted)" }}>
                      Current bid
                    </span>
                    <div
                      data-testid="td-standing-amount"
                      style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "3rem", fontWeight: 700, color: "var(--v2-color-accent)", lineHeight: 1 }}
                    >
                      {formatDollars(opened ? publicState.current_bid : 0)}
                    </div>
                    <p
                      data-testid="td-standing-holder"
                      style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}
                    >
                      {opened ? (holder === yourSeat ? "You lead" : `${seatNames[holder ?? -1] ?? "Opponent"} leads`) : "Floor is open"}
                    </p>
                  </div>

                  <PeakV2ShowdownClock
                    phase={phase}
                    deadlineAt={clockDeadlineAt}
                    activeSeat={publicState.active_seat}
                    yourSeat={yourSeat}
                    consequence={consequence}
                    turnKey={`${publicState.lot_index}:${publicState.lot_actions.length}:${publicState.active_seat ?? "none"}`}
                    opponentDeadlineAt={turnDeadlineAt}
                    pendingCommand={inFlightAction?.command ?? null}
                    pendingAmount={inFlightAction?.amount ?? 0}
                    onExpire={onExpire}
                  />
                </div>

                <p className="mt-2" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
                  The PEAK3 score is sealed until this lot sells.
                </p>

                <div className="mt-6 w-full max-w-sm">
                  <PeakV2ShowdownBidControls
                    publicState={publicState}
                    privateState={privateState}
                    seatNames={seatNames}
                    busy={busy}
                    live={controlsLive}
                    expired={locallyExpired && !busy}
                    onSubmit={onSubmit}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {opponent ? (
            <div className="order-3 lg:order-none">
              <RosterColumn
                label={seatNames[opponent.seat_index] ?? "Opponent"}
                seatIndex={opponent.seat_index}
                budget={opponent.budget}
                filledSlots={opponent.filled_slots}
                totalSlots={publicState.slots.length}
                marketSkips={opponent.market_skips}
                isActive={publicState.active_seat === opponent.seat_index}
                roster={opponent.roster}
                slots={publicState.slots}
                align="end"
              />
            </div>
          ) : null}
        </div>

        {/* `SettledLotTray` renders nothing before the first lot has sold
            (shared with legacy — unchanged here). A rule drawn above empty
            space reads as a cut-off section, so it only appears once there
            is real settled history for it to introduce. */}
        {revealedHistory.length > 0 ? (
          <>
            <PeakV2Rule spacing="lg" />
            <SettledLotTray history={revealedHistory} seatNames={seatNames} yourSeat={yourSeat} />
          </>
        ) : null}
      </div>
    </PeakV2Shell>
  );
}
