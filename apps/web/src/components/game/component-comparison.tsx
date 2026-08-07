"use client";

import { motion } from "motion/react";
import { cn, componentLabel, componentColor, componentTextColor } from "@/lib/utils";
import type { AnswerResponse } from "@/types";

const COMPONENT_KEYS = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
] as const;

interface ComponentComparisonProps {
  answer: AnswerResponse;
}

export function ComponentComparison({ answer }: ComponentComparisonProps) {
  const { winner, loser, component_comparison } = answer;

  return (
    <div className="space-y-3" role="region" aria-label="Component comparison">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 pb-1">
        <p className="text-xs font-semibold text-[var(--correct)] text-right truncate">
          {winner.player_name}
        </p>
        {/* WAS 10px `--text-muted`. It names the column between two player
            names; 11px secondary is the same restraint at a size that can
            actually be read. The `w-28` is unchanged, so nothing reflows. */}
        <p className="text-[11px] font-semibold text-[var(--text-secondary)] text-center uppercase tracking-wider w-28">
          Component
        </p>
        {/* WAS `--text-muted`. This is a player's NAME. The loser being quieter
            than the winner is right; being the same tier as a caption is not. */}
        <p className="text-xs font-semibold text-[var(--text-secondary)] truncate">
          {loser.player_name}
        </p>
      </div>

      {COMPONENT_KEYS.map((key, i) => {
        const comp = component_comparison[key];
        if (!comp) return null;
        const max = Math.max(Math.abs(comp.winner), Math.abs(comp.loser), 1);
        const winnerPct = (comp.winner / max) * 100;
        const loserPct = (comp.loser / max) * 100;
        const color = componentColor(key);
        const textColor = componentTextColor(key);
        const isDecisive = Math.abs(comp.winner - comp.loser) > 2;

        return (
          <motion.div
            key={key}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: i * 0.06 }}
            className={cn(
              "grid grid-cols-[1fr_auto_1fr] items-center gap-2",
              isDecisive && "rounded-md bg-[var(--bg-surface)] p-1"
            )}
          >
            {/* Winner bar */}
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs font-mono text-[var(--text-secondary)]">
                {comp.winner.toFixed(1)}
              </span>
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${winnerPct}%`,
                    backgroundColor: comp.winner_leads ? color : "var(--text-muted)",
                  }}
                />
              </div>
            </div>

            {/* Label */}
            {/* The non-decisive tier WAS `--text-muted`. A component's name is
                the only thing that says what the two bars beside it measure —
                a row nobody can read is not a quiet row, it is a missing one.
                The decisive/non-decisive distinction is preserved, it is just
                expressed between "lane colour" and "secondary" now instead of
                between "lane colour" and "barely there". */}
            <p
              className="text-[10px] font-medium text-center w-28 leading-tight"
              style={{ color: isDecisive ? textColor : "var(--text-secondary)" }}
            >
              {componentLabel(key)}
            </p>

            {/* Loser bar */}
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${loserPct}%`,
                    backgroundColor: !comp.winner_leads ? color : "var(--text-muted)",
                  }}
                />
              </div>
              <span className="text-xs font-mono text-[var(--text-secondary)]">
                {comp.loser.toFixed(1)}
              </span>
            </div>
          </motion.div>
        );
      })}

      {/* Teammate adjustment row */}
      {component_comparison["teammate_adjustment"] && (
        <div className="pt-1 border-t border-[var(--border-subtle)]">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs text-[var(--text-muted)]">
            {/* The two NUMBERS move up a tier; the label stays muted. This row
                is deliberately the quietest thing in the breakdown, but a
                figure a reader might want to compare is not the part to make
                unreadable. */}
            <p className="text-right font-mono text-[var(--text-secondary)]">
              {component_comparison["teammate_adjustment"].winner.toFixed(2)}
            </p>
            <p className="text-center w-28">Teammate Adj.</p>
            <p className="font-mono text-[var(--text-secondary)]">
              {component_comparison["teammate_adjustment"].loser.toFixed(2)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
