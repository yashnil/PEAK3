"use client";

/**
 * PeakV2RTTBattleResult — the boss result (Pass 3): "large serif 3—2 /
 * Victory over [boss]" then a LIVE five-lane receipt (brief).
 *
 * Verified against the reference (E2 page 17): CINEMATIC scoreline headline
 * (`player_lanes_won`–`opponent_lanes_won`, "Victory over {boss}" in italic
 * gold), then LIVE lane-by-lane `PeakV2DataLane` rows in the engine's own
 * `0-100` lane-rating domain. Reuses `battleVerdict`/`laneColorVar` from
 * `lib/run-the-table-state.ts` — the exact same real fields/helpers
 * `BattleReveal.tsx` already uses, never a second interpretation of
 * `BattlePublic`. `roster_total` renders only as secondary receipt context,
 * per the existing convention (never implying it decided any one lane —
 * `decided_by` describes how the OVERALL battle resolved, not a lane).
 */

import { useEffect } from "react";
import PeakV2CinematicStage from "../PeakV2CinematicStage";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2DisplayEmphasis from "../PeakV2DisplayEmphasis";
import PeakV2Rule from "../PeakV2Rule";
import PeakV2DataLane from "../PeakV2DataLane";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import { battleVerdict } from "@/lib/run-the-table-state";
import type { BattlePublic, BossPublic } from "@/types/run-the-table";
import type { V2ComponentTone } from "../v2-tone";

const LANE_TOKEN_TO_TONE: Record<string, V2ComponentTone> = {
  si: "si",
  tp: "tp",
  rec: "rec",
  po: "po",
  team: "team",
};

export interface PeakV2RTTBattleResultProps {
  battle: BattlePublic;
  boss: BossPublic | null;
  onAdvance: () => void;
  advanceLabel: string;
}

export default function PeakV2RTTBattleResult({ battle, boss, onAdvance, advanceLabel }: PeakV2RTTBattleResultProps) {
  const verdict = battleVerdict(battle);

  // See `PeakV2RTTBossIntro`'s comment: a cinematic surface can be much
  // shorter than the boss-preview screen it follows, so reset scroll on
  // mount rather than leaving this surface's own "Advance" action rendered
  // above a still-scrolled-down viewport.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div data-testid="rtt-battle-reveal">
      <PeakV2CinematicStage light={{ y: "-4%", tone: battle.outcome === "win" ? "positive" : battle.outcome === "loss" ? "negative" : "accent" }}>
        <span
          style={{
            fontFamily: "var(--v2-font-mono)",
            fontSize: "0.6875rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--v2-text-muted)",
          }}
        >
          Lanes won · first to three
        </span>
        <div className="mt-2 flex items-baseline gap-3">
          <span style={{ fontFamily: "var(--v2-font-display)", fontSize: "var(--v2-display-size-hero)", color: "var(--v2-text-primary)" }}>
            {battle.player_lanes_won}
          </span>
          <span style={{ fontFamily: "var(--v2-font-display)", fontSize: "var(--v2-display-size-line)", color: "var(--v2-text-muted)" }}>
            —
          </span>
          <span style={{ fontFamily: "var(--v2-font-display)", fontSize: "var(--v2-display-size-hero)", color: "var(--v2-text-muted)" }}>
            {battle.opponent_lanes_won}
          </span>
        </div>
        <PeakV2ResultHeadline as="h1" scale="moment" className="mt-2">
          {battle.outcome === "win" ? "Victory over " : battle.outcome === "loss" ? "Defeat to " : "Draw with "}
          <PeakV2DisplayEmphasis>{boss?.name ?? "the boss"}</PeakV2DisplayEmphasis>
        </PeakV2ResultHeadline>
        <p className="mt-2" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}>
          {verdict.detail}
        </p>
      </PeakV2CinematicStage>

      <PeakV2Rule spacing="md" />

      <div>
        <div className="mb-4 flex items-center justify-between">
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
            Lane resolution
          </span>
          <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>
            Engine lane rating 0-100
          </span>
        </div>
        <div className="flex flex-col gap-4">
          {battle.lanes.map((lane) => (
            <PeakV2DataLane
              key={lane.lane}
              label={lane.label}
              tone={LANE_TOKEN_TO_TONE[lane.token] ?? "accent"}
              leftLabel=""
              leftValue={lane.player_lineup_rating.toFixed(1)}
              leftCaption={lane.winner === "player" ? `Lane won +${(lane.player_lineup_rating - lane.boss_lineup_rating).toFixed(1)}` : lane.winner === "tie" ? "Tied" : undefined}
              rightLabel=""
              rightValue={lane.boss_lineup_rating.toFixed(1)}
              rightCaption={lane.winner === "opponent" ? `${boss?.name ?? "Boss"} +${(lane.boss_lineup_rating - lane.player_lineup_rating).toFixed(1)}` : undefined}
              scaleMin={0}
              scaleMax={100}
            />
          ))}
        </div>

        <p className="mt-6" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
          Roster total {battle.player_roster_total.toFixed(1)} · opponent {battle.opponent_roster_total.toFixed(1)} · bench
          weight {battle.bench_weight.toFixed(2)} — a tiebreak only, never a lane decider.
        </p>

        <div className="mt-6">
          <PeakV2PrimaryAction data-testid="rtt-battle-advance" onClick={onAdvance}>
            {advanceLabel}
          </PeakV2PrimaryAction>
        </div>
      </div>
    </div>
  );
}
