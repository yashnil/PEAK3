"use client";

/**
 * A heat resolves: the eight peaks in PEAK3's order with the CUT LINE drawn
 * between the fourth and fifth, your call beside each (in words and icons, not
 * colour alone), your heat score, and the table's standings.
 *
 * Exported pieces are reused by the final receipt so a heat reads the same in
 * both places.
 */

import { Check, Scissors } from "lucide-react";

import type { PrimeCutHeatResult, PrimeCutMatchView } from "@/types/prime-cut";
import { ordinal } from "@/components/prime-arena/ArenaMatchStrip";
import { teamShort } from "./PrimeCutCard";

export function CutLineList({
  result,
  seatIndex,
  testId,
}: {
  result: PrimeCutHeatResult;
  seatIndex: number | null;
  testId: string;
}) {
  const ordered = [...result.cards].sort((a, b) => b.prime_score - a.prime_score || a.card_index - b.card_index);
  const optimal = new Set(result.optimal_card_indexes);
  const row = result.seats.find((s) => s.seat_index === seatIndex);
  const kept = new Set(row?.kept_card_indexes ?? []);
  return (
    <ol className="pcut-cutline" data-testid={testId} aria-label={`Heat ${result.heat_index + 1}: all eight peaks in PEAK3's order`}>
      {ordered.map((card, index) => {
        const keptIt = kept.has(card.card_index);
        const rightCall = keptIt === optimal.has(card.card_index);
        return (
          <li
            key={card.card_index}
            className="pcut-cutline-row"
            data-side={index < 4 ? "above" : "below"}
            data-call={keptIt ? "keep" : "cut"}
            data-right={rightCall ? "true" : "false"}
          >
            <span className="pcut-cutline-rank pk-numeral">{index + 1}</span>
            <span className="pcut-cutline-who">
              <span className="pcut-cutline-name">{card.player_name}</span>
              <span className="pcut-cutline-window pk-numeral">
                {card.start_season}–{card.end_season} · {card.seasons.map((s) => teamShort(s.team)).filter((t, i, a) => a.indexOf(t) === i).join(", ")}
              </span>
            </span>
            <span className="pcut-cutline-score pk-numeral">{card.prime_score.toFixed(2)}</span>
            {row ? (
              <span className="pcut-cutline-call">
                {keptIt ? <Check size={14} aria-hidden="true" /> : <Scissors size={14} aria-hidden="true" />}
                <span>{keptIt ? "Kept" : "Cut"}</span>
                <span className="pcut-cutline-verdict">{rightCall ? "Right call" : "Missed"}</span>
              </span>
            ) : null}
            {index === 3 ? (
              <span className="pcut-cutline-divider" data-testid={`${testId}-line`}>
                <span>Cut line</span>
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default function PrimeCutHeatReveal({ view }: { view: PrimeCutMatchView }) {
  const state = view.public_state;
  const result = state.heat_results[state.heat_results.length - 1];
  if (!result) return null;
  const mine = result.seats.find((s) => s.seat_index === view.your_seat_index);
  const names = new Map(state.seats.map((s) => [s.seat_index, s.display_name]));
  const heatRows = [...result.seats].sort((a, b) => b.capture - a.capture || a.seat_index - b.seat_index);
  const standing = state.standings.find((s) => s.seat_index === view.your_seat_index);

  return (
    <div className="pcut-reveal" data-testid="pcut-heat-reveal">
      <p className="parena-eyebrow">
        Heat {result.heat_index + 1} results · {result.duration}-year peaks
      </p>
      {mine ? (
        <div className="pcut-reveal-score">
          <span className="pcut-reveal-numeral pk-numeral" data-testid="pcut-heat-score">
            {mine.capture.toFixed(1)}
          </span>
          <span className="pcut-reveal-caption">
            Heat score. You kept {mine.optimal_kept} of the four peaks PEAK3 rates highest
            {standing ? ` and sit ${ordinal(standing.position)}` : ""}.
          </span>
        </div>
      ) : null}
      <CutLineList result={result} seatIndex={view.your_seat_index} testId="pcut-reveal-cutline" />
      <table className="parena-table" data-testid="pcut-heat-table">
        <caption className="sr-only">Heat {result.heat_index + 1} scores</caption>
        <thead>
          <tr>
            <th scope="col">Seat</th>
            <th scope="col">Best four kept</th>
            <th scope="col">Heat score</th>
          </tr>
        </thead>
        <tbody>
          {heatRows.map((row) => (
            <tr key={row.seat_index} data-you={row.seat_index === view.your_seat_index ? "true" : "false"}>
              <th scope="row">{names.get(row.seat_index) ?? `Seat ${row.seat_index + 1}`}</th>
              <td className="pk-numeral">{row.optimal_kept}/4</td>
              <td className="pk-numeral">{row.capture.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
