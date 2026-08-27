"use client";

/**
 * PeakDuelV2Stage — the V2 presentation branch for `GameEngine` (Pass 3).
 *
 * Consumes the exact same `state`/`dispatch`/`duel`/`deadlineAt`/handlers
 * `GameEngine` already computes for the legacy tree — this component owns
 * NO reducer, no API call, no timing authority of its own. It only decides
 * which of the three V2 screens (question / intermediate result / cinematic
 * final) the current `state.phase` calls for, mirroring the branch
 * `GameEngine`'s own legacy JSX already makes.
 */

import PeakV2Shell from "../PeakV2Shell";
import PeakDuelV2Question from "./PeakDuelV2Question";
import PeakDuelV2Reveal from "./PeakDuelV2Reveal";
import PeakDuelV2Final from "./PeakDuelV2Final";
import { isComplete, currentDuel } from "@/lib/game-state";
import type { GameState } from "@/types";

export interface PeakDuelV2StageProps {
  state: GameState;
  date?: string;
  deadlineAt: number | null;
  onSelect: (peakId: string) => void;
  onTimeout: () => void;
  onNext: () => void;
}

export default function PeakDuelV2Stage({ state, date, deadlineAt, onSelect, onTimeout, onNext }: PeakDuelV2StageProps) {
  if (isComplete(state)) {
    return (
      <PeakV2Shell width="live">
        <PeakDuelV2Final state={state} date={date} />
      </PeakV2Shell>
    );
  }

  const duel = currentDuel(state);
  if (!duel) return null;

  const revealed = state.phase === "revealing" && state.current_answer;

  return (
    <PeakV2Shell width="live">
      {/* `justify-start`, not `justify-center` (Pass 3's original choice):
          centering re-derives the block's position from its TOTAL height
          every render, so a taller reveal (component lanes, explanation,
          the button — none of which the question has) recentres and moves
          the cards on screen even though nothing scrolled. Top-anchoring
          means the cards' position depends only on the header above them,
          which is the same height in both phases, so it never moves;
          `pt-12` keeps a question landing with some real air above it
          instead of jamming against the nav, matching the amount of breathing
          room `justify-center` gave a typical (short) question at rest. */}
      <div data-testid="duel-stage-slot" className="flex min-h-[calc(100vh-8rem)] flex-col justify-start pt-12 pb-8">
        {revealed && state.current_answer ? (
          <PeakDuelV2Reveal
            mode={state.mode}
            duel={duel}
            answer={state.current_answer}
            selectedPeakId={state.selected_peak_id}
            currentIndex={state.current_index}
            totalDuels={state.duels.length}
            totalArenaPoints={state.total_arena_points}
            currentStreak={state.current_streak}
            isLast={state.current_index === state.duels.length - 1}
            onNext={onNext}
          />
        ) : (
          <PeakDuelV2Question
            mode={state.mode}
            duel={duel}
            results={state.results}
            totalDuels={state.duels.length}
            currentIndex={state.current_index}
            selectedPeakId={state.selected_peak_id}
            submitting={state.is_submitting}
            deadlineAt={deadlineAt}
            totalArenaPoints={state.total_arena_points}
            currentStreak={state.current_streak}
            onSelect={onSelect}
            onTimeout={onTimeout}
          />
        )}
      </div>
    </PeakV2Shell>
  );
}
