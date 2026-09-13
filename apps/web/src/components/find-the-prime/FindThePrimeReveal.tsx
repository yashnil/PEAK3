"use client";

/**
 * A round resolves. The neutral rail becomes the ridge, then a restrained
 * receipt: PEAK3's highest-rated window, yours, the canonical gap between them,
 * and every seat's points. Language is "PEAK3 rates", never "the correct prime".
 */

import type { FindThePrimeMatchView, FindThePrimeRoundReveal, FindThePrimeSeatAnswer } from "@/types/find-the-prime";
import PrimeRidge from "./PrimeRidge";

export function answerSentence(answer: FindThePrimeSeatAnswer, reveal: FindThePrimeRoundReveal): string {
  if (answer.window_id === null) {
    return answer.locked_by === "forfeit" ? "Conceded — no window" : "No window placed — 0 points";
  }
  const window = reveal.windows.find((w) => w.window_id === answer.window_id);
  const label = window ? `${window.start_season} to ${window.end_season}` : "";
  if (answer.window_id === reveal.best_window_id) return `${label} — PEAK3's highest-rated window`;
  if (answer.found_prime) return `${label} — effectively tied with PEAK3's best (${answer.regret.toFixed(2)} behind)`;
  return `${label} — ${answer.regret.toFixed(2)} behind PEAK3's best`;
}

export default function FindThePrimeReveal({ view, reveal }: { view: FindThePrimeMatchView; reveal: FindThePrimeRoundReveal }) {
  const names = new Map(view.public_state.seats.map((s) => [s.seat_index, s.display_name]));
  const best = reveal.windows.find((w) => w.window_id === reveal.best_window_id);
  const mine = reveal.seats.find((s) => s.seat_index === view.your_seat_index);
  const rows = [...reveal.seats].sort((a, b) => b.points - a.points || a.seat_index - b.seat_index);
  return (
    <div className="fprime-reveal" data-testid="fprime-reveal">
      <div className="fprime-player">
        <p className="parena-eyebrow">
          Round {reveal.round_index + 1} · {reveal.duration}-year window
        </p>
        <h2 className="fprime-player-name">{reveal.player_name}</h2>
      </div>
      <PrimeRidge reveal={reveal} yourSeat={view.your_seat_index} seatNames={names} />
      <dl className="parena-receipt" data-testid="fprime-round-receipt">
        {best ? (
          <div>
            <dt>PEAK3&apos;s highest-rated window</dt>
            <dd>
              <span className="pk-numeral">
                {best.start_season} to {best.end_season}
              </span>{" "}
              · <span className="pk-numeral">{best.prime_score.toFixed(2)}</span>
            </dd>
          </div>
        ) : null}
        {mine ? (
          <div>
            <dt>Your window</dt>
            <dd data-testid="fprime-your-answer">{answerSentence(mine, reveal)}</dd>
          </div>
        ) : null}
        {mine ? (
          <div>
            <dt>Your round</dt>
            <dd className="pk-numeral" data-testid="fprime-round-points">
              {mine.points.toFixed(0)} pts
            </dd>
          </div>
        ) : null}
      </dl>
      <table className="parena-table" data-testid="fprime-round-table">
        <caption className="sr-only">Round {reveal.round_index + 1} points</caption>
        <thead>
          <tr>
            <th scope="col">Seat</th>
            <th scope="col">Window</th>
            <th scope="col">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.seat_index} data-you={row.seat_index === view.your_seat_index ? "true" : "false"}>
              <th scope="row">{names.get(row.seat_index) ?? `Seat ${row.seat_index + 1}`}</th>
              <td>{answerSentence(row, reveal)}</td>
              <td className="pk-numeral">{row.points.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
