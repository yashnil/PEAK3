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

function HeaderChip({
  label,
  title,
  color,
  orientation,
}: {
  label: string;
  title: string;
  color: string;
  orientation: "row" | "col";
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
        className="break-words text-[clamp(9px,2.4vw,12px)] font-bold uppercase tracking-[0.04em]"
        style={{ color: "var(--text-primary)", lineHeight: 1.15 }}
      >
        {label}
      </span>
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
      data-testid="daily-grid-board"
      role="group"
      aria-label={`Daily grid, ${GRID_SIZE} by ${GRID_SIZE}`}
      className="grid w-full gap-1.5 sm:gap-2"
      style={{ gridTemplateColumns: "minmax(58px, 0.55fr) repeat(3, minmax(0, 1fr))" }}
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
