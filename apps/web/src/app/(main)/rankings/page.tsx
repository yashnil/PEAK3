"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMethodology, getPeakWindowBoard, getSeasonBoard } from "@/lib/api";
import type { Methodology, RankingBoardData, RankingBoardId, RankingRow } from "@/types";
import RankingsTable, { ComponentLegend } from "@/components/rankings/RankingsTable";
import RankingsAnalysis from "@/components/rankings/RankingsAnalysis";
import RankingsProvenance from "@/components/rankings/RankingsProvenance";
import {
  boardHeadingFor,
  boardShortLabelFor,
  explainerFor,
} from "@/components/rankings/board-copy";
import {
  DEFAULT_SORT_DIRECTION,
  DEFAULT_SORT_KEY,
  RANKING_COLUMNS,
  RANKING_COMPONENT_KEYS,
  hasComponents,
  isDefaultSort,
  sortRankingRows,
  type RankingSortKey,
  type SortDirection,
} from "@/components/rankings/board-model";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2ResultHeadline from "@/components/v2/PeakV2ResultHeadline";
import PeakV2Rule from "@/components/v2/PeakV2Rule";

/**
 * `?sort=statistical_impact` (any `RankingComponentKey`, or `"total"`) —
 * the deep link the homepage's interactive component comparison uses so
 * "click a component" lands here already sorted by it, instead of on a
 * generic rankings page the visitor has to re-sort themselves. Reads once
 * on mount; the page's own sort controls own it from then on (this is a
 * starting point, not a synced URL state).
 *
 * Read via `window.location.search` in an effect, NOT `next/navigation`'s
 * `useSearchParams()` — the same choice `nav.tsx`'s `useLocationSearch`
 * already made and documents: that hook forces the nearest static shell
 * into a Suspense boundary, a real cost for a one-time initial read. This
 * page is already `"use client"`, so there is no server-render agreement
 * to protect; reading after mount is the same pattern, applied here too.
 */
function isDeepLinkableSortKey(value: string | null): value is RankingSortKey {
  return value === "total" || (RANKING_COMPONENT_KEYS as readonly string[]).includes(value ?? "");
}

function readSortFromLocation(): RankingSortKey | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("sort");
  return isDeepLinkableSortKey(raw) ? raw : null;
}

/**
 * PEAK3 Rankings.
 *
 * Phase 10B reduced this page from THREE boards to TWO. "Canonical Players"
 * answered the same question as Peak Windows -- one row per player, just over a
 * narrower universe -- so a reader had to diff two boards to tell them apart.
 * The canonical 250-pool leaderboards were NOT removed from the product: the
 * /api/v1/leaderboards route and its committed CSVs are untouched and the
 * methodology page still documents them.
 *
 * THE CONTRADICTION THIS FILE USED TO CARRY (fixed here)
 * ------------------------------------------------------
 * The comment above this one used to claim the two remaining boards "ask
 * genuinely different questions". At the 3-Year and 5-Year settings that is
 * true. At the 1-Year setting it is false, and provably so: a peak window of
 * length one IS a single season, so both boards return literally the same top
 * rows -- rank 1 Michael Jordan 1990-91 at 97.53, rank 2 LeBron James 2008-09
 * at 95.85, byte-identical row_ids in both generated artifacts. Meanwhile the
 * page header rendered "1-Year Peak Windows" directly beside a tab named
 * "Single Seasons": two names for one concept, presented as a choice between
 * two things. The blurb ("their single best consecutive stretch") was strained
 * at n=1 for the same reason -- a stretch of one.
 *
 * What is actually different at n=1 is de-duplication, and nothing else:
 *
 *   Peak Windows @ 1-Year -- best single season, ONE row per player
 *   Single Seasons        -- every qualifying season, repeats expected
 *
 * So the copy now says that, in those words, instead of implying a difference
 * of question where there is only a difference of grouping. At 3-Year and
 * 5-Year the boards genuinely do diverge and the copy says that too.
 * apps/api/tests/test_regression.py
 * ::test_the_two_boards_differ_only_by_deduplication_at_one_year holds the
 * claim true against the generated artifacts, so this copy cannot quietly
 * become wrong again.
 *
 * NOTE FOR FUTURE EDITORS: an existing e2e (gameplay.spec.ts:152) looks up a
 * *tab* by /3.year|3-year/i with NO tablist scoping, so exactly ONE control on
 * this page may match that wording. The window selector owns it
 * ("1-Year"/"3-Year"/"5-Year"); no board tab or sort control may use that
 * phrasing. Captions and prose are not controls and are unaffected.
 */

const BOARDS: { id: RankingBoardId; label: string; testId: string }[] = [
  { id: "peakWindows", label: "Peak Windows", testId: "pool-tab-peak-windows" },
  { id: "seasons", label: "Single Seasons", testId: "pool-tab-seasons" },
];

// Ascending window length, so the tab order matches the thing the tabs vary.
// 2-Year is a canonical board of its own (leaderboards/top_250_2_year_prime.csv,
// generated by peak3.n_year_windows with n=2), NOT a blend of the 1Y and 3Y
// boards -- a two-season peak has its own winner because the second season is
// weighted, not averaged in.
const WINDOW_OPTIONS: { id: "1y" | "2y" | "3y" | "5y"; label: string }[] = [
  { id: "1y", label: "1-Year" },
  { id: "2y", label: "2-Year" },
  { id: "3y", label: "3-Year" },
  { id: "5y", label: "5-Year" },
];


/**
 * THE POSITION FILTER.
 *
 * "All" plus the five canonical positions, in the order a basketball
 * reader expects them (backcourt out to the paint), not alphabetical.
 *
 * THE TABS PARTITION THE BOARD: every player belongs to EXACTLY ONE of them.
 * The source is each row's `primary_position` — the model's
 * `primary_position()`, i.e. the single position the player logged the most
 * career minutes at, behind the same games/minutes gate as everything else in
 * that module.
 *
 * IT DELIBERATELY DOES NOT USE `positions`. That array is the ELIGIBILITY set
 * (`career_positions()`) that 82-0 and Three-Man Weave enforce placements
 * with, and it is correctly generous — LeBron really has logged real minutes
 * at PG. Filtering tabs on it meant a player matched every position they were
 * eligible at, which produced a "PG" board led by Michael Jordan, with LeBron
 * James second and Giannis Antetokounmpo fifth. All true about eligibility;
 * nonsense as a ranking of point guards. Having played point guard does not
 * make you a point guard, and game placement flexibility must not decide tab
 * membership.
 *
 * Nothing here parses a display string: substring-matching prose is how "PG"
 * ends up matching "PG-SG" but missing "G".
 */
const POSITION_OPTIONS: { id: RankingPositionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "PG", label: "PG" },
  { id: "SG", label: "SG" },
  { id: "SF", label: "SF" },
  { id: "PF", label: "PF" },
  { id: "C", label: "C" },
];

type RankingPositionFilter = "all" | "PG" | "SG" | "SF" | "PF" | "C";

function isPositionFilter(value: string | null): value is RankingPositionFilter {
  return POSITION_OPTIONS.some((o) => o.id === value);
}

/** `?position=PG`, read on mount exactly like `?sort=` above. */
function readPositionFromLocation(): RankingPositionFilter | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("position");
  return isPositionFilter(raw) ? raw : null;
}

const PAGE_SIZE = 50;

export default function RankingsPage() {
  const [board, setBoard] = useState<RankingBoardId>("peakWindows");
  const [peakWindow, setPeakWindow] = useState<"1y" | "2y" | "3y" | "5y">("1y");
  const [position, setPosition] = useState<RankingPositionFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [data, setData] = useState<RankingBoardData | null>(null);
  const [methodology, setMethodology] = useState<Methodology | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<RankingSortKey>(DEFAULT_SORT_KEY);
  const [sortDirection, setSortDirection] = useState<SortDirection>(DEFAULT_SORT_DIRECTION);
  // WHICH ROW THE ANALYSIS DRAWER IS SHOWING, or `null` for "closed".
  //
  // NULL IS THE INITIAL STATE AND IT IS LOAD-BEARING. This used to fall back to
  // `sortedRows[0]`, so the page opened with the top-ranked player selected and
  // a radar chart drawn beside a permanently-reserved column. Nobody had asked
  // for that analysis, and the table lost the width it needed to be compared
  // across. There is no "selected but not shown" state now: `selectedRowId` is
  // set only by a deliberate row activation and cleared by closing.
  //
  // Held as a row_id rather than a row object so a refetch (a different window,
  // a new search) re-resolves it against the live data instead of pinning a
  // stale copy on screen.
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  // The row that opened the drawer, so focus returns exactly where it came
  // from rather than to the top of the document.
  const returnFocusTo = useRef<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // `?sort=<component>` deep link (the homepage's component comparison uses
  // this) — read once, on mount, so a visitor who arrives already sorted
  // can still freely change it afterward with the page's own controls.
  useEffect(() => {
    const requested = readSortFromLocation();
    if (!requested) return;
    setSortKey(requested);
    setSortDirection(RANKING_COLUMNS.find((c) => c.key === requested)?.initialDirection ?? "desc");
  }, []);

  // `?position=PG` deep link, same read-once-on-mount rule as `?sort=`: an
  // arriving visitor keeps the filter they were linked to and can still
  // change it freely afterwards.
  useEffect(() => {
    const requested = readPositionFromLocation();
    if (requested) setPosition(requested);
  }, []);

  // Reflected back into the URL so a filtered board is shareable, matching
  // the page's existing `?sort=` convention. `replaceState`, not `push`: a
  // filter toggle is not a navigation and must not fill the back button.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (position === "all") params.delete("position");
    else params.set("position", position);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [position]);

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
  const allRows = useMemo(() => data?.rows ?? [], [data]);
  // Filtered BEFORE sorting so the existing sort/search behaviour is
  // unchanged — the position filter narrows the set, it never reorders it.
  //
  // Filtering client-side rather than adding an API parameter: this page
  // already loads the whole board (up to 1000 rows) in one request and does
  // all of its sorting, ranking and pagination in memory, so a round trip
  // per position toggle would be slower AND would have to re-agree with the
  // sort state the client owns. The row already carries its canonical
  // `primary_position`, which is more useful to the UI than a filter-only
  // param.
  //
  // `=== position`, not `.includes(position)`: one player, one tab. A row
  // whose primary position the model could not resolve matches no tab rather
  // than being guessed into one — it is still present under "All".
  const rows = useMemo(
    () => (position === "all" ? allRows : allRows.filter((r) => r.primary_position === position)),
    [allRows, position],
  );
  const showComponents = hasComponents(rows);
  const sortedRows = useMemo(
    () => sortRankingRows(rows, sortKey, sortDirection),
    [rows, sortKey, sortDirection]
  );
  const shownRows = useMemo(() => sortedRows.slice(0, visible), [sortedRows, visible]);

  // A narrower board starts at the top again rather than keeping a "show
  // more" depth that may now exceed it.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [position]);

  // NO FALLBACK. An unresolvable id -- a board switch while the drawer is
  // open, a search that excludes the open row -- closes the analysis rather
  // than silently substituting a different player's, which is what the old
  // `?? sortedRows[0]` did on every single load.
  const selectedRow = useMemo(() => {
    if (!selectedRowId) return null;
    return sortedRows.find((row) => row.row_id === selectedRowId) ?? null;
  }, [sortedRows, selectedRowId]);

  const selectedIndex = useMemo(
    () =>
      selectedRowId ? sortedRows.findIndex((row) => row.row_id === selectedRowId) : -1,
    [sortedRows, selectedRowId],
  );

  /** Open the analysis for a row, remembering where to send focus back. */
  const openAnalysis = useCallback((row: RankingRow) => {
    returnFocusTo.current = row.row_id;
    setSelectedRowId(row.row_id);
  }, []);

  /** Close, and return focus to the row that opened it (PART 22). */
  const closeAnalysis = useCallback(() => {
    const rowId = returnFocusTo.current;
    setSelectedRowId(null);
    returnFocusTo.current = null;
    if (!rowId) return;
    // After the drawer unmounts, so the row element is focusable again.
    window.setTimeout(() => {
      // `preventScroll`: the row is already where the reader left it, and the
      // default scroll-into-view would start a smooth scroll (see
      // `scroll-behavior` in globals.css) that moves the list under them at the
      // exact moment they are looking for their place in it.
      document
        .querySelector<HTMLElement>(`[data-row-id="${CSS.escape(rowId)}"]`)
        ?.focus({ preventScroll: true });
    }, 0);
  }, []);

  const stepAnalysis = useCallback(
    (direction: -1 | 1) => {
      const next = sortedRows[selectedIndex + direction];
      if (!next) return;
      returnFocusTo.current = next.row_id;
      setSelectedRowId(next.row_id);
    },
    [sortedRows, selectedIndex],
  );

  const boardHeading = boardHeadingFor(board, peakWindow);
  const boardLabel = boardShortLabelFor(board, peakWindow);
  const explainer = explainerFor(board, peakWindow);
  const sortColumn = RANKING_COLUMNS.find((c) => c.key === sortKey);
  const isSorted = !isDefaultSort(sortKey, sortDirection);

  // V2's own chrome (Pass 7) — the EXACT same state/handlers computed above,
  // no second fetch or reducer. `RankingsTable`/`ComponentLegend`/
  // `RankingsAnalysis`/`RankingsProvenance` are reused verbatim: this only
  // restyles the shell, headings, tabs, and search around them. Typography
  // roles: page identity -> cinematic display (once); controls/table body ->
  // UI role (inherited by `RankingsTable` -- it sets no font-family of its
  // own); numeric cells -> instrumentation/mono, via the scoped
  // `[data-ui-version="v2"] .score-number` rule in `styles/v2/info-pages.css`
  // rather than editing the shared table component itself.
  const v2View = (
    <PeakV2Shell width="live">
      {/* QUIET ROOM. The court geometry is hidden behind a dense ranking
          table — `styles/v2/arena-room.css` reads this attribute upward — so
          nothing competes with a column of tabular figures. The floodlight
          and vignette stay, so arriving here from a game still feels like
          the same building. */}
      <div data-arena="quiet" className="py-6 flex flex-col gap-5">
        <header className="flex flex-col gap-1.5">
          <PeakV2ResultHeadline as="h1" scale="moment">
            PEAK3 Rankings
          </PeakV2ResultHeadline>
          <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.875rem", color: "var(--v2-text-secondary)", maxWidth: "42rem" }}>
            Every score below is the official PEAK3 formula. Select any row to see exactly how it
            was built.
          </p>
          {/* Editorial/instrument note, not a warning box — the model's real
              coverage boundary (docs/model/SCORING_METHODOLOGY.md), stated
              once here rather than left implicit in a board that otherwise
              looks like it ranks NBA history in full. */}
          <p
            data-testid="rankings-era-note"
            style={{
              fontFamily: "var(--v2-font-display)",
              fontStyle: "italic",
              fontSize: "0.8125rem",
              color: "var(--v2-text-muted)",
              maxWidth: "42rem",
            }}
          >
            Rankings quantify peaks beginning with the 1979–80 season. Earlier player peaks are not
            included.
          </p>
        </header>

        <div className="flex flex-col gap-2">
          <div
            role="tablist"
            aria-label="Ranking board"
            className="flex flex-wrap gap-1.5 p-1 w-fit max-w-full"
            style={{ background: "var(--v2-bg-surface)", border: "1px solid var(--v2-border-subtle)", borderRadius: "var(--v2-radius-control)" }}
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
                  className="v2-board-tab text-xs font-semibold uppercase tracking-wide px-3.5 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  style={{
                    borderRadius: "var(--v2-radius-control)",
                    ...(active
                      ? { background: "var(--v2-color-accent)", color: "var(--text-inverse)" }
                      : { background: "transparent", color: "var(--v2-text-secondary)" }),
                  }}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
          <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.875rem", color: "var(--v2-text-secondary)" }} data-testid="pool-explainer">
            {explainer}
          </p>
        </div>

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
                  className="v2-peak-window-tab text-xs font-semibold px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  style={
                    active
                      ? { background: "var(--v2-color-accent-bg)", color: "var(--v2-color-accent-text, var(--v2-color-accent))", border: "1px solid var(--v2-color-accent-dim)" }
                      : { background: "var(--v2-bg-surface)", color: "var(--v2-text-secondary)", border: "1px solid var(--v2-border-subtle)" }
                  }
                >
                  {w.label}
                </button>
              );
            })}
          </div>
        )}

        {/* POSITION FILTER — deliberately the SAME control family as the
            peak-window tabs directly above (same class, same active/inactive
            treatment, same tablist semantics), not a second filter design
            invented beside them. Rendered for both boards, since a player's
            canonical positions are a property of the player, not of the
            board they are listed on. */}
        <div role="tablist" aria-label="Filter by position" className="flex flex-wrap gap-1.5">
          {POSITION_OPTIONS.map((p) => {
            const active = p.id === position;
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={active}
                data-testid={`rankings-position-filter-${p.id}`}
                onClick={() => setPosition(p.id)}
                className="v2-peak-window-tab text-xs font-semibold px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                style={
                  active
                    ? { background: "var(--v2-color-accent-bg)", color: "var(--v2-color-accent-text, var(--v2-color-accent))", border: "1px solid var(--v2-color-accent-dim)" }
                    : { background: "var(--v2-bg-surface)", color: "var(--v2-text-secondary)", border: "1px solid var(--v2-border-subtle)" }
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={board === "seasons" ? "Search players or seasons…" : "Search players…"}
            aria-label="Search rankings"
            data-testid="rankings-search"
            className="flex-1 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{
              fontFamily: "var(--v2-font-ui)",
              background: "var(--v2-bg-surface)",
              color: "var(--v2-text-primary)",
              border: "1px solid var(--v2-border)",
              borderRadius: "var(--v2-radius-control)",
            }}
          />
          {isSorted && sortColumn && (
            <div className="flex items-center gap-2 text-xs shrink-0" data-testid="active-sort-note" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-secondary)" }}>
              <span>
                Sorted by <strong style={{ color: "var(--v2-color-accent)" }}>{sortColumn.full}</strong>{" "}
                {sortDirection === "desc" ? "high to low" : "low to high"}
              </span>
              <button
                onClick={() => {
                  setSortKey(DEFAULT_SORT_KEY);
                  setSortDirection(DEFAULT_SORT_DIRECTION);
                }}
                data-testid="reset-sort-btn"
                className="font-semibold uppercase tracking-wide px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                style={{ background: "var(--v2-bg-surface)", color: "var(--v2-text-secondary)", border: "1px solid var(--v2-border)", borderRadius: "var(--v2-radius-control)" }}
              >
                Reset
              </button>
            </div>
          )}
        </div>

        {showComponents && <ComponentLegend />}

        {error && (
          <div role="alert" data-testid="rankings-error" className="p-4 text-sm text-center" style={{ fontFamily: "var(--v2-font-ui)", background: "var(--v2-bg-surface)", color: "var(--v2-color-negative)", borderRadius: "var(--v2-radius-control)" }}>
            {error}
          </div>
        )}

        {loading && !data && (
          <div className="p-6 text-sm text-center" style={{ fontFamily: "var(--v2-font-ui)", background: "var(--v2-bg-surface)", color: "var(--v2-text-muted)", borderRadius: "var(--v2-radius-control)" }}>
            Loading rankings…
          </div>
        )}

        {data && (
          <>
            <PeakV2Rule spacing="sm" />
            <h2 style={{ fontFamily: "var(--v2-font-ui)", fontSize: "1.0625rem", fontWeight: 700, color: "var(--v2-text-primary)" }} data-testid="rankings-board-heading">
              {boardHeading}
            </h2>
            <div className="rankings-board">
              <RankingsTable
                rows={shownRows}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSort}
                showComponents={showComponents}
                caption={`${boardHeading} — ranked by PEAK3 score. Select a row to see how the score was built.`}
                emptyMessage={
                  debouncedSearch
                    ? `No rows match "${debouncedSearch}".`
                    : "No rows available for this board."
                }
                labelHeading={board === "seasons" ? "Season" : "Window"}
                selectedRowId={selectedRow?.row_id ?? null}
                onSelectRow={openAnalysis}
              />
            </div>

            {sortedRows.length > shownRows.length && (
              <button
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
                data-testid="rankings-show-more"
                className="self-center text-xs font-semibold uppercase tracking-wide px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                style={{ fontFamily: "var(--v2-font-ui)", background: "var(--v2-bg-surface)", color: "var(--v2-text-secondary)", border: "1px solid var(--v2-border)", borderRadius: "var(--v2-radius-control)" }}
              >
                Show more ({shownRows.length} of {sortedRows.length})
              </button>
            )}

            <RankingsProvenance meta={data.meta} fallbackRowCount={rows.length} />
          </>
        )}
      </div>

      <RankingsAnalysis
        row={selectedRow}
        board={board}
        boardLabel={boardLabel}
        windowLabel={board === "peakWindows" ? peakWindow.toUpperCase() : null}
        populationNoun={board === "seasons" ? "scored season" : "peak window"}
        populationNounPlural={board === "seasons" ? "scored seasons" : "peak windows"}
        boardRowCount={data?.meta.total_available ?? rows.length}
        methodology={methodology}
        onClose={closeAnalysis}
        onNavigate={stepAnalysis}
        hasPrevious={selectedIndex > 0}
        hasNext={selectedIndex >= 0 && selectedIndex < sortedRows.length - 1}
      />
    </PeakV2Shell>
  );

  return v2View;
}
