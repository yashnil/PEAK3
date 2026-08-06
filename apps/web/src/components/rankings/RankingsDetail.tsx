"use client";
import { useMemo } from "react";
import type { RankingRow } from "@/types";
import { formatScore2, RANKING_COMPONENT_KEYS } from "./board-model";
import { componentLabel } from "@/lib/utils";
import CompositeChart, { compositeAxes } from "./CompositeChart";

/**
 * The selected-player detail panel: a large composite chart and the same
 * numbers as a table.
 *
 * THE FIRST VIEW OF THE ANALYSIS DRAWER, and only that. It is deliberately the
 * PLAYER: rank, board, window, season, team, score, the composite chart and the
 * exact per-component values. The derivation — weights, arithmetic, receipts,
 * source window — sits below it inside `RankingsAnalysis`, behind disclosures,
 * so a reader who wanted the shape of a peak is not made to scroll past its
 * algebra to see it. Previous/Next swap this panel and nothing else moves, so a
 * reader walking the top twenty keeps their place.
 *
 * THE TABLE IS NOT A FALLBACK. It renders always, beside the chart, carrying
 * the identical values -- so the chart is one of two equal readings rather than
 * the only one with a text alternative bolted underneath. A radar is genuinely
 * good at shape and genuinely bad at exact values, and the table is where the
 * exact values live for everybody, not only for a screen reader.
 *
 * WHAT IT REFUSES TO DRAW. A board that publishes no percentiles gets the empty
 * state rather than a radar of zeros: a six-spoke shape collapsed to the origin
 * looks like a verdict on the player instead of an absence in the data.
 */
export default function RankingsDetail({
  row,
  boardLabel,
  windowLabel,
  populationNoun,
}: {
  row: RankingRow | null;
  boardLabel: string;
  windowLabel: string | null;
  populationNoun: string;
}) {
  const dataComplete = (row?.data_completeness ?? "complete") === "complete";
  const axes = useMemo(
    () => compositeAxes(row?.percentiles ?? null, row?.components ?? null, dataComplete),
    [row?.percentiles, row?.components, dataComplete],
  );

  if (!row) {
    return (
      <aside className="rk-detail" data-testid="rankings-detail" aria-live="polite">
        <p className="rk-detail-empty">Select a row to see its component profile.</p>
      </aside>
    );
  }

  return (
    <aside
      className="rk-detail"
      data-testid="rankings-detail"
      data-row-id={row.row_id}
      aria-live="polite"
      aria-labelledby="rk-detail-heading"
    >
      <header className="rk-detail-head">
        <p className="rk-detail-rank">
          #{row.rank} · {boardLabel}
          {windowLabel ? ` · ${windowLabel}` : ""}
        </p>
        <h2 id="rk-detail-heading" className="rk-detail-name" data-testid="rk-detail-name">
          {row.player_name}
        </h2>
        <p className="rk-detail-season">
          {row.label}
          {row.team ? ` · ${row.team}` : ""}
        </p>
        <p className="rk-detail-score">
          <span className="rk-detail-score-value">
            {row.prime_score === null ? "—" : formatScore2(row.prime_score)}
          </span>
          <span className="rk-detail-score-label">PEAK3 score</span>
        </p>
      </header>

      {axes ? (
        <>
          <CompositeChart axes={axes} playerName={row.player_name} />

          {/* The same values, as data. Always rendered -- see the docstring. */}
          <table className="rk-detail-table" data-testid="rk-detail-table">
            <caption>
              {row.player_name}, {row.label}: percentile against every{" "}
              {populationNoun} on this board, and the published contribution
              behind it.
            </caption>
            <thead>
              <tr>
                <th scope="col">Component</th>
                <th scope="col">Percentile</th>
                <th scope="col">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {RANKING_COMPONENT_KEYS.map((key) => (
                <tr key={key} data-testid={`rk-detail-row-${key}`}>
                  <th scope="row">{componentLabel(key)}</th>
                  <td>
                    {row.percentiles?.[key] === null ||
                    row.percentiles?.[key] === undefined
                      ? "—"
                      : Math.round(row.percentiles[key] as number)}
                  </td>
                  <td>
                    {row.components?.[key] === null ||
                    row.components?.[key] === undefined
                      ? "—"
                      : formatScore2(row.components[key] as number)}
                  </td>
                </tr>
              ))}
              <tr data-testid="rk-detail-row-data_completeness">
                <th scope="row">Data completeness</th>
                <td>{dataComplete ? 100 : 60}</td>
                <td>{dataComplete ? "Complete" : (row.data_completeness ?? "Partial")}</td>
              </tr>
            </tbody>
          </table>

          <p className="rk-detail-note">
            The five components are PEAK3&apos;s own weighted contributions; the
            sixth axis reports how complete this row&apos;s source data is, so a
            partially-covered season is visible rather than silently flattering.
            PEAK3 rates peaks — it does not settle them.
          </p>
        </>
      ) : (
        <p className="rk-detail-empty" data-testid="rk-detail-no-components">
          This board does not publish component percentiles, so there is no
          composite profile to draw for {row.player_name}.
        </p>
      )}

      {/* NO "Full score explanation" BUTTON. There is nowhere else for it to
          go: the derivation is directly below this panel, in the same drawer,
          behind three disclosures. A control that scrolls you three hundred
          pixels is worse than the heading it would scroll you to. */}
    </aside>
  );
}
