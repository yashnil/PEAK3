"use client";

import { DailyGridBoard, DailyGridProgress, GRID_SIZE } from "@/types/daily-grid";
import { cellFullTitle, cellSpec, colConstraint, findFilled, rowConstraint } from "@/lib/daily-grid-state";
import { categoryColor } from "./constraint-style";
import GridCell from "./GridCell";

interface Props {
  board: DailyGridBoard;
  progress: DailyGridProgress;
  selected: { row: number; col: number } | null;
  invalidCell: { row: number; col: number } | null;
  onSelect: (row: number, col: number) => void;
}

const INDICES = Array.from({ length: GRID_SIZE }, (_, i) => i);

/**
 * The "this axis has a rule you cannot read off the label" marker.
 *
 * An SVG rather than the "\u24D8" character on purpose, for two reasons. It
 * renders identically everywhere (the glyph is missing or differently-shaped
 * in several platform fonts), and an SVG contributes NOTHING to the header's
 * `textContent` -- which the board's own tests read to assert the label, and
 * which a screen reader would otherwise announce as an unexplained symbol.
 *
 * It is decorative here by design: the rule itself is already on the header's
 * `title` and printed in full on the selected-cell panel, so this marks WHERE
 * to look rather than being the only route to the text.
 */
function DefinitionMarker({ color }: { color: string }) {
  return (
    <svg
      data-testid="grid-header-definition-marker"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      width="9"
      height="9"
      style={{ flexShrink: 0, opacity: 0.75 }}
    >
      <circle cx="8" cy="8" r="7" fill="none" stroke={color} strokeWidth="1.6" />
      <circle cx="8" cy="4.4" r="1.05" fill={color} />
      <rect x="7.1" y="6.6" width="1.8" height="5.2" rx="0.9" fill={color} />
    </svg>
  );
}

function HeaderChip({
  label,
  title,
  color,
  orientation,
  needsDefinition = false,
}: {
  label: string;
  title: string;
  color: string;
  orientation: "row" | "col";
  needsDefinition?: boolean;
}) {
  return (
    <div
      data-testid={orientation === "row" ? "grid-row-header" : "grid-col-header"}
      title={title}
      className={
        orientation === "col"
          ? "flex min-h-[42px] flex-col items-center justify-end gap-1 px-0.5 pb-1 text-center"
          : "flex h-full flex-col items-start justify-center gap-1 pr-1.5 text-left"
      }
    >
      <span
        aria-hidden="true"
        className="rounded-full"
        style={{ background: color, width: orientation === "col" ? 22 : 16, height: 2 }}
      />
      <span
        data-testid="grid-header-label"
        className={
          orientation === "col"
            ? "break-words text-[clamp(9px,2.4vw,12px)] font-bold uppercase tracking-[0.04em]"
            : // Row-header gutter is the narrowest column on the board (see the
              // grid's `minmax(68px, 0.55fr)` track below) -- no letter-spacing
              // overhead here, and a single long word (e.g. "Champion",
              // "Timberwolves") shrinks a little further before `break-words`
              // is ever forced to slice it mid-word.
              "break-words font-bold uppercase"
        }
        style={{
          color: "var(--v2-text-primary)",
          fontFamily: "var(--v2-font-ui)",
          lineHeight: 1.15,
          fontSize:
            orientation === "row"
              ? label.length > 9
                ? "clamp(7.5px, 2.1vw, 10px)"
                : "clamp(9px, 2.4vw, 12px)"
              : undefined,
        }}
      >
        {label}
      </span>
      {needsDefinition ? <DefinitionMarker color={color} /> : null}
    </div>
  );
}

/**
 * The board itself: a 4-column CSS grid (row-header gutter + three squares).
 * Headers use `short_label` because the gutter is genuinely narrow on a phone;
 * the full `label` and `description` live on the selected-cell panel, and the
 * full label is also on each header's `title` and every cell's aria-label so
 * nothing is only available by hovering.
 */
export default function DailyGridBoardView({ board, progress, selected, invalidCell, onSelect }: Props) {
  return (
    <div
      /* QUIET, NOT LIVE. The board carries its own 48px cell texture and its
         own 3x3 borders; putting court geometry behind that is a third line
         system on one surface, and a review of the shipped build measured
         the collisions: the division line straight down the middle column, a
         centre-circle arc through a column header, a key line within ~3px of
         the first row's bottom edge. `arena-room.css` already argues a dense
         ranking table should be quiet for exactly this reason — a nine-cell
         puzzle board with its own grid is the same case. The light and the
         vignette stay. */
      data-arena="quiet"
      data-testid="daily-grid-board"
      role="group"
      aria-label={`Daily grid, ${GRID_SIZE} by ${GRID_SIZE}`}
      className="grid w-full gap-1.5 sm:gap-2"
      style={{ gridTemplateColumns: "minmax(68px, 0.55fr) repeat(3, minmax(0, 1fr))" }}
    >
      {/* Corner */}
      <div aria-hidden="true" />
      {INDICES.map((col) => {
        const c = colConstraint(board, col);
        return (
          <HeaderChip
            key={`col-${col}`}
            orientation="col"
            label={c?.short_label ?? `Col ${col + 1}`}
            title={c ? `${c.label} — ${c.description}` : `Column ${col + 1}`}
            color={c ? categoryColor(c.category) : "var(--border-emphasis)"}
            needsDefinition={c?.needs_definition ?? false}
          />
        );
      })}

      {INDICES.map((row) => {
        const r = rowConstraint(board, row);
        return (
          <div key={`row-${row}`} className="contents">
            <HeaderChip
              orientation="row"
              label={r?.short_label ?? `Row ${row + 1}`}
              title={r ? `${r.label} — ${r.description}` : `Row ${row + 1}`}
              color={r ? categoryColor(r.category) : "var(--border-emphasis)"}
              needsDefinition={r?.needs_definition ?? false}
            />
            {INDICES.map((col) => (
              <GridCell
                key={`cell-${row}-${col}`}
                row={row}
                col={col}
                spec={cellSpec(board, row, col)}
                filled={findFilled(progress, row, col)}
                active={selected?.row === row && selected?.col === col}
                invalid={invalidCell?.row === row && invalidCell?.col === col}
                fullTitle={cellFullTitle(board, row, col)}
                onSelect={onSelect}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
