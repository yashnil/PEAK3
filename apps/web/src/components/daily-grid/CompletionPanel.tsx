"use client";

import { useEffect, useState, type RefObject } from "react";
import Link from "next/link";
import { CalendarClock, Clock, Crown, Target, X } from "lucide-react";
import {
  DailyGridArchive,
  DailyGridBoard,
  DailyGridProgress,
  GridResultResponse,
  ResultCell,
} from "@/types/daily-grid";
import {
  CellGrade,
  TOTAL_CELLS,
  buildDailyGridShareText,
  cellGrade,
  cellShortTitle,
  elapsedMs,
  formatElapsed,
  resultGrade,
  totalArenaPoints,
} from "@/lib/daily-grid-state";
import { formatCountdown, msUntilNextBoard, recentEntries } from "@/lib/daily-grid-archive";
import OptimalGrid from "./OptimalGrid";
import RecentResults from "./RecentResults";

interface Props {
  board: DailyGridBoard;
  progress: DailyGridProgress;
  /** Today's maximum, once the server has released it. Null while it is still
   *  loading, or if the request failed -- the recap degrades to the player's
   *  own totals rather than disappearing. */
  result?: GridResultResponse | null;
  resultError?: string | null;
  /** The local archive, already updated with this board. Null until the
   *  localStorage read completes; the retention block simply does not render
   *  until then rather than flashing a zero streak. */
  archive?: DailyGridArchive | null;
  /** True when this is a replay of an earlier day, which changes what the
   *  come-back-tomorrow line can honestly say. */
  isArchiveBoard?: boolean;
  /** True once the signed-in player's durable, server-validated copy exists.
   *  Changes one label; never changes a number. */
  officialSaved?: boolean;
  /** Launch-polish §4: this panel now renders as the CONTENT of a `Dialog`
   *  (see `CompletionModal.tsx`), which already supplies the surface,
   *  border and shadow -- so this component no longer draws its own outer
   *  card, only a close affordance and the initial-focus target the
   *  Dialog's `initialFocusRef` points at. Both are optional so a future
   *  non-modal caller (there isn't one today) still renders sensibly. */
  onClose?: () => void;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
}

/** Colour per square grade. Always paired with a number or a word on screen --
 *  the colour is reinforcement, never the only carrier of the fact.
 *
 *  `beat` AND `close` TRADED COLOURS when the optimal board was added below.
 *  Two grids now sit on the same screen, each with its own legend, and the same
 *  colour meaning different things across four inches is a contradiction a
 *  reader has to notice and resolve. Gold means "you beat the best legal grid"
 *  in both grids now; blue means "close to it", which is the only place blue
 *  appears on this panel. Green already meant the same thing in both. Nothing
 *  moved that a word does not also say. */
const GRADE_COLOR: Record<CellGrade, string> = {
  beat: "var(--peak-accent)",
  best: "var(--comp-team)",
  close: "var(--comp-si)",
  fair: "var(--comp-po)",
  weak: "var(--text-muted)",
};

const GRADE_WORD: Record<CellGrade, string> = {
  beat: "beat the best legal grid here",
  best: "matched the best legal grid here",
  close: "close to the best legal grid",
  fair: "some points left",
  weak: "well short",
};

/** The chip under each mini-cell's points.
 *
 *  "Max" used to appear on every square with `points_left === 0`, which
 *  included squares the player actually WON — the best legal grid scores less
 *  there because it traded the square away for a bigger total. Saying "no
 *  better answer existed" in that case was simply false. */
const GRADE_CHIP: Record<CellGrade, string> = {
  beat: "Beat",
  best: "Max",
  close: "",
  fair: "",
  weak: "",
};

function ScoreTile({
  value,
  label,
  accent,
  testId,
  large,
}: {
  value: string;
  label: string;
  accent?: string;
  testId: string;
  large?: boolean;
}) {
  return (
    /* A raised plate with a lit top edge rather than a flat rectangle: these
       three tiles ARE the result, and they were carrying the same visual
       weight as the explanatory paragraphs further down the panel.

       THE NUMBER IS DELIBERATELY NOT A COUNT-UP. `complete-total-score`,
       `complete-optimal-total` and `complete-percent-of-best` are asserted
       with Playwright's EXACT `toHaveText(/^\d+$/)` in `daily-grid.spec.ts`,
       and every count-up component in this app carries a visually-hidden
       sibling holding the authoritative value — which doubles the element's
       `textContent` and would fail those assertions. The choice here is
       between a count-up and a green suite; the suite wins, and this note
       exists so the next person does not rediscover it the hard way. */
    <div className="card-surface pk-depth pk-crown flex-1 px-3 py-3 text-center">
      <p
        data-testid={testId}
        className={`score-number font-display font-bold leading-none ${large ? "text-3xl sm:text-4xl" : "text-2xl"}`}
        style={{ color: accent ?? "var(--text-primary)" }}
      >
        {value}
      </p>
      {/* WAS 9px `--text-muted`. Three big numbers in a row are unreadable
          without the words that say which is which. */}
      <p
        className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.12em]"
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
      </p>
    </div>
  );
}

/**
 * The completion state.
 *
 * PHASE 11C rebuilt this from a prose recap into a game result screen: a
 * headline earned from percent of today's maximum, the three numbers that
 * matter at a glance, a 3x3 recap of how each square did, and only then the
 * detail. The 11B version was accurate but had to be READ -- a player could
 * not tell at a glance whether they had done well.
 *
 * Everything shown is a server-awarded number already in `progress` or in
 * `result`. Nothing is re-scored here, and there is deliberately no rank,
 * percentile or "you beat X% of players": Phase 11C has no global leaderboard,
 * so any of those would be invented.
 */
export default function CompletionPanel({
  board,
  progress,
  result,
  resultError,
  archive,
  isArchiveBoard,
  officialSaved,
  onClose,
  closeButtonRef,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  // Ticks once a minute so the countdown to the next board stays roughly
  // right without a per-second timer for something hours away.
  const [countdown, setCountdown] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setCountdown(msUntilNextBoard());
    update();
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const total = totalArenaPoints(progress);
  const shareText = buildDailyGridShareText(board, progress, result, undefined, archive ?? null);
  const elapsed = elapsedMs(progress);
  // "today's maximum" is a provable claim; "PEAK3's best known" is not. Say
  // whichever one is actually true (see optimal.py's module docstring).
  const maxLabel = result?.exact_optimal ? "Today's max" : "Best known";
  const grade = result ? resultGrade(result.percent_of_best) : null;
  // Which squares the maximum would have filled differently. Now used only to
  // say how many, in one sentence over the optimal board -- the nine-line list
  // this used to feed is gone (DG-01).
  const changed = result ? result.cells.filter((c) => !c.matched_optimal) : [];
  // Launch-polish §4: `result.cells` arrives in FILL order (the order the
  // player locked squares in -- see filled_list in optimal.py), not board
  // order. The mini-grid below is a `grid-cols-3` that fills left-to-right,
  // top-to-bottom, so rendering it straight from `result.cells` silently
  // scrambled which square each mini-cell actually represented. Sorted here,
  // once, so mini-cell position N really is board square (row, col) N.
  const mapCells = result
    ? [...result.cells].sort((a, b) => a.row - b.row || a.col - b.col)
    : [];

  async function handleShare() {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked -- fall back to showing the text so it can be
      // selected by hand rather than silently doing nothing.
      setCopyFailed(true);
    }
  }

  return (
    // Launch-polish §4: no border/background/shadow of its own any more --
    // `CompletionModal` renders this inside `Dialog`, which already owns the
    // surface. A second card drawn here would nest one card inside another.
    <section data-testid="daily-grid-complete" aria-label="Grid complete">
      {/* Four bands, in reading order: the verdict, the three numbers, the
          per-square recap, then the biggest miss. `.pk-reveal` only fades and
          rises them — every band is in the DOM and in the accessibility tree
          from the first paint, and the shared reduced-motion block zeroes both
          the delay and the movement. */}
      <div
        className="pk-reveal flex items-start justify-between gap-4"
        style={{ "--pk-reveal-index": 0 } as React.CSSProperties}
      >
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--peak-accent-text)" }}>
            {board.date}
            {board.theme ? ` · ${board.theme}` : ""}
          </p>
          {/* The verdict. WAS `text-2xl font-bold` — one step above the
              paragraph under it. Whether the grid was a Perfect Grid or Room
              to Improve is the single fact this panel exists to state, so it
              now reads at display scale. The TEXT is unchanged: `daily-grid.
              spec.ts` matches it exactly. */}
          <h2
            id="daily-grid-complete-heading"
            data-testid="complete-headline"
            className="font-display mt-1 text-3xl font-extrabold sm:text-4xl"
          >
            {grade ? grade.headline : "Grid complete"}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            {grade ? grade.blurb : `All ${TOTAL_CELLS} squares filled with ${TOTAL_CELLS} different players.`}
          </p>
        </div>
        {/* Optional: only `CompletionModal` passes this. The board itself
            stays centred and visible behind the overlay -- this is how a
            player gets back to it without waiting for the countdown copy at
            the bottom of a long panel, or reaching for Escape. */}
        {onClose && (
          <button
            ref={closeButtonRef}
            type="button"
            data-testid="daily-grid-complete-close"
            onClick={onClose}
            aria-label="Close and return to the board"
            className="pk-lift pk-press shrink-0 rounded-md border p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <div
        className="pk-reveal mt-4 flex gap-2"
        style={{ "--pk-reveal-index": 1 } as React.CSSProperties}
      >
        <ScoreTile
          testId="complete-total-score"
          value={String(result ? result.user_total : total)}
          label="Your score"
          accent="var(--peak-accent)"
          large
        />
        {result && (
          <>
            <ScoreTile testId="complete-optimal-total" value={String(result.optimal_total)} label={maxLabel} large />
            <ScoreTile
              testId="complete-percent-of-best"
              value={`${result.percent_of_best}%`}
              label="Of that max"
              accent="var(--comp-team)"
              large
            />
          </>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
        <span data-testid="complete-time" className="inline-flex items-center gap-1">
          <Clock size={11} aria-hidden="true" />
          {formatElapsed(elapsed)}
        </span>
        <span data-testid="complete-attempts" className="inline-flex items-center gap-1">
          <Target size={11} aria-hidden="true" />
          {progress.incorrect_attempts} {progress.incorrect_attempts === 1 ? "miss" : "misses"}
        </span>
        {result && (
          <span data-testid="complete-matched" className="inline-flex items-center gap-1">
            <Crown size={11} aria-hidden="true" />
            {result.squares_matching_optimal}/{TOTAL_CELLS} squares at the max
          </span>
        )}
      </div>

      {result && (
        <>
          {/* The recap grid. Three rows of three, laid out like the board so a
              square's position is enough to find it again -- `mapCells` is
              sorted by (row, col) specifically so this `grid-cols-3`'s visual
              position N really is board square N, not whichever square the
              player happened to fill Nth. */}
          <div
            data-testid="complete-mini-grid"
            role="group"
            aria-label="Per-square recap, laid out to match the board"
            className="pk-reveal mt-4 grid grid-cols-3 gap-1.5"
            style={{ "--pk-reveal-index": 2 } as React.CSSProperties}
          >
            {mapCells.map((cell: ResultCell) => {
              const cellIsBiggestMiss =
                result.biggest_miss !== null &&
                result.biggest_miss.row === cell.row &&
                result.biggest_miss.col === cell.col;
              const g = cellGrade(cell);
              return (
                <div
                  key={`${cell.row}-${cell.col}`}
                  data-testid="complete-mini-cell"
                  data-grade={g}
                  data-biggest-miss={cellIsBiggestMiss ? "true" : "false"}
                  className="rounded-lg px-1.5 py-2 text-center"
                  aria-label={`${cellShortTitle(board, cell.row, cell.col)}: ${cell.user_points} points, ${
                    GRADE_WORD[g]
                  }${cellIsBiggestMiss ? ". Biggest miss." : ""}`}
                  style={{
                    background: "var(--bg-surface)",
                    border: `1px solid ${
                      cellIsBiggestMiss ? "var(--incorrect)" : `color-mix(in srgb, ${GRADE_COLOR[g]} 45%, transparent)`
                    }`,
                  }}
                >
                  <p
                    className="score-number font-display text-lg font-bold leading-none"
                    style={{ color: GRADE_COLOR[g] }}
                  >
                    {cell.user_points}
                  </p>
                  {/* WAS 9px `--text-muted`. "Beat" / "Max" / "−12" is the
                      verdict for the square; it is the reason the recap grid
                      exists at all. */}
                  <p
                    className="mt-1 truncate text-[10px] font-semibold uppercase tracking-[0.06em]"
                    style={{ color: "var(--text-secondary)" }}
                    title={cellShortTitle(board, cell.row, cell.col)}
                  >
                    {GRADE_CHIP[g] || `−${cell.points_left}`}
                  </p>
                </div>
              );
            })}
          </div>
          {/* WAS 10px `--text-muted`. It is the legend for the grid above it
              — the only place "Max" and "Beat" are defined. */}
          <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Points scored per square.{" "}
            <span style={{ color: "var(--comp-team-text)" }}>Max</span> means the best legal grid scored the
            same here; <span style={{ color: "var(--peak-accent-text)" }}>Beat</span> means you scored more
            than it did. A red outline marks your biggest miss.
          </p>

          {result.biggest_miss ? (
            <div
              data-testid="complete-biggest-miss"
              className="pk-reveal pk-depth mt-4 rounded-lg p-3"
              style={{ "--pk-reveal-index": 3, borderLeft: "3px solid var(--incorrect)" } as React.CSSProperties}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--incorrect)" }}>
                Biggest miss · {result.biggest_miss.points_left} points left
              </p>
              <p className="mt-1 text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {result.biggest_miss.row_constraint_label} × {result.biggest_miss.col_constraint_label}
              </p>
              <div className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
                <div>
                  {/* Both column labels WERE `--text-muted`. They are the
                      only thing distinguishing your answer from the model's. */}
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-secondary)" }}>
                    You used
                  </p>
                  <p style={{ color: "var(--text-primary)" }}>
                    {result.biggest_miss.user_player_season.label} · {result.biggest_miss.user_points} pts
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-secondary)" }}>
                    PEAK3 would have used
                  </p>
                  <p style={{ color: "var(--comp-team-text)" }}>
                    {result.biggest_miss.optimal_player_season.label} · {result.biggest_miss.optimal_points} pts
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p
              data-testid="complete-perfect"
              className="mt-4 rounded-lg px-3 py-2 text-sm font-semibold"
              style={{ background: "var(--bg-surface)", color: "var(--comp-team-text)" }}
            >
              No square left a single point on the board.
            </p>
          )}

          {/* DG-01: ONE EXPLANATION, NOT TWO. This block used to open with a
              nine-line text list — square, your pick, the grid's pick,
              matched/replaced — and then render the identical nine facts again
              as the board below it. The list is gone. Everything it said,
              including the "you played them on X" overlap note it uniquely
              carried, now sits on the square it is about, where a reader finds
              it by looking rather than by cross-referencing three coordinates
              per line. */}
          <div
            data-testid="complete-comparison"
            className="mt-4 rounded-lg p-3"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
              The best legal grid
            </p>
            <p
              data-testid="complete-comparison-summary"
              className="mt-1 text-xs leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              {changed.length === 0
                ? "Your grid matched the best legal grid on every square."
                : `The highest-scoring board legal under these six constraints uses nine different players. It agrees with you on ${
                    TOTAL_CELLS - changed.length
                  } of ${TOTAL_CELLS} squares; the rest show what it would have played instead.`}
            </p>
            <OptimalGrid board={board} cells={result.cells} />
          </div>
        </>
      )}

      {!result && resultError && (
        <p data-testid="complete-result-error" className="mt-3 text-xs" style={{ color: "var(--text-secondary)" }}>
          {resultError} Your score still stands — the comparison against today&rsquo;s maximum could not be
          loaded.
        </p>
      )}

      {/* --- the daily loop ------------------------------------------------
          Streak, history and the reason to come back. Everything here is read
          from this browser's own storage, and says so: there is no rank, no
          percentile and no comparison to other players, because none of that
          exists yet and inventing it would be the one thing that makes the
          rest of this screen untrustworthy. */}
      {archive && (
        <div
          data-testid="complete-retention"
          className="mt-4 rounded-lg p-3"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <p
              className="text-[10px] font-bold uppercase tracking-[0.14em]"
              style={{ color: "var(--text-muted)" }}
            >
              Your Daily Grid record
            </p>
            {/* Says exactly which of the two things is true, and neither
                implies a ranking. A signed-in player's result is durable and
                server-validated; an anonymous one's lives in this browser. */}
            <span
              data-testid="complete-local-only"
              data-official={officialSaved ? "true" : "false"}
              className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em]"
              style={
                officialSaved
                  ? { background: "var(--correct-bg)", color: "var(--correct)" }
                  : { background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }
              }
              title={
                officialSaved
                  ? "Saved to your account and validated by the server. Not ranked against other players."
                  : "Stored in this browser only. Not an account, not a global ranking."
              }
            >
              {officialSaved ? "Saved to your account" : "Saved on this device"}
            </span>
          </div>

          <div className="mt-2 flex gap-2">
            <div className="card-surface pk-depth pk-crown flex-1 px-2 py-2 text-center">
              <p
                data-testid="complete-current-streak"
                className="score-number font-display text-xl font-bold leading-none"
                style={{ color: "var(--peak-accent-text)" }}
              >
                {archive.current_streak}
              </p>
              <p
                className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em]"
                style={{ color: "var(--text-secondary)" }}
              >
                Day streak
              </p>
            </div>
            <div className="card-surface pk-depth pk-crown flex-1 px-2 py-2 text-center">
              <p
                data-testid="complete-longest-streak"
                className="score-number font-display text-xl font-bold leading-none"
              >
                {archive.longest_streak}
              </p>
              <p
                className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em]"
                style={{ color: "var(--text-secondary)" }}
              >
                Longest
              </p>
            </div>
            <div className="card-surface pk-depth pk-crown flex-1 px-2 py-2 text-center">
              <p
                data-testid="complete-total-played"
                className="score-number font-display text-xl font-bold leading-none"
              >
                {archive.total_completed}
              </p>
              <p
                className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em]"
                style={{ color: "var(--text-secondary)" }}
              >
                Grids played
              </p>
            </div>
          </div>

          <p
            data-testid="complete-come-back"
            className="mt-3 flex flex-wrap items-center gap-1.5 text-xs"
            style={{ color: "var(--text-secondary)" }}
          >
            <CalendarClock size={13} aria-hidden="true" style={{ color: "var(--peak-accent-text)" }} />
            {isArchiveBoard ? (
              <>
                <strong style={{ color: "var(--text-primary)" }}>That was an archive board.</strong>
                <Link
                  href="/daily/grid"
                  data-testid="complete-play-today"
                  className="font-semibold underline underline-offset-2"
                  style={{ color: "var(--peak-accent-text)" }}
                >
                  Play today&rsquo;s grid
                </Link>
                <span>to keep your streak going.</span>
              </>
            ) : (
              <>
                <strong style={{ color: "var(--text-primary)" }}>
                  Come back tomorrow for a new grid.
                </strong>
                {countdown !== null && <span>Next board in {formatCountdown(countdown)}.</span>}
              </>
            )}
          </p>

          {archive.entries.length > 1 && (
            <div className="mt-3">
              <p
                className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em]"
                style={{ color: "var(--text-muted)" }}
              >
                Recent grids
              </p>
              <RecentResults entries={recentEntries(archive, 3)} />
              <Link
                href="/daily/history"
                data-testid="complete-history-link"
                className="mt-2 inline-block text-[11px] font-semibold underline-offset-2 hover:underline"
                style={{ color: "var(--peak-accent-text)" }}
              >
                See all {archive.total_completed} grids
              </Link>
            </div>
          )}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        PEAK3 rates each season on its own; a square pays that season&rsquo;s calibrated score plus a bonus for how
        small its answer pool was. Scoring is server-side — this page only displays what the model returned. Your
        time is for you: it does not affect your score.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="daily-grid-share"
          onClick={handleShare}
          className="pk-lift pk-press pk-sheen rounded-lg px-4 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
        >
          {copied ? "Copied" : "Share result"}
        </button>
        {copied && (
          <span role="status" className="text-xs" style={{ color: "var(--text-muted)" }}>
            Copied to clipboard
          </span>
        )}
      </div>

      {copyFailed && (
        <pre
          data-testid="daily-grid-share-fallback"
          className="mt-3 overflow-x-auto rounded-lg p-3 text-xs"
          style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
        >
          {shareText}
        </pre>
      )}
    </section>
  );
}
