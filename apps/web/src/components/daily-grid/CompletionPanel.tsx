"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Clock, Crown, Target } from "lucide-react";
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
}

/** Colour per square grade. Always paired with a number or a word on screen --
 *  the colour is reinforcement, never the only carrier of the fact. */
const GRADE_COLOR: Record<CellGrade, string> = {
  beat: "var(--comp-si)",
  best: "var(--comp-team)",
  close: "var(--peak-accent)",
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
    <div className="card-surface flex-1 px-3 py-3 text-center">
      <p
        data-testid={testId}
        className={`score-number font-display font-bold leading-none ${large ? "text-3xl sm:text-4xl" : "text-2xl"}`}
        style={{ color: accent ?? "var(--text-primary)" }}
      >
        {value}
      </p>
      <p
        className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.12em]"
        style={{ color: "var(--text-muted)" }}
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
}: Props) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
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
  // Which squares the maximum would have filled differently. That is the whole
  // content of "what PEAK3 would have used" -- listing the nine squares when
  // six of them matched buries the three that did not.
  const changed = result ? result.cells.filter((c) => !c.matched_optimal) : [];
  const shown = result ? (showAll ? result.cells : changed) : [];

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
    <section
      data-testid="daily-grid-complete"
      aria-label="Grid complete"
      className="card-elevated p-4 sm:p-5"
      style={{ borderColor: "color-mix(in srgb, var(--peak-accent) 40%, var(--border-subtle))" }}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--peak-accent)" }}>
        {board.date}
        {board.theme ? ` · ${board.theme}` : ""}
      </p>
      <h2 data-testid="complete-headline" className="font-display mt-1 text-2xl font-bold sm:text-3xl">
        {grade ? grade.headline : "Grid complete"}
      </h2>
      <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        {grade ? grade.blurb : `All ${TOTAL_CELLS} squares filled with ${TOTAL_CELLS} different players.`}
      </p>

      <div className="mt-4 flex gap-2">
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
              square's position is enough to find it again. */}
          <div
            data-testid="complete-mini-grid"
            role="group"
            aria-label="Per-square recap"
            className="mt-4 grid grid-cols-3 gap-1.5"
          >
            {result.cells.map((cell: ResultCell) => {
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
                  <p
                    className="mt-1 truncate text-[9px] uppercase tracking-[0.06em]"
                    style={{ color: "var(--text-muted)" }}
                    title={cellShortTitle(board, cell.row, cell.col)}
                  >
                    {GRADE_CHIP[g] || `−${cell.points_left}`}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Points scored per square. <span style={{ color: GRADE_COLOR.best }}>Max</span> means the best legal
            grid scored the same here; <span style={{ color: GRADE_COLOR.beat }}>Beat</span> means you scored
            more than it did. A red outline marks your biggest miss.
          </p>

          {result.biggest_miss ? (
            <div
              data-testid="complete-biggest-miss"
              className="mt-4 rounded-lg p-3"
              style={{ background: "var(--bg-surface)", borderLeft: "3px solid var(--incorrect)" }}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--incorrect)" }}>
                Biggest miss · {result.biggest_miss.points_left} points left
              </p>
              <p className="mt-1 text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {result.biggest_miss.row_constraint_label} × {result.biggest_miss.col_constraint_label}
              </p>
              <div className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
                    You used
                  </p>
                  <p style={{ color: "var(--text-primary)" }}>
                    {result.biggest_miss.user_player_season.label} · {result.biggest_miss.user_points} pts
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
                    PEAK3 would have used
                  </p>
                  <p style={{ color: "var(--comp-team)" }}>
                    {result.biggest_miss.optimal_player_season.label} · {result.biggest_miss.optimal_points} pts
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p
              data-testid="complete-perfect"
              className="mt-4 rounded-lg px-3 py-2 text-sm font-semibold"
              style={{ background: "var(--bg-surface)", color: "var(--comp-team)" }}
            >
              No square left a single point on the board.
            </p>
          )}

          <div
            data-testid="complete-comparison"
            className="mt-4 rounded-lg p-3"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
                The best legal grid
              </p>
              {changed.length > 0 && (
                <button
                  type="button"
                  data-testid="complete-per-cell-toggle"
                  onClick={() => setShowAll((v) => !v)}
                  className="text-[11px] font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  style={{ color: "var(--peak-accent)" }}
                >
                  {showAll ? "Show only what changed" : `Show all ${TOTAL_CELLS} squares`}
                </button>
              )}
            </div>

            {shown.length === 0 ? (
              <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                Nothing to change — your grid matched the best legal grid on every square.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {shown.map((cell: ResultCell) => (
                  <li
                    key={`${cell.row}-${cell.col}`}
                    data-testid="complete-per-cell-row"
                    data-beat-optimal={cell.beat_optimal ? "true" : "false"}
                    className="flex flex-wrap items-baseline gap-x-2 text-xs leading-relaxed"
                  >
                    <span className="font-semibold" style={{ color: "var(--text-muted)" }}>
                      {cellShortTitle(board, cell.row, cell.col)}
                    </span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {cell.user_player_season.label} ({cell.user_points})
                    </span>
                    {cell.beat_optimal ? (
                      <span data-testid="complete-beat-note" style={{ color: GRADE_COLOR.beat }}>
                        — you beat it here ({cell.optimal_points})
                      </span>
                    ) : cell.matched_optimal ? (
                      <span style={{ color: "var(--comp-team)" }}>— matched</span>
                    ) : (
                      <span style={{ color: "var(--comp-team)" }}>
                        → {cell.optimal_player_season.label} ({cell.optimal_points})
                      </span>
                    )}
                    {/* The same name can legitimately appear twice down this
                        list — once as the player's pick, once as the optimal
                        grid's. Saying where they spent them turns what looks
                        like a duplicate bug into the actual insight: the grid
                        wanted that player somewhere else. */}
                    {cell.optimal_player_user_square && !cell.matched_optimal && !cell.beat_optimal && (
                      <span
                        data-testid="complete-overlap-note"
                        className="text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        (you played {cell.optimal_player_season.player_name} on{" "}
                        {cell.optimal_player_user_square})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {!result && resultError && (
        <p data-testid="complete-result-error" className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
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
            <div className="card-surface flex-1 px-2 py-2 text-center">
              <p
                data-testid="complete-current-streak"
                className="score-number font-display text-xl font-bold leading-none"
                style={{ color: "var(--peak-accent)" }}
              >
                {archive.current_streak}
              </p>
              <p
                className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em]"
                style={{ color: "var(--text-muted)" }}
              >
                Day streak
              </p>
            </div>
            <div className="card-surface flex-1 px-2 py-2 text-center">
              <p
                data-testid="complete-longest-streak"
                className="score-number font-display text-xl font-bold leading-none"
              >
                {archive.longest_streak}
              </p>
              <p
                className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em]"
                style={{ color: "var(--text-muted)" }}
              >
                Longest
              </p>
            </div>
            <div className="card-surface flex-1 px-2 py-2 text-center">
              <p
                data-testid="complete-total-played"
                className="score-number font-display text-xl font-bold leading-none"
              >
                {archive.total_completed}
              </p>
              <p
                className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em]"
                style={{ color: "var(--text-muted)" }}
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
            <CalendarClock size={13} aria-hidden="true" style={{ color: "var(--peak-accent)" }} />
            {isArchiveBoard ? (
              <>
                <strong style={{ color: "var(--text-primary)" }}>That was an archive board.</strong>
                <Link
                  href="/daily/grid"
                  data-testid="complete-play-today"
                  className="font-semibold underline underline-offset-2"
                  style={{ color: "var(--peak-accent)" }}
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
                style={{ color: "var(--peak-accent)" }}
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
          className="rounded-lg px-4 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
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
