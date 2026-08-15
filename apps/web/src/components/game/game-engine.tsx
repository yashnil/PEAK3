"use client";

import { useReducer, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { GameMode, Duel } from "@/types";
import {
  gameReducer,
  createInitialState,
  currentDuel,
  isComplete,
} from "@/lib/game-state";
import { submitAnswer } from "@/lib/api";
import { getProgressRepository } from "@/lib/progress";
// Deep import rather than the `@/components/ui` barrel — see the note in
// `result-number.tsx`. The barrel reaches `lucide-react` through `ThemeToggle`
// and costs this route ~74 kB of First Load JS for one number component.
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { DuelCardComponent } from "./duel-card";
import { RevealPanel } from "./reveal-panel";
import { ChallengeSummary } from "./challenge-summary";

interface GameEngineProps {
  mode: GameMode;
  years: number;
  duels: Duel[];
  session_token: string;
  date?: string;
  seed?: number;
  onComplete?: () => void;
}

export function GameEngine({
  mode,
  years,
  duels,
  session_token,
  date,
  seed,
  onComplete,
}: GameEngineProps) {
  const [state, dispatch] = useReducer(
    gameReducer,
    { mode, years, duels, session_token, date, seed },
    ({ mode, years, duels, session_token, date, seed }) =>
      createInitialState(mode, years, duels, session_token, { date, seed })
  );

  const startTimeRef = useRef<number | null>(null);
  const repo = useRef(getProgressRepository());

  // Start timer when a duel becomes active
  useEffect(() => {
    if (state.phase === "picking") {
      startTimeRef.current = Date.now();
    }
  }, [state.phase, state.current_index]);

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const duel = currentDuel(state);
      if (!duel) return;

      if (state.phase === "picking") {
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
          e.preventDefault();
          handleSelect(duel.left.peak_id);
        } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
          e.preventDefault();
          handleSelect(duel.right.peak_id);
        }
      } else if (state.phase === "revealing") {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          dispatch({ type: "ADVANCE" });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Save daily completion on finish
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isComplete(state) && mode === "daily" && date) {
      repo.current.recordDailyCompletion(date, years, state.results);
      onComplete?.();
    }
    if (isComplete(state) && mode === "endless") {
      repo.current.updateEndlessScore(state.total_arena_points, state.best_streak);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]); // intentionally narrow: fires exactly once per phase transition

  const handleSelect = useCallback(
    async (peakId: string) => {
      if (state.phase !== "picking" || state.is_submitting) return;
      const duel = currentDuel(state);
      if (!duel) return;

      // Validate selection
      if (peakId !== duel.left.peak_id && peakId !== duel.right.peak_id) return;

      dispatch({ type: "SELECT_PEAK", peak_id: peakId });
      dispatch({ type: "SUBMIT_START" });

      const elapsed_ms = startTimeRef.current
        ? Math.max(0, Date.now() - startTimeRef.current)
        : 5000;

      try {
        const answer = await submitAnswer({
          session_token: state.session_token,
          duel_id: duel.id,
          selected_peak_id: peakId,
          elapsed_ms,
          current_streak: state.current_streak,
        });
        dispatch({ type: "SUBMIT_SUCCESS", answer, elapsed_ms });
        repo.current.recordAnswer(answer.correct);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to submit answer";
        dispatch({ type: "SUBMIT_ERROR", error: message });
      }
    },
    [state]
  );

  const duel = currentDuel(state);

  if (isComplete(state)) {
    return (
      <ChallengeSummary
        state={state}
        date={date}
      />
    );
  }

  if (!duel) return null;

  const leftSelected = state.selected_peak_id === duel.left.peak_id;
  const rightSelected = state.selected_peak_id === duel.right.peak_id;
  const revealed = state.phase === "revealing";
  const winnerId = state.current_answer?.winning_peak_id;

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      {/* Progress + score bar */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {mode === "daily" && (
            <>
              <p className="text-[var(--text-secondary)]">
                {state.current_index + 1} / {duels.length}
              </p>
              <div
                className="h-1 w-24 rounded-full bg-[var(--border-subtle)] overflow-hidden"
                role="progressbar"
                aria-valuenow={state.current_index + 1}
                aria-valuemin={1}
                aria-valuemax={duels.length}
              >
                <motion.div
                  className="h-full rounded-full bg-[var(--peak-accent)]"
                  animate={{ width: `${((state.current_index + 1) / duels.length) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs">
          {state.current_streak > 0 && (
            <span className="text-[var(--peak-accent-text)] font-semibold">
              🔥 {state.current_streak}
            </span>
          )}
          {/* The running total RESOLVES every time an answer lands, so it
              tweens to its new value rather than jumping. `AnimatedNumber`
              (not `ResultNumber`) on purpose: this figure is already on screen
              before the first answer, and a HUD that counts up from zero on
              mount would be announcing a result that has not happened yet.
              `.pk-counting` lights the digits only while they resolve. */}
          <span className="font-semibold text-[var(--text-primary)]">
            <AnimatedNumber
              value={state.total_arena_points}
              className="pk-counting"
              format={(n) => Math.round(n).toLocaleString()}
            />{" "}
            pts
          </span>
        </div>
      </div>

      {/* Duel type label */}
      <div className="text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
          Peak Duel · {duel.left.duration_years}-Year Window
        </p>
      </div>

      {/*
        CARDS AND RESULT SHARE ONE GRID CELL.

        WHY A GRID STACK RATHER THAN `position: absolute`. The result has always
        overlaid the cards rather than stacking below them, so that the cards do
        not move and the window does not scroll when an answer lands — that part
        is right and is unchanged. But it was overlaid with `absolute inset-0`,
        which pins the panel to the CARDS' box: an absolutely positioned child
        contributes nothing to its parent's height, so the panel was squeezed
        into whatever the cards happened to occupy and the remainder was hidden
        behind `overflow-y-auto`.

        MEASURED at 1440x900: cards 257px, panel 510px — 253px of the result
        pushed into a nested scrollbar, inside a viewport with ~460px of unused
        space below the stage. At 1728x1000 it was 269px. So the player was
        scrolling a 600px-wide panel to reach the rest of a comparison and the
        "Next duel" button, on a screen that had ample room for both.

        Two children in the same `grid-area` overlap exactly as `absolute` did,
        but the row is sized to the TALLER of them. The stage is therefore the
        cards' height while choosing and the result's height while revealing,
        the cards keep their position either way, and nothing is ever clipped.
      */}
      <div className="grid">
      <AnimatePresence mode="wait">
        <motion.div
          key={duel.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
          style={{ gridArea: "1 / 1" }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 self-start"
        >
          <DuelCardComponent
            card={duel.left}
            side="left"
            selected={leftSelected}
            revealed={revealed}
            isWinner={revealed && winnerId === duel.left.peak_id}
            primeScore={
              revealed ? state.current_answer?.winner.player_id === duel.left.player_slug
                ? state.current_answer?.winner.prime_score
                : state.current_answer?.loser.prime_score
              : undefined
            }
            onClick={() => handleSelect(duel.left.peak_id)}
            disabled={state.is_submitting || revealed}
          />
          <DuelCardComponent
            card={duel.right}
            side="right"
            selected={rightSelected}
            revealed={revealed}
            isWinner={revealed && winnerId === duel.right.peak_id}
            primeScore={
              revealed ? state.current_answer?.winner.player_id === duel.right.player_slug
                ? state.current_answer?.winner.prime_score
                : state.current_answer?.loser.prime_score
              : undefined
            }
            onClick={() => handleSelect(duel.right.peak_id)}
            disabled={state.is_submitting || revealed}
          />
        </motion.div>
      </AnimatePresence>

      {/* Reveal panel — the same grid cell as the cards, so it covers them
          and sizes the stage rather than being clipped to them. No
          `overflow-y-auto`: a result that needs an internal scrollbar on a
          desktop viewport is a layout bug, not a scrolling surface. */}
      {revealed && state.current_answer && (
        <div
          style={{ gridArea: "1 / 1" }}
          className="z-10 rounded-xl bg-[var(--bg-base)]"
        >
          <RevealPanel
            answer={state.current_answer}
            arenaPoints={state.total_arena_points}
            streak={state.current_streak}
            onNext={() => dispatch({ type: "ADVANCE" })}
            isLast={state.current_index === duels.length - 1}
          />
        </div>
      )}
      </div>

      {/*
        THE DUEL STAGE SLOT — a fixed strip for the transient one-liners.

        WHAT MOVED THE PAGE, measured rather than assumed. Two independent
        causes, and fixing either alone left visible movement:

          1. `autoFocus` on the reveal panel's "Next duel" button. focus()
             without options lets the browser scroll the element into view:
             603px on a click, 626px on a keypress. Fixed in reveal-panel.tsx
             with `focus({ preventScroll: true })`, which keeps the keyboard
             contract and the aria-live announcement intact.
          2. Layout growth. The hint unmounted, the ~547px panel mounted below
             the cards, and each card grew by the height of its revealed score
             -- 72px of that was the cards alone.

        The panel now OVERLAYS the cards (above) instead of stacking under
        them, so the stage is the same size with a result showing as without,
        and "Next duel" stays where the cards were rather than below the fold.
        A first attempt reserved 576px beneath the cards instead; it held the
        page still but pushed the primary action to y=954 on a 900px viewport,
        which traded a jump for a scroll.

        This strip keeps the remaining one-line states (hint / "Checking…" /
        error) in fixed space so they cannot resize the page either.

        COLLAPSED WHILE REVEALING. None of the three lines below ever render
        during "revealing" -- the hint is `!revealed`-gated, "Checking…" is
        `is_submitting`-gated (already false by the time an answer lands),
        and `error` is reset to null on every successful submit (see
        `SUBMIT_SUCCESS` in game-state.ts). Reserving `h-12` (48px) anyway
        was 48px of real vertical margin the reveal panel's own content --
        specifically "Next duel", the last thing in it -- could have had
        against the viewport's bottom edge and did not: measured with the
        panel's natural height varying by a few px with duel content (a
        longer explanation line-wraps, a wider score gap, etc.), the button
        sat as close as 4px from the default 720px-tall viewport's edge on
        some duels. That is inside Playwright's own "fully in view" margin
        on some runs and not others, so `.click()` would sometimes scroll a
        few px to bring it fully into view before clicking -- a real,
        Playwright-driven scroll, not a rendering bug, but the exact
        intermittent few-px `scrollY` drift duel-viewport.spec.ts caught.
        Giving the panel back this dead space removes the near-miss instead
        of chasing the scroll it was intermittently triggering.
      */}
      <div
        data-testid="duel-stage-slot"
        className={`relative overflow-hidden ${revealed ? "h-0" : "h-12"}`}
      >
        {/* Keyboard hint */}
        {!revealed && !state.is_submitting && (
          <p className="absolute inset-x-0 top-0 text-center text-[10px] text-[var(--text-muted)]">
            Use{" "}
            <kbd className="rounded border border-[var(--border-subtle)] px-1 font-mono">←</kbd>{" "}
            <kbd className="rounded border border-[var(--border-subtle)] px-1 font-mono">A</kbd>{" "}
            or{" "}
            <kbd className="rounded border border-[var(--border-subtle)] px-1 font-mono">→</kbd>{" "}
            <kbd className="rounded border border-[var(--border-subtle)] px-1 font-mono">D</kbd>{" "}
            to choose
          </p>
        )}

        {/* Submitting indicator */}
        {state.is_submitting && (
          <p className="absolute inset-x-0 top-0 text-center text-[10px] text-[var(--text-muted)] animate-pulse" role="status">
            Checking…
          </p>
        )}

        {/* Error */}
        {state.error && !state.is_submitting && (
          <div
            role="alert"
            className="absolute inset-x-0 top-5 rounded-lg bg-[var(--incorrect-bg)] border border-[var(--incorrect)] p-3 text-sm text-[var(--incorrect)]"
          >
            {state.error} — tap a player to try again.
          </div>
        )}

      </div>
    </div>
  );
}
