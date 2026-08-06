"use client";

import { DailyGridBoard, ResultCell } from "@/types/daily-grid";
import {
  OptimalCellState,
  colConstraint,
  optimalCellState,
  rowConstraint,
} from "@/lib/daily-grid-state";

/**
 * The best legal grid, drawn as a board.
 *
 * WHY THIS EXISTS NEXT TO A LIST THAT SAYS THE SAME THING. The comparison list
 * above it is complete and, square by square, correct — and reading it means
 * holding three coordinates in your head at once: which square this line is
 * about, who you put there, who the grid wanted. Nine lines of that is a
 * cross-reference exercise, not an explanation. The same nine facts placed on
 * the board they came from are read by looking.
 *
 * THE LIST STAYS. It carries two things this cannot: the "you played them on
 * X" overlap note, which is about a relationship between two squares rather
 * than about either of them, and a compact "show only what changed" view. This
 * is an augmentation, not a replacement.
 *
 * WHAT EACH SQUARE SHOWS. The optimal player-season is the content, because
 * this is the optimal board. The player's own answer appears underneath, in
 * smaller type, on the squares where the two differ — the whole point is that
 * nobody should have to look back up at the list to find out what they had
 * there.
 *
 * COLOUR IS NEVER THE ONLY CARRIER. Every square also states its verdict in a
 * word, for the same reason the recap grid above does: the three states have to
 * survive a colourblind reader, a printed screenshot and a dark-on-dark phone
 * in sunlight.
 */

interface Props {
  board: DailyGridBoard;
  cells: ResultCell[];
}

/** Colour per state, aligned with the recap grid directly above this one.
 *
 *  The two grids sit four inches apart on the same screen and each has its own
 *  legend, so a colour that means one thing in one and something else in the
 *  other is a contradiction a reader has to notice and resolve. Green means
 *  "the max grid agrees with you" in both, and gold means "you beat it" in
 *  both — `GRADE_COLOR` in CompletionPanel moved `beat` onto gold for exactly
 *  this reason. Violet belongs only to this grid, because "the swap to make"
 *  is a claim only this grid makes. */
const STATE_COLOR: Record<OptimalCellState, string> = {
  matched: "var(--comp-team)",
  beat: "var(--peak-accent)",
  replacement: "var(--comp-tp)",
};

/** The readable variant of each, for text on the card surface. The raw
 *  component tokens are tuned for 4px bars and lose contrast at 10px. */
const STATE_TEXT: Record<OptimalCellState, string> = {
  matched: "var(--comp-team-text)",
  beat: "var(--peak-accent-text)",
  replacement: "var(--comp-tp-text)",
};

const STATE_LABEL: Record<OptimalCellState, string> = {
  matched: "Matched",
  beat: "You beat this",
  replacement: "Best choice",
};

/** Spoken, for the square's accessible name. The visible chip is deliberately
 *  terse; a screen reader has no adjacent colour to lean on. */
const STATE_SPOKEN: Record<OptimalCellState, string> = {
  matched: "you already played this exact season here",
  beat: "you outscored the best legal grid on this square",
  replacement: "the best legal grid would use this instead of your answer",
};

export default function OptimalGrid({ board, cells }: Props) {
  // `cells` arrives in FILL order — the order the player locked squares in.
  // A `grid-cols-3` fills left to right, top to bottom, so rendering straight
  // from it would put square N of the answer sheet in position N of the board,
  // which is only the same thing by coincidence. Sorted once, here, for the
  // same reason the recap grid above sorts.
  const ordered = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
  const rows = [0, 1, 2];
  const cols = [0, 1, 2];

  return (
    <div
      data-testid="complete-optimal-grid"
      role="group"
      aria-label="The best legal grid, laid out to match the board"
      className="mt-3"
    >
      {/* A 4x4: a blank corner, three column headers, then three labelled
          rows. The headers are what make this recognisably THE SAME PUZZLE
          rather than nine cards in a square — without them a reader has to
          take on trust that position maps to position. */}
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: "minmax(0,0.7fr) repeat(3, minmax(0,1fr))" }}
      >
        <div aria-hidden="true" />
        {cols.map((col) => (
          <p
            key={`col-${col}`}
            data-testid="complete-optimal-col-header"
            className="self-end break-words pb-0.5 text-center text-[9px] font-bold uppercase leading-tight tracking-[0.08em]"
            style={{ color: "var(--text-muted)" }}
            title={colConstraint(board, col)?.label ?? `Column ${col + 1}`}
          >
            {colConstraint(board, col)?.short_label ?? `Col ${col + 1}`}
          </p>
        ))}

        {rows.map((row) => (
          <FragmentRow
            key={`row-${row}`}
            row={row}
            board={board}
            ordered={ordered}
            cols={cols}
          />
        ))}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
        The highest-scoring legal version of this board.{" "}
        <span style={{ color: STATE_TEXT.matched }}>Green</span> — you already played it.{" "}
        <span style={{ color: STATE_TEXT.replacement }}>Violet</span> — the grid would use this
        instead. <span style={{ color: STATE_TEXT.beat }}>Gold</span> — you scored more here than
        it did.
      </p>
    </div>
  );
}

function FragmentRow({
  row,
  board,
  ordered,
  cols,
}: {
  row: number;
  board: DailyGridBoard;
  ordered: ResultCell[];
  cols: number[];
}) {
  return (
    <>
      <p
        data-testid="complete-optimal-row-header"
        className="self-center break-words pr-1 text-right text-[9px] font-bold uppercase leading-tight tracking-[0.08em]"
        style={{ color: "var(--text-muted)" }}
        title={rowConstraint(board, row)?.label ?? `Row ${row + 1}`}
      >
        {rowConstraint(board, row)?.short_label ?? `Row ${row + 1}`}
      </p>
      {cols.map((col) => {
        const cell = ordered.find((c) => c.row === row && c.col === col);
        if (!cell) {
          // Nine squares always arrive together — this branch is unreachable
          // in practice and renders an empty box rather than crashing the
          // whole recap if it ever is not.
          return (
            <div
              key={`empty-${row}-${col}`}
              aria-hidden="true"
              className="rounded-lg"
              style={{ background: "var(--bg-surface)" }}
            />
          );
        }
        return <OptimalCell key={`${row}-${col}`} cell={cell} />;
      })}
    </>
  );
}

function OptimalCell({ cell }: { cell: ResultCell }) {
  const state = optimalCellState(cell);
  const color = STATE_COLOR[state];
  const text = STATE_TEXT[state];
  const changed = state !== "matched";
  // What the swap is worth, next to the claim that it is one. "+0" is noise,
  // so a swap that scores the same says so instead: it is still a real swap —
  // the optimal board does play somebody else there — and `points_left` being
  // zero is exactly the case that would otherwise read as "no change".
  const delta =
    state === "beat"
      ? `+${cell.user_points - cell.optimal_points}`
      : state === "replacement"
        ? cell.points_left > 0
          ? `+${cell.points_left}`
          : "="
        : "";

  return (
    <div
      data-testid="complete-optimal-cell"
      data-state={state}
      className="flex min-w-0 flex-col rounded-lg px-2 py-1.5 text-left"
      aria-label={
        `${cell.row_constraint_label} by ${cell.col_constraint_label}: ` +
        `the best legal grid plays ${cell.optimal_player_season.label} for ${cell.optimal_points} points — ` +
        `${STATE_SPOKEN[state]}` +
        (changed ? `. You played ${cell.user_player_season.label} for ${cell.user_points} points.` : ".")
      }
      style={{
        background: `color-mix(in srgb, ${color} 9%, var(--bg-surface))`,
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
        // A ring rather than a heavier border: the border already carries the
        // state and thickening it would shift the grid's alignment by a pixel
        // per cell. `inset` so nothing is painted outside the box and the
        // three-column rhythm stays exact.
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 14%, transparent)`,
      }}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span
          data-testid="complete-optimal-chip"
          className="min-w-0 text-[8px] font-bold uppercase leading-tight tracking-[0.1em]"
          style={{ color: text }}
        >
          {STATE_LABEL[state]}
          {delta && (
            <span data-testid="complete-optimal-delta" style={{ color: "var(--text-muted)" }}>
              {" "}
              {delta}
            </span>
          )}
        </span>
        <span
          className="score-number font-display shrink-0 text-sm font-bold leading-none"
          style={{ color: text }}
        >
          {cell.optimal_points}
        </span>
      </div>

      <p
        className="mt-1 text-[10px] font-semibold leading-tight"
        style={{ color: "var(--text-primary)" }}
        title={cell.optimal_player_season.label}
      >
        {cell.optimal_player_season.season}
        <br />
        {cell.optimal_player_season.player_name}
      </p>

      {/* THE LINE THAT REMOVES THE CROSS-REFERENCE. On a changed square the
          player's own answer is right here, under the one they should have
          used, instead of nine lines further up the panel. */}
      {changed && (
        <p
          data-testid="complete-optimal-your-answer"
          className="mt-1 text-[9px] leading-tight"
          style={{ color: "var(--text-muted)" }}
        >
          You used: {cell.user_player_season.label} · {cell.user_points} pts
        </p>
      )}
    </div>
  );
}
