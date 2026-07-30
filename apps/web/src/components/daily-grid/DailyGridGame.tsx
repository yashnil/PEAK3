"use client";

import { useCallback, useEffect, useState } from "react";
import { DailyGridBoard, DailyGridProgress, PlayerSeasonSearchHit } from "@/types/daily-grid";
import { getDailyGridBoard, submitDailyGridAnswer } from "@/lib/daily-grid-api";
import {
  TOTAL_CELLS,
  clearProgress,
  emptyProgress,
  filledCoords,
  findFilled,
  isComplete,
  loadProgress,
  saveProgress,
  totalArenaPoints,
  usedPlayerSlugs,
  withFilledCell,
  withIncorrectAttempt,
  withoutCell,
} from "@/lib/daily-grid-state";
import DailyGridBoardView from "./DailyGridBoardView";
import CellPanel from "./CellPanel";
import CompletionPanel from "./CompletionPanel";

interface Props {
  /** Optional YYYY-MM-DD override; omitted means today (UTC), decided server-side. */
  date?: string;
  /** Test seam: pre-loaded board, so unit tests never need the API. */
  initialBoard?: DailyGridBoard;
}

const DIFFICULTY_COLOR: Record<string, string> = {
  easy: "var(--comp-team)",
  medium: "var(--peak-accent)",
  hard: "var(--comp-po)",
};

function Chip({ children, color, testId }: { children: React.ReactNode; color?: string; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em]"
      style={{
        border: `1px solid ${color ?? "var(--border-default)"}`,
        color: color ?? "var(--text-secondary)",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Daily Grid Challenge shell: board fetch, selection, submission and local
 * persistence.
 *
 * Server-authoritative by construction -- the only writes to `progress` that
 * fill a square copy the `player_season` and `cell_score` objects straight out
 * of the POST /daily-grid/answer response. There is no client-side eligibility
 * check and no client-side scoring anywhere in this component; the
 * unique-player rule is enforced by the server, and the slugs sent up in
 * `used_player_slugs` are just the board state it needs to do that.
 */
export default function DailyGridGame({ date, initialBoard }: Props) {
  const [board, setBoard] = useState<DailyGridBoard | null>(initialBoard ?? null);
  const [loading, setLoading] = useState(!initialBoard);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DailyGridProgress | null>(
    initialBoard ? emptyProgress(initialBoard) : null,
  );
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [cellMessage, setCellMessage] = useState<{ row: number; col: number; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  // --- board + restore ----------------------------------------------------
  useEffect(() => {
    if (initialBoard) {
      setProgress(loadProgress(initialBoard.board_id) ?? emptyProgress(initialBoard));
      return;
    }
    let cancelled = false;
    setLoading(true);
    getDailyGridBoard(date)
      .then((b) => {
        if (cancelled) return;
        setBoard(b);
        // A new date means a new board_id means a new storage key, so
        // yesterday's grid can never bleed into today's.
        setProgress(loadProgress(b.board_id) ?? emptyProgress(b));
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error && err.message ? err.message : "Could not load today's grid.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, initialBoard]);

  // --- persist ------------------------------------------------------------
  useEffect(() => {
    if (progress) saveProgress(progress);
  }, [progress]);

  const handleSelect = useCallback((row: number, col: number) => {
    setSelected((cur) => (cur && cur.row === row && cur.col === col ? null : { row, col }));
    setCellMessage(null);
  }, []);

  async function handleSubmit(hit: PlayerSeasonSearchHit) {
    if (!board || !progress || !selected) return;
    const { row, col } = selected;
    setSubmitting(true);
    try {
      const res = await submitDailyGridAnswer({
        date: board.date,
        row,
        col,
        answer_id: hit.id,
        used_player_slugs: usedPlayerSlugs(progress),
        filled_cells: filledCoords(progress),
      });
      if (res.valid && res.player_season && res.cell_score) {
        setProgress(
          withFilledCell(progress, {
            row,
            col,
            player_season: res.player_season,
            cell_score: res.cell_score,
          }),
        );
        setCellMessage(null);
        setSelected(null);
      } else {
        setProgress(withIncorrectAttempt(progress));
        // The server's sentence, verbatim -- it names the exact constraint or
        // rule that failed, which is the teaching moment. The fallback only
        // fires if the response omitted `reason` entirely.
        setCellMessage({ row, col, text: res.reason ?? "That answer was not accepted." });
      }
    } catch (err: unknown) {
      setCellMessage({
        row,
        col,
        text: err instanceof Error && err.message ? err.message : "Could not reach the grid service.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleRemove() {
    if (!progress || !selected) return;
    setProgress(withoutCell(progress, selected.row, selected.col));
    setCellMessage(null);
  }

  function handleReset() {
    if (!board) return;
    clearProgress(board.board_id);
    setProgress(emptyProgress(board));
    setSelected(null);
    setCellMessage(null);
    setConfirmingReset(false);
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p role="status" data-testid="daily-grid-loading" style={{ color: "var(--text-muted)" }}>
          Loading today&rsquo;s grid…
        </p>
      </div>
    );
  }

  if (loadError || !board || !progress) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4">
        <div className="card-elevated max-w-md space-y-3 p-6 text-center">
          <p role="alert" data-testid="daily-grid-error" style={{ color: "var(--incorrect)" }}>
            {loadError ?? "Could not load today's grid."}
          </p>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            The grid is generated by the PEAK3 API. Make sure it is running at{" "}
            <code className="text-xs">localhost:8000</code>.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg px-4 py-2 text-sm"
            style={{ border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const complete = isComplete(progress);
  const selectedFilled = selected ? findFilled(progress, selected.row, selected.col) : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-16 pt-6 sm:px-4">
      <header>
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Daily Grid Challenge</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          New board every day. Fill the grid with exact NBA player-seasons.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip testId="daily-grid-date">{board.date}</Chip>
          <Chip testId="daily-grid-difficulty" color={DIFFICULTY_COLOR[board.difficulty]}>
            {board.difficulty}
          </Chip>
          <Chip testId="daily-grid-progress">
            {progress.filled.length}/{TOTAL_CELLS} filled
          </Chip>
          <Chip testId="daily-grid-score">{totalArenaPoints(progress)} pts</Chip>
        </div>
        <p
          data-testid="daily-grid-unique-rule"
          className="mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{ background: "var(--peak-accent-bg)", color: "var(--text-secondary)" }}
        >
          <strong style={{ color: "var(--peak-accent)" }}>One player per square.</strong> No player may be used
          twice on this board — all nine squares need nine different players. Answers are exact seasons, so
          &ldquo;1999-00 Shaquille O&rsquo;Neal&rdquo;, not just &ldquo;Shaquille O&rsquo;Neal&rdquo;.
        </p>
      </header>

      <div className="court-grid-bg mt-5 rounded-xl p-2 sm:p-3" style={{ border: "1px solid var(--border-subtle)" }}>
        <DailyGridBoardView
          board={board}
          progress={progress}
          selected={selected}
          invalidCell={cellMessage ? { row: cellMessage.row, col: cellMessage.col } : null}
          onSelect={handleSelect}
        />
      </div>

      {selected && (
        <div className="mt-4">
          <CellPanel
            key={`${selected.row}-${selected.col}`}
            board={board}
            row={selected.row}
            col={selected.col}
            filled={selectedFilled}
            usedPlayerSlugs={usedPlayerSlugs(progress)}
            invalidMessage={
              cellMessage && cellMessage.row === selected.row && cellMessage.col === selected.col
                ? cellMessage.text
                : null
            }
            submitting={submitting}
            onSubmit={handleSubmit}
            onRemove={handleRemove}
            onClose={() => setSelected(null)}
          />
        </div>
      )}

      {!selected && !complete && (
        <p className="mt-4 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          Choose a square to see what it needs.
        </p>
      )}

      {complete && (
        <div className="mt-4">
          <CompletionPanel board={board} progress={progress} />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {confirmingReset ? (
          <>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Clear all nine squares for {board.date}?
            </span>
            <button
              type="button"
              data-testid="daily-grid-reset-confirm"
              onClick={handleReset}
              className="rounded-lg px-3 py-1.5 text-xs font-bold"
              style={{ background: "var(--incorrect)", color: "var(--text-primary)" }}
            >
              Yes, reset
            </button>
            <button
              type="button"
              data-testid="daily-grid-reset-cancel"
              onClick={() => setConfirmingReset(false)}
              className="rounded-lg px-3 py-1.5 text-xs"
              style={{ border: "1px solid var(--border-default)", color: "var(--text-secondary)" }}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            data-testid="daily-grid-reset"
            onClick={() => setConfirmingReset(true)}
            disabled={progress.filled.length === 0 && progress.incorrect_attempts === 0}
            className="rounded-lg px-3 py-1.5 text-xs disabled:opacity-40"
            style={{ border: "1px solid var(--border-default)", color: "var(--text-secondary)" }}
          >
            Reset grid
          </button>
        )}
      </div>
    </div>
  );
}
