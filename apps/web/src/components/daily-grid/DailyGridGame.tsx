"use client";

import { useCallback, useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import {
  DailyGridBoard,
  DailyGridProgress,
  GridResultResponse,
  PlayerSeasonSearchHit,
} from "@/types/daily-grid";
import { getDailyGridBoard, getDailyGridResult, submitDailyGridAnswer } from "@/lib/daily-grid-api";
import {
  TOTAL_CELLS,
  emptyProgress,
  filledCoords,
  findFilled,
  hasSeenRules,
  isComplete,
  loadProgress,
  markRulesSeen,
  saveProgress,
  totalArenaPoints,
  usedPlayerSlugs,
  withFilledCell,
  withIncorrectAttempt,
} from "@/lib/daily-grid-state";
import DailyGridBoardView from "./DailyGridBoardView";
import CellPanel from "./CellPanel";
import CompletionPanel from "./CompletionPanel";
import HowToPlay from "./HowToPlay";

interface Props {
  /** Optional YYYY-MM-DD override; omitted means today (UTC), decided server-side. */
  date?: string;
  /** Test seam: pre-loaded board, so unit tests never need the API. */
  initialBoard?: DailyGridBoard;
  /** Test seam: skip the rules gate. Production always consults localStorage. */
  skipRulesGate?: boolean;
}

const DIFFICULTY_COLOR: Record<string, string> = {
  easy: "var(--comp-team)",
  medium: "var(--peak-accent)",
  hard: "var(--comp-po)",
};

function StatTile({
  label,
  value,
  accent,
  testId,
}: {
  label: string;
  value: string;
  accent?: string;
  testId?: string;
}) {
  return (
    <div
      className="card-surface flex-1 px-3 py-2 text-center"
      style={{ borderTop: `2px solid ${accent ?? "var(--border-default)"}` }}
    >
      <p
        data-testid={testId}
        className="score-number font-display text-lg font-bold leading-tight"
        style={{ color: accent ?? "var(--text-primary)" }}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
    </div>
  );
}

/**
 * Daily Grid Challenge shell: board fetch, selection, submission, local
 * persistence and the post-completion comparison.
 *
 * Server-authoritative by construction -- the only writes to `progress` that
 * fill a square copy the `player_season` and `cell_score` objects straight out
 * of the POST /daily-grid/answer response. There is no client-side eligibility
 * check and no client-side scoring anywhere in this component.
 *
 * PHASE 11B RULES, all enforced here as well as server-side:
 *   - the rules gate runs before the board is playable on a first visit, because
 *     an optimisation puzzle is unguessable from a grid of empty squares;
 *   - a locked square is FINAL -- clicking it reviews it, and there is no
 *     remove or reset control anywhere in the component;
 *   - today's maximum is fetched only once all nine squares are locked, and the
 *     server re-validates the whole board before releasing it.
 */
export default function DailyGridGame({ date, initialBoard, skipRulesGate }: Props) {
  const [board, setBoard] = useState<DailyGridBoard | null>(initialBoard ?? null);
  const [loading, setLoading] = useState(!initialBoard);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DailyGridProgress | null>(
    initialBoard ? emptyProgress(initialBoard) : null,
  );
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [cellMessage, setCellMessage] = useState<{ row: number; col: number; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // `null` until the localStorage read happens in an effect -- reading it during
  // render would diverge between the server and client passes and hydrate wrong.
  const [showGate, setShowGate] = useState<boolean | null>(skipRulesGate ? false : null);
  const [rulesPanelOpen, setRulesPanelOpen] = useState(false);
  const [result, setResult] = useState<GridResultResponse | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  // --- rules gate ---------------------------------------------------------
  useEffect(() => {
    if (skipRulesGate) return;
    setShowGate(!hasSeenRules());
  }, [skipRulesGate]);

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

  // --- today's maximum, once the board is finished ------------------------
  useEffect(() => {
    if (!board || !progress || !isComplete(progress) || result) return;
    let cancelled = false;
    getDailyGridResult({
      date: board.date,
      filled: progress.filled.map((c) => ({ row: c.row, col: c.col, answer_id: c.player_season.id })),
      incorrect_attempts: progress.incorrect_attempts,
    })
      .then((res) => {
        if (!cancelled) {
          setResult(res);
          setResultError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // The board still shows its own total; only the comparison is missing.
        setResultError(
          err instanceof Error && err.message ? err.message : "Could not load today's maximum.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [board, progress, result]);

  const handleSelect = useCallback((row: number, col: number) => {
    setSelected((cur) => (cur && cur.row === row && cur.col === col ? null : { row, col }));
    setCellMessage(null);
  }, []);

  async function handleSubmit(hit: PlayerSeasonSearchHit) {
    if (!board || !progress || !selected) return;
    const { row, col } = selected;
    // A locked square is final. Guarded here as well as in withFilledCell so a
    // stray double-submit can never rewrite a pick.
    if (findFilled(progress, row, col)) return;
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

  function startGrid() {
    markRulesSeen();
    setShowGate(false);
  }

  if (loading || showGate === null) {
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

  if (showGate) {
    return (
      <div className="mx-auto w-full max-w-5xl px-3 pb-16 pt-8 sm:px-4">
        <HowToPlay
          variant="gate"
          date={board.date}
          difficulty={board.difficulty}
          onStart={startGrid}
        />
      </div>
    );
  }

  const complete = isComplete(progress);
  const selectedFilled = selected ? findFilled(progress, selected.row, selected.col) : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-3 pb-16 pt-6 sm:px-4">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold sm:text-3xl">Daily Grid Challenge</h1>
            {/* The objective, at the top, in the same words the how-to-play
                panel uses. This is the line the Phase 11A page was missing. */}
            <p
              data-testid="daily-grid-objective"
              className="mt-1 text-sm sm:text-base"
              style={{ color: "var(--text-secondary)" }}
            >
              <strong style={{ color: "var(--peak-accent)" }}>Maximize your PEAK3 total.</strong> Fill
              all nine squares with valid exact NBA player-seasons — scores stay hidden until you lock
              a pick.
            </p>
          </div>
          <button
            type="button"
            data-testid="daily-grid-how-to-play"
            onClick={() => setRulesPanelOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            <HelpCircle size={13} aria-hidden="true" />
            How to play
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-stretch gap-2">
          <StatTile
            label="Score"
            value={String(totalArenaPoints(progress))}
            accent="var(--peak-accent)"
            testId="daily-grid-score"
          />
          <StatTile
            label="Locked"
            value={`${progress.filled.length}/${TOTAL_CELLS}`}
            testId="daily-grid-progress"
          />
          <StatTile
            label="Misses"
            value={String(progress.incorrect_attempts)}
            accent={progress.incorrect_attempts > 0 ? "var(--incorrect)" : undefined}
            testId="daily-grid-misses"
          />
          {result ? (
            <StatTile
              label={result.exact_optimal ? "Of today's max" : "Of best known"}
              value={`${result.percent_of_best}%`}
              accent="var(--comp-team)"
              testId="daily-grid-percent"
            />
          ) : (
            <StatTile
              label="Difficulty"
              value={board.difficulty}
              accent={DIFFICULTY_COLOR[board.difficulty]}
              testId="daily-grid-difficulty"
            />
          )}
        </div>

        <p
          data-testid="daily-grid-unique-rule"
          className="mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{ background: "var(--peak-accent-bg)", color: "var(--text-secondary)" }}
        >
          <strong style={{ color: "var(--peak-accent)" }}>One player per square, picks are final.</strong>{" "}
          All nine squares need nine different players, and a valid pick cannot be changed. Answers are
          exact seasons — &ldquo;1999-00 Shaquille O&rsquo;Neal&rdquo;, not just &ldquo;Shaquille
          O&rsquo;Neal&rdquo;. <span data-testid="daily-grid-date">{board.date}</span>
        </p>
      </header>

      {/* Desktop: grid left, workbench right, so the selected square's panel is
          beside the board instead of below the fold. Mobile keeps them stacked.
          `items-start` + `sticky` keeps the panel in view while the player
          scrolls a long candidate list. */}
      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div
          className="court-grid-bg rounded-xl p-2 sm:p-3"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          <DailyGridBoardView
            board={board}
            progress={progress}
            selected={selected}
            invalidCell={cellMessage ? { row: cellMessage.row, col: cellMessage.col } : null}
            onSelect={handleSelect}
          />
        </div>

        <div className="lg:sticky lg:top-20">
          {selected ? (
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
              onClose={() => setSelected(null)}
            />
          ) : (
            !complete && (
              <div
                data-testid="daily-grid-idle-hint"
                className="card-surface p-5 text-center"
              >
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Choose a square to start
                </p>
                <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  Each square needs a player-season that satisfies both its row and its column. Squares
                  with a smaller answer pool are worth more — but any valid answer beats an empty square.
                </p>
              </div>
            )
          )}

          {complete && !selected && (
            <CompletionPanel
              board={board}
              progress={progress}
              result={result}
              resultError={resultError}
            />
          )}
        </div>
      </div>

      {/* Phase 11B: no reset control. A valid pick is locked and the board is
          the board -- a "start over" button would make both the day's score and
          the comparison against today's maximum meaningless. */}

      {rulesPanelOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-16"
          style={{ background: "rgba(0,0,0,0.6)" }}
        >
          <HowToPlay
            variant="panel"
            date={board.date}
            difficulty={board.difficulty}
            onStart={startGrid}
            onClose={() => setRulesPanelOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
