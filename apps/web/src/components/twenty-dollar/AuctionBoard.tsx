"use client";

import {
  formatDollars,
  lastActionLabel,
  type LotAction,
  type ResolvedLot,
  type SeatPublic,
  type TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import ComponentSilhouette from "./ComponentSilhouette";

/**
 * The board furniture: the auction stage, the seat cards, the rosters, the
 * auction log and the settlement reveal.
 *
 * Every component here renders SERVER STATE VERBATIM. None of them derives a
 * score, a legality or a winner — if a number is on screen it was on the wire.
 *
 * PLAYER IMAGERY (SHARED-03). Every player rendered here goes through the one
 * existing primitive, `components/court/PlayerAvatar`. There is no second
 * fetcher and no second fallback. Read that component's docstring before
 * assuming a headshot: the ESPN manifest resolves 15% of identities and
 * essentially no historical player, and the API gate
 * `PEAK3_ENABLE_EXTERNAL_ASSET_URLS` defaults OFF pending a licensing review —
 * so in production the medallion IS the shipping path, and the layouts below
 * are designed around a medallion rather than around a photograph that will
 * not arrive. `imageUrl` is threaded through anyway for the day it does.
 */

// ---------------------------------------------------------------------------
// The turn banner
// ---------------------------------------------------------------------------

/**
 * WHOSE ACTION THE BOARD IS WAITING ON, at the top of the room (S20-03).
 *
 * The old surface signalled this with a 11 px pill in the corner of the
 * candidate card reading "Your move". That is not "unmistakable", and it was
 * the only signal — the seat cards themselves changed a single border colour.
 *
 * This is the top-level label; `SeatCard` carries the matching treatment; the
 * timer sits directly under it. Three surfaces, one fact.
 *
 * `aria-live="polite"` belongs HERE and nowhere else in the room: the text
 * changes when the turn changes and at no other time, so it announces a handful
 * of times per lot rather than once a second.
 */
export function TurnBanner({
  activeSeat,
  yourSeat,
  seatNames,
  phase,
}: {
  activeSeat: number | null;
  yourSeat: number | null;
  seatNames: string[];
  /** The client's presentation phase, so a beat reads as a beat. */
  phase: "intro" | "reveal" | "handoff" | "decide" | "pending" | "settling" | "complete";
}) {
  const yours = activeSeat !== null && activeSeat === yourSeat;
  const who = activeSeat === null ? null : (seatNames[activeSeat] ?? "Opponent");

  const label =
    phase === "intro"
      ? "Auction starting"
      : phase === "pending"
        ? "Sending your move"
        : phase === "reveal"
          ? "New lot on the block"
          : phase === "settling"
            ? "Settling the lot"
            : yours
              ? "Your move"
              : `${who ?? "Opponent"} is deciding`;

  return (
    <p
      className="td-turn"
      data-testid="td-turn-indicator"
      data-your-turn={yours ? "true" : "false"}
      data-phase={phase}
      data-seat={activeSeat === null ? "none" : yours ? "a" : "b"}
      aria-live="polite"
    >
      <span className="td-turn-dot" aria-hidden="true" />
      <span className="td-turn-text">{label}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

/**
 * The lot under the hammer, in the order a bidder actually reads it (S20-04):
 *
 *   1. who is on the block — headshot, name, season, team, eligible positions
 *   2. CURRENT BID, as a large number
 *   3. who leads it
 *   4. the last meaningful action
 *
 * The time, the controls and the budgets follow, in the room. What is gone is
 * the row of micro-chips (`You $1 · PEAK3 Bot $2 · You $3 …`) that used to
 * carry the whole bid history at 11 px; the full walk-up now lives in
 * `AuctionLog`, behind a disclosure.
 *
 * It still does not show the PEAK3 score, because the server does not send one:
 * the absence IS the game.
 *
 * `key` on the outer element is the lot index, which restarts the CSS entry
 * animation on every new candidate. That is the arrival moment, done with a
 * keyframe rather than a timer, so `prefers-reduced-motion` switches it off in
 * CSS with no JavaScript branch.
 */
export function AuctionStage({
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
  const opened = publicState.current_bid > 0;
  const last = lastActionLabel(publicState, yourSeat, seatNames);

  return (
    <article
      key={publicState.lot_index}
      className="td-candidate td-enter"
      data-testid="td-candidate"
      data-lot={publicState.lot_index}
    >
      <p className="td-stage-lot" data-testid="td-lot-number">
        Lot {publicState.lot_index + 1}
        <span className="td-stage-lot-of">
          {" "}
          {/* THE STANDARD MARKET'S LENGTH, NOT THE HARD CAP.
              `max_lots` is 36 -- the ceiling the board will never exceed --
              while the market a player is actually in runs to
              `standard_market_lots` (24) before closeout begins. Printing the
              cap here put "LOT 1 OF 36" next to a header chip reading
              "STANDARD MARKET · 24 LOTS", two different totals for the same
              auction on the same screen. */}
          of {publicState.market_phase === "closeout" ? publicState.max_lots : publicState.standard_market_lots}
          {" · "}
          {publicState.market_phase === "closeout" ? "closeout" : "standard"} market
        </span>
      </p>

      <div className="td-stage-identity">
        <PlayerAvatar name={candidate.player_name} size={72} />
        <div className="td-stage-who">
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
        </div>
      </div>

      {/* THE NUMBER THE WHOLE DECISION TURNS ON. It was 1.75rem in a footer
          row headed "Standing bid"; it is now the largest thing on the stage,
          which is what S20-04 asks for and what an auction house does. */}
      <div className="td-stage-bid" data-testid="td-standing-bid" data-opened={opened ? "true" : "false"}>
        <p className="td-stage-bid-label">Current bid</p>
        {/* A REAL ZERO, NOT A PLACEHOLDER GLYPH. This rendered an em dash at
            `clamp(2.75rem, 9vw, 4rem)`, which paints as a thick grey horizontal
            bar directly under the "CURRENT BID" label — reviewers read it as a
            loading skeleton, which is exactly what a dash at display size looks
            like. `$0` is both true and unmistakably a value; the line beneath
            carries the nuance. */}
        <p className="td-stage-bid-amount pk-numeral" data-testid="td-standing-amount">
          {formatDollars(opened ? publicState.current_bid : 0)}
        </p>
        <p className="td-stage-bid-holder" data-testid="td-standing-holder">
          {opened
            ? holder === yourSeat
              ? "You lead"
              : `${seatNames[holder ?? -1] ?? "Opponent"} leads`
            : "No bid yet — the floor is open"}
        </p>
        {last ? (
          <p className="td-stage-last" data-testid="td-last-action">
            {last}
          </p>
        ) : null}
      </div>

      <p className="td-candidate-hint">
        The PEAK3 score is sealed until this lot sells.
      </p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// The auction log
// ---------------------------------------------------------------------------

/**
 * The full walk-up on the LIVE lot, behind a disclosure (S20-04).
 *
 * The stage already names the last action, which is the one a decision turns
 * on. This is for the player who wants to see the whole ladder, and it is
 * closed by default so it cannot compete with the number above it.
 */
export function AuctionLog({
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
    <details className="td-log" data-testid="td-auction-log">
      <summary data-testid="td-auction-log-toggle">
        Auction log
        <span className="td-log-count pk-numeral">{actions.length}</span>
      </summary>
      <ol className="td-log-list" data-testid="td-lot-ticker" aria-label="Bidding so far">
        {actions.map((action, index) => (
          <li key={index} className="td-log-item">
            <span className="td-log-who">
              {action.seat_index === yourSeat
                ? "You"
                : (seatNames[action.seat_index] ?? `Seat ${action.seat_index + 1}`)}
            </span>
            <span className="td-log-what pk-numeral">
              {action.action === "bid"
                ? formatDollars(action.amount)
                : action.timed_out
                  ? "timed out"
                  : action.consumed_skip
                    ? "market skip"
                    : "passed"}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Seat cards
// ---------------------------------------------------------------------------

/**
 * One seat's standing: budget, slots filled, and MARKET SKIPS REMAINING.
 *
 * S20-06 makes the third of those a first-class number rather than 10 px of
 * grey text under a meter, or — worse — something you learn from a button
 * label. All three are stats of the same rank, in the same row, because all
 * three are things a bidder trades off against each other.
 *
 * S20-03 makes the active seat unmistakable: a fill, a rail, a rendered
 * "ON THE CLOCK" line and the `data-active` attribute the CSS keys on. Never
 * colour alone — the word is there in text.
 */
export function SeatCard({
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
      className="td-seat"
      data-testid={`td-budget-${seat.seat_index}`}
      data-active={isActive ? "true" : "false"}
      data-seat={isYou ? "a" : "b"}
    >
      <div className="td-seat-head">
        <span className="td-seat-name">{label}</span>
        {isOpener ? (
          <span
            className="td-opener"
            data-testid={`td-opener-${seat.seat_index}`}
            title="Opens the bidding on this lot"
          >
            Opens
          </span>
        ) : null}
        {/* THE SEAT MARKER, which is a different job from the room's turn
            statement. The room used to answer "whose turn is it?" in FOUR
            places at once — this chip, the `TurnBanner`, the clock's old
            "YOUR TURN" label and a `Your move — open or pass.` line under the
            auction log. That is TMW-07's "three stacked rows" defect. Two of
            those are gone: the clock now reports TIME and the waiting line is
            deleted. This one stays, because it is the only thing that names the
            active seat ON the seat, and without it the card would carry the
            state in colour alone. */}
        {isActive ? (
          <span className="td-seat-live" data-testid={`td-seat-live-${seat.seat_index}`}>
            On the clock
          </span>
        ) : null}
      </div>

      <div className="td-seat-stats">
        <div className="td-stat">
          <span className="td-stat-value pk-numeral" data-testid={`td-seat-budget-${seat.seat_index}`}>
            {formatDollars(seat.budget)}
          </span>
          <span className="td-stat-label">left</span>
        </div>
        <div className="td-stat">
          <span className="td-stat-value pk-numeral">
            {seat.filled_slots}
            <span className="td-stat-of">/5</span>
          </span>
          <span className="td-stat-label">roster</span>
        </div>
        {/* MARKET SKIPS, FOR BOTH SEATS, AT THE SAME WEIGHT AS THE MONEY. The
            economy only works as a decision if a player can see it running
            down — theirs and their opponent's. A rule you discover by having a
            control disabled is a rule you have been taught badly. */}
        <div
          className="td-stat td-stat-skips"
          data-testid={`td-skips-${seat.seat_index}`}
          data-remaining={seat.market_skips}
        >
          <span className="td-stat-value pk-numeral">{seat.market_skips}</span>
          <span className="td-stat-label">
            {seat.market_skips === 1 ? "skip left" : "skips left"}
          </span>
        </div>
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

      <p className="td-seat-note">
        {seat.roster_full
          ? "Five filled — out of the market."
          : seat.in_lot
            ? `${skipAllowance - seat.market_skips} of ${skipAllowance} market skips used`
            : "Out of this lot."}
      </p>
    </div>
  );
}

/** @deprecated The pre-S20-06 name. `SeatCard` is the same component with the
 *  skip count promoted out of the footnote. Kept so no import breaks. */
export const BudgetMeter = SeatCard;

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

/**
 * One seat's five slots (S20-14).
 *
 * WIDE ENOUGH TO READ. The old rows were a 2 rem tag, a flexed name and a
 * price inside a 15 rem column, so "Shai Gilgeous-Alexander" wrapped onto
 * three lines and the season went under the name. Each row now has a fixed
 * grid: avatar, then a two-line identity block (name over season · team), then
 * the price, with the slot tag as a badge on the avatar. Ordinary names fit on
 * one line at 390 px.
 *
 * The slot a player occupies comes from `entry.slot`, which the server
 * recomputes from the WHOLE roster every time. A multi-position player moves as
 * later purchases arrive — that is the model working, not a glitch.
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
              data-filled={entry ? "true" : "false"}
            >
              <span className="td-slot-figure">
                {entry ? (
                  <PlayerAvatar name={entry.player_name} size={32} />
                ) : (
                  <span className="td-slot-vacant" aria-hidden="true" />
                )}
                <span className="td-slot-tag">{slot}</span>
              </span>
              {entry ? (
                <span className="td-slot-body">
                  <span className="td-slot-name">{entry.player_name}</span>
                  <span className="td-slot-sub pk-numeral">
                    {entry.anchor_season} · {entry.prime_score.toFixed(1)} PEAK3
                  </span>
                </span>
              ) : (
                <span className="td-slot-body">
                  <span className="td-slot-empty">Open</span>
                </span>
              )}
              <span className="td-slot-price pk-numeral">
                {entry ? (entry.autofilled ? "auto" : formatDollars(entry.price)) : "—"}
              </span>
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
 * This is where the score, the career-best season and the radar appear — see
 * `ComponentSilhouette`'s docstring for why none of it can appear before the
 * lot resolves.
 *
 * `queued` is the rest of the reveal SEQUENCE. When one accepted command
 * settles three lots (`_advance_lot` → `_resolve_lot` → `_advance_lot`, which
 * is ordinary play rather than a fault) the player watches all three go past,
 * one at a time, and this line tells them more are coming. That used to be
 * reported as "While you were away" while they were sitting right there.
 */
export function LotReveal({
  lot,
  seatNames,
  yourSeat,
  queued = 0,
}: {
  lot: ResolvedLot;
  seatNames: string[];
  yourSeat: number | null;
  queued?: number;
}) {
  const won = lot.winner_seat;
  const slot = (lot.slot_options ?? [])[0];
  return (
    <section
      className="td-reveal td-enter"
      data-testid="td-lot-reveal"
      data-queued={queued}
      aria-live="polite"
    >
      <p className="td-reveal-lot" data-testid="td-reveal-lot">
        Lot {lot.lot_index + 1} · {won === null ? "unsold" : "sold"}
      </p>
      <div className="td-reveal-identity">
        <PlayerAvatar name={lot.candidate.player_name} size={44} />
        <div>
          <h3 className="td-reveal-name">{lot.candidate.player_name}</h3>
          <p className="td-reveal-season" data-testid="td-reveal-season">
            Career-best season {lot.candidate.anchor_season}
            {lot.candidate.team ? ` · ${lot.candidate.team}` : ""}
          </p>
        </div>
      </div>
      <p className="td-reveal-score pk-numeral" data-testid="td-reveal-score">
        {lot.candidate.prime_score.toFixed(2)}
        <span className="td-reveal-score-label"> PEAK3</span>
      </p>
      {/* THE BREAKDOWN IS BEHIND A DISCLOSURE. The silhouette rendering inline
          was most of this panel's height, and the revealed SCORE — the payoff
          of the whole lot — sat below the fold because of it. */}
      {lot.candidate.component_index ? (
        <details className="td-reveal-breakdown">
          <summary data-testid="td-reveal-breakdown-toggle">View breakdown</summary>
          <ComponentSilhouette componentIndex={lot.candidate.component_index} />
        </details>
      ) : null}
      <p className="td-reveal-verdict" data-testid="td-reveal-verdict">
        {won === null
          ? "Nobody bid. The lot leaves the board."
          : `${won === yourSeat ? "You take" : `${seatNames[won] ?? `Seat ${won + 1}`} takes`} it for ${formatDollars(lot.price)}${slot ? ` at ${slot}` : ""}.`}
      </p>
      {queued > 0 ? (
        <p className="td-reveal-queued" data-testid="td-reveal-queued">
          {queued} more {queued === 1 ? "lot" : "lots"} settling…
        </p>
      ) : null}
    </section>
  );
}
