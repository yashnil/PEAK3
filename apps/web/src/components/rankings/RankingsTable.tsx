"use client";

/**
 * Phase 9C: the sortable rankings table, shared by both boards.
 *
 * Two things here are load-bearing and easy to break:
 *
 *  1. WHICH ORDERING AM I LOOKING AT. Sorting by a component silently
 *     re-orders rows away from the board's own ranking, which reads as "the
 *     ranking changed". So as soon as the sort leaves the default, a "#" column
 *     appears with the position in the CURRENT sort and the board's own PEAK
 *     rank is rendered as a badge next to it. Both numbers, always, never one.
 *
 *  2. NO NAKED ACRONYMS. Every abbreviated header carries the spelled-out name
 *     as sr-only text plus a `title`, and the legend above the table spells all
 *     five out with their colour. The abbreviation is a space-saver, never the
 *     only label.
 *
 * The component columns disappear entirely when no loaded row publishes
 * contributions -- an unsortable column of dashes is worse than no column.
 */

import type { RankingRow } from "@/types";
import { cn, componentColor, componentTextColor, componentLabel } from "@/lib/utils";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import {
  RANKING_COLUMNS,
  RANKING_COMPONENT_KEYS,
  COMPONENT_ABBR,
  formatScore1,
  isDefaultSort,
  type RankingSortKey,
  type SortDirection,
} from "./board-model";

const HEADER_CLASS =
  "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]";

export interface RankingsTableProps {
  /** Already sorted by the caller, so the row order here IS the display order. */
  rows: readonly RankingRow[];
  /** The row the detail panel is showing, marked as the active option. */
  selectedRowId?: string | null;
  /** Selecting a row updates the detail panel WITHOUT opening the modal.
   * Two different actions on one row: select to compare, open to read the
   * full derivation. */
  onSelectRow?: (row: RankingRow) => void;
  sortKey: RankingSortKey;
  sortDirection: SortDirection;
  onSort: (key: RankingSortKey) => void;
  /** False when no loaded row carries contributions -- hides those columns. */
  showComponents: boolean;
  onOpenRow: (row: RankingRow) => void;
  /** sr-only <caption>: what this table is, for screen readers. */
  caption: string;
  emptyMessage: string;
  /** Column header for the row's own identity ("Season" or "Window"). */
  labelHeading: string;
}

export default function RankingsTable({
  rows,
  selectedRowId = null,
  onSelectRow,
  sortKey,
  sortDirection,
  onSort,
  showComponents,
  onOpenRow,
  caption,
  emptyMessage,
  labelHeading,
}: RankingsTableProps) {
  const resorted = !isDefaultSort(sortKey, sortDirection);
  const columns = RANKING_COLUMNS.filter(
    (column) => showComponents || column.key === "rank" || column.key === "total"
  );
  const columnCount = columns.length + (resorted ? 1 : 0) + 3;

  return (
    // `--bg-surface-data` (§3 palette direction: "a subtle cool neutral for
    // data-dense regions") turns the table into its own distinct panel,
    // differentiated from the surrounding page by hue rather than by
    // stacking yet another lightness step onto an already-compressed ladder.
    <div
      className="overflow-x-auto rounded-xl border"
      style={{ background: "var(--bg-surface-data)", borderColor: "var(--border-default)" }}
    >
      <table className="w-full text-sm" data-testid="rankings-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          {/* Launch-polish IMPLEMENTATION_CONTRACT.md §3 correctness bug:
              this row used to share `--border-subtle` (1.37:1 against
              --bg-surface in Arena Day, under the WCAG 1.4.11 3:1 UI floor)
              with every data row below, so the header was structurally
              indistinguishable from a row of data. `--divider-strong` (a
              data-dense-region-specific token, not a general border
              darkening) fixes the contrast; the background band is what
              actually anchors the header as a header, not just a heavier
              line. */}
          <tr
            className="border-b-2 border-[var(--divider-strong)] text-left"
            style={{ background: "var(--bg-elevated)" }}
          >
            {resorted && (
              <th scope="col" className={cn(HEADER_CLASS, "w-10")} data-testid="rankings-position-header">
                <span title="Position in the current sort">#</span>
              </th>
            )}
            <SortableHeader
              columnKey="rank"
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={onSort}
              abbr="PEAK"
              full="PEAK rank"
              className="w-16"
            />
            <th scope="col" className={HEADER_CLASS}>
              Player
            </th>
            <th scope="col" className={cn(HEADER_CLASS, "hidden sm:table-cell")}>
              {labelHeading}
            </th>
            <th scope="col" className={cn(HEADER_CLASS, "hidden md:table-cell")}>
              Team
            </th>
            {columns
              .filter((column) => column.key !== "rank")
              .map((column) => (
                <SortableHeader
                  key={column.key}
                  columnKey={column.key}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={onSort}
                  abbr={column.abbr}
                  full={column.full}
                  align="right"
                  color={
                    column.key === "total" ? undefined : componentTextColor(column.key as string)
                  }
                  className={column.cellClass}
                />
              ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.row_id}
              // ROW CLICK SELECTS; the player-name button explains. Two
              // different questions -- "show me this shape" and "show me the
              // derivation" -- that used to share one action, so comparing
              // twenty rows meant opening and closing twenty dialogs.
              //
              // THE ROW ITSELF IS NOT A BUTTON, deliberately. It contains one
              // (the player name opens the modal), and a control inside a
              // control is `nested-interactive`: a screen reader announces the
              // row as a button and then cannot reach the button inside it.
              // The pointer affordance stays on the row; the KEYBOARD path is
              // the real select control in the rank cell below.
              onClick={() => (onSelectRow ? onSelectRow(row) : onOpenRow(row))}
              className="rankings-row group border-b border-[var(--divider-strong)] cursor-pointer transition-colors hover:bg-[var(--bg-surface-hover)]"
              data-testid="rankings-row"
              data-selected={row.row_id === selectedRowId ? "true" : "false"}
            >
              {resorted && (
                <td className="px-3 py-2.5 score-number text-[var(--text-primary)] font-semibold">
                  {index + 1}
                </td>
              )}
              <td className="px-3 py-2.5">
                {/* THE KEYBOARD PATH TO SELECTION. A pointer user clicks the
                    row; everyone else needs a real control, and the rank cell
                    is where it belongs -- it is the row's own identifier, so
                    "select rank 4" is a sentence rather than a widget bolted
                    on. Rendered as a button only when selection is offered, so
                    a board without a detail panel keeps a plain rank. */}
                {onSelectRow ? (
                  <button
                    type="button"
                    aria-pressed={row.row_id === selectedRowId}
                    aria-label={`Show the component profile for ${row.player_name}, ${row.label}`}
                    data-testid={`rankings-select-${row.rank}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectRow(row);
                    }}
                    className="score-number rounded px-1 font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--peak-accent-text)] aria-pressed:text-[var(--peak-accent-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  >
                    {resorted ? `#${row.rank}` : row.rank}
                  </button>
                ) : resorted ? (
                  <span
                    className="inline-flex items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-1.5 py-0.5 score-number text-[11px] text-[var(--text-secondary)]"
                    title="This row's rank in the board's own PEAK ordering"
                  >
                    #{row.rank}
                  </span>
                ) : (
                  <span className="score-number font-medium text-[var(--text-muted)]">
                    {row.rank}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <PlayerAvatar name={row.player_name} size={26} imageUrl={row.headshot_url} />
                  <span className="min-w-0">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenRow(row);
                      }}
                      aria-label={`Explain the PEAK3 score for ${row.player_name}, ${row.label}`}
                      className="block max-w-full truncate rounded text-left font-medium text-[var(--text-primary)] transition-colors group-hover:text-[var(--peak-accent-text)] hover:text-[var(--peak-accent-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      {row.player_name}
                    </button>
                    <span className="block truncate text-[11px] text-[var(--text-muted)] sm:hidden">
                      {row.label}
                    </span>
                  </span>
                </div>
              </td>
              <td className="hidden px-3 py-2.5 text-xs text-[var(--text-secondary)] sm:table-cell">
                {row.label || "—"}
                {row.season_in_progress ? " (in progress)" : ""}
              </td>
              <td className="hidden px-3 py-2.5 text-xs text-[var(--text-secondary)] md:table-cell">
                {row.team ?? "—"}
              </td>
              <td className="px-3 py-2.5 text-right score-number font-bold text-[var(--peak-accent-text)]">
                {formatScore1(row.prime_score)}
              </td>
              {showComponents &&
                RANKING_COMPONENT_KEYS.map((key) => (
                  <td
                    key={key}
                    // Test hook: lets an e2e read the actual column values and
                    // prove a component sort really reordered the rows, rather
                    // than only asserting that the sort STATE changed.
                    data-component={key}
                    className={cn(
                      "hidden px-3 py-2.5 text-right score-number text-xs lg:table-cell",
                      sortKey === key ? "font-bold" : ""
                    )}
                    style={{ color: componentTextColor(key) }}
                  >
                    {formatScore1(row.components?.[key])}
                  </td>
                ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columnCount}
                className="px-4 py-12 text-center text-sm text-[var(--text-muted)]"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({
  columnKey,
  sortKey,
  sortDirection,
  onSort,
  abbr,
  full,
  align = "left",
  color,
  className,
}: {
  columnKey: RankingSortKey;
  sortKey: RankingSortKey;
  sortDirection: SortDirection;
  onSort: (key: RankingSortKey) => void;
  abbr: string;
  full: string;
  align?: "left" | "right";
  color?: string;
  className?: string;
}) {
  const active = sortKey === columnKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
      className={cn(HEADER_CLASS, align === "right" && "text-right", className)}
      data-testid={`rankings-header-${columnKey}`}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        title={`${full} — sort`}
        className={cn(
          "inline-flex items-center gap-1 rounded px-1 -mx-1 uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
          active
            ? "text-[var(--text-primary)] underline decoration-2 underline-offset-4"
            : "hover:text-[var(--text-secondary)]"
        )}
        style={active && color ? { color, textDecorationColor: color } : undefined}
      >
        <span aria-hidden="true">{abbr}</span>
        <span className="sr-only">{full}</span>
        <span aria-hidden="true" className={active ? "opacity-100" : "opacity-0"}>
          {sortDirection === "asc" ? "↑" : "↓"}
        </span>
      </button>
    </th>
  );
}

/** The acronym key. Rendered above the table on every board, because the
 *  columns are abbreviated and an unexplained "PO" is meaningless. */
export function ComponentLegend() {
  return (
    <ul
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
      data-testid="rankings-legend"
      aria-label="Component abbreviations"
    >
      {RANKING_COMPONENT_KEYS.map((key) => (
        <li key={key} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: componentColor(key) }}
            aria-hidden="true"
          />
          <span className="text-[11px] text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text-secondary)]">
              {COMPONENT_ABBR[key]}
            </span>{" "}
            {componentLabel(key)}
          </span>
        </li>
      ))}
    </ul>
  );
}
