"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { CheckCircle, XCircle, ArrowRight } from "lucide-react";
import type { AnswerResponse } from "@/types";
import { ComponentComparison } from "./component-comparison";
import { ResultNumber } from "./result-number";
import { cn, difficultyColor } from "@/lib/utils";

interface RevealPanelProps {
  answer: AnswerResponse;
  arenaPoints: number;
  streak: number;
  onNext: () => void;
  isLast?: boolean;
}

/**
 * The answer, in a readable ORDER.
 *
 * This panel is the payoff of the entire Peak Duel loop and it used to land as
 * one flat block: a semibold 16px "Correct!" the same weight as the sentence
 * under it, a points number, and a rule-of-thumb explanation, all arriving in
 * the same frame. Everything was legible and nothing was FIRST.
 *
 * Two changes, and only two:
 *
 *  1. HIERARCHY. The verdict is now the loudest object on the panel — display
 *     face, 30px, state colour — because whether you were right is the one
 *     fact this surface exists to state. The points and the session total
 *     count up rather than appearing already-final.
 *  2. ORDER. `.pk-reveal` staggers five bands — verdict, running total,
 *     explanation, component breakdown, the control — at the shared
 *     `--pk-stagger` rhythm, so the eye is walked from "did I get it" to "why"
 *     instead of being handed all four at once.
 *
 * THE ORDER IS DECORATION, NOT GATING. Every band is in the DOM, in the
 * accessibility tree, and inside this region's `aria-live` announcement from
 * the first paint; `.pk-reveal` only fades and rises them, and the shared
 * reduced-motion block zeroes both the delay and the movement. The last band's
 * delay is 4 x 55ms = 220ms — a rhythm, not a wait. A player who looks away
 * and back sees a finished result.
 */
export function RevealPanel({
  answer,
  arenaPoints,
  streak,
  onNext,
  isLast,
}: RevealPanelProps) {
  const nextRef = useRef<HTMLButtonElement | null>(null);

  /**
   * Move focus to the next action WITHOUT scrolling.
   *
   * This was `autoFocus`, which is `focus()` with no options, and the browser
   * scrolls a freshly focused element into view. Measured on the endless mode:
   * choosing a player scrolled the window 603px. That is the "page jumps down
   * when I pick" report, and it is not a layout bug at all -- the layout
   * reserves its space (see the stage slot in game-engine.tsx); the browser
   * was chasing the focus ring.
   *
   * `preventScroll: true` keeps the keyboard contract exactly as it was --
   * focus lands on "Next duel", Enter still advances, screen readers still
   * announce the result via the panel's `aria-live` region -- and simply stops
   * the viewport following it.
   */
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      /* `pk-depth-decision` + an accent crown: this is the surface the player
         is looking at and about to act on, so it gets the lit top edge and the
         warmer gradient rather than the flat elevated fill it had. Both
         override `card-elevated`'s background by cascade order (they are
         declared later in globals.css, and neither is inside a Tailwind
         layer), which is why `card-elevated` stays on for its radius. */
      className="card-elevated pk-depth-decision pk-crown pk-crown-accent p-5 space-y-5"
      role="region"
      aria-live="polite"
      aria-label="Answer result"
    >
      {/* Band 1 — the verdict and what it paid. */}
      <div
        className="pk-reveal flex items-start justify-between gap-3"
        style={{ "--pk-reveal-index": 0 } as React.CSSProperties}
      >
        <div className="flex items-center gap-3">
          {answer.correct ? (
            <CheckCircle size={28} className="text-[var(--correct)] shrink-0" aria-hidden="true" />
          ) : (
            <XCircle size={28} className="text-[var(--incorrect)] shrink-0" aria-hidden="true" />
          )}
          <div>
            <p
              className={cn(
                "font-display text-2xl font-extrabold leading-none sm:text-3xl",
                answer.correct ? "text-[var(--correct)]" : "text-[var(--incorrect)]"
              )}
            >
              {answer.correct ? "Correct!" : "Not quite."}
            </p>
            {/* WAS `--text-muted` at 12px. The difficulty band and the raw gap
                are the two facts that say how hard this duel actually was --
                the reason a Photo Finish is worth more than a blowout. That is
                load-bearing, not metadata about the metadata. */}
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              <span className={difficultyColor(answer.difficulty)}>
                {answer.difficulty}
              </span>{" "}
              · gap {answer.score_gap.toFixed(1)} raw pts
            </p>
          </div>
        </div>

        {/* Points + streak */}
        <div className="shrink-0 text-right">
          {answer.correct && (
            <motion.p
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className="font-display text-2xl font-bold text-[var(--peak-accent-text)]"
            >
              <ResultNumber
                value={answer.arena_points_awarded}
                prefix="+"
                format={(n) => Math.round(n).toLocaleString()}
              />
            </motion.p>
          )}
          {/* WAS `--text-muted`. A live streak is a score, not a footnote:
              promoted, and the accent carries the "it is still running" state
              that the flame alone was doing. A reset streak stays quiet. */}
          <p
            className={cn(
              "text-xs font-semibold",
              streak > 0
                ? "text-[var(--peak-accent-text)]"
                : "text-[var(--text-secondary)]"
            )}
          >
            {streak > 0 ? `🔥 ${streak} streak` : "streak reset"}
          </p>
        </div>
      </div>

      {/* Band 2 — the running total. */}
      <div
        className="pk-reveal pk-crown flex items-center justify-between rounded-lg bg-[var(--bg-surface)] px-4 py-2 text-sm"
        style={{ "--pk-reveal-index": 1 } as React.CSSProperties}
      >
        <span className="text-[var(--text-secondary)]">Session total</span>
        <span className="font-display font-bold text-[var(--text-primary)]">
          <ResultNumber
            value={arenaPoints}
            format={(n) => Math.round(n).toLocaleString()}
          />{" "}
          pts
        </span>
      </div>

      {/* Band 3 — why. */}
      <p
        className="pk-reveal text-sm text-[var(--text-secondary)] leading-relaxed italic border-l-2 border-[var(--peak-accent)] pl-3"
        style={{ "--pk-reveal-index": 2 } as React.CSSProperties}
      >
        {answer.explanation}
      </p>

      {/* Band 4 — the component breakdown. The bars themselves are untouched;
          only when the block arrives changed. */}
      <div
        className="pk-reveal"
        style={{ "--pk-reveal-index": 3 } as React.CSSProperties}
      >
        <ComponentComparison answer={answer} />
      </div>

      {/* Band 5 — the control. The one `.pk-sheen` on this screen: it is the
          single thing the player is meant to press next. */}
      <div
        className="pk-reveal space-y-2"
        style={{ "--pk-reveal-index": 4 } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={onNext}
          ref={nextRef}
          className="pk-lift pk-press pk-sheen w-full rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-default)] py-3 text-sm font-semibold text-[var(--text-primary)] flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          {isLast ? "See results" : "Next duel"}
          <ArrowRight size={14} aria-hidden="true" />
        </button>
        {/* Genuinely tertiary: a shortcut hint for a control that is already
            focused and already labelled. Left at `--text-muted` on purpose. */}
        <p className="text-center text-xs text-[var(--text-muted)]">
          Press{" "}
          <kbd className="rounded border border-[var(--border-default)] px-1 py-0.5 font-mono text-[10px]">
            Enter
          </kbd>{" "}
          to continue
        </p>
      </div>
    </motion.div>
  );
}
