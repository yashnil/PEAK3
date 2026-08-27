"use client";

/**
 * PeakV2RTTResult — the V2 "Broadcast Arena" final run receipt for RUN THE
 * TABLE. Direct counterpart to `PeakV2ShowdownResult.tsx` and
 * `PeakV2CourtResult.tsx`: same CINEMATIC hero → `PeakV2Rule` → LIVE
 * hairline-divided sections pattern, applied to the exact data
 * `RunResult.tsx` (legacy) already receives from `build_receipt()` — no
 * field dropped, nothing re-derived beyond picking which already-sent field
 * to lead with, same discipline the legacy screen's own docstring documents.
 *
 * Before this file existed, `screen === "result"` fell through RTT's own
 * `v2Content = surface` default (`RunTheTableGame.tsx`), so every run under
 * `?ui=v2` ended on the fully legacy-styled `RunResult` — the same class of
 * gap `PeakV2RTTBossLineup`'s roster-reveal branch fixed for the opening
 * reveal. This closes the last one: RTT now has a real V2 screen for every
 * moment, including its own ending.
 *
 * CINEMATIC: how deep the run got (`runOutcome`/`endedInAct`/`actsTotal`),
 * the verdict stamp (`runVerdict`, engine string once `outcome` exists,
 * re-derived otherwise — never the retired "RUN COMPLETE"), the engine's own
 * headline/story, and the record line (record · lives left · roster total).
 *
 * LIVE: boss journey (`receipt.battles`, one row per act — the "bosses
 * faced" story), run MVP, best move (acquisition or trade, whichever scored
 * higher — `RunResult.tsx`'s own `mostValuable` selection, ported verbatim),
 * largest mistake (only when a real negative exists — never a placeholder),
 * closest lost lane, credits, final roster, five-lane profile, front office
 * perks, decision timeline (`state.map`, optional), the semantic receipt
 * items (`receiptItems`, coloured by `kind` and only by `kind`), the
 * leaderboard's explicit "not ranked yet", and the same four actions legacy
 * offers (run it back, back to Arena, challenge a friend, copy summary,
 * share card) — same handlers, same clipboard/canvas logic, restyled.
 *
 * EVERY NUMBER IS THE SERVER'S: nothing here computes a PEAK3 score, delta,
 * or verdict — every value is a field already on `RunReceipt` or a helper
 * `RunResult.tsx` itself already calls from `lib/run-the-table-state.ts`.
 */

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, Camera, Check, Copy, Link as LinkIcon, RotateCcw } from "lucide-react";
import PeakV2CinematicStage from "../PeakV2CinematicStage";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2Rule from "../PeakV2Rule";
import PeakV2DataLane from "../PeakV2DataLane";
import PeakV2PlayerIdentity from "../PeakV2PlayerIdentity";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import { v2ToneVar, type V2Tone } from "../v2-tone";
import type { MapAct, RunReceipt, RunVersions } from "@/types/run-the-table";
import {
  DECIDED_BY_LABELS,
  buildRunShareText,
  challengeUrl,
  formatReceiptItem,
  formatSigned,
  ladderRows,
  receiptItemColorVar,
  receiptItems,
  receiptLaneProfile,
  runOutcome,
  runVerdict,
  signedColorVar,
  slotLabel,
  trackRunTheTable,
} from "@/lib/run-the-table-state";
import {
  PERK_EXACT_RULE_LABEL,
  perkPlainEffect,
  perkStrategyHint,
} from "@/lib/run-the-table-copy";
import { drawShareCard } from "@/lib/run-the-table-share-card";

const LANE_TOKEN_TO_TONE: Record<string, V2Tone> = {
  si: "si",
  tp: "tp",
  rec: "rec",
  po: "po",
  team: "team",
};

const SECTION_HEAD_STYLE: CSSProperties = {
  fontFamily: "var(--v2-font-mono)",
  fontSize: "0.6875rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--v2-text-muted)",
};

const BODY_STYLE: CSSProperties = {
  fontFamily: "var(--v2-font-ui)",
  fontSize: "0.8125rem",
  color: "var(--v2-text-secondary)",
};

const MUTED_STYLE: CSSProperties = {
  fontFamily: "var(--v2-font-ui)",
  fontSize: "0.75rem",
  color: "var(--v2-text-muted)",
};

/** Same three-way mapping `outcomeColorVar` uses, expressed as a `V2Tone` so
 *  the cinematic light and the headline color both come from the shared V2
 *  token layer (`--v2-color-positive`/`accent`/`negative` alias the exact
 *  `--correct`/`--peak-accent`/`--incorrect` vars `outcomeColorVar` returns —
 *  see `styles/v2/tokens.css` — so this is the same three colors, not a
 *  second interpretation of the outcome). */
function outcomeTone(outcome: ReturnType<typeof runOutcome>): V2Tone {
  if (outcome === "table_cleared") return "positive";
  if (outcome === "ended_at_final_boss") return "accent";
  return "negative";
}

function CalloutRow({ tag, headline, body, testId }: { tag: string; headline: ReactNode; body: ReactNode; testId?: string }) {
  return (
    <li
      className="flex items-start justify-between gap-4 py-3"
      style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}
      data-testid={testId}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span style={SECTION_HEAD_STYLE}>{tag}</span>
        <span style={BODY_STYLE}>{body}</span>
      </div>
      <span
        className="shrink-0 text-right"
        style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "0.9375rem", fontWeight: 700, color: "var(--v2-text-primary)" }}
      >
        {headline}
      </span>
    </li>
  );
}

interface Props {
  receipt: RunReceipt;
  versions: RunVersions;
  busy: boolean;
  actsTotal?: number | null;
  map?: MapAct[] | null;
  onRunItBack: () => void;
  /** Kept on the contract, not offered as a button — see `RunResult.tsx`'s
   *  own note on why the player-facing "Replay this seed" affordance was
   *  removed while the seed itself stays deterministic. */
  onReplaySeed: () => void;
  onChallenge: () => Promise<string | null>;
}

type CopiedKind = "summary" | "challenge" | null;

export default function PeakV2RTTResult({ receipt, versions, busy, actsTotal, map, onRunItBack, onChallenge }: Props) {
  const [copied, setCopied] = useState<CopiedKind>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const roster = [...receipt.starters, ...receipt.bench];
  const outcome = runOutcome(receipt, actsTotal);
  const verdict = runVerdict(receipt, actsTotal);
  const tone = outcomeTone(outcome);
  const items = receiptItems(receipt);
  const lanes = receiptLaneProfile(receipt.lane_profile);

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

  // ---- Best move: the higher-scoring of best acquisition / best trade —
  // ported verbatim from RunResult.tsx's own `mostValuable` selection. ----
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

  // ---- Largest mistake: the most negative real value already on the
  // receipt — ported verbatim from RunResult.tsx. ----
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
          <strong style={{ color: "var(--v2-text-primary)" }}>{bestAcq.player_name}</strong> for {bestAcq.cost} credits in Act{" "}
          {bestAcq.act} —{" "}
          <span style={{ color: "var(--v2-color-negative)" }}>{formatSigned(bestAcq.score_delta, 2)}</span> PEAK3 over{" "}
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
          <strong style={{ color: "var(--v2-text-primary)" }}>{bestTrade.incoming.player_name}</strong> for{" "}
          {bestTrade.outgoing.player_name} — net {bestTrade.net_cost} credits,{" "}
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
          <strong style={{ color: "var(--v2-text-primary)" }}>{worstContribution.player_name}</strong>{" "}
          {worstContribution.anchor_season} — the roster would have scored{" "}
          <span style={{ color: "var(--v2-color-positive)" }}>{formatSigned(-worstContribution.marginal_contribution, 2)}</span> higher
          without them.
        </>
      ),
    });
  }
  const largestMistake =
    mistakeCandidates.length > 0 ? mistakeCandidates.reduce((worst, m) => (m.delta < worst.delta ? m : worst)) : null;

  const closestLostBattle = receipt.closest_battle && receipt.closest_battle.outcome !== "win" ? receipt.closest_battle : null;
  const timelineRows = map ? ladderRows(map).filter((r) => r.state !== "locked") : [];

  return (
    <div data-testid="rtt-result">
      {/* CINEMATIC — depth reached, the verdict stamp, the engine's own
          headline/story, and the record line. */}
      <PeakV2CinematicStage light={{ y: "-6%", tone }}>
        <span style={SECTION_HEAD_STYLE}>
          {outcome === "table_cleared"
            ? `Cleared all ${actsTotal ?? receipt.battles.length} acts`
            : outcome === "ended_at_final_boss"
              ? `Reached the final boss${actsTotal ? ` · Act ${actsTotal}` : ""}`
              : `Reached Act ${receipt.battles.length > 0 ? Math.max(...receipt.battles.map((b) => b.act)) : 1}${actsTotal ? ` of ${actsTotal}` : ""}`}
        </span>
        <div className="mt-2" data-testid="rtt-result-verdict" data-outcome={outcome}>
          <PeakV2ResultHeadline as="h1" scale="hero" style={{ color: v2ToneVar(tone) }}>
            {verdict}
          </PeakV2ResultHeadline>
        </div>
        <p className="mt-3 max-w-md" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.9375rem", fontWeight: 700, color: "var(--v2-text-primary)" }}>
          {receipt.headline}
        </p>
        <p className="mt-1 max-w-md" style={BODY_STYLE}>
          {receipt.story}
        </p>
        <p className="mt-4" style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}>
          Record {receipt.record} · {receipt.lives_remaining} lives left · roster total {receipt.roster_total.toFixed(1)}
        </p>
      </PeakV2CinematicStage>

      <PeakV2Rule spacing="lg" />

      {/* LIVE — boss journey: one row per act, the bosses faced. */}
      {receipt.battles.length > 0 && (
        <div data-testid="rtt-result-battles">
          <span style={SECTION_HEAD_STYLE}>Boss journey</span>
          <ul className="mt-3 flex flex-col">
            {receipt.battles.map((b) => (
              <li
                key={`${b.act}-${b.boss_id}`}
                data-testid={`rtt-result-battle-${b.act}`}
                data-outcome={b.outcome}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5"
                style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}
              >
                <span style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.8125rem", color: "var(--v2-text-primary)" }}>
                  Act {b.act}
                </span>
                <span
                  style={{
                    fontFamily: "var(--v2-font-mono)",
                    fontSize: "0.6875rem",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color:
                      b.outcome === "win" ? "var(--v2-color-positive)" : b.outcome === "loss" ? "var(--v2-color-negative)" : "var(--v2-text-secondary)",
                  }}
                >
                  {b.outcome === "win" ? "Won" : b.outcome === "loss" ? "Lost" : "Drew"}
                </span>
                <span style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}>
                  {b.player_lanes_won}–{b.opponent_lanes_won} on lanes
                </span>
                <span style={MUTED_STYLE}>{DECIDED_BY_LABELS[b.decided_by] ?? "Decided on lanes won"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <PeakV2Rule spacing="lg" />

      {/* LIVE — the run's highlights: MVP, best move, largest mistake
          (only when real), closest lost lane, credits. One hairline-divided
          list, not four bordered tiles. */}
      <div>
        <span style={SECTION_HEAD_STYLE}>The run, in five facts</span>
        <ul className="mt-3 flex flex-col" data-testid="rtt-result-facts">
          {receipt.run_mvp ? (
            <CalloutRow
              testId="rtt-result-mvp"
              tag="Run MVP"
              headline={formatSigned(receipt.run_mvp.marginal_contribution, 2)}
              body={
                <>
                  <strong style={{ color: "var(--v2-text-primary)" }}>{receipt.run_mvp.player_name}</strong> {receipt.run_mvp.anchor_season} —
                  removing them costs the roster this much overall total.
                </>
              }
            />
          ) : null}
          {mostValuable ? (
            <CalloutRow
              testId="rtt-result-best-move"
              tag={mostValuable.kind === "acquisition" ? "Best move · Acquisition" : "Best move · Trade"}
              headline={
                <span style={{ color: signedColorVar(mostValuable.data.score_delta) }}>{formatSigned(mostValuable.data.score_delta, 2)}</span>
              }
              body={
                mostValuable.kind === "acquisition" ? (
                  <>
                    <strong style={{ color: "var(--v2-text-primary)" }}>{mostValuable.data.player_name}</strong> for {mostValuable.data.cost} credits
                    in Act {mostValuable.data.act} over {mostValuable.data.replaced?.player_name ?? "an empty slot"}.
                  </>
                ) : (
                  <>
                    <strong style={{ color: "var(--v2-text-primary)" }}>{mostValuable.data.incoming.player_name}</strong> for{" "}
                    {mostValuable.data.outgoing.player_name} — net {mostValuable.data.net_cost} credits.
                  </>
                )
              }
            />
          ) : null}
          {largestMistake ? (
            <CalloutRow
              testId="rtt-result-largest-mistake"
              tag={largestMistake.label}
              headline={<span style={{ color: "var(--v2-color-negative)" }}>{formatSigned(largestMistake.delta, 2)}</span>}
              body={largestMistake.detail}
            />
          ) : null}
          {closestLostBattle ? (
            <CalloutRow
              testId="rtt-result-closest-lost"
              tag="Closest lost lane"
              headline={closestLostBattle.tightest_lane_margin.toFixed(2)}
              body={
                <>
                  Act {closestLostBattle.act} — {closestLostBattle.outcome}, lanes {closestLostBattle.lanes}.
                </>
              }
            />
          ) : null}
          <CalloutRow
            testId="rtt-result-credits"
            tag="Credits"
            headline={receipt.credits_remaining}
            body={
              <>
                Started with {receipt.starting_credits} · spent {receipt.credits_spent} · refunded {receipt.credits_refunded} · finished
                holding this many.
              </>
            }
          />
        </ul>
      </div>

      <PeakV2Rule spacing="lg" />

      {/* LIVE — final roster. */}
      <div>
        <span style={SECTION_HEAD_STYLE}>Final roster</span>
        <ul className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2" data-testid="rtt-result-roster">
          {roster.map((entry) => (
            <li
              key={entry.slot_id}
              className="flex items-center justify-between gap-3 py-2.5"
              style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}
            >
              <PeakV2PlayerIdentity
                name={entry.player_name}
                meta={`${slotLabel({ slot_id: entry.slot_id, role: entry.role, is_starter: true })} · ${entry.window}`}
                size="sm"
              />
              <span
                className="shrink-0"
                style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "0.8125rem", fontWeight: 700, color: "var(--v2-color-accent)" }}
              >
                {entry.prime_score.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <PeakV2Rule spacing="lg" />

      {/* LIVE — five-lane profile, real component tones. */}
      <div data-testid="rtt-result-lanes">
        <span style={SECTION_HEAD_STYLE}>Five-lane profile</span>
        <div className="mt-4 flex flex-col gap-3">
          {lanes.map((lane) => (
            <PeakV2DataLane
              key={lane.lane}
              label={lane.label}
              tone={LANE_TOKEN_TO_TONE[lane.token] ?? "accent"}
              leftLabel=""
              leftValue={lane.value.toFixed(1)}
              scaleMin={0}
              scaleMax={100}
            />
          ))}
        </div>
        <p className="mt-3" style={MUTED_STYLE}>
          Strongest: {receipt.strongest_lane.label} {receipt.strongest_lane.value.toFixed(1)} · weakest: {receipt.weakest_lane.label}{" "}
          {receipt.weakest_lane.value.toFixed(1)}
        </p>
      </div>

      <PeakV2Rule spacing="lg" />

      {/* LIVE — front office perks (Systems). */}
      <div>
        <span style={SECTION_HEAD_STYLE}>Front office perks</span>
        {receipt.systems.length === 0 ? (
          <p className="mt-2" style={MUTED_STYLE}>
            No perk was ever selected.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {receipt.systems.map((sys) => {
              const plain = perkPlainEffect(sys.id);
              const hint = perkStrategyHint(sys.id);
              return (
                <div key={sys.id} data-testid={`rtt-result-system-${sys.id}`}>
                  <p style={BODY_STYLE}>
                    <span style={{ fontWeight: 700, color: "var(--v2-color-accent)" }}>{sys.name}</span> — {plain ?? sys.summary}
                  </p>
                  {hint ? (
                    <p className="mt-0.5" style={MUTED_STYLE}>
                      {hint}
                    </p>
                  ) : null}
                  {plain ? (
                    <details data-testid={`rtt-result-system-rule-${sys.id}`} className="mt-0.5">
                      <summary style={{ ...MUTED_STYLE, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px" }}>
                        {PERK_EXACT_RULE_LABEL}
                        <span className="sr-only"> for {sys.name}</span>
                      </summary>
                      <p className="pt-0.5" style={MUTED_STYLE}>
                        {sys.summary}
                      </p>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* LIVE — decision timeline (optional: only when `map` was supplied). */}
      {timelineRows.length > 0 && (
        <>
          <PeakV2Rule spacing="lg" />
          <div>
            <span style={SECTION_HEAD_STYLE}>Decision timeline</span>
            <ol className="mt-3 flex flex-wrap gap-2" data-testid="rtt-result-timeline" aria-label="The run's stages, in order">
              {timelineRows.map((row) => (
                <li
                  key={row.key}
                  data-testid={`rtt-result-timeline-${row.key}`}
                  className="flex flex-col items-center gap-0.5 px-2 py-1.5 text-center"
                  style={{
                    borderBottom: `2px solid ${
                      row.kind === "boss"
                        ? row.state === "won"
                          ? "var(--v2-color-positive)"
                          : row.state === "lost"
                            ? "var(--v2-color-negative)"
                            : "var(--v2-border)"
                        : "var(--v2-border-subtle)"
                    }`,
                    minWidth: 76,
                  }}
                >
                  <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.625rem", textTransform: "uppercase", color: "var(--v2-text-muted)" }}>
                    {row.kind === "boss" ? `Act ${row.act} boss` : `Act ${row.act}·${row.stage}`}
                  </span>
                  <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", fontWeight: 700, color: "var(--v2-text-primary)" }}>
                    {row.kind === "boss"
                      ? row.state === "won"
                        ? "Won"
                        : row.state === "lost"
                          ? "Lost"
                          : row.state === "drawn"
                            ? "Drew"
                            : row.sublabel
                      : row.sublabel}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}

      <PeakV2Rule spacing="lg" />

      {/* The semantic receipt — colour comes from `kind` and from nothing
          else, never from the sign of the number beside it. */}
      <div>
        <span style={SECTION_HEAD_STYLE}>Why this run ended this way</span>
        {items.length === 0 ? (
          <p className="mt-2" style={MUTED_STYLE}>
            Not enough happened to explain.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col" data-testid="rtt-result-reasons">
            {items.map((item, i) => (
              <li
                key={`${item.kind}-${i}`}
                data-testid={`rtt-result-item-${i}`}
                data-kind={item.kind}
                className="flex items-baseline gap-3 py-2"
                style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}
              >
                <span
                  className="min-w-12 shrink-0 whitespace-nowrap text-right"
                  style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "0.75rem", fontWeight: 700, color: receiptItemColorVar(item.kind) }}
                >
                  {formatReceiptItem(item)}
                </span>
                <span style={BODY_STYLE}>{item.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <PeakV2Rule spacing="lg" />

      {/* Leaderboard — an explicit "not ranked yet", never a silent
          omission. RTT has no leaderboard contract yet. */}
      <div data-testid="rtt-result-leaderboard">
        <span style={SECTION_HEAD_STYLE}>Leaderboard</span>
        <p className="mt-2" style={MUTED_STYLE}>
          Not ranked yet — RUN THE TABLE doesn&apos;t have a global leaderboard in this build.
        </p>
      </div>

      <PeakV2Rule spacing="lg" />

      {/* Actions — the same four legacy offers, same handlers. */}
      {challengeError && (
        <p role="alert" className="mb-3" style={{ ...BODY_STYLE, color: "var(--v2-color-negative)" }}>
          {challengeError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <PeakV2PrimaryAction data-testid="rtt-run-it-back" onClick={onRunItBack} disabled={busy}>
          <RotateCcw size={13} aria-hidden="true" />
          Run it back
        </PeakV2PrimaryAction>
        <PeakV2SecondaryAction href="/arena" data-testid="rtt-back-to-arena">
          <ArrowLeft size={13} aria-hidden="true" />
          Back to Arena
        </PeakV2SecondaryAction>
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
          Share card (image)
        </PeakV2SecondaryAction>
      </div>
      <canvas ref={canvasRef} aria-hidden="true" data-testid="rtt-share-canvas" style={{ display: "none" }} />

      <details className="mt-8" style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.625rem", color: "var(--v2-text-muted)" }} data-testid="rtt-data-receipt">
        <summary style={{ cursor: "pointer", color: "var(--v2-text-secondary)" }}>Data receipt</summary>
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2">
          <span>Seed {receipt.seed}</span>
          <span>{receipt.run_type}</span>
          {receipt.date && <span>{receipt.date}</span>}
          <span>{versions.engine_version}</span>
          <span>{versions.ruleset_version}</span>
          <span>{versions.card_pool_version}</span>
          <span>{versions.peak3_model_version}</span>
        </div>
      </details>
    </div>
  );
}
