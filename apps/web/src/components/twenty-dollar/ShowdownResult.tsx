"use client";
import Link from "next/link";
import type {
  SeatPublic,
  TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";
import type { TwentyDollarReceiptData } from "./TwentyDollarReceipt";
import Celebration from "@/components/shared/Celebration";

/**
 * The dedicated result state. It REPLACES the auction rather than following it.
 *
 * WHY THAT IS THE FIX. The receipt used to be appended below a frozen auction
 * board, so finishing a match meant scrolling past the candidate you had just
 * bid on, both budget meters, both roster panels and the lot history before
 * reaching the word "wins". The single most important sentence in the mode was
 * the last thing on the page.
 *
 * WHAT THE FIRST VIEWPORT OWES A PLAYER, and everything here is in it: who won,
 * both totals, both complete rosters, what each seat spent and kept, the best
 * bargain, the biggest overpay, the decisive lot, and the two things they will
 * do next. The itemised receipt -- per-slot comparison, settlement ladder,
 * component disclosure -- lives below, because it answers "how exactly" rather
 * than "what happened", and nobody needs it before they need the score.
 *
 * EVERY NUMBER IS THE SERVER'S. Totals, prices and scores come from the settled
 * snapshot the results rows were written from, so this panel and the stored
 * result cannot disagree.
 */
export default function ShowdownResult({
  receipt,
  publicState,
  seatNames,
  yourSeat,
  onPlayAgain,
  children,
}: {
  receipt: TwentyDollarReceiptData;
  publicState: TwentyDollarPublicState;
  seatNames: string[];
  yourSeat: number | null;
  onPlayAgain: () => void;
  /** The itemised receipt, rendered below the fold. */
  children?: React.ReactNode;
}) {
  const winner = receipt.settlement?.winner_seat ?? null;
  const drawn = receipt.settlement?.outcome === "draw";
  const youWon = winner !== null && winner === yourSeat;

  function nameOf(seat: number): string {
    return seat === yourSeat ? "You" : (seatNames[seat] ?? `Seat ${seat + 1}`);
  }

  return (
    <section
      className="td-result"
      data-testid="td-result"
      data-outcome={drawn ? "draw" : youWon ? "win" : "loss"}
    >
      <Celebration active={youWon} testId="td-celebration" />

      <header className="td-result-head" data-tier={youWon ? "win" : drawn ? "draw" : "loss"}>
        <p className="td-result-eyebrow">Auction closed · {receipt.rounds_played} lots</p>
        <h2 className="td-result-headline" data-testid="td-result-headline">
          {drawn
            ? "A draw"
            : winner === null
              ? "Match complete"
              : `${nameOf(winner)} ${winner === yourSeat ? "win" : "wins"}`}
        </h2>
        <p className="td-result-basis">
          Decided on the sum of five career-best 1Y PEAK3 seasons.
        </p>
      </header>

      <div className="td-result-seats" data-testid="td-result-seats">
        {receipt.seats.map((seat, index) => {
          const live: SeatPublic | undefined = publicState.seats[index];
          const spent = receipt.starting_budget - (live?.budget ?? 0);
          return (
            <article
              key={index}
              className="td-result-seat"
              data-testid={`td-result-seat-${index}`}
              data-winner={winner === index ? "true" : "false"}
            >
              <header className="td-result-seat-head">
                <h3>{nameOf(index)}</h3>
                <span className="td-result-total" data-testid={`td-result-total-${index}`}>
                  {seat.roster_total.toFixed(2)}
                </span>
              </header>
              <p className="td-result-money" data-testid={`td-result-money-${index}`}>
                ${spent} spent · ${live?.budget ?? 0} unspent
              </p>
              <ol className="td-result-roster">
                {publicState.slots.map((slot) => {
                  const entry = (live?.roster ?? []).find((row) => row.slot === slot);
                  return (
                    <li key={slot} className="td-result-slot" data-slot={slot}>
                      <span className="td-result-slot-tag">{slot}</span>
                      <span className="td-result-slot-name">
                        {entry?.player_name ?? "—"}
                        {entry?.autofilled ? " · auto-filled" : ""}
                      </span>
                      <span className="td-result-slot-price">
                        ${entry?.price ?? 0}
                      </span>
                      <span className="td-result-slot-score">
                        {entry?.prime_score != null
                          ? entry.prime_score.toFixed(1)
                          : "—"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </article>
          );
        })}
      </div>

      <dl className="td-result-facts" data-testid="td-result-facts">
        {receipt.best_bargain && (
          <div>
            <dt>Best bargain</dt>
            <dd>
              {receipt.best_bargain.player_name} —{" "}
              {receipt.best_bargain.prime_score.toFixed(1)} for $
              {receipt.best_bargain.price} ({nameOf(receipt.best_bargain.seat_index)})
            </dd>
          </div>
        )}
        {receipt.biggest_overpay && (
          <div>
            <dt>Biggest overpay</dt>
            <dd>
              {receipt.biggest_overpay.player_name} — $
              {receipt.biggest_overpay.price} for{" "}
              {receipt.biggest_overpay.prime_score.toFixed(1)} (
              {nameOf(receipt.biggest_overpay.seat_index)})
            </dd>
          </div>
        )}
        {receipt.most_decisive && (
          <div>
            <dt>Decisive lot</dt>
            <dd>
              {receipt.most_decisive.player_name} — ${receipt.most_decisive.price} to{" "}
              {nameOf(receipt.most_decisive.winner_seat)}
            </dd>
          </div>
        )}
      </dl>

      <footer className="td-result-actions">
        <button
          type="button"
          className="btn-primary"
          data-testid="td-play-again"
          onClick={onPlayAgain}
        >
          Play again
        </button>
        <Link href="/arena" className="btn-secondary" data-testid="td-back-to-arena">
          Back to Arena
        </Link>
      </footer>

      {children ? (
        <details className="td-result-detail">
          <summary data-testid="td-result-detail-toggle">Full receipt</summary>
          {children}
        </details>
      ) : null}
    </section>
  );
}
