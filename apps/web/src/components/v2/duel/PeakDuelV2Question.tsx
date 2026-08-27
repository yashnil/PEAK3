"use client";

/**
 * PeakDuelV2Question — the confrontation screen (Pass 3, product-direction).
 *
 * Verified against the reference (`.claude-private/design/
 * PEAK3-Directions-E.pdf`, E2 page 21): stable LEFT/RIGHT player identity,
 * a center confrontation column, subtle opposing ambient washes (`pair=
 * "cool"`/`"warm"` — Pass 2.5's one deliberate exception to the single-light
 * rule), extremely little clutter, session progress as a compact dash row.
 *
 * OWNS NO TIMING. `deadlineAt`/`onSelect`/`onTimeout` are the exact same
 * values `GameEngine` already computes for the legacy tree — this component
 * renders a second, V2-styled READOUT of the same deadline
 * (`useRemainingSeconds`, the identical shared tick `ArenaTimer` itself
 * uses) while the real `ArenaTimer` still runs, visually hidden, so the one
 * real expiry effect (`onExpire` → `handleTimeout` → the server-scored
 * no-pick) fires exactly once, from exactly one place, same as legacy.
 */

import { useEffect, useState } from "react";
import ArenaTimer, { useRemainingSeconds } from "@/components/shared/ArenaTimer";
import PeakV2ArenaLight from "../PeakV2ArenaLight";
import PeakV2LiveHeader from "../PeakV2LiveHeader";
import PeakV2GameStatus from "../PeakV2GameStatus";
import { v2ActionBaseStyle } from "../v2-action-base";
import { DECISION_CLOCK_SECONDS } from "@/lib/peak-duel-constants";
import type { Duel, DuelResult } from "@/types";

/** The raw (fractional) seconds left on the deadline, ticked at the same
 *  250ms cadence as `ArenaTimer`'s own interval — a display-only derivative
 *  of the same authoritative deadline, never a second timing source. */
function useFractionalSecondsRemaining(deadlineAt: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (deadlineAt === null) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, (deadlineAt - performance.now()) / 1000));
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [deadlineAt]);
  return remaining;
}

function ProgressDashes({ results, total, currentIndex }: { results: DuelResult[]; total: number; currentIndex: number }) {
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => {
        const result = results[i];
        const color =
          result === undefined
            ? i === currentIndex
              ? "var(--v2-color-accent)"
              : "var(--v2-border)"
            : result.correct
              ? "var(--v2-color-positive)"
              : "var(--v2-color-negative)";
        return <span key={i} style={{ width: 14, height: 3, borderRadius: 1, background: color }} />;
      })}
    </div>
  );
}

function DuelSidePanel({
  side,
  card,
  selected,
  disabled,
  onChoose,
}: {
  side: "left" | "right";
  card: Duel["left"];
  selected: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`duel-card-${side}`}
      onClick={disabled ? undefined : onChoose}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`Select ${card.player_name}, ${card.duration_years}-year peak, ${card.start_season}${card.start_season !== card.end_season ? ` to ${card.end_season}` : ""}`}
      className={`relative flex w-full flex-col items-start gap-4 p-2 text-left transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed ${
        side === "right" ? "sm:items-end sm:text-right" : ""
      }`}
      style={{ opacity: selected ? 1 : 0.92 }}
    >
      <span
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontSize: "0.6875rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--v2-text-muted)",
        }}
      >
        {side === "left" ? "Left · ← or A" : "Right · → or D"}
      </span>
      {/* Built inline rather than via `PeakV2PlayerIdentity` (which takes a
          single fixed `align`): the right panel needs to stay LEFT-aligned
          in the mobile single-column stack — a deliberate mobile
          composition, not the desktop's right-flush text shrunk in place —
          and only flip to right-aligned at `sm:` and up. */}
      <div className={`flex flex-col ${side === "right" ? "sm:items-end" : ""}`}>
        <span
          style={{
            fontFamily: "var(--v2-font-ui)",
            fontWeight: 700,
            fontSize: "1.25rem",
            letterSpacing: "-0.006em",
            color: selected ? "var(--v2-color-accent)" : "var(--v2-text-primary)",
          }}
        >
          {card.player_name}
        </span>
        <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}>
          {card.start_season === card.end_season ? card.start_season : `${card.start_season} to ${card.end_season}`} · {card.duration_years}-year
        </span>
      </div>
      {/* A visual echo of the real action, not a second interactive element
          — the whole panel above is already the real `<button>`, and a
          `<button>` nested inside a `<button>` is invalid HTML. */}
      <span aria-hidden="true" style={{ ...v2ActionBaseStyle("sm"), border: "1px solid var(--v2-border)", color: "var(--v2-text-secondary)" }}>
        Choose {card.player_name.split(" ").slice(-1)[0]}
      </span>
    </button>
  );
}

export interface PeakDuelV2QuestionProps {
  mode: "daily" | "endless";
  duel: Duel;
  results: DuelResult[];
  totalDuels: number;
  currentIndex: number;
  selectedPeakId: string | null;
  submitting: boolean;
  deadlineAt: number | null;
  totalArenaPoints: number;
  currentStreak: number;
  onSelect: (peakId: string) => void;
  onTimeout: () => void;
}

export default function PeakDuelV2Question({
  mode,
  duel,
  results,
  totalDuels,
  currentIndex,
  selectedPeakId,
  submitting,
  deadlineAt,
  totalArenaPoints,
  currentStreak,
  onSelect,
  onTimeout,
}: PeakDuelV2QuestionProps) {
  const fractionalRemaining = useFractionalSecondsRemaining(deadlineAt);
  const remaining = useRemainingSeconds(deadlineAt);

  return (
    <div className="relative">
      {mode === "daily" ? (
        <>
          <PeakV2ArenaLight pair="cool" y="-10%" />
          <PeakV2ArenaLight pair="warm" y="-10%" />
        </>
      ) : null}

      {/* Real timing/expiry authority, visually hidden — the one place
          `onExpire` actually fires. See module docstring. */}
      {mode === "daily" ? (
        <div className="sr-only">
          <ArenaTimer
            deadlineAt={deadlineAt}
            totalSeconds={DECISION_CLOCK_SECONDS}
            label="Time to decide"
            onExpire={onTimeout}
            yours
            testId="peak-duel-decision-clock"
          />
        </div>
      ) : null}

      <div className="relative">
        <PeakV2LiveHeader
          as="h1"
          title={mode === "daily" ? "Peak Duel · Daily" : "Peak Duel · Endless"}
          status={<PeakV2GameStatus label={mode === "daily" ? `${currentIndex + 1} of ${totalDuels}` : "Endless"} state="active" />}
          instrument={
            <div className="flex items-center gap-4">
              {currentStreak > 0 ? (
                <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.8125rem", fontWeight: 700, color: "var(--v2-color-accent)" }}>
                  🔥 {currentStreak}
                </span>
              ) : null}
              <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.8125rem", fontWeight: 700, color: "var(--v2-text-primary)" }}>
                {totalArenaPoints.toLocaleString()} pts
              </span>
            </div>
          }
        />
        {mode === "daily" ? (
          <div className="mt-3">
            <ProgressDashes results={results} total={totalDuels} currentIndex={currentIndex} />
          </div>
        ) : null}

        <div className="mt-10 grid grid-cols-1 items-center gap-8 sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
          <DuelSidePanel
            side="left"
            card={duel.left}
            selected={selectedPeakId === duel.left.peak_id}
            disabled={submitting}
            onChoose={() => onSelect(duel.left.peak_id)}
          />

          <div className="flex flex-col items-center gap-2 py-2">
            <span
              style={{
                fontFamily: "var(--v2-font-ui)",
                fontSize: "0.6875rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--v2-text-muted)",
              }}
            >
              Higher peak?
            </span>
            {mode === "daily" && remaining !== null ? (
              <span className="flex items-baseline gap-1">
                <span
                  data-testid="peak-duel-v2-clock"
                  style={{
                    fontFamily: "var(--v2-font-mono)",
                    fontVariantNumeric: "tabular-nums",
                    fontSize: "2.5rem",
                    fontWeight: 700,
                    lineHeight: 1,
                    color: remaining <= 2 ? "var(--v2-color-negative)" : "var(--v2-color-accent)",
                  }}
                >
                  {(fractionalRemaining ?? remaining).toFixed(1)}
                </span>
                {/* Disambiguates the countdown from a score reveal — same
                    face/size as a `prime_score` readout otherwise, on the
                    single most gameplay-critical screen in the product. */}
                <span
                  aria-hidden="true"
                  style={{
                    fontFamily: "var(--v2-font-ui)",
                    fontSize: "0.625rem",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--v2-text-muted)",
                  }}
                >
                  sec
                </span>
              </span>
            ) : (
              <span style={{ fontFamily: "var(--v2-font-display)", fontStyle: "italic", fontSize: "1.5rem", color: "var(--v2-text-secondary)" }}>
                vs
              </span>
            )}
          </div>

          <DuelSidePanel
            side="right"
            card={duel.right}
            selected={selectedPeakId === duel.right.peak_id}
            disabled={submitting}
            onChoose={() => onSelect(duel.right.peak_id)}
          />
        </div>
      </div>
    </div>
  );
}
