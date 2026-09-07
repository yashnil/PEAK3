"use client";

/**
 * PeakV2RTTScoutPrepare — the V2 "current decision" for a `film_room` node
 * (player-facing "Scout & Prepare"). Ported from `ScoutPrepare.tsx` with
 * IDENTICAL functionality and data: same three branches
 * (`scout_boss` free, `shape_market` priced, `reserve_card` priced), same
 * `useState<ScoutChoice["id"]>("scout_boss")` open-branch tracking, same
 * `!node.scout` older-API fallback. Nothing here recomputes a projection, a
 * `would_flip` flag, a price or a report — every number is
 * `scout_and_prepare_options()`'s output, read verbatim.
 *
 * WHY THIS IS ITS OWN V2 SURFACE rather than reusing `PeakV2RTTDraftRoom`'s
 * shape: Scout & Prepare is not "pick a priced card" — it is three
 * qualitatively different actions (read a report, guarantee a market role,
 * lock a future card) that keep their own branch selector and panel, exactly
 * as the legacy component and the brief specify. It gets its own identity —
 * a scouting/information node, not a Draft Room clone.
 *
 * `would_flip` — legacy's loudest element (a green banner INSIDE the prep
 * button) — stays the loudest element here: a `positive`-tone caption above
 * the row plus a `positive`-tone left border, never demoted to routine
 * caption text.
 *
 * `LANE_TOKEN_TO_TONE` is copied verbatim from `PeakV2RTTShell.tsx` /
 * `PeakV2RTTBattleResult.tsx` — the same `LaneToken → V2ComponentTone`
 * mapping every other V2 RTT surface uses, never a fourth reinterpretation.
 */

import { useState } from "react";
import type {
  ActiveNode,
  CreditSink,
  LaneField,
  ReserveCandidate,
  Role,
  ScoutChoice,
  ScoutReport,
} from "@/types/run-the-table";
import {
  creditSinkPlainEffect,
  nodeChoiceTradeoff,
  nodeTypeCopy,
  sinkUnavailableReason,
} from "@/lib/run-the-table-copy";
import { LANE_TOKEN_BY_FIELD, ROLE_LABELS } from "@/lib/run-the-table-state";
import PeakV2RTTDecisionHead from "./PeakV2RTTDecisionHead";
import PeakV2RTTCoach from "./PeakV2RTTCoach";
import GameActionButton from "@/components/game-feel/GameActionButton";
import PeakV2Rule from "../PeakV2Rule";
import PeakV2PlayerIdentity from "../PeakV2PlayerIdentity";
import PeakV2Score from "../PeakV2Score";
import PeakV2DataLane from "../PeakV2DataLane";
import { v2ToneVar } from "../v2-tone";
import type { V2ComponentTone, V2Tone } from "../v2-tone";

const LANE_TOKEN_TO_TONE: Record<string, V2ComponentTone> = {
  si: "si",
  tp: "tp",
  rec: "rec",
  po: "po",
  team: "team",
};

function laneTone(lane: LaneField): V2Tone {
  return LANE_TOKEN_TO_TONE[LANE_TOKEN_BY_FIELD[lane]] ?? "accent";
}

const EYEBROW_STYLE = {
  fontFamily: "var(--v2-font-mono)",
  fontSize: "0.6875rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
  color: "var(--v2-text-muted)",
};

const SECONDARY_STYLE = {
  fontFamily: "var(--v2-font-ui)",
  fontSize: "0.8125rem",
  color: "var(--v2-text-secondary)",
};

const MUTED_STYLE = {
  fontFamily: "var(--v2-font-ui)",
  fontSize: "0.75rem",
  color: "var(--v2-text-muted)",
};

const NEGATIVE_STYLE = {
  fontFamily: "var(--v2-font-ui)",
  fontSize: "0.75rem",
  fontWeight: 700,
  color: "var(--v2-color-negative)",
};

interface Props {
  node: ActiveNode;
  credits: number;
  busy: boolean;
  onScoutBoss: (lane: LaneField) => Promise<unknown>;
  onShapeMarket: (role: Role) => Promise<unknown>;
  onReserveCard: (cardId: string) => Promise<unknown>;
  act?: number;
  stage?: number;
  stagesPerAct?: number;
}

export default function PeakV2RTTScoutPrepare({
  node,
  credits,
  busy,
  onScoutBoss,
  onShapeMarket,
  onReserveCard,
  act,
  stage,
  stagesPerAct,
}: Props) {
  // Kept for prop-contract parity with legacy `ScoutPrepare` (same caller,
  // same call site) — unused here because the "costs N of your M credits"
  // sentence it fed would only restate the credits figure the shell's own
  // status strip (`PeakV2RTTShell`) already shows on every RTT screen; see
  // `creditSinkPlainEffect` below for the branch's real, non-redundant cost
  // sentence instead.
  void credits;
  const scout = node.scout;
  const copy = nodeTypeCopy("film_room");
  const [open, setOpen] = useState<ScoutChoice["id"]>("scout_boss");

  // A film_room payload with no `scout` block is an older API — the same
  // condition legacy's `ScoutPrepare` guards, and the same plain message: no
  // empty surface with three dead buttons.
  if (!scout) {
    return (
      <div data-testid="rtt-scout-prepare" role="alert">
        <PeakV2RTTDecisionHead eyebrow="Scout & Prepare" title={node.title} />
        <p style={SECONDARY_STYLE}>
          This node needs a newer PEAK3 API than the one answering right now.
        </p>
      </div>
    );
  }

  const byId = new Map(scout.choices.map((c) => [c.id, c]));
  const scoutBoss = byId.get("scout_boss");
  const shapeMarket = byId.get("shape_market");
  const reserveCard = byId.get("reserve_card");
  const sinks = new Map((node.credit_sinks ?? []).map((s) => [s.id, s]));

  return (
    <div data-testid="rtt-scout-prepare" className="rtt-scout">
      <PeakV2RTTDecisionHead
        eyebrow={act ? `Act ${act} · Stop ${stage} of ${stagesPerAct} · Scout & Prepare` : "Scout & Prepare"}
        title={node.title}
        context={node.summary}
        aside={<PeakV2RTTCoach coach="first_scout" active />}
      />
      <details className="rtt-perk-rule rtt-trade-rule">
        <summary>What each branch does</summary>
        <span>{copy.consequence}</span>
      </details>

      <ul className="mt-4 flex flex-col" data-testid="rtt-scout-branches">
        {scout.choices.map((choice) => {
          const sink = choice.id === "scout_boss" ? undefined : sinks.get(
            (choice.id === "shape_market" ? "role_focus" : "reserve_card") as CreditSink["id"],
          );
          const isOpen = open === choice.id;
          const blocked = !choice.available;
          const reason = blocked ? sinkUnavailableReason(choice.unavailable_reason) : null;
          const tradeoff = nodeChoiceTradeoff("film_room", choice.id);
          return (
            <li key={choice.id}>
              <button
                type="button"
                data-testid={`rtt-scout-branch-${choice.id}`}
                data-open={isOpen ? "true" : "false"}
                data-available={choice.available ? "true" : "false"}
                aria-pressed={isOpen}
                disabled={busy}
                onClick={() => setOpen(choice.id)}
                className="flex w-full flex-col gap-1 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  borderBottom: "1px solid var(--v2-border-subtle)",
                  borderLeft: `2px solid ${isOpen ? "var(--v2-color-accent)" : "transparent"}`,
                  paddingLeft: "var(--v2-space-3)",
                  opacity: blocked ? 0.6 : 1,
                }}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span
                    style={{
                      fontFamily: "var(--v2-font-ui)",
                      fontWeight: 700,
                      fontSize: "0.9375rem",
                      color: isOpen ? "var(--v2-color-accent)" : "var(--v2-text-primary)",
                    }}
                  >
                    {choice.name}
                  </span>
                  {choice.cost === 0 ? (
                    <span
                      style={{
                        fontFamily: "var(--v2-font-mono)",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: "var(--v2-color-positive)",
                        flexShrink: 0,
                      }}
                    >
                      FREE
                    </span>
                  ) : (
                    <PeakV2Score value={choice.cost} label="Credits" size="sm" />
                  )}
                </span>
                {choice.summary ? <span style={SECONDARY_STYLE}>{choice.summary}</span> : null}
                {sink?.limit ? <span style={MUTED_STYLE}>Limit: {sink.limit}</span> : null}
                {tradeoff ? (
                  <span data-testid={`rtt-scout-tradeoff-${choice.id}`} style={MUTED_STYLE}>
                    {tradeoff}
                  </span>
                ) : null}
                {reason ? (
                  <span data-testid={`rtt-scout-blocked-${choice.id}`} style={NEGATIVE_STYLE}>
                    {reason}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <PeakV2Rule spacing="md" />

      {open === "scout_boss" && scoutBoss ? (
        <ScoutBossPanel choice={scoutBoss} busy={busy} onPrepare={onScoutBoss} />
      ) : null}

      {open === "shape_market" && shapeMarket ? (
        <RolePanel
          roles={shapeMarket.roles ?? scout.roles}
          available={shapeMarket.available}
          busy={busy}
          sink={sinks.get("role_focus")}
          onChoose={onShapeMarket}
        />
      ) : null}

      {open === "reserve_card" && reserveCard ? (
        <ReservePanel
          candidates={reserveCard.candidates ?? []}
          available={reserveCard.available}
          busy={busy}
          sink={sinks.get("reserve_card")}
          onChoose={onReserveCard}
        />
      ) : null}
    </div>
  );
}

/**
 * Scout the Boss: the free branch.
 *
 * Shows the whole report the engine computed — rule, the projected
 * matchup lane-by-lane (which doubles as the strongest/weakest read: each
 * `PeakV2DataLane` row carries a caption naming the boss's strongest or
 * weakest lane rather than a separate plain-text sentence) — then the five
 * capped preparations with `would_flip` on each, still the single loudest
 * signal on the screen.
 */
function ScoutBossPanel({
  choice,
  busy,
  onPrepare,
}: {
  choice: ScoutChoice;
  busy: boolean;
  onPrepare: (lane: LaneField) => void;
}) {
  const report: ScoutReport | null | undefined = choice.report;
  if (!report) {
    return (
      <p data-testid="rtt-scout-no-report" style={SECONDARY_STYLE}>
        There is no boss left to scout in this run.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="rtt-scout-report">
      <div className="flex flex-col gap-1.5">
        <span style={EYEBROW_STYLE}>Act {report.act} boss</span>
        <PeakV2PlayerIdentity name={report.name} meta={report.tagline} size="md" />
        {report.rule ? (
          <p data-testid="rtt-scout-rule" style={SECONDARY_STYLE}>
            <strong style={{ color: "var(--v2-color-accent)" }}>{report.rule.name}</strong>{" "}
            {report.rule.summary}
          </p>
        ) : null}
        <p data-testid="rtt-scout-projection" style={SECONDARY_STYLE}>
          Projected{" "}
          <span style={{ fontFamily: "var(--v2-font-mono)", fontWeight: 700, color: "var(--v2-text-primary)" }}>
            {report.projected_lanes_won}–{report.projected_lanes_lost}
          </span>{" "}
          on lanes, {report.lanes_to_win} needed to win outright, total margin{" "}
          <span style={{ fontFamily: "var(--v2-font-mono)", fontWeight: 700, color: "var(--v2-text-primary)" }}>
            {report.projected_summed_margin.toFixed(2)}
          </span>
          .
        </p>
      </div>

      <div>
        <span style={EYEBROW_STYLE}>Projected matchup, lane by lane</span>
        <div className="mt-2 flex flex-col gap-3">
          {report.lanes.map((lane) => {
            const isStrongest = report.strongest_lanes.includes(lane.lane);
            const isWeakest = lane.lane === report.weakest_lane;
            const outcomeCaption =
              lane.projected_winner === "player"
                ? "You lead"
                : lane.projected_winner === "opponent"
                  ? "Boss leads"
                  : "Even";
            const bossCaption = isWeakest
              ? "Boss's weakest lane"
              : isStrongest
                ? "Boss's strongest lane"
                : outcomeCaption;
            return (
              <PeakV2DataLane
                key={lane.lane}
                label={lane.label}
                tone={laneTone(lane.lane)}
                leftLabel="You"
                leftValue={lane.player_score.toFixed(1)}
                leftCaption={lane.projected_winner === "player" ? "You lead" : undefined}
                rightLabel="Boss"
                rightValue={lane.opponent_score.toFixed(1)}
                rightCaption={bossCaption}
                scaleMin={0}
                scaleMax={100}
              />
            );
          })}
        </div>
      </div>

      <PeakV2Rule spacing="sm" />

      <div className="flex flex-col gap-2">
        <p style={SECONDARY_STYLE}>
          Prepare one lane for this battle only. The bonus is{" "}
          <span style={{ fontFamily: "var(--v2-font-mono)", fontWeight: 700, color: "var(--v2-text-primary)" }}>
            {choice.prep_bonus ?? report.preparations[0]?.bonus}
          </span>{" "}
          points, it applies to that lane and no other, and it is spent whether or not it helps.
        </p>
        <ul className="flex flex-col">
          {report.preparations.map((prep) => (
            <li key={prep.lane}>
              {/* `would_flip` is the strongest decision signal in this node — the
                  one preparation that actually changes who wins a lane, versus
                  four that spend the same bonus for no change in outcome. Kept
                  loud: a positive-tone caption ABOVE the row plus a positive
                  left border, never folded into routine caption text. */}
              <button
                type="button"
                data-testid={`rtt-scout-prepare-${prep.lane}`}
                data-would-flip={prep.would_flip ? "true" : "false"}
                onClick={() => void onPrepare(prep.lane)}
                disabled={busy}
                className="flex w-full flex-col gap-1 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  borderBottom: "1px solid var(--v2-border-subtle)",
                  borderLeft: `2px solid ${prep.would_flip ? "var(--v2-color-positive)" : "transparent"}`,
                  paddingLeft: "var(--v2-space-3)",
                }}
              >
                {prep.would_flip ? (
                  <span
                    data-testid={`rtt-scout-flip-${prep.lane}`}
                    style={{
                      fontFamily: "var(--v2-font-mono)",
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--v2-color-positive)",
                    }}
                  >
                    ✓ Flips this lane to a win
                  </span>
                ) : null}
                <span className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-block",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: v2ToneVar(laneTone(prep.lane)),
                        flexShrink: 0,
                      }}
                    />
                    <span
                      className="truncate"
                      style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 600, fontSize: "0.875rem", color: "var(--v2-text-primary)" }}
                    >
                      {prep.label}
                    </span>
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--v2-font-mono)",
                      fontVariantNumeric: "tabular-nums",
                      fontFeatureSettings: "var(--v2-mono-feature)",
                      fontSize: "0.75rem",
                      color: "var(--v2-text-muted)",
                      flexShrink: 0,
                    }}
                  >
                    {prep.margin_before.toFixed(2)} → {prep.margin_after.toFixed(2)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Shape the Market: pick the role the next market is guaranteed to serve. */
function RolePanel({
  roles,
  available,
  busy,
  sink,
  onChoose,
}: {
  roles: Role[];
  available: boolean;
  busy: boolean;
  sink: CreditSink | undefined;
  onChoose: (role: Role) => void;
}) {
  const effect = sink ? creditSinkPlainEffect(sink.id) : null;
  return (
    <div className="flex flex-col gap-3" data-testid="rtt-scout-roles">
      {effect ? <p style={SECONDARY_STYLE}>{effect}</p> : null}
      <ul className="flex flex-wrap gap-2">
        {roles.map((role) => (
          <li key={role}>
            <GameActionButton variant="secondary" size="sm" disabled={busy || !available} pendingLabel="Arming…" onAction={() => onChoose(role)} data-testid={`rtt-scout-role-${role}`}>
              {ROLE_LABELS[role]}
            </GameActionButton>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Reserve a Card: three revealed future cards, each at the price it would
 *  lock. A card already on the roster has no legal slot and cannot be
 *  reserved — the server says so, and this shows it rather than hiding it. */
function ReservePanel({
  candidates,
  available,
  busy,
  sink,
  onChoose,
}: {
  candidates: ReserveCandidate[];
  available: boolean;
  busy: boolean;
  sink: CreditSink | undefined;
  onChoose: (cardId: string) => void;
}) {
  const effect = sink ? creditSinkPlainEffect(sink.id) : null;
  return (
    <div className="flex flex-col gap-3" data-testid="rtt-scout-reserve">
      {effect ? <p style={SECONDARY_STYLE}>{effect}</p> : null}
      <ul className="flex flex-col">
        {candidates.map((candidate) => {
          const legal = candidate.legal_slots.length > 0;
          const blocked = !available || !legal;
          return (
            <li key={candidate.card_id}>
              <button
                type="button"
                data-testid={`rtt-scout-reserve-${candidate.card_id}`}
                onClick={() => void onChoose(candidate.card_id)}
                disabled={busy || blocked}
                className="flex w-full items-center justify-between gap-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60"
                style={{ borderBottom: "1px solid var(--v2-border-subtle)", opacity: blocked ? 0.6 : 1 }}
              >
                <PeakV2PlayerIdentity
                  name={candidate.player_name}
                  meta={`${candidate.anchor_season} · ${candidate.prime_score.toFixed(1)} prime score`}
                />
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <PeakV2Score value={candidate.locked_cost} label="Credits" size="sm" />
                  {!legal ? (
                    <span style={NEGATIVE_STYLE}>No legal slot — already on your roster.</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
