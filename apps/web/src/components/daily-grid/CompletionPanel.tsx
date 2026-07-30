"use client";

import { useState } from "react";
import { DailyGridBoard, DailyGridProgress } from "@/types/daily-grid";
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
export default function CompletionPanel({ board, progress }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const total = totalArenaPoints(progress);
  const best = bestCell(progress.filled);
  const hardest = hardestCell(progress.filled);
  const shareText = buildDailyGridShareText(board, progress);

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
      </div>

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
