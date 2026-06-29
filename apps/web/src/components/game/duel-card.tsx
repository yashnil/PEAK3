"use client";

import { cn } from "@/lib/utils";
import type { DuelCard } from "@/types";
import { motion } from "motion/react";

interface DuelCardProps {
  card: DuelCard;
  side: "left" | "right";
  selected: boolean;
  revealed: boolean;
  isWinner?: boolean;
  primeScore?: number;
  onClick?: () => void;
  disabled?: boolean;
}

export function DuelCardComponent({
  card,
  side,
  selected,
  revealed,
  isWinner,
  primeScore,
  onClick,
  disabled,
}: DuelCardProps) {
  const isInteractive = !revealed && !disabled;

  return (
    <motion.button
      type="button"
      onClick={isInteractive ? onClick : undefined}
      disabled={!isInteractive}
      aria-pressed={selected}
      aria-label={`Select ${card.player_name}, ${card.duration_years}-year peak, ${card.start_season}${card.start_season !== card.end_season ? ` to ${card.end_season}` : ""}`}
      className={cn(
        "relative w-full rounded-xl border-2 p-6 text-left transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
        isInteractive && "cursor-pointer",
        // Default state
        !selected && !revealed && "border-[var(--border-default)] bg-[var(--bg-elevated)] hover:border-[var(--border-emphasis)] hover:bg-[var(--bg-surface)]",
        // Selected (before reveal)
        selected && !revealed && "border-[var(--peak-accent)] bg-[var(--peak-accent-bg)]",
        // Revealed — winner
        revealed && isWinner && "border-[var(--correct)] bg-[var(--correct-bg)]",
        // Revealed — loser
        revealed && !isWinner && "border-[var(--border-subtle)] bg-[var(--bg-elevated)] opacity-60",
      )}
      whileTap={isInteractive ? { scale: 0.98 } : undefined}
    >
      {/* Side label */}
      <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
        {side === "left" ? "Player A" : "Player B"}
      </p>

      {/* Player name */}
      <div className="mb-4">
        <h3 className="font-display text-2xl font-bold leading-tight text-[var(--text-primary)] sm:text-3xl">
          {card.player_name}
        </h3>
      </div>

      {/* Window info */}
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--text-secondary)]">
          {card.duration_years}-year peak
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {card.start_season === card.end_season
            ? card.start_season
            : `${card.start_season} — ${card.end_season}`}
        </p>
      </div>

      {/* Score reveal */}
      {revealed && primeScore !== undefined && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="mt-5"
        >
          <p
            className={cn(
              "text-3xl font-bold score-number font-display",
              isWinner ? "text-[var(--correct)]" : "text-[var(--text-muted)]"
            )}
          >
            {primeScore.toFixed(1)}
          </p>
          <p className="text-xs text-[var(--text-muted)]">Prime Score</p>
        </motion.div>
      )}

      {/* Winner badge */}
      {revealed && isWinner && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.3 }}
          className="absolute top-4 right-4 rounded-full bg-[var(--correct)] px-2 py-0.5 text-[10px] font-bold text-white"
          aria-label="Winner"
        >
          ✓ Winner
        </motion.div>
      )}

      {/* Correct selection marker */}
      {revealed && selected && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute bottom-4 right-4 text-xs text-[var(--text-muted)]"
        >
          ← your pick
        </motion.div>
      )}
    </motion.button>
  );
}
