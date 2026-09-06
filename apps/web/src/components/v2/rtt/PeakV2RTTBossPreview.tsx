"use client";

/**
 * PeakV2RTTBossPreview — the matchup board: your five lanes against theirs,
 * then one press.
 *
 * The briefing is an ESTIMATE and says so (see `bossBriefing`'s docstring:
 * the two profiles are not computed under identical bench-weight
 * conditions, and a boss rule's tie-break is not modelled). What used to be
 * four prose sections is now one board: the rule in one line, five lane rows
 * with a lean marker, a one-line summary, the boss roster behind a
 * disclosure, and the stakes beside the action. Nothing here recomputes a
 * margin — `bossBriefing` and `bossRulePlainEffect` are the same calls.
 */

import { bossBriefing, type LaneProjection } from "@/lib/run-the-table-state";
import { bossRulePlainEffect, lanesToWinSentence } from "@/lib/run-the-table-copy";
import type { BossPublic, LaneProfileEntry } from "@/types/run-the-table";
import GameActionButton from "@/components/game-feel/GameActionButton";
import { v2ToneVar, type V2ComponentTone } from "../v2-tone";
import PeakV2RTTDecisionHead from "./PeakV2RTTDecisionHead";
import PeakV2RTTCoach from "./PeakV2RTTCoach";
import { actNumeral } from "@/lib/run-the-table-state";

const LANE_TOKEN_TO_TONE: Record<string, V2ComponentTone> = { si: "si", tp: "tp", rec: "rec", po: "po", team: "team" };

interface Props {
  boss: BossPublic;
  playerLanes: LaneProfileEntry[];
  playerTotal: number;
  benchWeight: number;
  lives: number;
  maxLives: number;
  busy: boolean;
  onResolve: () => Promise<unknown>;
  lanesToWin?: number;
}

export default function PeakV2RTTBossPreview({ boss, playerLanes, playerTotal, benchWeight, lives, maxLives, busy, onResolve, lanesToWin }: Props) {
  const briefing = boss.revealed ? bossBriefing(playerLanes, boss.lane_profile) : null;
  const plain = boss.rule ? bossRulePlainEffect(boss.rule.id) : null;
  const final = boss.is_final === true;
  const bossByLane = new Map((boss.lane_profile ?? []).map((l) => [l.lane, l]));

  return (
    <section data-testid="rtt-boss-preview" className="rtt-matchup" data-final={final ? "true" : "false"}>
      <PeakV2RTTDecisionHead
        tone="boss"
        eyebrow={`Act ${actNumeral(boss.act)} · ${final ? "Final boss" : "Boss"}${boss.rule ? ` · ${boss.rule.name}` : ""}`}
        title={boss.name}
        context={boss.tagline}
        aside={
          <span className="rtt-stakes" data-testid="rtt-boss-stakes">
            <span className="rtt-eyebrow">At stake</span>
            <span className="rtt-stakes-value">
              1 of {lives} {lives === 1 ? "life" : "lives"}
            </span>
          </span>
        }
      />

      <p className="rtt-matchup-rule" data-testid="rtt-boss-win-condition">
        <strong>{lanesToWinSentence(lanesToWin)}</strong> Each lane compares your roster&apos;s PEAK3 component rating against theirs. No game is simulated.
      </p>
      {boss.rule ? (
        <div className="rtt-matchup-boss-rule" data-testid="rtt-boss-rule">
          <span className="rtt-eyebrow">Rule in force · {boss.rule.name}</span>
          {plain ? (
            <span className="rtt-matchup-boss-rule-plain" data-testid="rtt-boss-rule-plain">
              {plain}
            </span>
          ) : null}
          <span className="rtt-matchup-boss-rule-summary" data-testid="rtt-boss-rule-summary">
            {boss.rule.summary}
          </span>
        </div>
      ) : null}

      <div className="rtt-matchup-board" data-testid="rtt-boss-briefing">
        <div className="rtt-matchup-cols" aria-hidden="true">
          <span>You · {playerTotal.toFixed(1)}</span>
          <span>{boss.revealed ? `${boss.name}${typeof boss.roster_total === "number" ? ` · ${boss.roster_total.toFixed(1)}` : ""}` : "Not scouted"}</span>
        </div>
        <ul className="rtt-matchup-lanes">
          {playerLanes.map((entry) => {
            const opp = boss.revealed ? (bossByLane.get(entry.lane) ?? null) : null;
            const projection = briefing?.lanes.find((l) => l.lane === entry.lane) ?? null;
            const lean = projection?.favour ?? "unknown";
            const tone = LANE_TOKEN_TO_TONE[entry.token] ?? "si";
            return (
              <li key={entry.lane} className="rtt-matchup-lane" data-testid={`rtt-boss-lane-${entry.lane}`} data-lean={lean}>
                <span className="rtt-matchup-you">{entry.value.toFixed(1)}</span>
                <span className="rtt-matchup-mid">
                  <span className="rtt-matchup-label" style={{ color: v2ToneVar(tone) }}>
                    {entry.label}
                  </span>
                  <span className="rtt-matchup-lean">
                    {lean === "you" ? `You lead by ${fmt(projection!.margin)}` : lean === "boss" ? `They lead by ${fmt(-projection!.margin)}` : lean === "level" ? "Too close to call" : "Unknown until scouted"}
                  </span>
                </span>
                <span className="rtt-matchup-boss">{opp ? opp.value.toFixed(1) : "—"}</span>
              </li>
            );
          })}
        </ul>
        {briefing ? (
          <p className="rtt-matchup-summary">
            <Chip testId="rtt-boss-briefing-you" label="Leaning you" lanes={briefing.favouredYou} />
            <Chip testId="rtt-boss-briefing-boss" label={`Leaning ${boss.name}`} lanes={briefing.favouredBoss} />
            {briefing.level.length > 0 ? <Chip testId="rtt-boss-briefing-level" label="Too close" lanes={briefing.level} /> : null}
          </p>
        ) : (
          <p className="rtt-matchup-summary rtt-fineprint">
            {boss.locked === false ? "This opponent is matched to your roster when the act starts." : "Not scouted — you know the name and the rule, not the five."}
          </p>
        )}
        <p className="rtt-fineprint">
          An estimate, not a result. Bench counts at {benchWeight.toFixed(2)}; a boss rule can change how the bench is weighted for both teams when the lanes are scored.
        </p>
      </div>

      {boss.revealed && boss.starters ? (
        <details className="rtt-matchup-roster" data-testid="rtt-boss-roster">
          <summary>{boss.name}&apos;s seven</summary>
          <ul>
            {[...boss.starters, ...(boss.bench ?? [])].map((card, i) => (
              <li key={card.card_id}>
                <span>{card.player_name}</span>
                <span className="rtt-fineprint">
                  {card.window_label}
                  {i >= (boss.starters?.length ?? 0) ? " · bench" : ""}
                </span>
                <span className="rtt-matchup-roster-score">{card.prime_score.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="rtt-matchup-action">
        <PeakV2RTTCoach coach="first_life_risk" active />
        <GameActionButton data-testid="rtt-resolve-boss" disabled={busy} pendingLabel="Scoring the lanes…" onAction={onResolve} className="rtt-matchup-resolve">
          {final ? "Play the final matchup" : "Play the matchup"}
        </GameActionButton>
        <span className="rtt-fineprint">
          {lives} of {maxLives} lives. Lose and it is {lives - 1}.
        </span>
      </div>
    </section>
  );
}

function fmt(n: number): string {
  return Math.abs(n) >= 10 ? Math.abs(n).toFixed(0) : Math.abs(n).toFixed(1);
}

function Chip({ testId, label, lanes }: { testId: string; label: string; lanes: LaneProjection[] }) {
  return (
    <span className="rtt-matchup-chip" data-testid={testId}>
      <span className="rtt-eyebrow">{label}</span>
      <span>{lanes.length === 0 ? "none" : lanes.map((l) => l.label).join(", ")}</span>
    </span>
  );
}
