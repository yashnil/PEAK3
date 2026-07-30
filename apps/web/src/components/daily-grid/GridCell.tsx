"use client";

import { FilledCell, GridCellSpec } from "@/types/daily-grid";
import { RARITY_COLOR } from "./constraint-style";
import { RARITY_SHORT_LABEL } from "@/lib/daily-grid-state";

interface Props {
  row: number;
  col: number;
  spec: GridCellSpec | null;
  filled: FilledCell | null;
  active: boolean;
  /** True only for the square whose last submission the server rejected. */
  invalid: boolean;
  /** "Boston Celtics x MVP" -- full labels, for the accessible name. */
  fullTitle: string;
  onSelect: (row: number, col: number) => void;
}

/**
 * One square of the 3x3 board.
 *
 * A plain <button>, not role="gridcell": a real ARIA grid promises roving
 * arrow-key navigation, and this board uses native Tab order (the same call
 * the Peak Season candidate list makes in EligiblePlayerSearch.tsx). The
 * accessible name carries BOTH constraints plus the current contents, so a
 * screen-reader user never has to infer the square from its position.
 *
 * All motion here is CSS transitions only, which the global
 * prefers-reduced-motion rule in globals.css neutralizes; there is no
 * JS-driven animation to short-circuit.
 */
export default function GridCell({
  row,
  col,
  spec,
  filled,
  active,
  invalid,
  fullTitle,
  onSelect,
}: Props) {
  const state = filled ? "filled" : active ? "active" : invalid ? "invalid" : "empty";

  const borderColor = filled
    ? "color-mix(in srgb, var(--peak-accent) 45%, transparent)"
    : invalid
      ? "var(--incorrect)"
      : active
        ? "var(--peak-accent)"
        : "var(--border-default)";

  const ariaLabel = filled
    ? `${fullTitle}. Filled with ${filled.player_season.label}, ${filled.player_season.team_name}, PEAK ${filled.player_season.prime_score}, ${filled.cell_score.arena_points} arena points. Activate to review or remove.`
    : `${fullTitle}. Empty square. Activate to search for a player-season.`;

  return (
    <button
      type="button"
      data-testid="grid-cell"
      data-row={row}
      data-col={col}
      data-state={state}
      aria-pressed={active}
      aria-label={ariaLabel}
      title={fullTitle}
      onClick={() => onSelect(row, col)}
      className="relative flex w-full flex-col items-center justify-center overflow-hidden rounded-lg px-1 py-1.5 text-center transition-colors"
      style={{
        aspectRatio: "1 / 1",
        background: filled
          ? "linear-gradient(180deg, rgba(245,200,66,0.07), rgba(245,200,66,0.02))"
          : active
            ? "var(--bg-surface-hover)"
            : "var(--bg-surface)",
        border: `1px solid ${borderColor}`,
        boxShadow: active ? "0 0 0 2px color-mix(in srgb, var(--peak-accent) 28%, transparent)" : "none",
        color: "var(--text-primary)",
      }}
    >
      {filled ? (
        <span className="flex w-full flex-col items-center gap-0.5 leading-tight">
          <span
            data-testid="grid-cell-season"
            className="text-[clamp(9px,2.3vw,11px)] font-semibold tracking-wide"
            style={{ color: "var(--peak-accent)" }}
          >
            {filled.player_season.season}
          </span>
          <span
            data-testid="grid-cell-player"
            className="w-full break-words px-0.5 text-[clamp(10px,2.7vw,13px)] font-bold"
            style={{ lineHeight: 1.15 }}
          >
            {filled.player_season.player_name}
          </span>
          <span
            data-testid="grid-cell-team"
            className="text-[clamp(8px,2vw,10px)]"
            style={{ color: "var(--text-secondary)" }}
          >
            {filled.player_season.team} · PEAK {filled.player_season.prime_score}
          </span>
          <span
            data-testid="grid-cell-points"
            className="mt-0.5 rounded-full px-1.5 py-px text-[clamp(8px,2vw,10px)] font-bold"
            style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
          >
            {filled.cell_score.arena_points} pts
          </span>
        </span>
      ) : (
        <span className="flex flex-col items-center gap-1">
          <span
            aria-hidden="true"
            className="text-[clamp(14px,4vw,20px)] font-light"
            style={{ color: active ? "var(--peak-accent)" : "var(--text-muted)" }}
          >
            +
          </span>
          {spec && (
            <span
              data-testid="grid-cell-rarity"
              className="text-[clamp(7px,1.9vw,9px)] font-semibold uppercase tracking-[0.08em]"
              style={{ color: RARITY_COLOR[spec.rarity_bucket] }}
            >
              {RARITY_SHORT_LABEL[spec.rarity_bucket]}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
