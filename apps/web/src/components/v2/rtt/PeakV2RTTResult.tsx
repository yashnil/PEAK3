"use client";

/**
 * PeakV2RTTResult — the run ends in a sequence, not a dashboard.
 *
 *   RUN ENDED / TABLE CLEARED (the stamp, with the engine's verdict)
 *   → how far you got (the track, boss by boss)
 *   → the roster you built
 *   → the score assembles (roster total, five lanes)
 *   → what mattered (MVP, best move, decisive mistake, closest lost lane, credits)
 *   → personal best (local — RUN THE TABLE has no global leaderboard yet)
 *   → Run it back
 *
 * A Level-3 moment for a full clear, a plainer one for a failure; a click
 * anywhere completes it and reduced motion shows it complete. Every number
 * is a field already on `RunReceipt` or a helper `lib/run-the-table-state`
 * exposes — nothing is derived here beyond choosing what to lead with.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, Camera, Check, Copy, Link as LinkIcon, RotateCcw } from "lucide-react";
import ResultReveal, { RevealStep } from "@/components/game-feel/ResultReveal";
import ScoreTransition from "@/components/game-feel/ScoreTransition";
import GameActionButton from "@/components/game-feel/GameActionButton";
import PeakV2ArenaLight from "../PeakV2ArenaLight";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import { v2ToneVar, type V2Tone } from "../v2-tone";
import type { MapAct, RunReceipt, RunVersions } from "@/types/run-the-table";
import {
  DECIDED_BY_LABELS,
  actNumeral,
  buildRunShareText,
  challengeUrl,
  formatReceiptItem,
  formatSigned,
  ladderRows,
  receiptItemColorVar,
  receiptItems,
  receiptLaneProfile,
  recordPersonalBest,
  runOutcome,
  runVerdict,
  slotLabel,
  trackRunTheTable,
  type PersonalBest,
} from "@/lib/run-the-table-state";
import { PERK_EXACT_RULE_LABEL, perkPlainEffect } from "@/lib/run-the-table-copy";
import { drawShareCard } from "@/lib/run-the-table-share-card";

const LANE_TOKEN_TO_TONE: Record<string, V2Tone> = { si: "si", tp: "tp", rec: "rec", po: "po", team: "team" };

const STEPS_CLEARED = [
  { name: "ending", at: 0 },
  { name: "journey", at: 900 },
  { name: "roster", at: 1500 },
  { name: "score", at: 2100 },
  { name: "facts", at: 2700 },
  { name: "best", at: 3100 },
  { name: "actions", at: 3400 },
] as const;

const STEPS_ENDED = [
  { name: "ending", at: 0 },
  { name: "journey", at: 600 },
  { name: "roster", at: 1000 },
  { name: "score", at: 1400 },
  { name: "facts", at: 1800 },
  { name: "best", at: 2100 },
  { name: "actions", at: 2300 },
] as const;

function outcomeTone(outcome: ReturnType<typeof runOutcome>): V2Tone {
  if (outcome === "table_cleared") return "positive";
  if (outcome === "ended_at_final_boss") return "accent";
  return "negative";
}

interface Props {
  receipt: RunReceipt;
  versions: RunVersions;
  busy: boolean;
  actsTotal?: number | null;
  map?: MapAct[] | null;
  onRunItBack: () => Promise<unknown>;
  onReplaySeed: () => void;
  onChallenge: () => Promise<string | null>;
  /** A resumed terminal run shows the finished receipt at once. */
  resumed?: boolean;
}

type CopiedKind = "summary" | "challenge" | null;

export default function PeakV2RTTResult({ receipt, versions, busy, actsTotal, map, onRunItBack, onChallenge, resumed = false }: Props) {
  const [copied, setCopied] = useState<CopiedKind>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [best, setBest] = useState<{ isNew: boolean; previous: PersonalBest | null } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const roster = [...receipt.starters, ...receipt.bench];
  const outcome = runOutcome(receipt, actsTotal);
  const verdict = runVerdict(receipt, actsTotal);
  const cleared = outcome === "table_cleared";
  const tone = outcomeTone(outcome);
  const items = receiptItems(receipt);
  const lanes = receiptLaneProfile(receipt.lane_profile);
  const livesLost = Math.max(0, receipt.battles.filter((b) => b.outcome === "loss").length);
  const steps = cleared ? STEPS_CLEARED : STEPS_ENDED;

  // Personal best is recorded once per receipt (keyed on the seed and the
  // record), on the client, after mount.
  const recordedRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${receipt.seed}:${receipt.record}:${receipt.roster_total}`;
    if (recordedRef.current === key) return;
    recordedRef.current = key;
    setBest(recordPersonalBest(receipt));
  }, [receipt]);

  function flash(kind: Exclude<CopiedKind, null>) {
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 2000);
  }

  async function handleCopySummary() {
    try {
      await navigator.clipboard.writeText(buildRunShareText(receipt));
      trackRunTheTable({ type: "rtt_shared", surface: "summary" });
      flash("summary");
    } catch {
      // Clipboard blocked — no crash, just no confirmation.
    }
  }

  async function handleChallenge() {
    setChallengeError(null);
    try {
      const token = await onChallenge();
      if (!token) {
        setChallengeError("Could not create a challenge link. Try again.");
        return;
      }
      await navigator.clipboard.writeText(challengeUrl(token));
      flash("challenge");
    } catch {
      setChallengeError("Could not create a challenge link. Try again.");
    }
  }

  function handleShareCard() {
    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvasRef.current = canvas;
    drawShareCard(canvas, receipt, actsTotal);
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-the-table-${receipt.seed}.png`;
    a.click();
    trackRunTheTable({ type: "rtt_shared", surface: "card" });
  }

  const bestAcq = receipt.best_acquisition;
  const bestTrade = receipt.best_trade;
  const mostValuable: { kind: "acquisition"; data: NonNullable<typeof bestAcq> } | { kind: "trade"; data: NonNullable<typeof bestTrade> } | null =
    bestAcq && bestTrade
      ? bestAcq.score_delta >= bestTrade.score_delta
        ? { kind: "acquisition", data: bestAcq }
        : { kind: "trade", data: bestTrade }
      : bestAcq
        ? { kind: "acquisition", data: bestAcq }
        : bestTrade
          ? { kind: "trade", data: bestTrade }
          : null;

  const worstContribution =
    receipt.marginal_contributions.length > 0
      ? receipt.marginal_contributions.reduce((min, c) => (c.marginal_contribution < min.marginal_contribution ? c : min))
      : null;
  type Mistake = { label: string; detail: ReactNode; delta: number };
  const mistakeCandidates: Mistake[] = [];
  if (bestAcq && bestAcq.score_delta < 0) {
    mistakeCandidates.push({
      label: "Worst acquisition",
      delta: bestAcq.score_delta,
      detail: (
        <>
          <strong>{bestAcq.player_name}</strong> for {bestAcq.cost} credits in Act {bestAcq.act} — <span style={{ color: "var(--v2-color-negative)" }}>{formatSigned(bestAcq.score_delta, 2)}</span> PEAK3 over{" "}
          {bestAcq.replaced?.player_name ?? "an empty slot"}.
        </>
      ),
    });
  }
  if (bestTrade && bestTrade.score_delta < 0) {
    mistakeCandidates.push({
      label: "Worst trade",
      delta: bestTrade.score_delta,
      detail: (
        <>
          <strong>{bestTrade.incoming.player_name}</strong> for {bestTrade.outgoing.player_name} — net {bestTrade.net_cost} credits,{" "}
          <span style={{ color: "var(--v2-color-negative)" }}>{formatSigned(bestTrade.score_delta, 2)}</span> PEAK3.
        </>
      ),
    });
  }
  if (worstContribution && worstContribution.marginal_contribution < 0) {
    mistakeCandidates.push({
      label: "Weakest roster spot",
      delta: worstContribution.marginal_contribution,
      detail: (
        <>
          <strong>{worstContribution.player_name}</strong> {worstContribution.anchor_season} — the roster would have scored{" "}
          <span style={{ color: "var(--v2-color-positive)" }}>{formatSigned(-worstContribution.marginal_contribution, 2)}</span> higher without them.
        </>
      ),
    });
  }
  const largestMistake = mistakeCandidates.length > 0 ? mistakeCandidates.reduce((worst, m) => (m.delta < worst.delta ? m : worst)) : null;
  const closestLostBattle = receipt.closest_battle && receipt.closest_battle.outcome !== "win" ? receipt.closest_battle : null;
  const timelineRows = map ? ladderRows(map).filter((r) => r.state !== "locked") : [];
  const reachedAct = receipt.battles.length > 0 ? Math.max(...receipt.battles.map((b) => b.act)) : 1;

  return (
    <ResultReveal steps={steps} startComplete={resumed} sequenceKey={`${receipt.seed}:${receipt.record}`} testId="rtt-result-reveal" className="rtt-ending">
      {({ revealed, complete }) => (
        <div data-testid="rtt-result" className="rtt-receipt" data-outcome={outcome} data-complete={complete ? "true" : "false"}>
          <RevealStep name="ending" revealed={revealed} className="rtt-ending-stage" as="section">
            <PeakV2ArenaLight y="-8%" tone={tone} intensity="focus" />
            <div className="rtt-ending-body">
              <span className="rtt-eyebrow rtt-ending-eyebrow" data-testid="rtt-ending-kind">
                {cleared ? "Final boss cleared" : "Run ended"}
                {" · "}
                {cleared ? `all ${actsTotal ?? receipt.battles.length} acts` : outcome === "ended_at_final_boss" ? `at the final boss` : `Act ${actNumeral(reachedAct)}${actsTotal ? ` of ${actsTotal}` : ""}`}
              </span>
              <h1 className="rtt-ending-stamp" data-testid="rtt-result-verdict" data-outcome={outcome} style={{ color: v2ToneVar(tone) }}>
                {verdict}
              </h1>
              <p className="rtt-ending-headline">{receipt.headline}</p>
              <p className="rtt-ending-story">{receipt.story}</p>
              <p className="rtt-ending-record">
                Record {receipt.record} · {receipt.lives_remaining} {receipt.lives_remaining === 1 ? "life" : "lives"} left · {receipt.credits_remaining} credits unspent
              </p>
            </div>
          </RevealStep>

          <RevealStep name="journey" revealed={revealed} className="rtt-result-section" as="section" testId="rtt-result-battles">
            <span className="rtt-eyebrow">How far you got</span>
            <ol className="rtt-journey">
              {(map ? map : []).map((act) => {
                const battle = receipt.battles.find((b) => b.act === act.act) ?? null;
                return (
                  <li key={act.act} className="rtt-journey-act" data-state={act.boss.state} data-testid={battle ? `rtt-result-battle-${act.act}` : undefined} data-outcome={battle?.outcome}>
                    <span className="rtt-journey-numeral">{actNumeral(act.act)}</span>
                    <span className="rtt-journey-boss">{act.boss.name}</span>
                    <span className="rtt-journey-outcome" data-outcome={battle?.outcome ?? "none"}>
                      {battle ? (battle.outcome === "win" ? "Won" : battle.outcome === "loss" ? "Lost · life" : "Drew") : "Not reached"}
                    </span>
                    {battle ? (
                      <span className="rtt-fineprint">
                        {battle.player_lanes_won}–{battle.opponent_lanes_won} · {DECIDED_BY_LABELS[battle.decided_by] ?? "Decided on lanes won"}
                      </span>
                    ) : null}
                  </li>
                );
              })}
              {!map && receipt.battles.length > 0
                ? receipt.battles.map((b) => (
                    <li key={`${b.act}-${b.boss_id}`} className="rtt-journey-act" data-testid={`rtt-result-battle-${b.act}`} data-outcome={b.outcome}>
                      <span className="rtt-journey-numeral">{actNumeral(b.act)}</span>
                      <span className="rtt-journey-outcome" data-outcome={b.outcome}>
                        {b.outcome === "win" ? "Won" : b.outcome === "loss" ? "Lost · life" : "Drew"}
                      </span>
                      <span className="rtt-fineprint">
                        {b.player_lanes_won}–{b.opponent_lanes_won}
                      </span>
                    </li>
                  ))
                : null}
            </ol>
          </RevealStep>

          <RevealStep name="roster" revealed={revealed} className="rtt-result-section" as="section">
            <span className="rtt-eyebrow">The roster you built</span>
            <ul className="rtt-result-roster" data-testid="rtt-result-roster">
              {roster.map((entry) => (
                <li key={entry.slot_id} className="rtt-result-roster-row">
                  <span className="rtt-result-roster-slot">{slotLabel({ slot_id: entry.slot_id, role: entry.role, is_starter: true })}</span>
                  <span className="rtt-result-roster-name">
                    {entry.player_name}
                    <span className="rtt-fineprint"> {entry.window}</span>
                  </span>
                  <span className="rtt-result-roster-score">{entry.prime_score.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </RevealStep>

          <RevealStep name="score" revealed={revealed} className="rtt-result-section" as="section" testId="rtt-result-lanes">
            <div className="rtt-result-score">
              <span className="rtt-eyebrow">Roster total</span>
              <span className="rtt-result-score-value" data-testid="rtt-result-roster-total">
                <ScoreTransition value={receipt.roster_total} from={revealed("score") && !resumed ? 0 : undefined} durationMs={900} format={(n) => n.toFixed(1)} />
              </span>
              <span className="rtt-fineprint">
                {livesLost} {livesLost === 1 ? "life" : "lives"} lost · {receipt.credits_spent} credits spent · {receipt.credits_remaining} left
              </span>
            </div>
            <ul className="rtt-result-lanes">
              {lanes.map((lane) => (
                <li key={lane.lane} className="rtt-dna-row">
                  <span className="rtt-dna-label" style={{ color: v2ToneVar(LANE_TOKEN_TO_TONE[lane.token] ?? "accent") }}>
                    {lane.label}
                  </span>
                  <span className="rtt-dna-track" aria-hidden="true">
                    <span className="rtt-dna-fill" style={{ width: `${Math.max(2, Math.min(100, lane.value))}%`, background: v2ToneVar(LANE_TOKEN_TO_TONE[lane.token] ?? "accent") }} />
                  </span>
                  <span className="rtt-dna-value">{lane.value.toFixed(1)}</span>
                </li>
              ))}
            </ul>
            <p className="rtt-fineprint">
              Strongest: {receipt.strongest_lane.label} {receipt.strongest_lane.value.toFixed(1)} · weakest: {receipt.weakest_lane.label} {receipt.weakest_lane.value.toFixed(1)}
            </p>
          </RevealStep>

          <RevealStep name="facts" revealed={revealed} className="rtt-result-section" as="section">
            <span className="rtt-eyebrow">What mattered</span>
            <ul className="rtt-facts" data-testid="rtt-result-facts">
              {receipt.run_mvp ? (
                <Fact testId="rtt-result-mvp" tag="Strongest pick" value={formatSigned(receipt.run_mvp.marginal_contribution, 2)}>
                  <strong>{receipt.run_mvp.player_name}</strong> {receipt.run_mvp.anchor_season} — removing them costs the roster this much.
                </Fact>
              ) : null}
              {mostValuable ? (
                <Fact testId="rtt-result-best-move" tag={mostValuable.kind === "acquisition" ? "Best signing" : "Best trade"} value={formatSigned(mostValuable.data.score_delta, 2)} tone={mostValuable.data.score_delta >= 0 ? "positive" : "negative"}>
                  {mostValuable.kind === "acquisition" ? (
                    <>
                      <strong>{mostValuable.data.player_name}</strong> for {mostValuable.data.cost} credits in Act {mostValuable.data.act} over {mostValuable.data.replaced?.player_name ?? "an empty slot"}.
                    </>
                  ) : (
                    <>
                      <strong>{mostValuable.data.incoming.player_name}</strong> for {mostValuable.data.outgoing.player_name} — net {mostValuable.data.net_cost} credits.
                    </>
                  )}
                </Fact>
              ) : null}
              {largestMistake ? (
                <Fact testId="rtt-result-largest-mistake" tag="Decisive mistake" value={formatSigned(largestMistake.delta, 2)} tone="negative">
                  {largestMistake.detail}
                </Fact>
              ) : null}
              {closestLostBattle ? (
                <Fact testId="rtt-result-closest-lost" tag="Closest lost lane" value={closestLostBattle.tightest_lane_margin.toFixed(2)}>
                  Act {closestLostBattle.act} — {closestLostBattle.outcome}, lanes {closestLostBattle.lanes}.
                </Fact>
              ) : null}
              <Fact testId="rtt-result-credits" tag="Credits" value={String(receipt.credits_remaining)}>
                Started with {receipt.starting_credits} · spent {receipt.credits_spent} · refunded {receipt.credits_refunded} · finished holding this many.
              </Fact>
            </ul>
            {items.length > 0 ? (
              <ul className="rtt-reasons" data-testid="rtt-result-reasons">
                {items.map((item, i) => (
                  <li key={`${item.kind}-${i}`} data-testid={`rtt-result-item-${i}`} data-kind={item.kind} className="rtt-reason">
                    <span className="rtt-reason-value" style={{ color: receiptItemColorVar(item.kind) }}>
                      {formatReceiptItem(item)}
                    </span>
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {receipt.systems.length > 0 ? (
              <div className="rtt-fineprint rtt-result-perks">
                Perks:{" "}
                {receipt.systems.map((sys, i) => (
                  <span key={sys.id} data-testid={`rtt-result-system-${sys.id}`}>
                    {i > 0 ? " · " : ""}
                    <strong>{sys.name}</strong> — {perkPlainEffect(sys.id) ?? sys.summary}
                    {perkPlainEffect(sys.id) ? (
                      <details className="rtt-perk-rule" data-testid={`rtt-result-system-rule-${sys.id}`} style={{ display: "inline-block", marginLeft: 4 }}>
                        <summary>{PERK_EXACT_RULE_LABEL}</summary>
                        <span>{sys.summary}</span>
                      </details>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}
            {timelineRows.length > 0 ? (
              <ol className="rtt-timeline" data-testid="rtt-result-timeline" aria-label="The run's stops, in order">
                {timelineRows.map((row) => (
                  <li key={row.key} data-testid={`rtt-result-timeline-${row.key}`} className="rtt-timeline-stop" data-kind={row.kind} data-state={row.state}>
                    <span className="rtt-fineprint">{row.kind === "boss" ? `Act ${row.act} boss` : `Act ${row.act}·${row.stage}`}</span>
                    <span>{row.kind === "boss" ? (row.state === "won" ? "Won" : row.state === "lost" ? "Lost" : row.state === "drawn" ? "Drew" : row.sublabel) : row.sublabel}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </RevealStep>

          <RevealStep name="best" revealed={revealed} className="rtt-result-section" as="section" testId="rtt-result-best">
            <span className="rtt-eyebrow">Personal best</span>
            {best === null ? null : best.isNew ? (
              <p className="rtt-best" data-testid="rtt-result-best-new" data-new="true">
                <strong>New personal best.</strong> {receipt.bosses_defeated} {receipt.bosses_defeated === 1 ? "boss" : "bosses"} beaten, roster total {receipt.roster_total.toFixed(1)}
                {best.previous ? ` — up from ${best.previous.bosses_defeated} and ${best.previous.roster_total.toFixed(1)}.` : "."}
              </p>
            ) : (
              <p className="rtt-best" data-testid="rtt-result-best-standing" data-new="false">
                Your best stands at {best.previous?.bosses_defeated} {best.previous?.bosses_defeated === 1 ? "boss" : "bosses"} and roster total {best.previous?.roster_total.toFixed(1)}. This run: {receipt.bosses_defeated} and{" "}
                {receipt.roster_total.toFixed(1)}.
              </p>
            )}
            <p className="rtt-fineprint" data-testid="rtt-result-leaderboard">
              Not ranked — RUN THE TABLE has no global leaderboard in this build. Personal bests live in this browser.
            </p>
          </RevealStep>

          <RevealStep name="actions" revealed={revealed} className="rtt-result-actions-step" as="section">
            {challengeError ? (
              <p role="alert" className="rtt-commit-short">
                {challengeError}
              </p>
            ) : null}
            <div className="rtt-result-actions">
              <GameActionButton data-testid="rtt-run-it-back" disabled={busy} pendingLabel="Dealing a new run…" onAction={onRunItBack}>
                <RotateCcw size={13} aria-hidden="true" />
                Run it back
              </GameActionButton>
              <PeakV2SecondaryAction data-testid="rtt-challenge" onClick={handleChallenge} disabled={busy}>
                {copied === "challenge" ? <Check size={13} aria-hidden="true" /> : <LinkIcon size={13} aria-hidden="true" />}
                {copied === "challenge" ? "Link copied!" : "Challenge a friend"}
              </PeakV2SecondaryAction>
              <PeakV2SecondaryAction data-testid="rtt-copy-summary" onClick={handleCopySummary}>
                {copied === "summary" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                {copied === "summary" ? "Copied!" : "Copy summary"}
              </PeakV2SecondaryAction>
              <PeakV2SecondaryAction data-testid="rtt-share-card" onClick={handleShareCard}>
                <Camera size={13} aria-hidden="true" />
                Share card
              </PeakV2SecondaryAction>
              <PeakV2SecondaryAction href="/arena" data-testid="rtt-back-to-arena">
                <ArrowLeft size={13} aria-hidden="true" />
                Back to Arena
              </PeakV2SecondaryAction>
            </div>
            <canvas ref={canvasRef} aria-hidden="true" data-testid="rtt-share-canvas" style={{ display: "none" }} />
            <details className="rtt-data-receipt" data-testid="rtt-data-receipt">
              <summary>Data receipt</summary>
              <div>
                <span>Seed {receipt.seed}</span> <span>{receipt.run_type}</span> {receipt.date ? <span>{receipt.date}</span> : null} <span>{versions.engine_version}</span> <span>{versions.ruleset_version}</span>{" "}
                <span>{versions.card_pool_version}</span> <span>{versions.peak3_model_version}</span>
              </div>
            </details>
          </RevealStep>
        </div>
      )}
    </ResultReveal>
  );
}

function Fact({ tag, value, children, testId, tone }: { tag: string; value: string; children: ReactNode; testId?: string; tone?: "positive" | "negative" }) {
  const style: CSSProperties | undefined = tone ? { color: v2ToneVar(tone) } : undefined;
  return (
    <li className="rtt-fact" data-testid={testId}>
      <span className="rtt-fact-text">
        <span className="rtt-eyebrow">{tag}</span>
        <span className="rtt-fact-body">{children}</span>
      </span>
      <span className="rtt-fact-value" style={style}>
        {value}
      </span>
    </li>
  );
}
