"use client";

import { motion } from "motion/react";
import { CheckCircle, XCircle, ArrowRight } from "lucide-react";
import type { AnswerResponse } from "@/types";
import { ComponentComparison } from "./component-comparison";
import { cn, difficultyColor } from "@/lib/utils";

interface RevealPanelProps {
  answer: AnswerResponse;
  arenaPoints: number;
  streak: number;
  onNext: () => void;
  isLast?: boolean;
}

export function RevealPanel({
  answer,
  arenaPoints,
  streak,
  onNext,
  isLast,
}: RevealPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="card-elevated p-5 space-y-5"
      role="region"
      aria-live="polite"
      aria-label="Answer result"
    >
      {/* Result header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {answer.correct ? (
            <CheckCircle size={24} className="text-[var(--correct)] shrink-0" aria-hidden="true" />
          ) : (
            <XCircle size={24} className="text-[var(--incorrect)] shrink-0" aria-hidden="true" />
          )}
          <div>
            <p
              className={cn(
                "font-semibold",
                answer.correct ? "text-[var(--correct)]" : "text-[var(--incorrect)]"
              )}
            >
              {answer.correct ? "Correct!" : "Not quite."}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              <span className={difficultyColor(answer.difficulty)}>
                {answer.difficulty}
              </span>{" "}
              · gap {answer.score_gap.toFixed(1)} raw pts
            </p>
          </div>
        </div>

        {/* Points + streak */}
        <div className="text-right">
          {answer.correct && (
            <motion.p
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className="text-xl font-bold text-[var(--peak-accent)] score-number"
            >
              +{answer.arena_points_awarded.toLocaleString()}
            </motion.p>
          )}
          <p className="text-xs text-[var(--text-muted)]">
            {streak > 0 ? `🔥 ${streak} streak` : "streak reset"}
          </p>
        </div>
      </div>

      {/* Total score */}
      <div className="flex items-center justify-between rounded-lg bg-[var(--bg-surface)] px-4 py-2 text-sm">
        <span className="text-[var(--text-secondary)]">Session total</span>
        <span className="font-bold score-number text-[var(--text-primary)]">
          {arenaPoints.toLocaleString()} pts
        </span>
      </div>

      {/* Explanation */}
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed italic border-l-2 border-[var(--peak-accent)] pl-3">
        {answer.explanation}
      </p>

      {/* Component comparison */}
      <ComponentComparison answer={answer} />

      {/* Next button */}
      <button
        type="button"
        onClick={onNext}
        className="w-full rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-default)] py-3 text-sm font-semibold text-[var(--text-primary)] transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        autoFocus
      >
        {isLast ? "See results" : "Next duel"}
        <ArrowRight size={14} aria-hidden="true" />
      </button>
      <p className="text-center text-xs text-[var(--text-muted)]">
        Press{" "}
        <kbd className="rounded border border-[var(--border-default)] px-1 py-0.5 font-mono text-[10px]">
          Enter
        </kbd>{" "}
        to continue
      </p>
    </motion.div>
  );
}
