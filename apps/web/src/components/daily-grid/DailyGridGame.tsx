"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, HelpCircle, History } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import {
  DailyGridArchive,
  DailyGridBoard,
  DailyGridProgress,
  GridResultResponse,
  PlayerSeasonSearchHit,
} from "@/types/daily-grid";
import {
  getDailyGridBoard,
  getDailyGridResult,
  saveOfficialDailyGridResult,
  startDailyGridAttempt,
  submitDailyGridAnswer,
} from "@/lib/daily-grid-api";
import { GuidedTour, useGuidedTour } from "@/components/ui/GuidedTour";
import {
  DAILY_GRID_TOUR,
  DAILY_GRID_TOUR_ID,
  DAILY_GRID_TOUR_VERSION,
  type TourTargetId,
} from "@/components/ui/tour-steps";
import { usePrefersReducedMotion } from "@/lib/a11y";
import {
  buildArchiveEntry,
  isCanonicalToday,
  loadArchive,
  recordCompletedBoard,
  reportableElapsedSeconds,
  saveArchive,
} from "@/lib/daily-grid-archive";
import {
  type DailyWindowPayload,
  extractDailyWindow,
  formatCountdown,
} from "@/lib/daily-time";
import { useDailyReset } from "@/lib/use-daily-reset";
import {
  TOTAL_CELLS,
  elapsedMs,
  emptyProgress,
  filledCoords,
  findFilled,
  formatElapsed,
  hasSeenRules,
  isComplete,
  loadProgress,
  markRulesSeen,
  saveProgress,
  totalArenaPoints,
  usedPlayerSlugs,
  withFilledCell,
  withIncorrectAttempt,
  withServerTimer,
  withTimerStarted,
} from "@/lib/daily-grid-state";
import DailyGridBoardView from "./DailyGridBoardView";
import CellPanel from "./CellPanel";
import CompletionPanel from "./CompletionPanel";
import HowToPlay from "./HowToPlay";
import StartGate from "./StartGate";

interface Props {
  /** Optional YYYY-MM-DD ARCHIVE date. Omitted means today's board, which the
   *  server decides (midnight America/Los_Angeles) — never this component. */
  date?: string;
  /** Test seam: pre-loaded board, so unit tests never need the API. */
  initialBoard?: DailyGridBoard;
  /** Test seam: skip the rules gate. Production always consults localStorage. */
  skipRulesGate?: boolean;
}

const DIFFICULTY_COLOR: Record<string, string> = {
  easy: "var(--comp-team)",
  medium: "var(--peak-accent)",
  hard: "var(--comp-po)",
};

function StatTile({
  label,
  value,
  accent,
  testId,
  tourId,
}: {
  label: string;
  value: string;
  accent?: string;
  testId?: string;
  /** Spotlight target for the guided walkthrough. Typed against the shared
   *  closed union so a renamed id fails `tsc` rather than silently un-aiming a
   *  step. */
  tourId?: TourTargetId;
}) {
  return (
    <div
      className="card-surface flex-1 px-3 py-2 text-center"
      data-tour-id={tourId}
      style={{ borderTop: `2px solid ${accent ?? "var(--border-default)"}` }}
    >
      <p
        data-testid={testId}
        className="score-number font-display text-lg font-bold leading-tight"
        style={{ color: accent ?? "var(--text-primary)" }}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
    </div>
  );
}

/**
 * Daily Grid Challenge shell: board fetch, selection, submission, local
 * persistence and the post-completion comparison.
 *
 * Server-authoritative by construction -- the only writes to `progress` that
 * fill a square copy the `player_season` and `cell_score` objects straight out
 * of the POST /daily-grid/answer response. There is no client-side eligibility
 * check and no client-side scoring anywhere in this component.
 *
 * PHASE 11B RULES, all enforced here as well as server-side:
 *   - the rules gate runs before the board is playable on a first visit, because
 *     an optimisation puzzle is unguessable from a grid of empty squares;
 *   - a locked square is FINAL -- clicking it reviews it, and there is no
 *     remove or reset control anywhere in the component;
 *   - today's maximum is fetched only once all nine squares are locked, and the
 *     server re-validates the whole board before releasing it.
 */
export default function DailyGridGame({ date, initialBoard, skipRulesGate }: Props) {
  const [board, setBoard] = useState<DailyGridBoard | null>(initialBoard ?? null);
  // The server's window for the board on screen: which day it is and how long
  // it has left. Never derived here -- see lib/daily-time.ts.
  const [window_, setWindow] = useState<DailyWindowPayload | null>(
    extractDailyWindow(initialBoard),
  );
  // Bumped to force the board effect to run again at a rollover. The effect's
  // real dependencies (`date`, `initialBoard`) are BOTH permanently undefined
  // on the canonical /daily/grid route, so without this the board was fetched
  // exactly once per mount and never again -- a tab left open through midnight
  // kept playing yesterday's board while posting answers against yesterday's
  // date, and the server correctly filed the whole session as an archive
  // replay, silently breaking a streak the player had actually earned.
  const [reloadToken, setReloadToken] = useState(0);
  const [loading, setLoading] = useState(!initialBoard);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DailyGridProgress | null>(
    initialBoard ? emptyProgress(initialBoard) : null,
  );
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [cellMessage, setCellMessage] = useState<{ row: number; col: number; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // `null` until the localStorage read happens in an effect -- reading it during
  // render would diverge between the server and client passes and hydrate wrong.
  const [showGate, setShowGate] = useState<boolean | null>(skipRulesGate ? false : null);
  const [rulesPanelOpen, setRulesPanelOpen] = useState(false);
  // True while POST /daily-grid/{key}/start is in flight, so the gate's two
  // start actions can disable themselves. The server is idempotent, so this is
  // presentation, not correctness -- `startingRef` below is the real guard.
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  // The daily key whose window closed while this board was on screen, or null.
  // NOT a refetch: see the rollover block below (defect D1).
  const [rolloverFrom, setRolloverFrom] = useState<string | null>(null);
  const [result, setResult] = useState<GridResultResponse | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  // Re-render tick for the running clock. The elapsed time itself is always
  // derived from `progress.started_at`, never accumulated here -- this state
  // exists only to make the displayed number move.
  const [, setClockTick] = useState(0);
  // The local archive. `null` until the localStorage read happens in an effect,
  // for the same hydration reason as `showGate`.
  const [archive, setArchive] = useState<DailyGridArchive | null>(null);
  // Whether this board also has a durable, server-validated copy. Only ever
  // true for a signed-in player; drives one honest badge, nothing else.
  const [officialSaved, setOfficialSaved] = useState(false);
  // The board whose official save has already been attempted, so a re-render
  // (or the archive effect firing again) cannot re-POST it.
  const officialSavedRef = useRef<string | null>(null);
  const { user } = useAuth();
  const reducedMotion = usePrefersReducedMotion();

  // Read-through mirrors, so the rollover callback and the attempt starter can
  // both stay referentially stable without going stale. `useDailyReset` keys
  // its whole timer effect off `onReset`'s identity, so a callback that changed
  // every render would restart the countdown on every render.
  const progressRef = useRef<DailyGridProgress | null>(progress);
  progressRef.current = progress;
  const boardRef = useRef<DailyGridBoard | null>(board);
  boardRef.current = board;

  // --- rules gate ---------------------------------------------------------
  useEffect(() => {
    if (skipRulesGate) return;
    setShowGate(!hasSeenRules());
  }, [skipRulesGate]);

  // --- local archive ------------------------------------------------------
  useEffect(() => {
    setArchive(loadArchive());
  }, []);

  // --- board + restore ----------------------------------------------------
  useEffect(() => {
    if (initialBoard) {
      setProgress(loadProgress(initialBoard.board_id) ?? emptyProgress(initialBoard));
      return;
    }
    let cancelled = false;
    setLoading(true);
    getDailyGridBoard(date)
      .then((b) => {
        if (cancelled) return;
        setBoard(b);
        setWindow(extractDailyWindow(b));
        // A new date means a new board_id means a new storage key, so
        // yesterday's grid can never bleed into today's.
        setProgress(loadProgress(b.board_id) ?? emptyProgress(b));
        setLoadError(null);
        setResult(null);
        setResultError(null);
        setSelected(null);
        setCellMessage(null);
        // D6: the "official" badge belongs to ONE board. It used to survive a
        // rollover along with the ref that gates the POST, so after midnight a
        // fresh, unsaved board could render "Saved to your account" purely
        // because yesterday's save had succeeded -- and if yesterday's had
        // FAILED, the stale ref could also suppress today's save entirely.
        setOfficialSaved(false);
        officialSavedRef.current = null;
        setRolloverFrom(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error && err.message ? err.message : "Could not load today's grid.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, initialBoard, reloadToken]);

  // --- the rollover -------------------------------------------------------
  // Fires when this board's window closes -- either because the countdown ran
  // out in a foreground tab, or because the tab came back from the background
  // (or the machine from sleep) past the boundary. An ARCHIVE board reports
  // `seconds_remaining: 0` and never arms, so opening `?date=` deliberately is
  // not yanked out from under the player. `date` is likewise left alone: a
  // rollover refetches the SAME request the mount made, which for the canonical
  // route means today's board and for an archive route means the same archive
  // board (which cannot roll over at all).
  //
  // D1 -- IT PROMPTS, IT DOES NOT DISCARD. This used to bump `reloadToken`
  // unconditionally, and the board effect above then replaced the board AND the
  // progress with the new day's empty grid. A player six squares into a board
  // at 00:00 PT silently lost all six, with no message and nothing to undo; the
  // board they were playing was not even addressable afterwards. Now: an
  // untouched board is still swapped silently (there is nothing to lose and the
  // swap is the correct behaviour for a tab left open overnight), and a board
  // with any state on it raises a prompt that keeps the old board exactly where
  // it is until the player chooses.
  const { secondsLeft } = useDailyReset({
    dailyKey: window_?.daily_key ?? null,
    secondsRemaining: window_?.seconds_remaining ?? null,
    window: window_,
    onReset: useCallback(() => {
      if (date) return; // an explicit archive board has nothing to roll over to
      const current = progressRef.current;
      const untouched = !current || (current.filled.length === 0 && !current.started_at);
      if (untouched) {
        setReloadToken((t) => t + 1);
        return;
      }
      setRolloverFrom(boardRef.current?.date ?? "");
    }, [date]),
  });

  // A board reached through ?date= that is not today's. Fully playable, but
  // labelled, and it never touches the live streak (see daily-grid-archive.ts)
  // or today's timed attempt.
  //
  // Decided from the SERVER's window when there is one -- an archive board's
  // window has already closed, which is a fact about the board rather than an
  // opinion about the browser's clock. `isCanonicalToday` is the fallback for
  // an API old enough not to send the block, and for the unit-test seam that
  // injects a board directly.
  const isArchiveBoard = useMemo(() => {
    if (!board) return false;
    if (window_) return window_.seconds_remaining <= 0;
    return !isCanonicalToday(board.date);
  }, [board, window_]);

  // --- the timed attempt ---------------------------------------------------
  // The daily key this board's timed attempt lives under, or null when there
  // is no attempt to start: an explicit `?date=` route, a board whose window
  // has closed, or a board that has not loaded. Prefers the top-level
  // `daily_key` the hardening pass added, falls back to the nested `daily`
  // block, and finally to `board.date` -- all three are the same string when
  // they are all present, and every one of them is optional on the wire.
  const attemptKey = useCallback((): string | null => {
    if (date) return null;
    if (isArchiveBoard) return null;
    const b = boardRef.current;
    if (!b) return null;
    return b.daily_key ?? window_?.daily_key ?? b.date ?? null;
  }, [date, isArchiveBoard, window_]);

  /**
   * Start (or resume) the timed attempt. The ONLY thing that starts the clock.
   *
   * Never called on page load and never called when the walkthrough opens --
   * that is the whole contract of the start gate. It is called from exactly two
   * places: the gate's two start actions, and a returning player's first move
   * on a board whose gate was dismissed on an earlier day (there is no gate to
   * press then, and charging them for the page load instead would be worse).
   *
   * FALLBACK BEHAVIOUR. The local clock is started FIRST and unconditionally,
   * so a player whose network is slow or whose API is down still sees an honest
   * running timer; the server's `elapsed_seconds` then re-anchors it if and
   * when the response lands (`withServerTimer`). Every failure -- offline, 429,
   * 409 `not_todays_key`, an API that predates the route -- is swallowed, and
   * the local clock simply stands. Nothing about play, scoring or the result
   * comparison depends on this call succeeding.
   */
  const beginAttempt = useCallback(async () => {
    if (startingRef.current) return;
    const current = progressRef.current;
    // Already running, or already finished: the timestamp is written once.
    if (!current || current.started_at || current.completed_at) return;

    startingRef.current = true;
    setStarting(true);
    setProgress((cur) => (cur ? withTimerStarted(cur) : cur));

    const key = attemptKey();
    if (!key) {
      startingRef.current = false;
      setStarting(false);
      return;
    }
    try {
      const token = await getAccessToken();
      const res = await startDailyGridAttempt(key, token);
      setProgress((cur) => (cur ? withServerTimer(cur, res.elapsed_seconds) : cur));
    } catch {
      // Deliberately silent -- see the docstring. The local clock stands.
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [attemptKey]);

  // --- the walkthrough -----------------------------------------------------
  // Mirrors RunTheTableGame's `tourBlocked`: no spotlight while the surface is
  // still loading, while the start gate owns the screen, or while a submit is
  // in flight and the board is about to change under the highlight. `blocked`
  // suppresses the AUTO-start only -- an explicit press always opens the tour,
  // which is what makes the gate's "How to Play" action work.
  const tourBlocked = loading || showGate !== false || submitting;
  // `autoStart: false`, following the RUN THE TABLE start gate: a walkthrough
  // that opens by itself on top of a "press a button to begin" screen is a
  // modal in front of a call to action. Onboarding here is entered explicitly,
  // from the gate or from the permanent `?` control.
  const tour = useGuidedTour({
    tourId: DAILY_GRID_TOUR_ID,
    version: DAILY_GRID_TOUR_VERSION,
    blocked: tourBlocked,
    autoStart: false,
  });

  // --- persist ------------------------------------------------------------
  useEffect(() => {
    if (progress) saveProgress(progress);
  }, [progress]);

  // --- clock --------------------------------------------------------------
  // Runs only while a board is genuinely in play: not before the first move,
  // and not for a second after the ninth square locks. A plain interval, no
  // animation -- nothing here is affected by prefers-reduced-motion.
  const clockRunning = !!progress?.started_at && !progress?.completed_at;
  useEffect(() => {
    if (!clockRunning) return;
    const id = window.setInterval(() => setClockTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [clockRunning]);

  // --- today's maximum, once the board is finished ------------------------
  useEffect(() => {
    if (!board || !progress || !isComplete(progress) || result) return;
    let cancelled = false;
    getDailyGridResult({
      date: board.date,
      filled: progress.filled.map((c) => ({ row: c.row, col: c.col, answer_id: c.player_season.id })),
      incorrect_attempts: progress.incorrect_attempts,
    })
      .then((res) => {
        if (!cancelled) {
          setResult(res);
          setResultError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // The board still shows its own total; only the comparison is missing.
        setResultError(
          err instanceof Error && err.message ? err.message : "Could not load today's maximum.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [board, progress, result]);

  // --- official (account-backed) save --------------------------------------
  // Best-effort and strictly additive: a signed-in player gets a durable,
  // server-validated copy of the result; an anonymous one keeps the local
  // archive, which is the whole product for them. A failure here is swallowed
  // on purpose -- the score is already on screen and correct, and an error
  // banner about a background copy would be noise in front of someone who just
  // finished a grid. Guarded by a ref so a re-render cannot re-POST.
  useEffect(() => {
    if (!board || !progress || !result || !user) return;
    if (officialSavedRef.current === board.board_id) return;
    officialSavedRef.current = board.board_id;

    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      if (!token || cancelled) return;
      try {
        await saveOfficialDailyGridResult(
          {
            date: board.date,
            filled: progress.filled.map((c) => ({
              row: c.row,
              col: c.col,
              answer_id: c.player_season.id,
            })),
            incorrect_attempts: progress.incorrect_attempts,
            elapsed_seconds: reportableElapsedSeconds(progress),
            theme: board.theme,
          },
          token,
        );
        if (!cancelled) setOfficialSaved(true);
      } catch {
        // Intentionally silent -- see above. The next completed board will try
        // again on its own.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [board, progress, result, user]);

  // --- record the finished board into the local archive --------------------
  // Runs on completion and again when the comparison lands a moment later.
  // `recordCompletedBoard` replaces by board_id, so the second pass UPGRADES
  // the row with today's max and the grade rather than adding a duplicate --
  // which is also what makes this safe to re-run on every mount of a finished
  // board. Uses a functional update so `archive` stays out of the dependency
  // array and cannot drive a render loop.
  useEffect(() => {
    if (!board || !progress || !isComplete(progress)) return;
    setArchive((current) => {
      const base = current ?? loadArchive();
      const next = recordCompletedBoard(base, buildArchiveEntry(board, progress, result));
      saveArchive(next);
      return next;
    });
  }, [board, progress, result]);

  const handleSelect = useCallback(
    (row: number, col: number) => {
      setSelected((cur) => (cur && cur.row === row && cur.col === col ? null : { row, col }));
      setCellMessage(null);
      // A returning player has no start gate to press -- the gate is shown
      // once, not once a day -- so their first MOVE is the explicit action that
      // starts the attempt. Still never the page load, and still never the
      // walkthrough. `beginAttempt` is a no-op once the clock is running, so
      // every later square costs nothing.
      void beginAttempt();
    },
    [beginAttempt],
  );

  async function handleSubmit(hit: PlayerSeasonSearchHit) {
    if (!board || !progress || !selected) return;
    const { row, col } = selected;
    // A locked square is final. Guarded here as well as in withFilledCell so a
    // stray double-submit can never rewrite a pick.
    if (findFilled(progress, row, col)) return;
    setSubmitting(true);
    try {
      const res = await submitDailyGridAnswer({
        date: board.date,
        row,
        col,
        answer_id: hit.id,
        used_player_slugs: usedPlayerSlugs(progress),
        filled_cells: filledCoords(progress),
      });
      if (res.valid && res.player_season && res.cell_score) {
        setProgress(
          withFilledCell(progress, {
            row,
            col,
            player_season: res.player_season,
            cell_score: res.cell_score,
          }),
        );
        setCellMessage(null);
        setSelected(null);
      } else {
        setProgress(withIncorrectAttempt(progress));
        // The server's sentence, verbatim -- it names the exact constraint or
        // rule that failed, which is the teaching moment. The fallback only
        // fires if the response omitted `reason` entirely.
        setCellMessage({ row, col, text: res.reason ?? "That answer was not accepted." });
      }
    } catch (err: unknown) {
      setCellMessage({
        row,
        col,
        text: err instanceof Error && err.message ? err.message : "Could not reach the grid service.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * "Start Timed Grid" / "Skip Tour and Start".
   *
   * The two differ only in what they record about the walkthrough: skipping is
   * a deliberate choice and is stored as one, so a later version bump can tell
   * "declined the tour at v1" from "never saw a tour at all". Both dismiss the
   * gate and both start the clock.
   */
  function startGrid(status: "completed" | "skipped" = "completed") {
    markRulesSeen(status);
    setShowGate(false);
    void beginAttempt();
  }

  if (loading || showGate === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p role="status" data-testid="daily-grid-loading" style={{ color: "var(--text-muted)" }}>
          Loading today&rsquo;s grid…
        </p>
      </div>
    );
  }

  if (loadError || !board || !progress) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4">
        <div className="card-elevated max-w-md space-y-3 p-6 text-center">
          <p role="alert" data-testid="daily-grid-error" style={{ color: "var(--incorrect)" }}>
            {loadError ?? "Could not load today's grid."}
          </p>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            The grid is generated by the PEAK3 API. Make sure it is running at{" "}
            <code className="text-xs">localhost:8000</code>.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg px-4 py-2 text-sm"
            style={{ border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (showGate) {
    return (
      <div className="mx-auto w-full max-w-5xl px-3 pb-16 pt-8 sm:px-4">
        <StartGate
          date={board.date}
          difficulty={board.difficulty}
          theme={board.theme}
          starting={starting}
          reducedMotion={reducedMotion}
          onHowToPlay={tour.start}
          onStart={() => startGrid("completed")}
          onSkipTourAndStart={() => startGrid("skipped")}
        />
        {/* The walkthrough is reachable FROM the gate, and reading it starts
            nothing: the clock is written by `beginAttempt`, which only the two
            start actions above can reach. With no board mounted yet every step
            renders centred with no spotlight -- GuidedTour's documented
            missing-target degradation. */}
        <GuidedTour
          steps={DAILY_GRID_TOUR}
          tourId={DAILY_GRID_TOUR_ID}
          version={DAILY_GRID_TOUR_VERSION}
          eyebrow="How the Daily Grid works"
          open={tour.open}
          onOpenChange={(next) => {
            if (!next) tour.stop();
          }}
          autoStart={false}
          data-testid="daily-grid-tour"
        />
      </div>
    );
  }

  const complete = isComplete(progress);
  const selectedFilled = selected ? findFilled(progress, selected.row, selected.col) : null;

  return (
    <div
      className="mx-auto w-full max-w-6xl px-3 pb-16 pt-6 sm:px-4"
      data-motion={reducedMotion ? "none" : "auto"}
    >
      {/* D1: the midnight prompt. Deliberately NOT a modal — a player six
          squares into a grid at 00:00 does not need their board taken away and
          a decision demanded before they may look at it again. Both choices are
          non-destructive: the old board stays exactly where it is until the
          player picks, and picking "today's grid" refetches rather than
          discarding (the old board remains reachable at ?date=). */}
      {rolloverFrom !== null && (
        <div
          data-testid="daily-grid-rollover-prompt"
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2.5 text-xs"
          style={{
            background: "var(--peak-accent-bg)",
            border: "1px solid var(--peak-accent)",
            color: "var(--text-secondary)",
            transition: reducedMotion ? "none" : "opacity 200ms ease",
          }}
        >
          <CalendarClock size={14} aria-hidden="true" style={{ color: "var(--peak-accent)" }} />
          <strong style={{ color: "var(--text-primary)" }}>A new grid is up.</strong>
          <span>
            You are still on the {rolloverFrom || "previous"} board. Your picks on it are safe — but
            it is now an earlier day, so finishing it will not extend your streak.
          </span>
          <button
            type="button"
            data-testid="daily-grid-rollover-switch"
            onClick={() => {
              setRolloverFrom(null);
              setReloadToken((t) => t + 1);
            }}
            className="rounded px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
          >
            Play today&rsquo;s grid
          </button>
          <button
            type="button"
            data-testid="daily-grid-rollover-stay"
            onClick={() => setRolloverFrom(null)}
            className="rounded border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            Finish this board
          </button>
        </div>
      )}
      {isArchiveBoard && (
        <div
          data-testid="daily-grid-archive-banner"
          role="note"
          className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-xs"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            color: "var(--text-secondary)",
          }}
        >
          <History size={13} aria-hidden="true" style={{ color: "var(--comp-tm)" }} />
          <strong style={{ color: "var(--text-primary)" }}>Archive board · {board.date}.</strong>
          <span>
            You are replaying an earlier day. It is scored normally but does not count toward your
            streak.
          </span>
          <Link
            href="/daily/grid"
            data-testid="daily-grid-play-today"
            className="font-semibold underline underline-offset-2"
            style={{ color: "var(--peak-accent)" }}
          >
            Play today&rsquo;s grid
          </Link>
        </div>
      )}
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold sm:text-3xl">Daily Grid Challenge</h1>
            {/* The objective, at the top, in the same words the how-to-play
                panel uses. This is the line the Phase 11A page was missing. */}
            <p
              data-testid="daily-grid-objective"
              className="mt-1 text-sm sm:text-base"
              style={{ color: "var(--text-secondary)" }}
            >
              Fill the grid with exact NBA player-seasons. Scores stay hidden until each pick locks.{" "}
              <strong style={{ color: "var(--peak-accent)" }}>
                Your goal: maximize your PEAK3 total with nine different players.
              </strong>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/daily/history"
              data-testid="daily-grid-history-link"
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
            >
              <History size={13} aria-hidden="true" />
              History
              {/* The streak is the reason to look, so it rides on the link
                  rather than needing its own tile in an already-full bar. */}
              {archive && archive.current_streak > 0 && (
                <span
                  data-testid="daily-grid-streak-chip"
                  className="rounded-full px-1.5 py-px text-[10px] font-bold"
                  style={{ background: "var(--peak-accent-bg)", color: "var(--peak-accent)" }}
                >
                  {archive.current_streak}d
                </span>
              )}
            </Link>
            {/* The permanent replay control. Reopening the walkthrough does
                NOT touch the board and does NOT pause the clock: the tour is a
                portal above the page, elapsed time is derived from
                `progress.started_at`, and nothing here writes to `progress`. */}
            <button
              type="button"
              data-testid="daily-grid-tour-launcher"
              onClick={tour.start}
              disabled={tourBlocked}
              aria-haspopup="dialog"
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-50"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
            >
              {/* The `?` glyph, styled by the shared launcher rule so the two
                  tours' help controls read as the same affordance. The button
                  chrome deliberately matches its neighbours here rather than
                  using `.pk-tour-launcher`, whose 44px tray sizing would tower
                  over the History and Rules chips beside it. */}
              <span aria-hidden="true" className="pk-tour-launcher-glyph">
                ?
              </span>
              <span>How to play</span>
            </button>
            <button
              type="button"
              data-testid="daily-grid-how-to-play"
              onClick={() => setRulesPanelOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
            >
              <HelpCircle size={13} aria-hidden="true" />
              Rules
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-stretch gap-2" data-tour-id="dg-score">
          <StatTile
            label="Score"
            value={String(totalArenaPoints(progress))}
            accent="var(--peak-accent)"
            testId="daily-grid-score"
          />
          <StatTile
            label="Locked"
            value={`${progress.filled.length}/${TOTAL_CELLS}`}
            testId="daily-grid-progress"
          />
          <StatTile
            label="Misses"
            value={String(progress.incorrect_attempts)}
            accent={progress.incorrect_attempts > 0 ? "var(--incorrect)" : undefined}
            testId="daily-grid-misses"
          />
          {/* The clock. Starts on the first move, freezes on completion, and
              does not enter the score — it is pressure and a personal best,
              not a scoreboard (Phase 11C has no verified speed ranking, so
              claiming one would be inventing it). */}
          <StatTile
            label={progress.completed_at ? "Final time" : "Time"}
            value={formatElapsed(elapsedMs(progress))}
            testId="daily-grid-timer"
            tourId="dg-timer"
          />
          {result ? (
            <StatTile
              label={result.exact_optimal ? "Of today's max" : "Of best known"}
              value={`${result.percent_of_best}%`}
              accent="var(--comp-team)"
              testId="daily-grid-percent"
            />
          ) : (
            <StatTile
              label="Difficulty"
              value={board.difficulty}
              accent={DIFFICULTY_COLOR[board.difficulty]}
              testId="daily-grid-difficulty"
            />
          )}
        </div>

        <p
          data-testid="daily-grid-unique-rule"
          data-tour-id="dg-rule"
          className="mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{ background: "var(--peak-accent-bg)", color: "var(--text-secondary)" }}
        >
          <strong style={{ color: "var(--peak-accent)" }}>One player per board, picks are final.</strong>{" "}
          Nine squares need nine different players, and a valid pick cannot be changed. Search helps you
          confirm eligibility, but scores reveal only after a pick locks. Answers are exact seasons —
          &ldquo;1999-00 Shaquille O&rsquo;Neal&rdquo;, not just &ldquo;Shaquille O&rsquo;Neal&rdquo;.{" "}
          <span data-testid="daily-grid-theme">{board.theme}</span> ·{" "}
          <span data-testid="daily-grid-date">{board.date}</span>
          {/* Counted down from the server's own window, not from a boundary
              derived in the browser — the two used to disagree by up to a day. */}
          {!isArchiveBoard && secondsLeft !== null && (
            <>
              {" · "}
              <span data-testid="daily-grid-countdown">
                {secondsLeft > 0
                  ? `New board in ${formatCountdown(secondsLeft)}`
                  : "A new board is available"}
              </span>
            </>
          )}
        </p>
      </header>

      {/* Desktop: grid left, workbench right, so the selected square's panel is
          beside the board instead of below the fold. Mobile keeps them stacked.
          `items-start` + `sticky` keeps the panel in view while the player
          scrolls a long candidate list. */}
      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div
          className="court-grid-bg rounded-xl p-2 sm:p-3"
          data-tour-id="dg-board"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          <DailyGridBoardView
            board={board}
            progress={progress}
            selected={selected}
            invalidCell={cellMessage ? { row: cellMessage.row, col: cellMessage.col } : null}
            onSelect={handleSelect}
          />
        </div>

        <div className="lg:sticky lg:top-20" data-tour-id="dg-workbench">
          {selected ? (
            <CellPanel
              key={`${selected.row}-${selected.col}`}
              board={board}
              row={selected.row}
              col={selected.col}
              filled={selectedFilled}
              usedPlayerSlugs={usedPlayerSlugs(progress)}
              invalidMessage={
                cellMessage && cellMessage.row === selected.row && cellMessage.col === selected.col
                  ? cellMessage.text
                  : null
              }
              submitting={submitting}
              onSubmit={handleSubmit}
              onClose={() => setSelected(null)}
            />
          ) : (
            !complete && (
              <div
                data-testid="daily-grid-idle-hint"
                className="card-surface p-5 text-center"
              >
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Choose a square to start
                </p>
                <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  Each square needs a player-season that satisfies both its row and its column. Squares
                  with a smaller answer pool are worth more — but any valid answer beats an empty square.
                </p>
              </div>
            )
          )}

          {complete && !selected && (
            <CompletionPanel
              board={board}
              progress={progress}
              result={result}
              resultError={resultError}
              archive={archive}
              isArchiveBoard={isArchiveBoard}
              officialSaved={officialSaved}
            />
          )}
        </div>
      </div>

      {/* Phase 11B: no reset control. A valid pick is locked and the board is
          the board -- a "start over" button would make both the day's score and
          the comparison against today's maximum meaningless. */}

      {/* The rules reference. `Dialog` owns the backdrop, the portal, the focus
          trap, the layer stack, the scroll lock and the focus restoration —
          none of which the hand-rolled version above it used to have. */}
      <HowToPlay
        open={rulesPanelOpen}
        date={board.date}
        difficulty={board.difficulty}
        theme={board.theme}
        onClose={() => setRulesPanelOpen(false)}
        onTakeTour={() => {
          setRulesPanelOpen(false);
          tour.start();
        }}
      />

      {/* The replayable walkthrough. Opening it changes no game state at all:
          the clock keeps running off `progress.started_at`, the board keeps its
          picks, and closing it returns focus to whichever control opened it. */}
      <GuidedTour
        steps={DAILY_GRID_TOUR}
        tourId={DAILY_GRID_TOUR_ID}
        version={DAILY_GRID_TOUR_VERSION}
        eyebrow="How the Daily Grid works"
        open={tour.open}
        onOpenChange={(next) => {
          if (!next) tour.stop();
        }}
        autoStart={false}
        data-testid="daily-grid-tour"
      />
    </div>
  );
}
