"use client";

import { cn } from "@/lib/utils";
import type { DuelCard } from "@/types";
import { motion } from "motion/react";
import { ResultNumber } from "./result-number";

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
    <button
      type="button"
      data-testid={`duel-card-${side}`}
      onClick={isInteractive ? onClick : undefined}
      disabled={!isInteractive}
      aria-pressed={selected}
      aria-label={`Select ${card.player_name}, ${card.duration_years}-year peak, ${card.start_season}${card.start_season !== card.end_season ? ` to ${card.end_season}` : ""}`}
      className={cn(
        "relative w-full rounded-xl border-2 p-6 text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
        /* THE WHOLE CARD IS THE TARGET, so it gets the larger of the two lift
           steps plus the press. `whileTap={{ scale: 0.98 }}` used to be the
           only half of this that existed -- a card that sank on click and did
           nothing on hover, which reads as unresponsive rather than as
           restrained. `.pk-lift-lg` needs `.pk-lift`'s transition, which is
           why both are named.

           The Tailwind `transition-[...]` utility that used to live here is
           gone deliberately: Tailwind v4 emits utilities inside `@layer`, and
           the `.pk-*` primitives are unlayered, so an unlayered
           `transition-property` always wins the cascade. Keeping the utility
           would have looked like a transition and been dead. */
        isInteractive && "pk-lift pk-lift-lg pk-press cursor-pointer",
        // Default state
        !selected && !revealed && "border-[var(--border-default)] bg-[var(--bg-elevated)] hover:border-[var(--border-emphasis)] hover:bg-[var(--bg-surface)]",
        // Selected (before reveal)
        selected && !revealed && "border-[var(--peak-accent)] bg-[var(--peak-accent-bg)]",
        // Revealed — winner
        revealed && isWinner && "border-[var(--correct)] bg-[var(--correct-bg)]",
        // Revealed — loser
        revealed && !isWinner && "border-[var(--border-subtle)] bg-[var(--bg-elevated)] opacity-60",
      )}
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

      {/*
        Score reveal, in space the card ALREADY OCCUPIES.

        This block used to mount only once `revealed`, so both cards grew by
        the height of a 3xl number plus its caption the instant a player chose
        -- 72px of document growth, measured. The stage slot below reserves its
        own height, so that growth was the last thing still moving the page.

        The reservation lives on the card rather than on a wrapper because the
        cards are a 2-column grid: reserving on only one of them would make the
        pair different heights before the reveal.
      */}
      <div className="mt-5 h-[3.75rem]" aria-hidden={!revealed || primeScore === undefined}>
      {revealed && primeScore !== undefined && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
        >
          {/* The number the whole duel was about — it counts to itself rather
              than appearing already-final. `ResultNumber` starts the tween in
              a layout effect, so the reserved 3.75rem block above never sees a
              zero frame and the accessible text is the real score from the
              first paint. */}
          <p
            className={cn(
              "text-3xl font-bold font-display",
              isWinner ? "text-[var(--correct)]" : "text-[var(--text-secondary)]"
            )}
          >
            <ResultNumber value={primeScore} precision={1} />
          </p>
          {/* WAS `--text-muted`. Two 3xl numbers side by side mean nothing
              without the two words that say what they are. */}
          <p className="text-xs font-medium text-[var(--text-secondary)]">Prime Score</p>
        </motion.div>
      )}
      </div>

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
    </button>
  );
}
