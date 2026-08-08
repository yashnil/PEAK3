"use client";

import PlayerAvatar from "@/components/court/PlayerAvatar";
import { DailyGridBoard, ResultCell } from "@/types/daily-grid";
import {
  OptimalCellState,
  colConstraint,
  optimalCellState,
  rowConstraint,
} from "@/lib/daily-grid-state";

/**
 * The best legal grid, drawn as a board. THE ONLY PLACE THE COMPARISON LIVES.
 *
 * WHAT THIS REPLACED (DG-01). Until this pass the same nine facts were printed
 * twice on one screen: once as a nine-line text list above ("square — you used
 * X (n) → Y (m)") and once here. The list required holding three coordinates in
 * your head per line — which square, who you played, who the grid wanted — and
 * it had to grow a "show only what changed" toggle precisely because nine lines
 * of that is a cross-reference exercise rather than an explanation. The list is
 * deleted. Everything it carried is now on the square it was about:
 *
 *   * the player's own answer, under the one the grid would have used;
 *   * the "you played them on X" overlap note, which is the one genuinely
 *     two-square fact the list had — a name appearing twice on this board is
 *     not a duplicate bug, it is the grid saying it wanted that player
 *     somewhere else;
 *   * the verdict, in a word, on every square.
 *
 * WHAT EACH SQUARE SHOWS (DG-02). A portrait — a real photograph where the
 * manifest resolves one, the medallion otherwise — the player name, the season
 * and team, the points that square was worth, and the state treatment, all for
 * the optimal player-season, because this is the optimal board. On a changed
 * square the player's own answer sits underneath in smaller type.
 *
 * THE PORTRAIT IS `PlayerAvatar`, THE ONE PRIMITIVE (SHARED-03). No second
 * image component and no second fetcher. It is fed the `headshot_url` the
 * result route resolved from the committed asset manifest — the same lookup
 * 82-0 uses, keyed on the same `player_slug`.
 *
 * WHAT ACTUALLY LANDS HERE IS MOSTLY THE MEDALLION, and that is the design
 * rather than a shortfall: the manifest resolves 283 of the pool's 1,384
 * distinct identities (20.4%) because resolution needs a current NBA roster
 * entry, and a Daily Grid board is mostly historical. On top of that the API
 * gate (`PEAK3_ENABLE_EXTERNAL_ASSET_URLS`) is off by default pending a
 * licensing review, so with the shipped posture every square draws the
 * medallion. The avatar reserves the same box in both branches, so a
 * photograph arriving — or failing — cannot shift the grid by a pixel.
 *
 * COLOUR IS NEVER THE ONLY CARRIER. Every square states its verdict in a word,
 * carries it in its accessible name, and the legend below names all three — for
 * a colourblind reader, a printed screenshot and a dark-on-dark phone in
 * sunlight.
 *
 * MOBILE. Three columns plus a header column at 390px leaves roughly 80px of
 * content per square, so the avatar is a deliberate 28px and it stacks ABOVE
 * the name below `sm` rather than beside it — an avatar and a wrapped player
 * name sharing 80px is how imagery makes a grid unreadable.
 */

interface Props {
  board: DailyGridBoard;
  cells: ResultCell[];
}

/** Avatar edge, in px. Chosen against the narrowest real case: at a 390px
 *  viewport a square's content box is ~80px wide, and 28px leaves room for the
 *  points figure beside it on the same line. */
const AVATAR_PX = 28;

/** Colour per state, aligned with the recap grid directly above this one.
 *
 *  The two grids sit on the same screen and each has its own legend, so a
 *  colour that means one thing in one and something else in the other is a
 *  contradiction a reader has to notice and resolve. Green means "the max grid
 *  agrees with you" in both, and gold means "you beat it" in both —
 *  `GRADE_COLOR` in CompletionPanel moved `beat` onto gold for exactly this
 *  reason. Violet belongs only to this grid, because "the swap to make" is a
 *  claim only this grid makes. */
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

/** The legend, in reading order of how good the news is. */
const LEGEND: { state: OptimalCellState; gloss: string }[] = [
  { state: "matched", gloss: "you already played it" },
  { state: "beat", gloss: "you scored more here" },
  { state: "replacement", gloss: "the grid would swap it" },
];

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
        className="grid gap-1 sm:gap-1.5"
        style={{ gridTemplateColumns: "minmax(0,0.62fr) repeat(3, minmax(0,1fr))" }}
      >
        <div aria-hidden="true" />
        {cols.map((col) => (
          <p
            key={`col-${col}`}
            data-testid="complete-optimal-col-header"
            className="self-end break-words pb-0.5 text-center text-[9px] font-bold uppercase leading-tight tracking-[0.08em]"
            style={{ color: "var(--text-secondary)" }}
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

      <ul
        data-testid="complete-optimal-legend"
        className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1"
      >
        {LEGEND.map(({ state, gloss }) => (
          <li key={state} className="flex items-center gap-1.5 text-[10px] leading-tight">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{
                background: `color-mix(in srgb, ${STATE_COLOR[state]} 30%, transparent)`,
                border: `1px solid ${STATE_COLOR[state]}`,
              }}
            />
            <span className="font-bold" style={{ color: STATE_TEXT[state] }}>
              {STATE_LABEL[state]}
            </span>
            <span style={{ color: "var(--text-muted)" }}>— {gloss}</span>
          </li>
        ))}
      </ul>
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
        style={{ color: "var(--text-secondary)" }}
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
  const optimal = cell.optimal_player_season;
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
  // The one fact the deleted list carried that is about TWO squares rather
  // than one. Only meaningful where the grid is asking for a swap: on a matched
  // or beaten square "you played them on X" is either trivially this square or
  // about a player the grid did not get.
  const overlap =
    state === "replacement" && cell.optimal_player_user_square
      ? cell.optimal_player_user_square
      : null;

  return (
    <div
      data-testid="complete-optimal-cell"
      data-state={state}
      className="flex min-w-0 flex-col gap-1 rounded-lg px-1.5 py-1.5 text-left sm:px-2"
      aria-label={
        `${cell.row_constraint_label} by ${cell.col_constraint_label}: ` +
        `the best legal grid plays ${optimal.label}${optimal.team ? `, ${optimal.team}` : ""} ` +
        `for ${cell.optimal_points} points — ${STATE_SPOKEN[state]}` +
        (changed ? `. You played ${cell.user_player_season.label} for ${cell.user_points} points` : "") +
        (overlap ? `, and you played ${optimal.player_name} on ${overlap}` : "") +
        "."
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

      {/* THE IDENTITY BLOCK. Stacked below `sm` — three columns plus a header
          column at 390px leaves ~80px of content per square, and an avatar
          beside a wrapping player name inside 80px is unreadable. */}
      <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-1.5">
        {/* No `alt`: the avatar sits directly beside the name in text and the
            square's own `aria-label` already names the player. */}
        <PlayerAvatar
          name={optimal.player_name}
          size={AVATAR_PX}
          imageUrl={optimal.headshot_url}
        />
        <p
          className="min-w-0 text-[10px] font-semibold leading-tight"
          style={{ color: "var(--text-primary)" }}
          title={optimal.label}
        >
          {optimal.player_name}
          <span
            className="pk-numeral mt-0.5 block text-[9px] font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            {optimal.season}
            {optimal.team ? ` · ${optimal.team}` : ""}
          </span>
        </p>
      </div>

      {/* THE LINE THAT REMOVED THE CROSS-REFERENCE. On a changed square the
          player's own answer is right here, under the one they should have
          used, instead of nine lines further up the panel. */}
      {changed && (
        <p
          data-testid="complete-optimal-your-answer"
          className="text-[9px] leading-tight"
          style={{ color: "var(--text-muted)" }}
        >
          You used: {cell.user_player_season.label} · {cell.user_points} pts
        </p>
      )}

      {/* The same name can legitimately appear twice on this board — once as
          the player's pick, once as the optimal grid's. Saying where they spent
          them turns what looks like a duplicate bug into the actual insight:
          the grid wanted that player somewhere else. */}
      {overlap && (
        <p
          data-testid="complete-optimal-overlap"
          className="text-[9px] leading-tight"
          style={{ color: "var(--text-muted)" }}
        >
          You played {optimal.player_name} on {overlap}.
        </p>
      )}
    </div>
  );
}
