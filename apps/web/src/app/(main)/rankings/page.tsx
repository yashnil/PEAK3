"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getMethodology, getPeakWindowBoard, getSeasonBoard } from "@/lib/api";
import type { Methodology, RankingBoardData, RankingBoardId, RankingRow } from "@/types";
import RankingsTable, { ComponentLegend } from "@/components/rankings/RankingsTable";
import ScoreExplainModal from "@/components/rankings/ScoreExplainModal";
import {
  DEFAULT_SORT_DIRECTION,
  DEFAULT_SORT_KEY,
  RANKING_COLUMNS,
  hasComponents,
  isDefaultSort,
  sortRankingRows,
  type RankingSortKey,
  type SortDirection,
} from "@/components/rankings/board-model";

/**
 * PEAK3 Rankings.
 *
 * Phase 10B: reduced from THREE boards to TWO. "Canonical Players" answered the
 * same question as Peak Windows -- "who had the best peak?", one row per player,
 * just over a narrower universe -- so a reader had to diff two boards to tell
 * them apart. Two boards that ask genuinely different questions is clearer:
 *
 *   Peak Windows   -- one row per player. "Who had the best peak?"
 *   Single Seasons -- one row per season, repeats expected. "What are the best
 *                     individual seasons ever?"
 *
 * The canonical 250-pool leaderboards are NOT removed from the product: the
 * /api/v1/leaderboards route and its committed CSVs are untouched and the
 * methodology page still documents them. This page just stops presenting a
 * third, overlapping board.
 *
 * NOTE FOR FUTURE EDITORS: an existing e2e (gameplay.spec.ts) looks up a tab by
 * /3.year|3-year/i with NO tablist scoping, so exactly ONE control on this page
 * may match that wording. The window selector owns it ("1-Year"/"3-Year"/
 * "5-Year"); no board tab or sort control may use that phrasing.
 */

const BOARDS: { id: RankingBoardId; label: string; blurb: string; testId: string }[] = [
  {
    id: "peakWindows",
    label: "Peak Windows",
    blurb:
      "One row per player, at their single best consecutive stretch. Answers “who had the best peak?”",
    testId: "pool-tab-peak-windows",
  },
  {
    id: "seasons",
    label: "Single Seasons",
    blurb:
      "Every scored season ranked on its own, so a player can appear many times. Answers “what are the best individual seasons ever?”",
    testId: "pool-tab-seasons",
  },
];

const WINDOW_OPTIONS: { id: "1y" | "3y" | "5y"; label: string }[] = [
  { id: "1y", label: "1-Year" },
  { id: "3y", label: "3-Year" },
  { id: "5y", label: "5-Year" },
];

const PAGE_SIZE = 50;

export default function RankingsPage() {
  const [board, setBoard] = useState<RankingBoardId>("peakWindows");
  const [peakWindow, setPeakWindow] = useState<"1y" | "3y" | "5y">("1y");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [data, setData] = useState<RankingBoardData | null>(null);
  const [methodology, setMethodology] = useState<Methodology | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<RankingSortKey>(DEFAULT_SORT_KEY);
  const [sortDirection, setSortDirection] = useState<SortDirection>(DEFAULT_SORT_DIRECTION);
  const [openRow, setOpenRow] = useState<RankingRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Component weights and long-form copy for the modal come from the real
  // methodology endpoint -- never hardcoded in TS (project rule).
  useEffect(() => {
    getMethodology()
      .then(setMethodology)
      .catch(() => setMethodology(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const request =
      board === "peakWindows"
        ? getPeakWindowBoard(peakWindow, { limit: 1000, search: debouncedSearch })
        : getSeasonBoard({ limit: 1000, search: debouncedSearch });

    request
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setVisible(PAGE_SIZE);
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setError("Could not load rankings. Is the API running?");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [board, peakWindow, debouncedSearch]);

  // Switching board resets sort: a component sort silently carried across
  // boards would reorder a board the user has not looked at yet.
  const selectBoard = useCallback((next: RankingBoardId) => {
    setBoard(next);
    setSortKey(DEFAULT_SORT_KEY);
    setSortDirection(DEFAULT_SORT_DIRECTION);
    setSearch("");
    setDebouncedSearch("");
  }, []);

  const handleSort = useCallback((key: RankingSortKey) => {
    setSortKey((prevKey) => {
      const column = RANKING_COLUMNS.find((c) => c.key === key);
      const initial = column?.initialDirection ?? "desc";
      // Re-clicking the active column flips it; a new column starts at its own
      // natural direction (rank ascends, every score descends).
      setSortDirection((prevDirection) =>
        prevKey === key ? (prevDirection === "asc" ? "desc" : "asc") : initial
      );
      return key;
    });
  }, []);

  // Memoised so the `?? []` fallback doesn't mint a fresh array identity on
  // every render and invalidate the sort memo below.
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const showComponents = hasComponents(rows);
  const sortedRows = useMemo(
    () => sortRankingRows(rows, sortKey, sortDirection),
    [rows, sortKey, sortDirection]
  );
  const shownRows = useMemo(() => sortedRows.slice(0, visible), [sortedRows, visible]);

  const activeBoard = BOARDS.find((b) => b.id === board) ?? BOARDS[0];
  const boardLabel =
    board === "peakWindows"
      ? `${WINDOW_OPTIONS.find((w) => w.id === peakWindow)?.label ?? peakWindow} Peak Windows`
      : "Single Seasons";
  const sortColumn = RANKING_COLUMNS.find((c) => c.key === sortKey);
  const isSorted = !isDefaultSort(sortKey, sortDirection);

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-5xl flex flex-col gap-5">
        <header className="flex flex-col gap-1.5">
          <h1 className="font-display text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
            PEAK3 Rankings
          </h1>
          <p className="text-sm max-w-2xl" style={{ color: "var(--text-secondary)" }}>
            Every score below is the official PEAK3 formula. Select any row to see exactly how it
            was built.
          </p>
        </header>

        {/* Board toggle. flex-wrap so a narrow viewport stacks instead of
            overflowing -- an @mobile e2e asserts no horizontal page overflow. */}
        <div className="flex flex-col gap-2">
          <div
            role="tablist"
            aria-label="Ranking board"
            className="flex flex-wrap gap-1.5 p-1 rounded-xl w-fit max-w-full"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
          >
            {BOARDS.map((b) => {
              const active = b.id === board;
              return (
                <button
                  key={b.id}
                  role="tab"
                  aria-selected={active}
                  data-testid={b.testId}
                  onClick={() => selectBoard(b.id)}
                  className="text-xs font-semibold uppercase tracking-wide rounded-lg px-3.5 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  style={
                    active
                      ? { background: "var(--peak-accent, #f5c842)", color: "#000" }
                      : { background: "transparent", color: "var(--text-secondary)" }
                  }
                >
                  {b.label}
                </button>
              );
            })}
          </div>
          <p
            className="text-xs max-w-2xl"
            style={{ color: "var(--text-muted)" }}
            data-testid="pool-explainer"
          >
            {activeBoard.blurb}
          </p>
        </div>

        {/* Window duration -- Peak Windows only. */}
        {board === "peakWindows" && (
          <div role="tablist" aria-label="Peak window duration" className="flex flex-wrap gap-1.5">
            {WINDOW_OPTIONS.map((w) => {
              const active = w.id === peakWindow;
              return (
                <button
                  key={w.id}
                  role="tab"
                  aria-selected={active}
                  data-testid={`peak-window-tab-${w.id}`}
                  onClick={() => setPeakWindow(w.id)}
                  className="text-xs font-semibold rounded-full px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  style={
                    active
                      ? {
                          background: "var(--peak-accent-bg, rgba(245,200,66,0.12))",
                          color: "var(--peak-accent, #f5c842)",
                          border: "1px solid var(--peak-accent-dim)",
                        }
                      : {
                          background: "var(--bg-surface)",
                          color: "var(--text-secondary)",
                          border: "1px solid var(--border-subtle)",
                        }
                  }
                >
                  {w.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={board === "seasons" ? "Search players or seasons…" : "Search players…"}
            aria-label="Search rankings"
            data-testid="rankings-search"
            className="flex-1 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
            }}
          />
          {isSorted && sortColumn && (
            <div
              className="flex items-center gap-2 text-xs shrink-0"
              data-testid="active-sort-note"
              style={{ color: "var(--text-secondary)" }}
            >
              <span>
                Sorted by{" "}
                <strong style={{ color: "var(--peak-accent, #f5c842)" }}>{sortColumn.full}</strong>{" "}
                {sortDirection === "desc" ? "high to low" : "low to high"}
              </span>
              <button
                onClick={() => {
                  setSortKey(DEFAULT_SORT_KEY);
                  setSortDirection(DEFAULT_SORT_DIRECTION);
                }}
                data-testid="reset-sort-btn"
                className="font-semibold uppercase tracking-wide rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                style={{
                  background: "var(--bg-surface)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-default)",
                }}
              >
                Reset
              </button>
            </div>
          )}
        </div>

        {showComponents && <ComponentLegend />}

        {error && (
          <div
            role="alert"
            data-testid="rankings-error"
            className="rounded-lg p-4 text-sm text-center"
            style={{ background: "var(--bg-surface)", color: "#ef4444" }}
          >
            {error}
          </div>
        )}

        {loading && !data && (
          <div
            className="rounded-lg p-6 text-sm text-center"
            style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}
          >
            Loading rankings…
          </div>
        )}

        {data && (
          <>
            <RankingsTable
              rows={shownRows}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={handleSort}
              showComponents={showComponents}
              onOpenRow={setOpenRow}
              caption={`${boardLabel} — ranked by PEAK3 score. Select a row to see how the score was built.`}
              emptyMessage={
                debouncedSearch
                  ? `No rows match “${debouncedSearch}”.`
                  : "No rows available for this board."
              }
              labelHeading={board === "seasons" ? "Season" : "Window"}
            />

            {sortedRows.length > shownRows.length && (
              <button
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
                data-testid="rankings-show-more"
                className="self-center text-xs font-semibold uppercase tracking-wide rounded px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                style={{
                  background: "var(--bg-surface)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-default)",
                }}
              >
                Show more ({shownRows.length} of {sortedRows.length})
              </button>
            )}

            {/* Provenance, deliberately understated and last. */}
            <div
              className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]"
              style={{ color: "var(--text-muted)" }}
              data-testid="rankings-provenance"
            >
              {data.meta.dataset_version && <span>{data.meta.dataset_version}</span>}
              {data.meta.formula_version && <span>{data.meta.formula_version}</span>}
              {data.meta.supported_start_season && data.meta.supported_end_season && (
                <span>
                  {data.meta.supported_start_season} to {data.meta.supported_end_season}
                </span>
              )}
              {data.meta.total_available != null && (
                <span>{data.meta.total_available} rows served</span>
              )}
              {data.meta.serving_gate_note && <span>{data.meta.serving_gate_note}</span>}
            </div>
          </>
        )}
      </div>

      <ScoreExplainModal
        row={openRow}
        board={board}
        boardLabel={boardLabel}
        boardRowCount={data?.meta.total_available ?? rows.length}
        populationNoun={board === "seasons" ? "scored seasons" : "peak windows"}
        methodology={methodology}
        onClose={() => setOpenRow(null)}
      />
    </div>
  );
}
