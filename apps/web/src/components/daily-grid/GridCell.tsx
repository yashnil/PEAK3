"use client";

import { Lock } from "lucide-react";
import { FilledCell, GridCellSpec } from "@/types/daily-grid";
import { RARITY_COLOR } from "./constraint-style";
import { RARITY_POOL_HINT, RARITY_SHORT_LABEL } from "@/lib/daily-grid-state";

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

  const poolHint = spec ? RARITY_POOL_HINT[spec.rarity_bucket] : "";
  const ariaLabel = filled
    ? `${fullTitle}. Locked: ${filled.player_season.label}, ${filled.player_season.team_name}, PEAK ${filled.cell_score.quality_points}, ${filled.cell_score.arena_points} arena points. This pick is final. Activate to review it.`
    : `${fullTitle}. Empty square. ${poolHint} Activate to search for a player-season.`;

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
            style={{ color: "var(--peak-accent-text)" }}
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
            {/* Phase 11B: the score comes from cell_score.quality_points --
                the locked square is where a season's PEAK3 rating is
                revealed, and the card itself no longer carries one. */}
            {filled.player_season.team} · PEAK {filled.cell_score.quality_points}
          </span>
          <span
            data-testid="grid-cell-points"
            className="mt-0.5 rounded-full px-1.5 py-px text-[clamp(8px,2vw,10px)] font-bold"
            style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
          >
            {filled.cell_score.arena_points} pts
          </span>
          <span
            data-testid="grid-cell-locked"
            className="mt-px inline-flex items-center gap-0.5 text-[clamp(7px,1.7vw,8px)] font-semibold uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            <Lock size={7} aria-hidden="true" />
            Locked
          </span>
        </span>
      ) : (
        <span className="flex flex-col items-center gap-1">
          {/* "Pick" rather than a bare "+": on a board where every square is
              an open decision, the affordance should name the action. */}
          <span
            className="text-[clamp(9px,2.5vw,12px)] font-bold uppercase tracking-[0.1em]"
            style={{ color: active ? "var(--peak-accent)" : "var(--text-secondary)" }}
          >
            {active ? "Choose" : "Pick"}
          </span>
          {spec && (
            <span
              data-testid="grid-cell-rarity"
              className="text-[clamp(7px,1.9vw,9px)] font-semibold uppercase tracking-[0.08em]"
              style={{ color: RARITY_COLOR[spec.rarity_bucket] }}
            >
              {/* Named as what it is -- the size of the answer pool -- rather
                  than an unexplained rarity adjective. */}
              {RARITY_SHORT_LABEL[spec.rarity_bucket]} pool
            </span>
          )}
        </span>
      )}
    </button>
  );
}
