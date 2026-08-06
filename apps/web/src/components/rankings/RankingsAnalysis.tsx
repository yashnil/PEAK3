"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getRankingExplain } from "@/lib/api";
import type {
  Methodology,
  RankingBoardId,
  RankingComparison,
  RankingExplain,
  RankingRow,
} from "@/types";
import RankingsDetail from "./RankingsDetail";
import {
  PivotBackButton,
  ScoreBreakdownSection,
  ScoreCalculationSection,
  SourceWindowSection,
  type DerivationSubject,
} from "./ScoreDerivation";

/**
 * THE player-analysis drawer. One row activation, one destination, everything
 * PEAK3 can say about that peak.
 *
 * WHAT THIS ABSORBED, AND WHY IT HAD TO. Until this pass a ranking row carried
 * TWO controls: the row (and the name, and the rank) opened this drawer, and a
 * separate one-character `ƒ` cell opened a full-screen `ScoreExplainModal`. Two
 * interactions, two dialogs, one question. The drawer showed the shape of a peak
 * and refused to say where the number came from; the modal showed the
 * derivation and had no chart. A reader who wanted both had to close one to open
 * the other, and on a phone the `ƒ` cell was a glyph in a table.
 *
 * The `ƒ` column is gone — header and cells — and the table reclaimed its width.
 * The derivation lives here, behind three disclosures, and the modal file no
 * longer exists: its contents are `ScoreDerivation.tsx`, which is a set of
 * SECTIONS rather than a dialog, so there is no second modal left to open.
 *
 * PROGRESSIVE DISCLOSURE, AND THE ORDER IS THE ARGUMENT. The first view is
 * unchanged and stays unchanged deliberately — it was reviewed and approved:
 * name, rank, board, season, team, score, the composite chart, and the exact
 * percentile and contribution for every component. The derivation expands
 * BELOW it, closed by default, so a reader who only wanted to see the shape of
 * a peak is not made to scroll past its algebra.
 *
 * NATIVE `<details>`, NOT A `useState` ACCORDION. The same correctness argument
 * `NbaFactOfTheDay` records: the browser owns the open/closed state, so it works
 * before hydration and with JavaScript off, it is keyboard-operable with no
 * handler of ours, and it reports its state to assistive technology natively —
 * which is why there is no hand-written `aria-expanded` here to duplicate and
 * eventually contradict what the element already says.
 *
 * WHY A DRAWER AND NOT A ROUTE. The ranking list stays mounted behind it, which
 * preserves scroll position, the active sort, the search text and the duration
 * filter for free — a route would have to serialise and restore all four. The
 * cost is that browser Back does not close it, so Escape, the scrim and an
 * explicit Close all do, and the close control is the first focusable element.
 *
 * THE CHART IS MOUNTED ONLY WHILE THIS IS OPEN, and so is the explain request:
 * `RankingsDetail` (and through it `CompositeChart`) renders inside the `open`
 * branch, and `getRankingExplain` fires from an effect that only runs when a row
 * is selected. A page load that never opens an analysis constructs no SVG and
 * makes no derivation request.
 */

/** What the drawer is showing: the page's row, or a row pivoted to from a
 *  comparison rail. `row_id` is the only thing the explain route needs. */
interface AnalysisSubject extends DerivationSubject {
  row_id: string;
}

function subjectFromRow(row: RankingRow): AnalysisSubject {
  return {
    row_id: row.row_id,
    player_name: row.player_name,
    label: row.label,
    rank: row.rank,
    prime_score: row.prime_score,
  };
}

function subjectFromComparison(entry: RankingComparison, fallbackName: string): AnalysisSubject {
  return {
    row_id: entry.row_id,
    player_name: entry.player_name ?? fallbackName,
    label: entry.label,
    rank: entry.rank,
    prime_score: entry.prime_score,
  };
}

export interface RankingsAnalysisProps {
  /** `null` means closed. There is no "selected but hidden" state. */
  row: RankingRow | null;
  board: RankingBoardId;
  boardLabel: string;
  windowLabel: string | null;
  /** Singular — "percentile against every peak window". */
  populationNoun: string;
  /** Plural — "the 99th percentile of all scored peak windows". Two forms
   *  rather than one, because the summary panel and the derivation prose
   *  genuinely need different ones and a single string made one of them
   *  ungrammatical. */
  populationNounPlural: string;
  /** Total rows on the board, for "rank N of M". */
  boardRowCount: number | null;
  methodology: Methodology | null;
  onClose: () => void;
  /** Move to the adjacent ranked row without leaving the analysis. */
  onNavigate: (direction: -1 | 1) => void;
  hasPrevious: boolean;
  hasNext: boolean;
  /** Injectable for tests; production always uses the real endpoint. */
  fetchExplain?: (board: RankingBoardId, rowId: string) => Promise<RankingExplain>;
}

export default function RankingsAnalysis({
  row,
  board,
  boardLabel,
  windowLabel,
  populationNoun,
  populationNounPlural,
  boardRowCount,
  methodology,
  onClose,
  onNavigate,
  hasPrevious,
  hasNext,
  fetchExplain = getRankingExplain,
}: RankingsAnalysisProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const open = row !== null;

  /** Pivot history. Empty means "showing the page's own row"; each entry is a
   *  comparison the reader walked into, and "Back" pops one. */
  const [pivots, setPivots] = useState<AnalysisSubject[]>([]);
  const [explain, setExplain] = useState<RankingExplain | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);

  const pageRowId = row?.row_id ?? null;

  // A different row from the page — a click, or Previous/Next — is a fresh
  // subject, not a deeper pivot.
  useEffect(() => {
    setPivots([]);
  }, [pageRowId]);

  const subject: AnalysisSubject | null = useMemo(() => {
    if (pivots.length) return pivots[pivots.length - 1];
    return row ? subjectFromRow(row) : null;
  }, [pivots, row]);

  const activeRowId = subject?.row_id ?? null;

  useEffect(() => {
    if (!activeRowId) {
      setExplain(null);
      setExplainError(null);
      return;
    }
    let cancelled = false;
    setExplainLoading(true);
    setExplainError(null);
    setExplain(null);
    fetchExplain(board, activeRowId)
      .then((result) => {
        if (!cancelled) setExplain(result);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setExplain(null);
          setExplainError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setExplainLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `fetchExplain` is a stable prop in production and a fresh mock per test;
    // re-running on its identity would refetch on every render in tests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRowId, board]);

  // FOCUS MOVES IN, AND THE CLOSE CONTROL IS WHERE IT LANDS. A drawer that
  // opens without moving focus leaves a keyboard user still on the row behind
  // it, tabbing through a list they cannot see.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(
      // `preventScroll` IS LOAD-BEARING, not a micro-optimisation. `html` in
      // this app carries `scroll-behavior: smooth` (globals.css), so the
      // default scroll-into-view that accompanies `focus()` starts a smooth
      // scroll animation on the document — which moves the ranking list the
      // reader is going to return to, and defeats the whole reason this is a
      // drawer rather than a route. It also left the panel in motion long
      // enough that Playwright's actionability check reported it as unstable.
      () => closeRef.current?.focus({ preventScroll: true }),
      20,
    );
    return () => window.clearTimeout(timer);
  }, [open, pageRowId]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // A SIMPLE FOCUS TRAP. The list behind stays mounted (that is what preserves
  // scroll and filters), so without this a Tab from the last control walks into
  // a table the user cannot see.
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const pivot = useCallback(
    (entry: RankingComparison) => {
      setPivots((current) => [
        ...current,
        subjectFromComparison(entry, subject?.player_name ?? entry.label),
      ]);
    },
    [subject?.player_name],
  );

  const goBack = useCallback(() => setPivots((current) => current.slice(0, -1)), []);

  if (!open || !subject) return null;

  const pivoted = pivots.length > 0;
  // The row the summary head and the chart draw. Unpivoted that is the board
  // row the page handed us. Pivoted it is the explain payload, which extends
  // `RankingRow` — so the chart, the exact values and the completeness axis all
  // come from the same fetch the derivation does, with nothing reconstructed.
  const displayRow: RankingRow | null = pivoted ? explain : row;
  const previousLabel = pivoted
    ? pivots.length > 1
      ? `${pivots[pivots.length - 2].player_name} ${pivots[pivots.length - 2].label}`
      : `${row.player_name} ${row.label}`
    : null;

  const derivation = {
    explain,
    subject,
    boardLabel,
    boardRowCount,
    populationNoun: populationNounPlural,
    methodology,
    loading: explainLoading,
    error: explainError,
  };

  return (
    <div className="rk-analysis-scrim" data-testid="rankings-analysis-scrim" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rk-detail-heading"
        data-testid="rankings-analysis"
        data-row-id={subject.row_id}
        data-pivoted={pivoted ? "true" : "false"}
        className="rk-analysis"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="rk-analysis-head">
          <p className="rk-analysis-eyebrow">Player analysis</p>
          <button
            ref={closeRef}
            type="button"
            className="rk-analysis-close"
            data-testid="rankings-analysis-close"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
            <span className="sr-only">Close player analysis</span>
          </button>
        </header>

        <div className="rk-analysis-body">
          {previousLabel && <PivotBackButton label={previousLabel} onClick={goBack} />}

          {/* THE FIRST VIEW, UNCHANGED. Rank, board, window, season, team,
              score, the composite chart, and every component's exact percentile
              and contribution. This is what the manual review approved, and the
              derivation was folded in BELOW it rather than in front of it. */}
          {displayRow ? (
            <RankingsDetail
              row={displayRow}
              boardLabel={boardLabel}
              windowLabel={windowLabel}
              populationNoun={populationNoun}
            />
          ) : (
            <p className="rk-detail-empty" role="status" data-testid="rankings-analysis-loading">
              Loading {subject.player_name} {subject.label}…
            </p>
          )}

          {/* THE DERIVATION. Three disclosures, all closed on open. */}
          <div className="rk-folds">
            <details className="rk-fold" data-testid="rk-fold-breakdown">
              <summary className="rk-fold-summary">
                <span className="rk-fold-title">Score breakdown</span>
                <span className="rk-fold-hint">
                  Every component, its weight and its share
                </span>
              </summary>
              <div className="rk-fold-body">
                <ScoreBreakdownSection {...derivation} />
              </div>
            </details>

            <details className="rk-fold" data-testid="rk-fold-calculation">
              <summary className="rk-fold-summary">
                <span className="rk-fold-title">How this score was calculated</span>
                <span className="rk-fold-hint">
                  The arithmetic, the receipts and the caveats
                </span>
              </summary>
              <div className="rk-fold-body">
                <ScoreCalculationSection {...derivation} />
              </div>
            </details>

            <details className="rk-fold" data-testid="rk-fold-source">
              <summary className="rk-fold-summary">
                <span className="rk-fold-title">Source window</span>
                <span className="rk-fold-hint">
                  The seasons, the statistics and where to look next
                </span>
              </summary>
              <div className="rk-fold-body">
                <SourceWindowSection {...derivation} board={board} onPivot={pivot} />
              </div>
            </details>
          </div>
        </div>

        {/* PREVIOUS / NEXT RANKED PLAYER. Comparing two neighbouring peaks is
            the reason somebody opens this at all, and closing and reopening to
            do it is what made the standing panel feel necessary.

            DISABLED WHILE PIVOTED, because "the next ranked player" is a fact
            about the board list and the pivoted row is not on it. Back returns
            to the list, and the controls return with it. */}
        <footer className="rk-analysis-nav">
          <button
            type="button"
            className="rk-analysis-step"
            data-testid="rankings-analysis-prev"
            disabled={pivoted || !hasPrevious}
            onClick={() => onNavigate(-1)}
          >
            ← Higher ranked
          </button>
          <button
            type="button"
            className="rk-analysis-step"
            data-testid="rankings-analysis-next"
            disabled={pivoted || !hasNext}
            onClick={() => onNavigate(1)}
          >
            Lower ranked →
          </button>
        </footer>
      </div>
    </div>
  );
}
