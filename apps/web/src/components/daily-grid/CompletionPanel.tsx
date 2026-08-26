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
import { dailyShareFile, dailyShareFileName } from "@/lib/daily-grid-share-card";
import { formatCompletionTime } from "./DailyLeaderboard";
import type { DailyGridRetryCompleteResponse } from "@/lib/daily-grid-api";

/** A finished retry's server verdict; "failed" = the submission never
 *  counted (network/session), which the player must be told. */
export type RetryOutcome = DailyGridRetryCompleteResponse | "failed" | null;
import OptimalGrid from "./OptimalGrid";
import RecentResults from "./RecentResults";
import DailyLeaderboard from "./DailyLeaderboard";
import PeakV2CinematicStage from "@/components/v2/PeakV2CinematicStage";
import PeakV2ResultHeadline from "@/components/v2/PeakV2ResultHeadline";
import PeakV2Rule from "@/components/v2/PeakV2Rule";
import PeakV2Score from "@/components/v2/PeakV2Score";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";

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
  /** Leaderboard retries (final integrity closure): a signed-in player whose
   *  official result is recorded may replay today's board to challenge their
   *  own leaderboard entry. The replay never touches the official result —
   *  the copy under the button says exactly that. */
  canReplay?: boolean;
  onReplay?: () => void;
  replayStarting?: boolean;
  /** True when THIS panel shows a finished RETRY run rather than the
   *  canonical daily — flips the banner and where the outcome line reads
   *  from. */
  retryRun?: boolean;
  retryOutcome?: RetryOutcome;
  onExitRetry?: () => void;
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
  canReplay,
  onReplay,
  replayStarting,
  retryRun,
  retryOutcome,
  onExitRetry,
  onClose,
  closeButtonRef,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  // A1: the visual share card. `generating` covers both actions while the
  // canvas renders and encodes; `shareOutcome` is the one-line feedback strip
  // (downloaded / shared / failed), cleared on the next action.
  const [generating, setGenerating] = useState(false);
  const [shareOutcome, setShareOutcome] = useState<
    null | "shared" | "downloaded" | "failed"
  >(null);
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

  /** The generated PNG for this exact result. One code path feeds BOTH
   *  actions, so what gets shared is byte-for-byte what gets downloaded. */
  async function generateImage(): Promise<File | null> {
    const canvas = document.createElement("canvas");
    return dailyShareFile(canvas, {
      board,
      progress,
      result,
      currentStreak: archive?.current_streak ?? null,
    });
  }

  // A1: SHARE IMAGE — the primary action. Native file sharing when the
  // browser genuinely supports sharing THIS file (`navigator.canShare` with
  // the files payload, not just the API existing); graceful fall-through to
  // the download path otherwise, so the button always produces the image.
  async function handleShareImage() {
    setGenerating(true);
    setShareOutcome(null);
    try {
      const file = await generateImage();
      if (!file) {
        setShareOutcome("failed");
        return;
      }
      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
      };
      if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
        try {
          await nav.share({ files: [file] });
          setShareOutcome("shared");
          return;
        } catch (error) {
          // An abort is the user closing the sheet — not a failure and not a
          // reason to dump a file in their downloads.
          if ((error as DOMException)?.name === "AbortError") return;
          // A real share failure falls through to the download below.
        }
      }
      downloadFile(file);
      setShareOutcome("downloaded");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownloadImage() {
    setGenerating(true);
    setShareOutcome(null);
    try {
      const file = await generateImage();
      if (!file) {
        setShareOutcome("failed");
        return;
      }
      downloadFile(file);
      setShareOutcome("downloaded");
    } finally {
      setGenerating(false);
    }
  }

  function downloadFile(file: File) {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = dailyShareFileName(board);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  // Pass 7 (human acceptance testing, task §3): the completion recap
  // rebuilt as CINEMATIC (one hero moment) -> LIVE (hairline-divided detail)
  // instead of the legacy card-in-card-in-card nesting. Every value below is
  // the SAME variable computed above -- zero re-derivation, zero data
  // removed, only the markup differs. `OptimalGrid`/`RecentResults`/
  // `DailyLeaderboard` are reused verbatim (their own internal presentation
  // untouched by this pass).
  const sectionLabelStyle: React.CSSProperties = {
      fontFamily: "var(--v2-font-mono)",
      fontSize: "0.6875rem",
      fontWeight: 700,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "var(--v2-text-muted)",
    };
    const bodyTextStyle: React.CSSProperties = {
      fontFamily: "var(--v2-font-ui)",
      fontSize: "0.8125rem",
      color: "var(--v2-text-secondary)",
    };
    const mutedTextStyle: React.CSSProperties = {
      fontFamily: "var(--v2-font-ui)",
      fontSize: "0.75rem",
      color: "var(--v2-text-muted)",
    };

    return (
      <section data-testid="daily-grid-complete" aria-label="Grid complete">
        {onClose && (
          <div className="flex justify-end">
            <button
              ref={closeButtonRef}
              type="button"
              data-testid="daily-grid-complete-close"
              onClick={onClose}
              aria-label="Close and return to the board"
              className="rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              style={{ border: "1px solid var(--v2-border)", color: "var(--v2-text-secondary)" }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* CINEMATIC: one hero moment -- the verdict, the score, and its
            relationship to today's max. */}
        <PeakV2CinematicStage align="start">
          <span style={sectionLabelStyle}>
            {board.date}
            {board.theme ? ` · ${board.theme}` : ""}
          </span>
          {/* `id`/`data-testid` live on this wrapper, not on
              `PeakV2ResultHeadline` itself (it already renders its own real
              `<h2>` — nesting a second `<h2>` inside it is invalid HTML and
              triggers a hydration warning). `aria-labelledby` on a dialog may
              point at any element containing the accessible name, so this
              still labels the dialog correctly. */}
          <div id="daily-grid-complete-heading" data-testid="complete-headline" className="mt-1">
            <PeakV2ResultHeadline as="h2" scale="moment" tone={grade ? "accent" : "primary"} style={{ margin: 0 }}>
              {grade ? grade.headline : "Grid complete"}
            </PeakV2ResultHeadline>
          </div>
          <p className="mt-1" style={bodyTextStyle}>
            {grade ? grade.blurb : `All ${TOTAL_CELLS} squares filled with ${TOTAL_CELLS} different players.`}
          </p>
          <div className="mt-4 flex flex-wrap items-baseline gap-6">
            {/* `valueTestId`, not `data-testid`, on each `PeakV2Score`: the
                latter lands on the wrapper that ALSO contains `label`
                ("Your score"), which would make e.g. `complete-total-score`
                read "Your score590" instead of the bare number these ids
                promise. */}
            <PeakV2Score role="moment" size="lg" tone="accent" value={String(result ? result.user_total : total)} label="Your score" valueTestId="complete-total-score" />
            {result && (
              <>
                <PeakV2Score role="instrument" size="md" tone="neutral" value={String(result.optimal_total)} label={maxLabel} valueTestId="complete-optimal-total" />
                <PeakV2Score role="instrument" size="md" tone="team" value={`${result.percent_of_best}%`} label="Of that max" valueTestId="complete-percent-of-best" />
              </>
            )}
          </div>
        </PeakV2CinematicStage>

        <PeakV2Rule spacing="md" />

        {/* LIVE: everything else, hairline-divided rather than stacked cards. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1" style={mutedTextStyle}>
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
            <div
              data-testid="complete-mini-grid"
              role="group"
              aria-label="Per-square recap, laid out to match the board"
              className="mt-4 grid grid-cols-3 gap-1.5"
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
                      background: "var(--v2-bg-plane)",
                      border: `1px solid ${
                        cellIsBiggestMiss ? "var(--v2-color-negative)" : "var(--v2-border-subtle)"
                      }`,
                    }}
                  >
                    <p style={{ fontFamily: "var(--v2-font-mono)", fontSize: "1.125rem", fontWeight: 700, lineHeight: 1, color: GRADE_COLOR[g] }}>
                      {cell.user_points}
                    </p>
                    <p
                      className="mt-1 truncate"
                      style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.625rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--v2-text-secondary)" }}
                      title={cellShortTitle(board, cell.row, cell.col)}
                    >
                      {GRADE_CHIP[g] || `−${cell.points_left}`}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5" style={mutedTextStyle}>
              Points scored per square.{" "}
              <span style={{ color: "var(--v2-color-positive)" }}>Max</span> means the best legal grid scored the
              same here; <span style={{ color: "var(--v2-color-accent)" }}>Beat</span> means you scored more
              than it did. A red outline marks your biggest miss.
            </p>

            <PeakV2Rule spacing="md" />

            {result.biggest_miss ? (
              <div data-testid="complete-biggest-miss">
                <span style={{ ...sectionLabelStyle, color: "var(--v2-color-negative)" }}>
                  Biggest miss · {result.biggest_miss.points_left} points left
                </span>
                <p className="mt-1" style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.875rem", color: "var(--v2-text-primary)" }}>
                  {result.biggest_miss.row_constraint_label} × {result.biggest_miss.col_constraint_label}
                </p>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2" style={bodyTextStyle}>
                  <div>
                    <p style={sectionLabelStyle}>You used</p>
                    <p style={{ color: "var(--v2-text-primary)" }}>
                      {result.biggest_miss.user_player_season.label} · {result.biggest_miss.user_points} pts
                    </p>
                  </div>
                  <div>
                    <p style={sectionLabelStyle}>PEAK3 would have used</p>
                    <p style={{ color: "var(--v2-color-positive)" }}>
                      {result.biggest_miss.optimal_player_season.label} · {result.biggest_miss.optimal_points} pts
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p data-testid="complete-perfect" style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.875rem", color: "var(--v2-color-positive)" }}>
                No square left a single point on the board.
              </p>
            )}

            <PeakV2Rule spacing="md" />

            <div data-testid="complete-comparison">
              <span style={sectionLabelStyle}>The best legal grid</span>
              <p className="mt-1" style={bodyTextStyle} data-testid="complete-comparison-summary">
                {changed.length === 0
                  ? "Your grid matched the best legal grid on every square."
                  : `The highest-scoring board legal under these six constraints uses nine different players. It agrees with you on ${
                      TOTAL_CELLS - changed.length
                    } of ${TOTAL_CELLS} squares; the rest show what it would have played instead.`}
              </p>
              <div className="mt-3">
                <OptimalGrid board={board} cells={result.cells} />
              </div>
            </div>
          </>
        )}

        {!result && resultError && (
          <p data-testid="complete-result-error" className="mt-3" style={mutedTextStyle}>
            {resultError} Your score still stands — the comparison against today&rsquo;s maximum could not be
            loaded.
          </p>
        )}

        <PeakV2Rule spacing="md" />

        {archive && (
          <div data-testid="complete-retention">
            <div className="flex items-center justify-between gap-2">
              <span style={sectionLabelStyle}>Your Daily Grid record</span>
              <span
                data-testid="complete-local-only"
                data-official={officialSaved ? "true" : "false"}
                style={{
                  fontFamily: "var(--v2-font-mono)",
                  fontSize: "0.625rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: officialSaved ? "var(--v2-color-positive)" : "var(--v2-text-muted)",
                }}
                title={
                  officialSaved
                    ? "Saved to your account and validated by the server. Not ranked against other players."
                    : "Stored in this browser only. Not an account, not a global ranking."
                }
              >
                {officialSaved ? "Saved to your account" : "Saved on this device"}
              </span>
            </div>

            <div className="mt-3 flex gap-6">
              <div data-testid="complete-current-streak-wrap">
                <PeakV2Score role="instrument" size="md" tone="accent" value={String(archive.current_streak)} label="Day streak" />
              </div>
              <div data-testid="complete-longest-streak-wrap">
                <PeakV2Score role="instrument" size="md" tone="neutral" value={String(archive.longest_streak)} label="Longest" />
              </div>
              <div data-testid="complete-total-played-wrap">
                <PeakV2Score role="instrument" size="md" tone="neutral" value={String(archive.total_completed)} label="Grids played" />
              </div>
            </div>
            {/* Hidden authoritative values for anything (tests, tooling) that
                still looks for the original flat testids -- the tiles above
                are the visible presentation. */}
            <span data-testid="complete-current-streak" className="sr-only">{archive.current_streak}</span>
            <span data-testid="complete-longest-streak" className="sr-only">{archive.longest_streak}</span>
            <span data-testid="complete-total-played" className="sr-only">{archive.total_completed}</span>

            <p className="mt-3 flex flex-wrap items-center gap-1.5" style={bodyTextStyle} data-testid="complete-come-back">
              <CalendarClock size={13} aria-hidden="true" style={{ color: "var(--v2-color-accent)" }} />
              {isArchiveBoard ? (
                <>
                  <strong style={{ color: "var(--v2-text-primary)" }}>That was an archive board.</strong>
                  <Link
                    href="/daily/grid"
                    data-testid="complete-play-today"
                    className="font-semibold underline underline-offset-2"
                    style={{ color: "var(--v2-color-accent)" }}
                  >
                    Play today&rsquo;s grid
                  </Link>
                  <span>to keep your streak going.</span>
                </>
              ) : (
                <>
                  <strong style={{ color: "var(--v2-text-primary)" }}>Come back tomorrow for a new grid.</strong>
                  {countdown !== null && <span>Next board in {formatCountdown(countdown)}.</span>}
                </>
              )}
            </p>

            {archive.entries.length > 1 && (
              <div className="mt-3">
                <p className="mb-1.5" style={sectionLabelStyle}>Recent grids</p>
                <RecentResults entries={recentEntries(archive, 3)} />
                <Link
                  href="/daily/history"
                  data-testid="complete-history-link"
                  className="mt-2 inline-block underline-offset-2 hover:underline"
                  style={{ ...mutedTextStyle, color: "var(--v2-color-accent)" }}
                >
                  See all {archive.total_completed} grids
                </Link>
              </div>
            )}
          </div>
        )}

        <p className="mt-4" style={mutedTextStyle}>
          PEAK3 rates each season on its own; a square pays that season&rsquo;s calibrated score plus a bonus for how
          small its answer pool was. Scoring is server-side — this page only displays what the model returned. Your
          time is for you: it does not affect your score.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <PeakV2PrimaryAction onClick={handleShareImage} disabled={generating} data-testid="daily-grid-share-image">
            {generating ? "Generating…" : "Share image"}
          </PeakV2PrimaryAction>
          <PeakV2SecondaryAction onClick={handleDownloadImage} disabled={generating} data-testid="daily-grid-download-image">
            Download image
          </PeakV2SecondaryAction>
          <PeakV2SecondaryAction onClick={handleShare} data-testid="daily-grid-share">
            {copied ? "Copied" : "Copy text"}
          </PeakV2SecondaryAction>
          {copied && (
            <span role="status" style={mutedTextStyle}>
              Copied to clipboard
            </span>
          )}
          {shareOutcome && (
            <span role="status" data-testid="daily-grid-share-outcome" style={{ ...mutedTextStyle, color: shareOutcome === "failed" ? "var(--v2-color-negative)" : "var(--v2-text-muted)" }}>
              {shareOutcome === "shared" ? "Shared" : shareOutcome === "downloaded" ? "Image saved" : "Could not generate the image — try again."}
            </span>
          )}
        </div>

        {retryRun && (
          <p data-testid="daily-grid-retry-banner" className="mt-4" style={bodyTextStyle}>
            <strong style={{ color: "var(--v2-text-primary)" }}>Replay run.</strong>{" "}
            Your official result for today is unchanged — this run only counts if it beats your best on the
            leaderboard.
          </p>
        )}
        {retryRun && retryOutcome && (
          <p
            role="status"
            data-testid="daily-grid-retry-outcome"
            className="mt-2"
            style={{
              ...mutedTextStyle,
              color:
                retryOutcome === "failed"
                  ? "var(--v2-color-negative)"
                  : retryOutcome.improved
                    ? "var(--v2-color-positive)"
                    : "var(--v2-text-secondary)",
            }}
          >
            {retryOutcome === "failed"
              ? "This replay could not be submitted — it did not count. Your best entry is unchanged."
              : retryOutcome.improved
                ? `Leaderboard updated: ${retryOutcome.score} in ${formatCompletionTime(retryOutcome.completion_time_ms)} is your new best.`
                : `Your earlier run stays on the board — this replay (${retryOutcome.score} in ${formatCompletionTime(retryOutcome.completion_time_ms)}) didn't beat it.`}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canReplay && (
            <PeakV2SecondaryAction onClick={onReplay} disabled={replayStarting} data-testid="daily-grid-replay">
              {replayStarting ? "Starting…" : "Replay this board"}
            </PeakV2SecondaryAction>
          )}
          {canReplay && !retryRun && (
            <span style={mutedTextStyle}>
              Your official result stays recorded — a better replay can improve today&rsquo;s leaderboard
              placement. The clock starts the moment you press replay.
            </span>
          )}
          {retryRun && onExitRetry && (
            <PeakV2SecondaryAction onClick={onExitRetry} data-testid="daily-grid-retry-exit">
              Back to your official result
            </PeakV2SecondaryAction>
          )}
        </div>

        <div className="mt-4">
          <DailyLeaderboard
            date={board.date}
            isArchiveBoard={isArchiveBoard}
            refreshKey={(officialSaved ? 1 : 0) + (retryOutcome && retryOutcome !== "failed" ? 2 : 0)}
          />
        </div>

        {copyFailed && (
          <pre
            data-testid="daily-grid-share-fallback"
            className="mt-3 overflow-x-auto rounded-lg p-3"
            style={{ ...mutedTextStyle, background: "var(--v2-bg-plane)" }}
          >
            {shareText}
          </pre>
        )}
      </section>
    );
}
