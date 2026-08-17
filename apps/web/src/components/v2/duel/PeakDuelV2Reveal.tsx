"use client";

/**
 * PeakDuelV2Reveal — the intermediate result (Pass 3, product-direction).
 *
 * Verified against the reference (E2 page 22): same LEFT/RIGHT identities as
 * the question that produced this result, a center verdict column (points
 * awarded, difficulty/gap, streak/session total), five dot-on-line component
 * lanes (`PeakV2DataLane`, Pass 2.5's grammar) in FIXED left/right position —
 * never resorted by winner/loser — and one real server-generated explanation
 * line. Rounds 1-9 auto-advance from `GameEngine`'s own existing effect
 * (~1.2-1.5s); this component only renders the manual `onNext` control, the
 * same dispatched action legacy's `RevealPanel` already uses.
 */

import PeakV2LiveHeader from "../PeakV2LiveHeader";
import PeakV2GameStatus from "../PeakV2GameStatus";
import PeakV2PlayerIdentity from "../PeakV2PlayerIdentity";
import PeakV2Score from "../PeakV2Score";
import PeakV2DataLane from "../PeakV2DataLane";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import { RANKING_COMPONENT_ORDER, RANKING_COMPONENT_TONE, RANKING_COMPONENT_LABEL } from "@/lib/v2-component-map";
import type { AnswerResponse, Duel } from "@/types";

export interface PeakDuelV2RevealProps {
  mode: "daily" | "endless";
  duel: Duel;
  answer: AnswerResponse;
  currentIndex: number;
  totalDuels: number;
  totalArenaPoints: number;
  currentStreak: number;
  isLast: boolean;
  onNext: () => void;
}

export default function PeakDuelV2Reveal({
  mode,
  duel,
  answer,
  currentIndex,
  totalDuels,
  totalArenaPoints,
  currentStreak,
  isLast,
  onNext,
}: PeakDuelV2RevealProps) {
  // FIXED left/right identity — never resorted by winner/loser. `winner`/
  // `loser` on `AnswerResponse` are PeakWindow objects; map each back onto
  // whichever real side (left/right) it actually is via `winning_peak_id`,
  // the exact same comparison `GameEngine`'s own legacy JSX already makes.
  const winnerIsLeft = answer.winning_peak_id === duel.left.peak_id;
  const leftWindow = winnerIsLeft ? answer.winner : answer.loser;
  const rightWindow = winnerIsLeft ? answer.loser : answer.winner;
  const leftCorrect = winnerIsLeft;

  return (
    <div>
      <PeakV2LiveHeader
        as="h1"
        title={mode === "daily" ? "Peak Duel · Daily" : "Peak Duel · Endless"}
        status={<PeakV2GameStatus label={mode === "daily" ? `${currentIndex + 1} of ${totalDuels}` : "Endless"} state="idle" />}
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

      <div className="mt-8 grid grid-cols-1 items-start gap-6 sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
        <div className="flex flex-col items-start gap-1.5 text-left">
          <span
            style={{
              fontFamily: "var(--v2-font-mono)",
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: leftCorrect ? "var(--v2-color-positive)" : "var(--v2-text-muted)",
            }}
          >
            {leftCorrect ? "Your pick · correct" : "Still left"}
          </span>
          <PeakV2PlayerIdentity name={duel.left.player_name} align="start" size="lg" state={leftCorrect ? "current" : "default"} />
          <PeakV2Score value={leftWindow.prime_score.toFixed(1)} tone={leftCorrect ? "positive" : "neutral"} size="lg" />
        </div>

        <div className="flex flex-col items-center gap-1 py-2 text-center">
          {answer.correct ? (
            <PeakV2Score value={`+${Math.round(answer.arena_points_awarded)}`} tone="accent" size="md" />
          ) : (
            <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "1.125rem", fontWeight: 700, color: "var(--v2-color-negative)" }}>
              +0
            </span>
          )}
          <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>
            {answer.difficulty} · gap {answer.score_gap.toFixed(1)}
          </span>
        </div>

        <div className="flex flex-col items-start gap-1.5 text-left sm:items-end sm:text-right">
          <span
            style={{
              fontFamily: "var(--v2-font-mono)",
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: !leftCorrect ? "var(--v2-color-positive)" : "var(--v2-text-muted)",
            }}
          >
            {!leftCorrect ? "Your pick · correct" : "Still right"}
          </span>
          {/* Inline rather than `PeakV2PlayerIdentity` (fixed `align`, no
              responsive variant) — mobile stays left-aligned like every
              other row on this screen; only `sm:` flips to right-flush. */}
          <span
            style={{
              fontFamily: "var(--v2-font-ui)",
              fontWeight: 700,
              fontSize: "1.25rem",
              color: !leftCorrect ? "var(--v2-color-accent)" : "var(--v2-text-primary)",
            }}
          >
            {duel.right.player_name}
          </span>
          <PeakV2Score value={rightWindow.prime_score.toFixed(1)} tone={!leftCorrect ? "positive" : "neutral"} size="lg" />
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {RANKING_COMPONENT_ORDER.map((key) => {
          const comp = answer.component_comparison[key];
          if (!comp) return null;
          const leftValue = winnerIsLeft ? comp.winner : comp.loser;
          const rightValue = winnerIsLeft ? comp.loser : comp.winner;
          const max = Math.max(Math.abs(leftValue), Math.abs(rightValue), 1) * 1.15;
          return (
            <PeakV2DataLane
              key={key}
              label={RANKING_COMPONENT_LABEL[key]}
              tone={RANKING_COMPONENT_TONE[key]}
              leftLabel=""
              leftValue={leftValue.toFixed(1)}
              rightLabel=""
              rightValue={rightValue.toFixed(1)}
              scaleMin={0}
              scaleMax={max}
            />
          );
        })}
      </div>

      <p
        className="mt-6 max-w-[64ch] border-l-2 pl-3 italic"
        style={{ borderColor: "var(--v2-color-accent)", fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}
      >
        {answer.explanation}
      </p>

      <div className="mt-6 flex items-center justify-between gap-3">
        <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
          {isLast ? "Ready when you are." : "Continuing automatically…"}
        </p>
        <PeakV2PrimaryAction onClick={onNext} autoFocus>
          {isLast ? "See results" : "Next duel"}
        </PeakV2PrimaryAction>
      </div>
    </div>
  );
}
