"use client";

/**
 * PeakV2RTTBattleResult — the boss battle resolves in beats, then the
 * consequence lands.
 *
 * The lanes settle one at a time (the count runs beside them), the verdict
 * stamps, then the consequence — a life lost, credits won, the act
 * cleared — before the one action out. A click anywhere completes the
 * sequence; reduced motion shows it complete. Every number is the engine's
 * `BattlePublic`; `battleVerdict`/`runningSeries` only count what the
 * server already decided.
 */

import { useEffect } from "react";
import ResultReveal, { RevealStep } from "@/components/game-feel/ResultReveal";
import GameActionButton from "@/components/game-feel/GameActionButton";
import LifeMeter from "@/components/game-feel/LifeMeter";
import PeakV2ArenaLight from "../PeakV2ArenaLight";
import { battleResolution, decisiveLane, runningSeries, actNumeral } from "@/lib/run-the-table-state";
import type { BattlePublic, BossPublic } from "@/types/run-the-table";
import { v2ToneVar, type V2ComponentTone } from "../v2-tone";

const LANE_TOKEN_TO_TONE: Record<string, V2ComponentTone> = { si: "si", tp: "tp", rec: "rec", po: "po", team: "team" };

const STEPS = [
  { name: "lane-0", at: 0 },
  { name: "lane-1", at: 260 },
  { name: "lane-2", at: 520 },
  { name: "lane-3", at: 780 },
  { name: "lane-4", at: 1040 },
  { name: "verdict", at: 1400 },
  { name: "consequence", at: 1950 },
  { name: "actions", at: 2350 },
] as const;

export interface PeakV2RTTBattleResultProps {
  battle: BattlePublic;
  boss: BossPublic | null;
  busy: boolean;
  lives: number;
  maxLives: number;
  actsTotal: number;
  lanesToWin?: number;
  onAdvance: () => Promise<unknown>;
  advanceLabel: string;
  /** A resumed run shows the finished result at once. */
  resumed?: boolean;
}

export default function PeakV2RTTBattleResult({ battle, boss, busy, lives, maxLives, actsTotal, lanesToWin, onAdvance, advanceLabel, resumed = false }: PeakV2RTTBattleResultProps) {
  const needed = lanesToWin ?? battle.lanes_to_win ?? 3;
  const resolution = battleResolution(battle, needed);
  const decisive = decisiveLane(battle, needed);
  const final = battle.act >= actsTotal;
  const won = battle.outcome === "win";
  const lost = battle.outcome === "loss";
  const bossName = boss?.name ?? "the boss";

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <ResultReveal steps={STEPS} startComplete={resumed} sequenceKey={`${battle.boss_id}:${battle.act}`} testId="rtt-battle-reveal" className="rtt-battle">
      {({ revealed, complete }) => {
        const shown = STEPS.filter((s) => s.name.startsWith("lane-") && revealed(s.name)).length;
        const series = runningSeries(battle.lanes, shown);
        return (
          <div className="rtt-battle-body" data-outcome={battle.outcome} data-final={final ? "true" : "false"} data-complete={complete ? "true" : "false"}>
            <PeakV2ArenaLight y="-6%" tone={revealed("verdict") ? (won ? "positive" : lost ? "negative" : "accent") : "accent"} intensity="focus" />
            <header className="rtt-battle-head">
              <span className="rtt-eyebrow">
                {final ? "Final boss" : `Act ${actNumeral(battle.act)} boss`} · {bossName} · first to {needed}
              </span>
              <span className="rtt-battle-series" data-testid="rtt-battle-series" aria-live="polite">
                <span className="rtt-battle-series-you">{series.player}</span>
                <span className="rtt-battle-series-dash">—</span>
                <span className="rtt-battle-series-boss">{series.opponent}</span>
              </span>
            </header>

            <ol className="rtt-battle-lanes" data-testid="rtt-battle-lanes">
              {battle.lanes.map((lane, i) => {
                const tone = LANE_TOKEN_TO_TONE[lane.token] ?? "si";
                const on = revealed(`lane-${i}`);
                const isDecisive = decisive.lane?.lane === lane.lane;
                return (
                  <RevealStep key={lane.lane} name={`lane-${i}`} revealed={revealed} as="li" className="rtt-battle-lane" testId={`rtt-battle-lane-${lane.lane}`}>
                    <span className="rtt-battle-lane-row" data-winner={lane.winner} data-decisive={isDecisive ? "true" : "false"} data-on={on ? "true" : "false"}>
                      <span className="rtt-battle-lane-you">{lane.player_lineup_rating.toFixed(1)}</span>
                      <span className="rtt-battle-lane-mid">
                        <span className="rtt-battle-lane-label" style={{ color: v2ToneVar(tone) }}>
                          {lane.label}
                        </span>
                        <span className="rtt-battle-lane-call">
                          {lane.winner === "player" ? `You take it +${(lane.player_lineup_rating - lane.boss_lineup_rating).toFixed(1)}` : lane.winner === "opponent" ? `${bossName} +${(lane.boss_lineup_rating - lane.player_lineup_rating).toFixed(1)}` : "Tied"}
                          {lane.tie_broken_by_rule ? " · rule" : ""}
                          {isDecisive ? " · decisive" : ""}
                        </span>
                      </span>
                      <span className="rtt-battle-lane-boss">{lane.boss_lineup_rating.toFixed(1)}</span>
                    </span>
                  </RevealStep>
                );
              })}
            </ol>

            <RevealStep name="verdict" revealed={revealed} className="rtt-battle-verdict" testId="rtt-battle-verdict">
              <span className="rtt-battle-stamp" data-outcome={battle.outcome}>
                {resolution.stamp}
              </span>
              {/* THE THREE FACTS, TOGETHER: the lane count, what was needed,
                  and the rule that decided it with its number — so a "3–2"
                  that fell short of 4 can never read as a win. */}
              <span className="rtt-battle-verdict-line" data-testid="rtt-battle-resolution" data-fell-short={resolution.fellShort ? "true" : "false"}>
                <span className="rtt-battle-verdict-count">{resolution.count}</span>
                <span className="rtt-battle-verdict-sep" aria-hidden="true">·</span>
                <span className="rtt-battle-verdict-target">{resolution.target}</span>
              </span>
              <span className="rtt-battle-verdict-decider" data-testid="rtt-battle-decider">
                {resolution.decider}
              </span>
              <span className="rtt-battle-verdict-detail">{decisive.lane ? decisive.sentence : null}</span>
            </RevealStep>

            <RevealStep name="consequence" revealed={revealed} className="rtt-battle-consequence" testId="rtt-battle-consequence">
              {lost ? (
                <div className="rtt-battle-life" data-testid="rtt-battle-life-lost">
                  <span className="rtt-battle-consequence-title">Life lost</span>
                  <LifeMeter lives={lives} max={maxLives} size="lg" testId="rtt-battle-lives" />
                  <span className="rtt-battle-consequence-detail">
                    {lives === 0 ? "No lives left. The run ends here." : `${lives} ${lives === 1 ? "life" : "lives"} left${battle.credits_awarded > 0 ? ` · +${battle.credits_awarded} comeback credits` : ""}`}
                  </span>
                </div>
              ) : won ? (
                <div className="rtt-battle-win" data-testid="rtt-battle-won">
                  <span className="rtt-battle-consequence-title">{final ? "Table cleared" : `Act ${actNumeral(battle.act)} cleared`}</span>
                  <span className="rtt-battle-consequence-detail">
                    {battle.credits_awarded > 0 ? `+${battle.credits_awarded} credits` : "No credits awarded"}
                    {!final ? ` · Act ${actNumeral(battle.act + 1)} ahead` : ""}
                  </span>
                </div>
              ) : (
                <div className="rtt-battle-draw" data-testid="rtt-battle-drawn">
                  <span className="rtt-battle-consequence-title">Draw</span>
                  <span className="rtt-battle-consequence-detail">No life lost. {!final ? `Act ${actNumeral(battle.act + 1)} ahead` : ""}</span>
                </div>
              )}
              <p className="rtt-fineprint">
                Roster total {battle.player_roster_total.toFixed(1)} · opponent {battle.opponent_roster_total.toFixed(1)} · bench weight {battle.bench_weight.toFixed(2)} — a tiebreak only, never a lane decider.
              </p>
            </RevealStep>

            <RevealStep name="actions" revealed={revealed} className="rtt-battle-actions">
              <GameActionButton data-testid="rtt-battle-advance" disabled={busy} pendingLabel="Moving on…" onAction={onAdvance}>
                {advanceLabel}
              </GameActionButton>
            </RevealStep>
          </div>
        );
      }}
    </ResultReveal>
  );
}
