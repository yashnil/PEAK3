"use client";

import { useState } from "react";
import { DailyGridBoard, DailyGridProgress, GridResultResponse, ResultCell } from "@/types/daily-grid";
import {
  TOTAL_CELLS,
  bestCell,
  buildDailyGridShareText,
  cellShortTitle,
  hardestCell,
  totalArenaPoints,
} from "@/lib/daily-grid-state";

interface Props {
  board: DailyGridBoard;
  progress: DailyGridProgress;
  /** Today's maximum, once the server has released it. Null while it is still
   *  loading, or if the request failed -- the recap degrades to the player's
   *  own totals rather than disappearing. */
  result?: GridResultResponse | null;
  resultError?: string | null;
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="card-surface p-3 text-center">
      <p data-testid={testId} className="font-display text-xl font-bold" style={{ color: "var(--peak-accent)" }}>
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
    </div>
  );
}

/**
 * Shown once all nine squares are filled. The recap is built entirely from
 * server-awarded numbers already sitting in progress -- no re-scoring, no
 * editorial verdict on the player, just what the board paid and which square
 * was the rarest.
 */
export default function CompletionPanel({ board, progress, result, resultError }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const total = totalArenaPoints(progress);
  const best = bestCell(progress.filled);
  const hardest = hardestCell(progress.filled);
  const shareText = buildDailyGridShareText(board, progress, result);
  // "today's maximum" is a provable claim; "PEAK3's best known" is not. Say
  // whichever one is actually true (see optimal.py's module docstring).
  const maxLabel = result?.exact_optimal ? "Today's max" : "PEAK3 best known";

  async function handleShare() {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked -- fall back to showing the text so it can be
      // selected by hand rather than silently doing nothing.
      setCopyFailed(true);
    }
  }

  return (
    <section
      data-testid="daily-grid-complete"
      aria-label="Grid complete"
      className="card-elevated p-4 sm:p-5"
      style={{ borderColor: "color-mix(in srgb, var(--peak-accent) 40%, var(--border-subtle))" }}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--peak-accent)" }}>
        Grid complete
      </p>
      <h2 className="font-display mt-1 text-xl font-bold">
        {TOTAL_CELLS}/{TOTAL_CELLS} squares, nine different players
      </h2>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat testId="complete-total-score" label="Total score" value={String(total)} />
        {result ? (
          <>
            <Stat testId="complete-optimal-total" label={maxLabel} value={String(result.optimal_total)} />
            <Stat
              testId="complete-percent-of-best"
              label="Of that maximum"
              value={`${result.percent_of_best}%`}
            />
          </>
        ) : (
          <>
            <Stat
              testId="complete-attempts"
              label="Wrong attempts"
              value={String(progress.incorrect_attempts)}
            />
            <Stat
              testId="complete-avg"
              label="Avg per square"
              value={String(Math.round(total / TOTAL_CELLS))}
            />
          </>
        )}
      </div>

      {result && (
        <div
          data-testid="complete-comparison"
          className="mt-4 rounded-lg p-3"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
            Against {result.exact_optimal ? "today's maximum" : "PEAK3's best known grid"}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            You scored{" "}
            <strong style={{ color: "var(--peak-accent)" }}>{result.user_total}</strong> of a possible{" "}
            <strong style={{ color: "var(--text-primary)" }}>{result.optimal_total}</strong> —{" "}
            {result.percent_of_best}% — and matched the best available answer on{" "}
            <strong style={{ color: "var(--text-primary)" }}>{result.squares_matching_optimal}</strong> of{" "}
            {TOTAL_CELLS} squares.
          </p>

          {result.biggest_miss ? (
            <p
              data-testid="complete-biggest-miss"
              className="mt-2.5 text-sm leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              <span className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
                Biggest miss
              </span>
              <br />
              <strong style={{ color: "var(--text-primary)" }}>
                {result.biggest_miss.row_constraint_label} × {result.biggest_miss.col_constraint_label}
              </strong>
              : you used {result.biggest_miss.user_player_season.label} (
              {result.biggest_miss.user_points} pts); PEAK3&rsquo;s best was{" "}
              {result.biggest_miss.optimal_player_season.label} ({result.biggest_miss.optimal_points}{" "}
              pts) — {result.biggest_miss.points_left} points left on the board.
            </p>
          ) : (
            <p
              data-testid="complete-perfect"
              className="mt-2.5 text-sm font-semibold"
              style={{ color: "var(--comp-team)" }}
            >
              Perfect board — you matched the maximum on every square.
            </p>
          )}

          <details className="mt-3">
            <summary
              data-testid="complete-per-cell-toggle"
              className="cursor-pointer text-xs font-semibold"
              style={{ color: "var(--peak-accent)" }}
            >
              What PEAK3 would have used
            </summary>
            <ul className="mt-2 space-y-1.5">
              {result.cells.map((cell: ResultCell) => (
                <li
                  key={`${cell.row}-${cell.col}`}
                  data-testid="complete-per-cell-row"
                  className="text-xs leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span style={{ color: "var(--text-muted)" }}>
                    {cell.row_constraint_label} × {cell.col_constraint_label}:
                  </span>{" "}
                  {cell.user_player_season.label} ({cell.user_points})
                  {cell.matched_optimal ? (
                    <strong style={{ color: "var(--comp-team)" }}> — best available</strong>
                  ) : (
                    <>
                      {" "}
                      → {cell.optimal_player_season.label} ({cell.optimal_points})
                    </>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {!result && resultError && (
        <p
          data-testid="complete-result-error"
          className="mt-3 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          {resultError} Your score still stands — the comparison against today&rsquo;s maximum could
          not be loaded.
        </p>
      )}

      <dl className="mt-3 space-y-2 text-sm">
        {best && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
              Best cell
            </dt>
            <dd data-testid="complete-best-cell" style={{ color: "var(--text-primary)" }}>
              {best.player_season.label} — {best.cell_score.arena_points} pts
            </dd>
          </div>
        )}
        {hardest && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
              Hardest cell
            </dt>
            <dd data-testid="complete-hardest-cell" style={{ color: "var(--text-primary)" }}>
              {cellShortTitle(board, hardest.row, hardest.col)} — {hardest.cell_score.rarity_label}, filled with{" "}
              {hardest.player_season.label}
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        PEAK3 rates each season on its own; a square pays that season&rsquo;s calibrated score plus a bonus for how
        rare a qualifying answer is. Scoring is server-side — this page only displays what the model returned.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="daily-grid-share"
          onClick={handleShare}
          className="rounded-lg px-4 py-2 text-sm font-bold"
          style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
        >
          {copied ? "Copied" : "Share result"}
        </button>
        {copied && (
          <span role="status" className="text-xs" style={{ color: "var(--text-muted)" }}>
            Copied to clipboard
          </span>
        )}
      </div>

      {copyFailed && (
        <pre
          data-testid="daily-grid-share-fallback"
          className="mt-3 overflow-x-auto rounded-lg p-3 text-xs"
          style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
        >
          {shareText}
        </pre>
      )}
    </section>
  );
}
