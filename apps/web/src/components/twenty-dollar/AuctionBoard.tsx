"use client";

import {
  formatDollars,
  type LotAction,
  type ResolvedLot,
  type SeatPublic,
  type TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";
import ComponentSilhouette from "./ComponentSilhouette";

/**
 * The board furniture: candidate card, budget meters, rosters, lot ticker,
 * auction history.
 *
 * Every component here renders SERVER STATE VERBATIM. None of them derives a
 * score, a legality or a winner -- if a number is on screen it was on the wire.
 */

// ---------------------------------------------------------------------------
// Candidate
// ---------------------------------------------------------------------------

/**
 * The card under the hammer — the centre of the room.
 *
 * Shows the name, the season, the team and the positions the player is legal
 * at, plus the STANDING BID and who holds it. It does not show the PEAK3 score,
 * because the server does not send one: the absence IS the game.
 *
 * `key` on the outer element is the lot index, which restarts the CSS entry
 * animation on every new candidate. That is the arrival moment, done with a
 * keyframe rather than a timer, so `prefers-reduced-motion` switches it off in
 * CSS with no JavaScript branch.
 */
export function CandidateCard({
  publicState,
  fits,
  seatNames,
  yourSeat,
}: {
  publicState: TwentyDollarPublicState;
  fits: string[];
  seatNames: string[];
  yourSeat: number | null;
}) {
  const candidate = publicState.candidate;
  if (!candidate) return null;
  const holder = publicState.high_bidder;
  const active = publicState.active_seat;
  const yourTurn = active !== null && active === yourSeat;

  return (
    <article
      key={publicState.lot_index}
      className="td-candidate td-enter"
      data-testid="td-candidate"
      data-lot={publicState.lot_index}
    >
      <header className="td-candidate-head">
        <p className="td-candidate-lot" data-testid="td-lot-number">
          Lot {publicState.lot_index + 1}
        </p>
        <p
          className={yourTurn ? "td-turn td-turn-yours" : "td-turn"}
          data-testid="td-turn-indicator"
          data-your-turn={yourTurn ? "true" : "false"}
          aria-live="polite"
        >
          {/* THE COUNTDOWN IS NOT HERE ANY MORE. It lives in `ArenaTimer`,
              beside the controls, so a tick rerenders four characters instead
              of the whole board — see that component's docstring for the
              measurement. This line says WHOSE turn it is, which changes only
              when the authoritative state does. */}
          {active === null
            ? "Settling…"
            : yourTurn
              ? "Your move"
              : `${seatNames[active] ?? "Opponent"} to act`}
        </p>
      </header>

      <h2 className="td-candidate-name" data-testid="td-candidate-name">
        {candidate.player_name}
      </h2>
      <p className="td-candidate-meta" data-testid="td-candidate-season">
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

      <div className="td-standing" data-testid="td-standing-bid">
        <span className="td-standing-label">Standing bid</span>
        <span className="td-standing-amount" data-testid="td-standing-amount">
          {publicState.current_bid > 0 ? formatDollars(publicState.current_bid) : "—"}
        </span>
        <span className="td-standing-holder" data-testid="td-standing-holder">
          {publicState.current_bid > 0
            ? holder === yourSeat
              ? "you"
              : (seatNames[holder ?? -1] ?? "opponent")
            : "no bid yet"}
        </span>
      </div>

      <p className="td-candidate-hint">
        The PEAK3 score is sealed until this lot sells.
      </p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Live lot ticker
// ---------------------------------------------------------------------------

/** Every action taken on the LIVE lot, oldest first. Small, and the thing that
 *  makes an alternating auction legible: you can see the walk-up. */
export function LotTicker({
  actions,
  seatNames,
  yourSeat,
}: {
  actions: LotAction[];
  seatNames: string[];
  yourSeat: number | null;
}) {
  if (actions.length === 0) return null;
  return (
    <ol className="td-ticker" data-testid="td-lot-ticker" aria-label="Bidding so far">
      {actions.map((action, index) => (
        <li key={index} className="td-ticker-item">
          <span className="td-ticker-who">
            {action.seat_index === yourSeat
              ? "You"
              : (seatNames[action.seat_index] ?? `Seat ${action.seat_index}`)}
          </span>
          <span className="td-ticker-what">
            {action.action === "bid"
              ? formatDollars(action.amount)
              : action.timed_out
                ? "timed out"
                : action.consumed_skip
                  ? "skipped · −1"
                  : "passed"}
          </span>
        </li>
      ))}
    </ol>
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
  skipAllowance = 5,
  label,
  isYou,
  isActive,
  isOpener,
}: {
  seat: SeatPublic;
  startingBudget?: number;
  skipAllowance?: number;
  label: string;
  isYou: boolean;
  isActive: boolean;
  isOpener: boolean;
}) {
  const pct = Math.max(0, Math.min(100, (seat.budget / startingBudget) * 100));
  return (
    <div
      className={isActive ? "td-budget td-budget-active" : "td-budget"}
      data-testid={`td-budget-${seat.seat_index}`}
      data-active={isActive ? "true" : "false"}
    >
      <div className="td-budget-head">
        <span className="td-budget-name">
          {label}
          {isOpener ? (
            <span
              className="td-opener"
              data-testid={`td-opener-${seat.seat_index}`}
              title="Opens the bidding on this lot"
            >
              Opens
            </span>
          ) : null}
        </span>
        <span className="td-budget-amount">{formatDollars(seat.budget)}</span>
      </div>
      <div
        className="td-budget-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={startingBudget}
        aria-valuenow={seat.budget}
        aria-label={`${isYou ? "Your" : `${label}'s`} budget remaining`}
      >
        <div className="td-budget-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="td-budget-slots">
        {seat.filled_slots} of 5 filled
        {seat.roster_full ? " · complete" : seat.in_lot ? "" : " · out of this lot"}
      </p>
      {/* MARKET SKIPS, FOR BOTH SEATS. The economy only works as a decision if
          a player can see it running down -- theirs and their opponent's. A
          rule you discover by having a control disabled is a rule you have
          been taught badly. */}
      <p
        className="td-budget-skips"
        data-testid={`td-skips-${seat.seat_index}`}
        data-remaining={seat.market_skips}
      >
        <span className="td-skip-pips" aria-hidden="true">
          {Array.from({ length: skipAllowance }, (_, index) => (
            <i key={index} data-spent={index >= seat.market_skips ? "true" : "false"} />
          ))}
        </span>
        <span className="td-skip-count">
          {seat.market_skips} skip{seat.market_skips === 1 ? "" : "s"} left
        </span>
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
  const bySlot = new Map(
    seat.roster.filter((r) => r.slot).map((r) => [r.slot as string, r]),
  );
  return (
    <section
      className="td-roster"
      aria-label={`${label} roster`}
      data-testid={`td-roster-${seat.seat_index}`}
    >
      <h3 className="td-roster-title">{label}</h3>
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
                  <span className="td-slot-sub">
                    {entry.anchor_season} · {entry.prime_score.toFixed(1)}
                  </span>
                </span>
              ) : (
                <span className="td-slot-empty">Open</span>
              )}
              <span className="td-slot-price">
                {entry ? (entry.autofilled ? "auto" : formatDollars(entry.price)) : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** Every settled lot, newest first, with the price and the full card. Once a
 *  lot resolves the amounts ARE the result, so they are shown in full. */
export function AuctionHistory({
  history,
  seatNames,
  yourSeat,
}: {
  history: ResolvedLot[];
  seatNames: string[];
  yourSeat: number | null;
}) {
  if (history.length === 0) return null;
  return (
    <section className="td-history" aria-labelledby="td-history-heading">
      <h3 id="td-history-heading" className="td-history-heading">
        Settled lots
      </h3>
      {/* `tabIndex={0}` because this list SCROLLS. A scrollable region whose
          content holds no focusable element is unreachable by keyboard --
          axe's `scrollable-region-focusable`, and a real defect once the
          history grows past its max-height. The rows are static text, so the
          container itself takes focus. */}
      <ol className="td-history-list" tabIndex={0} aria-labelledby="td-history-heading">
        {[...history].reverse().map((lot) => {
          const won = lot.winner_seat;
          return (
            <li
              key={lot.lot_index}
              className="td-history-row"
              data-testid={`td-history-${lot.lot_index}`}
            >
              <div className="td-history-main">
                <span className="td-history-name">{lot.candidate.player_name}</span>
                <span className="td-history-score">
                  {lot.candidate.prime_score.toFixed(1)}
                </span>
              </div>
              <p className="td-history-verdict">
                {won === null
                  ? "Unsold — both passed."
                  : `${won === yourSeat ? "You" : (seatNames[won] ?? `Seat ${won}`)} ${
                      lot.decided_by === "autofill" ? "auto-filled" : "won"
                    } for ${formatDollars(lot.price)}.`}
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
 * The lot that just settled, revealed in full.
 *
 * This is where the score, the career-best season and the radar appear -- see
 * `ComponentSilhouette`'s docstring for why none of it can appear before the
 * lot resolves.
 */
export function LotReveal({
  lot,
  seatNames,
  yourSeat,
}: {
  lot: ResolvedLot;
  seatNames: string[];
  yourSeat: number | null;
}) {
  const won = lot.winner_seat;
  const slot = (lot.slot_options ?? [])[0];
  return (
    <section
      className="td-reveal td-enter"
      data-testid="td-lot-reveal"
      aria-live="polite"
    >
      {/* SOLD OR UNSOLD, said in the eyebrow as well as the verdict. It was
          hardcoded to "sold", and the review frame caught the result: an
          unsold lot headed "LOT 2 · SOLD" with "Nobody bid. The lot leaves the
          board." three lines underneath it. */}
      <p className="td-reveal-lot" data-testid="td-reveal-lot">
        Lot {lot.lot_index + 1} · {won === null ? "unsold" : "sold"}
      </p>
      <h3 className="td-reveal-name">{lot.candidate.player_name}</h3>
      <p className="td-reveal-season" data-testid="td-reveal-season">
        Career-best season {lot.candidate.anchor_season}
        {lot.candidate.team ? ` · ${lot.candidate.team}` : ""}
      </p>
      <p className="td-reveal-score" data-testid="td-reveal-score">
        {lot.candidate.prime_score.toFixed(2)}
        <span className="td-reveal-score-label"> PEAK3</span>
      </p>
      {/* THE BREAKDOWN IS BEHIND A DISCLOSURE (PART 19: "a 'View breakdown'
          action may open the radar chart after settlement" -- and, directly
          above it, "do not append a giant chart under the active controls").
          The silhouette was rendering inline, which is most of this panel's
          height, and the review frame showed the consequence: the revealed
          SCORE -- the payoff of the whole lot -- sat below the fold. */}
      {lot.candidate.component_index ? (
        <details className="td-reveal-breakdown">
          <summary data-testid="td-reveal-breakdown-toggle">View breakdown</summary>
          <ComponentSilhouette componentIndex={lot.candidate.component_index} />
        </details>
      ) : null}
      <p className="td-reveal-verdict" data-testid="td-reveal-verdict">
        {won === null
          ? "Nobody bid. The lot leaves the board."
          : `${won === yourSeat ? "You take" : `${seatNames[won] ?? `Seat ${won}`} takes`} it for ${formatDollars(lot.price)}${slot ? ` at ${slot}` : ""}.`}
      </p>
    </section>
  );
}
