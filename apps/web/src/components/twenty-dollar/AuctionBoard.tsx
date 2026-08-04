"use client";

import {
  formatDollars,
  type ResolvedRound,
  type SeatPublic,
  type TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";
import ComponentSilhouette from "./ComponentSilhouette";

/**
 * The board furniture: candidate card, budget meters, rosters, tie token,
 * auction history.
 *
 * Every component here renders SERVER STATE VERBATIM. None of them derives a
 * score, a legality or a winner -- if a number is on screen it was on the wire.
 */

// ---------------------------------------------------------------------------
// Candidate
// ---------------------------------------------------------------------------

/**
 * The card under the hammer.
 *
 * Shows the name, the season, the team and the positions the player is legal
 * at -- and nothing else, because nothing else is sent. The absence of a score
 * IS the game: you are bidding on what you know about the player.
 *
 * `key` on the outer element is the round index, which restarts the CSS entry
 * animation on every new candidate. That is the "dramatic reveal", done with a
 * keyframe rather than a timer, so `prefers-reduced-motion` can switch it off
 * in CSS without any JavaScript branch.
 */
export function CandidateCard({
  publicState,
  fits,
}: {
  publicState: TwentyDollarPublicState;
  fits: string[];
}) {
  const candidate = publicState.candidate;
  if (!candidate) return null;
  return (
    <article
      key={publicState.round_index}
      className="td-candidate td-enter"
      data-testid="td-candidate"
      aria-live="polite"
    >
      <p className="td-candidate-lot">Lot {publicState.round_index + 1}</p>
      <h2 className="td-candidate-name" data-testid="td-candidate-name">
        {candidate.player_name}
      </h2>
      <p className="td-candidate-meta">
        {candidate.anchor_season}
        {candidate.team ? ` · ${candidate.team}` : ""}
      </p>
      <ul className="td-position-list" aria-label="Eligible positions">
        {candidate.positions.map((position) => (
          <li
            key={position}
            className={
              fits.includes(position) ? "td-position td-position-open" : "td-position"
            }
            data-testid={`td-position-${position}`}
          >
            {position}
          </li>
        ))}
      </ul>
      <p className="td-candidate-hint">
        Peak season only. The score is sealed until both bids are in.
      </p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/** The $20 meter. Width is a percentage of the starting budget, which the
 *  server's own numbers determine -- spent + remaining is always $20. */
export function BudgetMeter({
  seat,
  startingBudget = 20,
  label,
}: {
  seat: SeatPublic;
  startingBudget?: number;
  label: string;
}) {
  const pct = Math.max(0, Math.min(100, (seat.budget / startingBudget) * 100));
  return (
    <div className="td-budget" data-testid={`td-budget-${seat.seat_index}`}>
      <div className="td-budget-head">
        <span className="td-budget-name">{label}</span>
        <span className="td-budget-amount">{formatDollars(seat.budget)}</span>
      </div>
      <div
        className="td-budget-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={startingBudget}
        aria-valuenow={seat.budget}
        aria-label={`${label} budget remaining`}
      >
        <div className="td-budget-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="td-budget-slots">
        {seat.filled_slots} of 5 slots filled
        {seat.locked && !seat.roster_full ? " · locked in" : ""}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

/**
 * One seat's five slots.
 *
 * The slot a player occupies comes from `entry.slot`, which the server
 * recomputes from the WHOLE roster every time. A multi-position player moves as
 * later purchases arrive, so this can legitimately change between renders --
 * that is the model working, not a glitch.
 */
export function RosterBoard({
  seat,
  slots,
  label,
}: {
  seat: SeatPublic;
  slots: string[];
  label: string;
}) {
  const bySlot = new Map(seat.roster.filter((r) => r.slot).map((r) => [r.slot as string, r]));
  return (
    <section className="td-roster" aria-label={`${label} roster`} data-testid={`td-roster-${seat.seat_index}`}>
      <ol className="td-slot-list">
        {slots.map((slot) => {
          const entry = bySlot.get(slot);
          return (
            <li
              key={slot}
              className={entry ? "td-slot td-slot-filled td-land" : "td-slot"}
              data-testid={`td-slot-${seat.seat_index}-${slot}`}
            >
              <span className="td-slot-tag">{slot}</span>
              {entry ? (
                <span className="td-slot-body">
                  <span className="td-slot-name">{entry.player_name}</span>
                  <span className="td-slot-price">
                    {entry.autofilled ? "auto" : formatDollars(entry.price)}
                  </span>
                </span>
              ) : (
                <span className="td-slot-empty">Open</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tie priority
// ---------------------------------------------------------------------------

/** The token, always visible. It is decided from the match seed and published
 *  before the first lot, so it is never a surprise at the moment it matters. */
export function TiePriorityToken({
  holderSeat,
  holderName,
  youHoldIt,
}: {
  holderSeat: number;
  holderName: string;
  youHoldIt: boolean;
}) {
  return (
    <div
      className={youHoldIt ? "td-token td-token-yours" : "td-token"}
      data-testid="td-tie-token"
      data-holder={holderSeat}
    >
      <span className="td-token-dot" aria-hidden="true" />
      <span>
        Tie priority: <strong>{youHoldIt ? "you" : holderName}</strong>
      </span>
      <span className="td-token-hint">Wins a level bid, then passes over.</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** Every settled lot, newest first, with both bids and the full card. After a
 *  round resolves the amounts ARE the result, so they are shown in full. */
export function AuctionHistory({
  history,
  seatNames,
  yourSeat,
}: {
  history: ResolvedRound[];
  seatNames: string[];
  yourSeat: number | null;
}) {
  if (history.length === 0) return null;
  return (
    <section className="td-history" aria-labelledby="td-history-heading">
      <h3 id="td-history-heading" className="td-history-heading">
        Settled lots
      </h3>
      <ol className="td-history-list">
        {[...history].reverse().map((round) => {
          const won = round.winner_seat;
          return (
            <li
              key={round.round_index}
              className="td-history-row"
              data-testid={`td-history-${round.round_index}`}
            >
              <div className="td-history-main">
                <span className="td-history-name">{round.candidate.player_name}</span>
                <span className="td-history-score">
                  {round.candidate.prime_score.toFixed(2)}
                </span>
              </div>
              <div className="td-history-bids">
                {round.bids.map((bid, index) => (
                  <span
                    key={index}
                    className={index === won ? "td-bid-chip td-bid-chip-won" : "td-bid-chip"}
                    data-testid={`td-history-bid-${round.round_index}-${index}`}
                  >
                    {seatNames[index] ?? `Seat ${index}`}{" "}
                    {round.timed_out[index] ? "—" : formatDollars(bid)}
                  </span>
                ))}
              </div>
              <p className="td-history-verdict">
                {won === null
                  ? "Unsold — both passed."
                  : `${won === yourSeat ? "You" : seatNames[won] ?? `Seat ${won}`} won for ${formatDollars(round.price)}${
                      round.decided_by === "tie_priority" ? " on tie priority" : ""
                    }.`}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

/**
 * The simultaneous reveal for the round that just settled.
 *
 * This is where the radar appears -- see `ComponentSilhouette`'s docstring for
 * why it cannot appear before the round resolves.
 */
export function RoundReveal({
  round,
  seatNames,
  yourSeat,
}: {
  round: ResolvedRound;
  seatNames: string[];
  yourSeat: number | null;
}) {
  const won = round.winner_seat;
  return (
    <section className="td-reveal td-enter" data-testid="td-round-reveal" aria-live="polite">
      <h3 className="td-reveal-name">{round.candidate.player_name}</h3>
      <p className="td-reveal-score" data-testid="td-reveal-score">
        {round.candidate.prime_score.toFixed(2)}
        <span className="td-reveal-score-label"> PEAK3</span>
      </p>
      {round.candidate.component_index ? (
        <ComponentSilhouette componentIndex={round.candidate.component_index} />
      ) : null}
      <div className="td-reveal-bids">
        {round.bids.map((bid, index) => (
          <span
            key={index}
            className={index === won ? "td-bid-chip td-bid-chip-won" : "td-bid-chip"}
            data-testid={`td-reveal-bid-${index}`}
          >
            {index === yourSeat ? "You" : seatNames[index] ?? `Seat ${index}`}{" "}
            {round.timed_out[index] ? "no bid" : formatDollars(bid)}
          </span>
        ))}
      </div>
      <p className="td-reveal-verdict">
        {won === null
          ? "Nobody bid. The lot leaves the board."
          : `${won === yourSeat ? "You take" : `${seatNames[won] ?? `Seat ${won}`} takes`} it for ${formatDollars(round.price)}${
              round.decided_by === "tie_priority" ? ", on tie priority" : ""
            }.`}
      </p>
    </section>
  );
}
