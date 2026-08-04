"use client";

import { formatDollars } from "@/lib/twenty-dollar-api";

/**
 * The final receipt.
 *
 * HOUSE STYLE, INHERITED FROM `SideBySideReceipt.tsx`, including the two
 * conventions that file's own header argues for:
 *
 *   * The levels table is rendered in the SERVER's published order, straight
 *     from `settlement.levels`. There is no client-side ordering.
 *   * Levels below the deciding one are shown, dimmed, marked "Not consulted"
 *     rather than dropped. A table that omitted them would imply the deciding
 *     level was the only rule; a table that showed a lower one as "winning"
 *     would imply a rule that does not exist.
 *
 * No PEAK3 score is computed here. Every number is `receipt.*`.
 */

export interface ReceiptSeat {
  seat_index: number;
  roster_total: number;
  spent: number;
  budget_remaining: number;
  peak3_per_dollar: number;
  components: Record<string, number>;
  roster: Array<{
    player_slug: string;
    player_name: string;
    anchor_season: string;
    prime_score: number;
    price: number;
    value_per_dollar: number;
    autofilled: boolean;
  }>;
}

export interface TwentyDollarReceiptData {
  model_version: string;
  starting_budget: number;
  slots: string[];
  seats: ReceiptSeat[];
  positional: Array<{
    slot: string;
    seats: Array<{ player_name: string; prime_score: number; price: number } | null>;
    margin: number;
    winner_seat: number | null;
  }>;
  best_bargain: { player_name: string; prime_score: number; price: number; seat_index: number } | null;
  biggest_overpay: { player_name: string; prime_score: number; price: number; seat_index: number } | null;
  most_decisive: { player_name: string; price: number; winner_seat: number; bids: number[] } | null;
  counterfactual: {
    player_name: string;
    your_bid: number;
    winning_bid: number;
    needed_bid: number;
    extra_dollars: number;
    loser_seat: number;
    new_totals: number[];
    assumption: string;
  } | null;
  autofilled: boolean;
  rounds_played: number;
  component_disclosure: {
    shown: string[];
    absent: string[];
    count: number;
    house_count: number;
    note: string;
  };
  settlement: {
    winner_seat: number | null;
    outcome: string;
    decided_by: string | null;
    levels: Array<{
      level: string;
      label: string;
      higher_wins: boolean;
      values: number[];
      verdict: string;
    }>;
  } | null;
}

function verdictLabel(verdict: string, names: string[]): string {
  if (verdict === "tied") return "Level";
  if (verdict === "not_consulted") return "Not consulted";
  const match = /^seat_(\d+)$/.exec(verdict);
  if (match) return names[Number(match[1])] ?? `Seat ${match[1]}`;
  return verdict;
}

export default function TwentyDollarReceipt({
  receipt,
  seatNames,
  yourSeat,
}: {
  receipt: TwentyDollarReceiptData;
  seatNames: string[];
  yourSeat: number | null;
}) {
  const settlement = receipt.settlement;
  const winner = settlement?.winner_seat ?? null;

  return (
    <section className="td-receipt" aria-labelledby="td-receipt-heading" data-testid="td-receipt">
      <h2 id="td-receipt-heading" className="td-receipt-heading">
        The $20 Showdown — result
      </h2>

      <p className="td-receipt-outcome" data-testid="td-receipt-outcome">
        {winner === null
          ? "Both rosters scored level."
          : `${winner === yourSeat ? "You win" : `${seatNames[winner] ?? `Seat ${winner}`} wins`} on ${
              settlement?.decided_by === "budget_remaining"
                ? "budget left over"
                : "roster PEAK3 total"
            }.`}
      </p>

      {/* Totals */}
      <div className="td-receipt-totals">
        {receipt.seats.map((seat) => (
          <div
            key={seat.seat_index}
            className={seat.seat_index === winner ? "td-total td-total-won" : "td-total"}
            data-testid={`td-receipt-total-${seat.seat_index}`}
          >
            <span className="td-total-name">
              {seat.seat_index === yourSeat ? "You" : seatNames[seat.seat_index]}
            </span>
            <span className="td-total-score">{seat.roster_total.toFixed(2)}</span>
            <span className="td-total-meta">
              {formatDollars(seat.spent)} spent · {formatDollars(seat.budget_remaining)} left ·{" "}
              {seat.peak3_per_dollar.toFixed(2)} per dollar
            </span>
          </div>
        ))}
      </div>

      {/* Settlement levels, in the server's order */}
      {settlement ? (
        <div className="td-table-scroll">
          <table className="td-levels">
            <caption className="sr-only">
              Result, in the published settlement order
            </caption>
            <thead>
              <tr>
                <th scope="col">Level</th>
                {receipt.seats.map((seat) => (
                  <th scope="col" key={seat.seat_index}>
                    {seat.seat_index === yourSeat ? "You" : seatNames[seat.seat_index]}
                  </th>
                ))}
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {settlement.levels.map((level, index) => (
                <tr
                  key={level.level}
                  data-testid={`td-level-${level.level}`}
                  className={
                    level.level === settlement.decided_by
                      ? "td-level-decided"
                      : level.verdict === "not_consulted"
                        ? "td-level-muted"
                        : undefined
                  }
                >
                  <th scope="row">
                    <span className="td-level-index">{index + 1}</span>
                    {level.label}
                  </th>
                  {level.values.map((value, i) => (
                    <td key={i}>{value.toFixed(2)}</td>
                  ))}
                  <td>{verdictLabel(level.verdict, seatNames)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Slot by slot */}
      <h3 className="td-receipt-subheading">Slot by slot</h3>
      <div className="td-table-scroll">
        <table className="td-positional">
          <caption className="sr-only">Positional comparison</caption>
          <thead>
            <tr>
              <th scope="col">Slot</th>
              {receipt.seats.map((seat) => (
                <th scope="col" key={seat.seat_index}>
                  {seat.seat_index === yourSeat ? "You" : seatNames[seat.seat_index]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {receipt.positional.map((row) => (
              <tr key={row.slot} data-testid={`td-positional-${row.slot}`}>
                <th scope="row">{row.slot}</th>
                {row.seats.map((entry, i) => (
                  <td key={i} className={row.winner_seat === i ? "td-positional-won" : undefined}>
                    {entry ? (
                      <>
                        <span className="td-positional-name">{entry.player_name}</span>
                        <span className="td-positional-score">
                          {entry.prime_score.toFixed(2)} · {formatDollars(entry.price)}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Highlights */}
      <ul className="td-highlights">
        {receipt.best_bargain ? (
          <li data-testid="td-bargain">
            <strong>Best bargain.</strong> {receipt.best_bargain.player_name} at{" "}
            {receipt.best_bargain.prime_score.toFixed(2)} for{" "}
            {formatDollars(receipt.best_bargain.price)}.
          </li>
        ) : null}
        {receipt.biggest_overpay ? (
          <li data-testid="td-overpay">
            <strong>Biggest overpay.</strong> {receipt.biggest_overpay.player_name} at{" "}
            {receipt.biggest_overpay.prime_score.toFixed(2)} for{" "}
            {formatDollars(receipt.biggest_overpay.price)}.
          </li>
        ) : null}
        {receipt.most_decisive ? (
          <li data-testid="td-decisive">
            <strong>Most decisive lot.</strong> {receipt.most_decisive.player_name}, won for{" "}
            {formatDollars(receipt.most_decisive.price)}.
          </li>
        ) : null}
      </ul>

      {/* Counterfactual */}
      {receipt.counterfactual ? (
        <aside className="td-counterfactual" data-testid="td-counterfactual">
          <h3 className="td-receipt-subheading">One bid away</h3>
          <p>
            {formatDollars(receipt.counterfactual.needed_bid)} on{" "}
            {receipt.counterfactual.player_name} instead of{" "}
            {formatDollars(receipt.counterfactual.your_bid)} —{" "}
            {formatDollars(receipt.counterfactual.extra_dollars)} more — and the totals
            become {receipt.counterfactual.new_totals.map((t) => t.toFixed(2)).join(" to ")}.
          </p>
          <p className="td-assumption">{receipt.counterfactual.assumption}</p>
        </aside>
      ) : null}

      {/* Autofill, when it happened */}
      {receipt.autofilled ? (
        <p className="td-autofill-note" data-testid="td-autofill-note">
          Some slots were filled automatically because the bidding did not complete
          both rosters. Those are marked &ldquo;auto&rdquo; and were not won at auction.
        </p>
      ) : null}

      {/*
        THE COMPONENT DISCLOSURE, SHOWN RATHER THAN OMITTED.
        This board publishes five of the six PEAK3 components. Rendering five
        bars silently, next to a six-bar breakdown elsewhere in the app, would
        read as a missing bar. The server sends the explanation; it is displayed.
      */}
      <footer className="td-disclosure" data-testid="td-component-disclosure">
        <p>
          <strong>
            {receipt.component_disclosure.count} of {receipt.component_disclosure.house_count}{" "}
            components shown.
          </strong>{" "}
          {receipt.component_disclosure.note}
        </p>
        <p className="td-model-version">
          Scored under {receipt.model_version} · {receipt.rounds_played} lots.
        </p>
      </footer>
    </section>
  );
}

/**
 * Share text for a finished match.
 *
 * Spoiler-shaped like the rest of the app's share strings: the totals and the
 * margin, never the roster, so a share does not hand the next player the
 * answer to a board they have not played.
 */
export function buildShowdownShareText(
  receipt: TwentyDollarReceiptData,
  yourSeat: number | null,
  url = "https://peak3.app/arena/twenty-dollar",
): string {
  const you = receipt.seats.find((s) => s.seat_index === yourSeat) ?? receipt.seats[0];
  const them = receipt.seats.find((s) => s.seat_index !== you.seat_index);
  const verdict =
    receipt.settlement?.winner_seat === null
      ? "Level"
      : receipt.settlement?.winner_seat === you.seat_index
        ? "Won"
        : "Lost";
  const lines = [
    "PEAK3 — The $20 Showdown",
    `${verdict} ${you.roster_total.toFixed(1)}${them ? ` – ${them.roster_total.toFixed(1)}` : ""}`,
    `${formatDollars(you.spent)} spent · ${you.peak3_per_dollar.toFixed(2)} PEAK3 per dollar`,
    url,
  ];
  return lines.join("\n");
}
