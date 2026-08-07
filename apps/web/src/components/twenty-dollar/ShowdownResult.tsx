"use client";
import Link from "next/link";
import type { SeatPublic, TwentyDollarPublicState } from "@/lib/twenty-dollar-api";
import { formatDollars } from "@/lib/twenty-dollar-api";
import type { TwentyDollarReceiptData } from "./TwentyDollarReceipt";
import Celebration from "@/components/shared/Celebration";
import PlayerAvatar from "@/components/court/PlayerAvatar";

/**
 * The result state (S20-15). It REPLACES the auction rather than following it.
 *
 * THE BRIEF REJECTED THE PREVIOUS SCREEN AS "too sparse and administrative",
 * and that was fair. It had a headline, a margin, a grey sentence about what
 * the score was derived from, two roster lists at 12 px, and a `<dl>` of three
 * report labels in 9 px uppercase grey — the biggest bargain and the decisive
 * lot of the whole match rendered as footnotes. "Play again" and "Back to
 * Arena" were the loudest things on the page by default.
 *
 * WHAT THIS ONE IS BUILT AROUND
 * -----------------------------
 *   * A HERO THAT SAYS WON OR LOST IN A WORD, with the margin as a number and a
 *     head-to-head bar underneath. Never colour alone: `WON` / `LOST` / `DREW`
 *     is the word, `data-outcome` is the attribute, and the bar is labelled.
 *   * A DETERMINISTIC RESPONSE LINE. One sentence, chosen from a bank by the
 *     match's own numbers (see `responseLine`) — so a 0.4 margin and a 40
 *     margin read differently, and the same result always produces the same
 *     line. No randomness, because a result screen that says something
 *     different on reload is a result screen nobody trusts.
 *   * TWO RICH TEAM CARDS, five players each, with the avatar primitive, the
 *     slot, the price paid and the PEAK3 value on every row, plus the total and
 *     the spend/unspent split.
 *   * THE THREE CALLOUTS AS CARDS, not labels. Best bargain, biggest overpay
 *     and the decisive lot each get a headline number.
 *   * THE ITEMISED RECEIPT one disclosure below, because it answers "how
 *     exactly" rather than "what happened".
 *
 * EVERY NUMBER IS THE SERVER'S. Totals, prices and scores come from the settled
 * snapshot the results rows were written from, so this panel and the stored
 * result cannot disagree.
 */

/**
 * The response bank.
 *
 * DETERMINISTIC BY CONSTRUCTION: the tier is decided by the margin, and the
 * line within a tier by an integer derived from the match's own totals. There
 * is no `Math.random` and no clock read, so the same finished match always
 * reads the same way — on reload, in a screenshot, and in a test.
 */
export function responseLine(
  outcome: "win" | "loss" | "draw",
  margin: number,
  fingerprint: number,
): string {
  if (outcome === "draw") return "Dead level. Twenty dollars each, nothing between you.";
  const tier = margin < 2 ? "thin" : margin < 12 ? "clear" : "wide";
  const bank: Record<string, string[]> = {
    "win:thin": [
      "Won it by a whisker. One more dollar anywhere and this reads the other way.",
      "That was the thinnest kind of win — a single lot decided it.",
    ],
    "win:clear": [
      "A clean win. You bought the right five and left nothing important on the board.",
      "Comfortable. Your money went where the value was.",
    ],
    "win:wide": [
      "A rout. You were never in danger after the middle of the market.",
      "Not close. That roster wins most nights by that margin.",
    ],
    "loss:thin": [
      "Lost by a whisker. One more dollar in the right lot and this is a win.",
      "That close. A single lot was the difference.",
    ],
    "loss:clear": [
      "Outbid where it counted. The value went the other way in the middle rounds.",
      "A clear loss — the winning five did more with the same twenty dollars.",
    ],
    "loss:wide": [
      "Comprehensively beaten. The money went to the wrong lots.",
      "A heavy one. Worth reading the receipt to see where the twenty went.",
    ],
  };
  const lines = bank[`${outcome}:${tier}`];
  return lines[Math.abs(Math.trunc(fingerprint)) % lines.length];
}

export default function ShowdownResult({
  receipt,
  publicState,
  seatNames,
  yourSeat,
  onPlayAgain,
  onCopy,
  copied,
  children,
}: {
  receipt: TwentyDollarReceiptData;
  publicState: TwentyDollarPublicState;
  seatNames: string[];
  yourSeat: number | null;
  onPlayAgain: () => void;
  onCopy: () => void;
  copied: boolean;
  /** The itemised receipt, rendered below the fold. */
  children?: React.ReactNode;
}) {
  const winner = receipt.settlement?.winner_seat ?? null;
  const drawn = receipt.settlement?.outcome === "draw" || winner === null;
  const youWon = winner !== null && winner === yourSeat;
  const outcome: "win" | "loss" | "draw" = drawn ? "draw" : youWon ? "win" : "loss";
  const totals = receipt.seats.map((seat) => seat.roster_total);
  const margin = totals.length === 2 ? Math.abs(totals[0] - totals[1]) : 0;
  const sum = totals.reduce((a, b) => a + b, 0);
  // The fingerprint is the match's own arithmetic, so the same result always
  // picks the same line. Scaled to whole numbers before truncation so two
  // matches a hundredth apart do not collide.
  const fingerprint = Math.round(sum * 100 + receipt.rounds_played);

  function nameOf(seat: number): string {
    return seat === yourSeat ? "You" : (seatNames[seat] ?? `Seat ${seat + 1}`);
  }

  const yourTotal = yourSeat !== null ? (totals[yourSeat] ?? 0) : (totals[0] ?? 0);
  const theirTotal = yourSeat !== null ? (totals[1 - yourSeat] ?? 0) : (totals[1] ?? 0);
  const yourShare = sum > 0 ? Math.round((yourTotal / sum) * 100) : 50;

  return (
    <section
      className="td-result"
      data-testid="td-result"
      data-outcome={outcome}
    >
      <Celebration active={youWon} testId="td-celebration" />

      <header className="td-result-head td-enter" data-tier={outcome}>
        <p className="td-result-eyebrow">
          Auction closed · {receipt.rounds_played} lots · {formatDollars(receipt.starting_budget)} each
        </p>
        {/* THE WORD, NOT THE COLOUR. `WON` / `LOST` / `DREW` survives
            greyscale, a screenshot and a colour-blind reader. */}
        <h2 className="td-result-headline" data-testid="td-result-headline">
          {drawn ? "DREW" : youWon ? "WON" : "LOST"}
        </h2>
        <p className="td-result-margin pk-numeral" data-testid="td-result-margin">
          {drawn ? "Level on PEAK3" : `by ${margin.toFixed(2)} PEAK3`}
        </p>
        <p className="td-result-response" data-testid="td-result-response">
          {responseLine(outcome, margin, fingerprint)}
        </p>

        {/* HEAD-TO-HEAD, as one bar with both totals on it. */}
        <div
          className="td-result-bar"
          data-testid="td-result-bar"
          role="img"
          aria-label={`You ${yourTotal.toFixed(2)} PEAK3, opponent ${theirTotal.toFixed(2)} PEAK3.`}
        >
          <span className="td-result-bar-fill" data-seat="a" style={{ width: `${yourShare}%` }} />
          <span className="td-result-bar-fill" data-seat="b" style={{ width: `${100 - yourShare}%` }} />
        </div>
        <div className="td-result-bar-keys">
          <span className="td-result-bar-key" data-seat="a">
            You <b className="pk-numeral">{yourTotal.toFixed(2)}</b>
          </span>
          <span className="td-result-bar-key" data-seat="b">
            {seatNames[yourSeat === 0 ? 1 : 0] ?? "Opponent"}{" "}
            <b className="pk-numeral">{theirTotal.toFixed(2)}</b>
          </span>
        </div>
      </header>

      <div className="td-result-seats" data-testid="td-result-seats">
        {receipt.seats.map((seat, index) => {
          const live: SeatPublic | undefined = publicState.seats[index];
          const spent = receipt.starting_budget - (live?.budget ?? seat.budget_remaining);
          return (
            <article
              key={index}
              className="td-result-seat"
              data-testid={`td-result-seat-${index}`}
              data-winner={winner === index ? "true" : "false"}
              data-seat={index === yourSeat ? "a" : "b"}
            >
              <header className="td-result-seat-head">
                <h3>{nameOf(index)}</h3>
                {winner === index ? (
                  <span className="td-result-crown" data-testid={`td-result-crown-${index}`}>
                    Winner
                  </span>
                ) : null}
                <span className="td-result-total pk-numeral" data-testid={`td-result-total-${index}`}>
                  {seat.roster_total.toFixed(2)}
                </span>
              </header>
              <p className="td-result-money pk-numeral" data-testid={`td-result-money-${index}`}>
                {formatDollars(spent)} spent · {formatDollars(live?.budget ?? seat.budget_remaining)} unspent
              </p>
              <ol className="td-result-roster">
                {publicState.slots.map((slot) => {
                  const entry = (live?.roster ?? []).find((row) => row.slot === slot);
                  return (
                    <li key={slot} className="td-result-slot" data-slot={slot}>
                      <span className="td-result-slot-figure">
                        {entry ? (
                          <PlayerAvatar name={entry.player_name} size={30} />
                        ) : (
                          <span className="td-slot-vacant" aria-hidden="true" />
                        )}
                        <span className="td-result-slot-tag">{slot}</span>
                      </span>
                      <span className="td-result-slot-body">
                        <span className="td-result-slot-name">
                          {entry?.player_name ?? "—"}
                        </span>
                        <span className="td-result-slot-sub pk-numeral">
                          {entry
                            ? `${entry.anchor_season}${entry.autofilled ? " · auto-filled" : ""}`
                            : "No player"}
                        </span>
                      </span>
                      <span className="td-result-slot-price pk-numeral">
                        {entry ? formatDollars(entry.price) : "—"}
                      </span>
                      <span className="td-result-slot-score pk-numeral">
                        {entry?.prime_score != null ? entry.prime_score.toFixed(1) : "—"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </article>
          );
        })}
      </div>

      {/* THE CALLOUTS ARE CARDS WITH A HEADLINE NUMBER, not a `<dl>` of 9 px
          grey labels. Each one is the most interesting fact of a whole match. */}
      <div className="td-result-facts" data-testid="td-result-facts">
        {receipt.best_bargain ? (
          <article className="td-callout" data-kind="bargain" data-testid="td-callout-bargain">
            <p className="td-callout-tag">Steal of the night</p>
            <p className="td-callout-headline pk-numeral">
              {receipt.best_bargain.prime_score.toFixed(1)}
              <span className="td-callout-unit"> for {formatDollars(receipt.best_bargain.price)}</span>
            </p>
            <p className="td-callout-body">
              {receipt.best_bargain.player_name} — {nameOf(receipt.best_bargain.seat_index)}
            </p>
          </article>
        ) : null}
        {receipt.biggest_overpay ? (
          <article className="td-callout" data-kind="overpay" data-testid="td-callout-overpay">
            <p className="td-callout-tag">Biggest overpay</p>
            <p className="td-callout-headline pk-numeral">
              {formatDollars(receipt.biggest_overpay.price)}
              <span className="td-callout-unit"> for {receipt.biggest_overpay.prime_score.toFixed(1)}</span>
            </p>
            <p className="td-callout-body">
              {receipt.biggest_overpay.player_name} — {nameOf(receipt.biggest_overpay.seat_index)}
            </p>
          </article>
        ) : null}
        {receipt.most_decisive ? (
          <article className="td-callout" data-kind="decisive" data-testid="td-callout-decisive">
            <p className="td-callout-tag">Decisive lot</p>
            <p className="td-callout-headline pk-numeral">
              {formatDollars(receipt.most_decisive.price)}
            </p>
            <p className="td-callout-body">
              {receipt.most_decisive.player_name} — to {nameOf(receipt.most_decisive.winner_seat)}
            </p>
          </article>
        ) : null}
      </div>

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
        <button type="button" className="btn-secondary" data-testid="td-share" onClick={onCopy}>
          {copied ? "Copied" : "Copy result"}
        </button>
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
