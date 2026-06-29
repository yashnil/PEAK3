"use client";

import { motion } from "motion/react";
import { cn, componentLabel, componentColor } from "@/lib/utils";
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
        <p className="text-[10px] text-[var(--text-muted)] text-center uppercase tracking-wider w-28">
          Component
        </p>
        <p className="text-xs font-semibold text-[var(--text-muted)] truncate">
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
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${winnerPct}%`,
                    backgroundColor: comp.winner_leads ? color : "var(--text-muted)",
                  }}
                />
              </div>
            </div>

            {/* Label */}
            <p
              className="text-[10px] font-medium text-center w-28 leading-tight"
              style={{ color: isDecisive ? color : "var(--text-muted)" }}
            >
              {componentLabel(key)}
            </p>

            {/* Loser bar */}
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                <div
                  className="h-full rounded-full transition-all duration-500"
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
            <p className="text-right font-mono">
              {component_comparison["teammate_adjustment"].winner.toFixed(2)}
            </p>
            <p className="text-center w-28">Teammate Adj.</p>
            <p className="font-mono">
              {component_comparison["teammate_adjustment"].loser.toFixed(2)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
