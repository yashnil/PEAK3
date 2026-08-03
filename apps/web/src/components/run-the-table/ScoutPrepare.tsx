"use client";
import { useState } from "react";
import type { CSSProperties } from "react";
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
  nodeChoiceTradeoff,
  nodeTypeCopy,
  sinkUnavailableReason,
} from "@/lib/run-the-table-copy";
import { LANE_TOKEN_BY_FIELD, ROLE_LABELS, laneColorVar } from "@/lib/run-the-table-state";
import { Coachmark } from "@/components/ui/GuidedTour";
import { NodeTypeIcon } from "./NodeChoice";

/**
 * Scout & Prepare — the v3 replacement for the Film Room (spec §5).
 *
 * WHY THIS IS ITS OWN SURFACE rather than another `ChoiceNode`. The v2 node was
 * two written choices with no follow-up, which `ChoiceNode` renders perfectly.
 * v3's three branches each need a SECOND selection before they are a legal
 * action — a lane, a role, or a named card — and the outcome of each is data
 * the player has to read before choosing: the scout report's projected matchup,
 * the reservable candidates and their locked prices. A generic two-button
 * surface cannot show any of that, and the whole measured problem with the v2
 * node was that its information could not change a later decision.
 *
 * EVERY NUMBER ON THIS SCREEN CAME FROM THE SERVER. The projected margins, the
 * "would flip" flags, the prices, the prep bonus and the lane labels are all
 * `scout_and_prepare_options()`'s output — which is the same accessor
 * `action_film_room` validates against, so a choice shown here is a choice the
 * engine will accept.
 *
 * DOM ORDER IS LOAD-BEARING. `e2e/run-the-table.spec.ts` clicks the first
 * ENABLED `<button>` inside a surface, so the free `scout_boss` branch is
 * rendered first and the coachmark (which renders a "Got it" button) last.
 */
interface Props {
  node: ActiveNode;
  credits: number;
  busy: boolean;
  onScoutBoss: (lane: LaneField) => void;
  onShapeMarket: (role: Role) => void;
  onReserveCard: (cardId: string) => void;
}

export default function ScoutPrepare({
  node,
  credits,
  busy,
  onScoutBoss,
  onShapeMarket,
  onReserveCard,
}: Props) {
  const scout = node.scout;
  const copy = nodeTypeCopy("film_room");
  const [open, setOpen] = useState<ScoutChoice["id"]>("scout_boss");

  // A film_room payload with no `scout` block is an older API. Say so rather
  // than rendering an empty surface with three dead buttons.
  if (!scout) {
    return (
      <section
        data-testid="rtt-scout-prepare"
        role="alert"
        className="rtt-decision-surface flex flex-col gap-2"
      >
        <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          {node.title}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          This node needs a newer PEAK3 API than the one answering right now.
        </p>
      </section>
    );
  }

  const byId = new Map(scout.choices.map((c) => [c.id, c]));
  const scoutBoss = byId.get("scout_boss");
  const shapeMarket = byId.get("shape_market");
  const reserveCard = byId.get("reserve_card");
  const sinks = new Map((node.credit_sinks ?? []).map((s) => [s.id, s]));

  return (
    <section
      data-testid="rtt-scout-prepare"
      className="rtt-decision-surface flex flex-col gap-3"
      style={{ "--rtt-node-accent": copy.accentVar } as CSSProperties}
    >
      <header className="flex flex-col gap-1">
        <div className="rtt-node-head">
          <NodeTypeIcon type="film_room" />
          <div className="flex min-w-0 flex-col">
            <span className="rtt-node-kind">{copy.label}</span>
            <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
              {node.title}
            </h2>
          </div>
        </div>
        {/* The generator's own line. Printed, not suppressed: v3's
            `_NODE_COPY["film_room"]` describes exactly the three branches the
            engine implements. See `NodeTypeCopy.suppressServerSummary`. */}
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {node.summary}
        </p>
        <p className="rtt-node-consequence">{copy.consequence}</p>
      </header>

      {/* The three branches, always all three, each with its price. A branch
          the player cannot afford stays visible with its reason. */}
      <ul className="grid gap-2 @[440px]:grid-cols-3" data-testid="rtt-scout-branches">
        {scout.choices.map((choice) => {
          const sink = choice.id === "scout_boss" ? undefined : sinks.get(
            (choice.id === "shape_market" ? "role_focus" : "reserve_card") as CreditSink["id"],
          );
          const blocked = !choice.available;
          const reason = blocked ? sinkUnavailableReason(choice.unavailable_reason) : null;
          return (
            <li key={choice.id} className="min-w-0">
              <button
                type="button"
                data-testid={`rtt-scout-branch-${choice.id}`}
                data-open={open === choice.id ? "true" : "false"}
                data-available={choice.available ? "true" : "false"}
                aria-expanded={open === choice.id}
                onClick={() => setOpen(choice.id)}
                disabled={busy}
                className="rtt-choice-btn rtt-node-option h-full w-full text-left disabled:opacity-50"
                style={
                  open === choice.id
                    ? { borderColor: "var(--peak-accent)", background: "var(--peak-accent-bg)" }
                    : undefined
                }
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                    {choice.name}
                  </span>
                  <span
                    className="score-number shrink-0 text-xs font-bold"
                    data-testid={`rtt-scout-cost-${choice.id}`}
                    style={{ color: choice.cost === 0 ? "var(--correct)" : "var(--peak-accent)" }}
                  >
                    {choice.cost === 0 ? "Free" : `${choice.cost} cr`}
                  </span>
                </span>
                {choice.summary && (
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {choice.summary}
                  </span>
                )}
                {sink?.limit && (
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    Limit: {sink.limit}
                  </span>
                )}
                {nodeChoiceTradeoff("film_room", choice.id) && (
                  <span className="rtt-node-consequence" data-testid={`rtt-scout-tradeoff-${choice.id}`}>
                    {nodeChoiceTradeoff("film_room", choice.id)}
                  </span>
                )}
                {reason && (
                  <span
                    className="text-[10px] font-semibold"
                    data-testid={`rtt-scout-blocked-${choice.id}`}
                    style={{ color: "var(--incorrect)" }}
                  >
                    {reason}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {open === "scout_boss" && scoutBoss && (
        <ScoutBossPanel
          choice={scoutBoss}
          busy={busy}
          onPrepare={onScoutBoss}
        />
      )}

      {open === "shape_market" && shapeMarket && (
        <RolePanel
          roles={shapeMarket.roles ?? scout.roles}
          cost={shapeMarket.cost}
          credits={credits}
          available={shapeMarket.available}
          busy={busy}
          onChoose={onShapeMarket}
        />
      )}

      {open === "reserve_card" && reserveCard && (
        <ReservePanel
          candidates={reserveCard.candidates ?? []}
          cost={reserveCard.cost}
          available={reserveCard.available}
          busy={busy}
          onChoose={onReserveCard}
        />
      )}

      <Coachmark id="film_room" />
    </section>
  );
}

/**
 * Scout the Boss: the free branch.
 *
 * Shows the whole report the engine computed — rule, two strongest lanes,
 * weakest lane, projected matchup — and then the five capped preparations with
 * `would_flip` on each. `would_flip` is the only reason this node stops being
 * dead content: it says, before the player commits, whether the bonus actually
 * changes a lane result in the fight they are about to take.
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
      <p className="text-sm" style={{ color: "var(--text-secondary)" }} data-testid="rtt-scout-no-report">
        There is no boss left to scout in this run.
      </p>
    );
  }

  const strongest = report.lanes.filter((l) => report.strongest_lanes.includes(l.lane));
  const weakest = report.lanes.find((l) => l.lane === report.weakest_lane);

  return (
    <div className="flex flex-col gap-3" data-testid="rtt-scout-report">
      <div
        className="flex flex-col gap-1 rounded-xl border p-3"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          Act {report.act} boss
        </span>
        <span className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
          {report.name}
        </span>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {report.tagline}
        </span>
        {report.rule && (
          <p className="text-xs" data-testid="rtt-scout-rule" style={{ color: "var(--text-secondary)" }}>
            <strong style={{ color: "var(--peak-accent-text)" }}>{report.rule.name}</strong>{" "}
            {report.rule.summary}
          </p>
        )}
        <p className="text-xs" data-testid="rtt-scout-projection" style={{ color: "var(--text-secondary)" }}>
          Projected {report.projected_lanes_won}–{report.projected_lanes_lost} on lanes,{" "}
          {report.lanes_to_win} needed to win outright, total margin{" "}
          <span className="score-number">{report.projected_summed_margin.toFixed(2)}</span>.
        </p>
      </div>

      <dl className="grid gap-2 @[440px]:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Their two strongest lanes
          </dt>
          <dd className="text-sm" data-testid="rtt-scout-strongest" style={{ color: "var(--text-primary)" }}>
            {strongest.map((l) => l.label).join(", ")}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Their weakest lane
          </dt>
          <dd className="text-sm" data-testid="rtt-scout-weakest" style={{ color: "var(--text-primary)" }}>
            {weakest?.label ?? report.weakest_lane}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
          Prepare one lane for this battle only. The bonus is{" "}
          <span className="score-number">{choice.prep_bonus ?? report.preparations[0]?.bonus}</span> points,
          it applies to that lane and no other, and it is spent whether or not it helps.
        </p>
        <ul className="flex flex-col gap-1.5">
          {report.preparations.map((prep) => (
            <li key={prep.lane}>
              <button
                type="button"
                data-testid={`rtt-scout-prepare-${prep.lane}`}
                data-would-flip={prep.would_flip ? "true" : "false"}
                onClick={() => onPrepare(prep.lane)}
                disabled={busy}
                className="rtt-choice-btn w-full text-left disabled:opacity-50"
                style={{ borderLeft: `3px solid ${laneColorVar(LANE_TOKEN_BY_FIELD[prep.lane])}` }}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {prep.label}
                  </span>
                  <span className="score-number shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
                    {prep.margin_before.toFixed(2)} → {prep.margin_after.toFixed(2)}
                  </span>
                </span>
                {prep.would_flip && (
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide"
                    data-testid={`rtt-scout-flip-${prep.lane}`}
                    style={{ color: "var(--correct)" }}
                  >
                    Takes this lane
                  </span>
                )}
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
  cost,
  credits,
  available,
  busy,
  onChoose,
}: {
  roles: Role[];
  cost: number;
  credits: number;
  available: boolean;
  busy: boolean;
  onChoose: (role: Role) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="rtt-scout-roles">
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        The next market will carry at least one offer that can play the role you pick. Costs{" "}
        <span className="score-number">{cost}</span> of your{" "}
        <span className="score-number">{credits}</span> credits.
      </p>
      <ul className="grid gap-1.5 @[440px]:grid-cols-2">
        {roles.map((role) => (
          <li key={role}>
            <button
              type="button"
              data-testid={`rtt-scout-role-${role}`}
              onClick={() => onChoose(role)}
              disabled={busy || !available}
              className="rtt-choice-btn w-full text-left text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ color: "var(--text-primary)" }}
            >
              {ROLE_LABELS[role]}
            </button>
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
  cost,
  available,
  busy,
  onChoose,
}: {
  candidates: ReserveCandidate[];
  cost: number;
  available: boolean;
  busy: boolean;
  onChoose: (cardId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="rtt-scout-reserve">
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Reserving costs <span className="score-number">{cost}</span> credits and locks the card at
        the price shown. It appears in the next Draft Room and expires after it, so you still have
        to be able to pay for it there.
      </p>
      <ul className="flex flex-col gap-1.5">
        {candidates.map((candidate) => {
          const legal = candidate.legal_slots.length > 0;
          return (
            <li key={candidate.card_id}>
              <button
                type="button"
                data-testid={`rtt-scout-reserve-${candidate.card_id}`}
                onClick={() => onChoose(candidate.card_id)}
                disabled={busy || !available || !legal}
                className="rtt-choice-btn w-full text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                    {candidate.player_name}
                  </span>
                  <span
                    className="score-number shrink-0 text-xs font-bold"
                    style={{ color: "var(--peak-accent-text)" }}
                  >
                    {candidate.locked_cost} cr
                  </span>
                </span>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {candidate.anchor_season} ·{" "}
                  <span className="score-number">{candidate.prime_score.toFixed(1)}</span>
                </span>
                {!legal && (
                  <span className="text-[10px] font-semibold" style={{ color: "var(--incorrect)" }}>
                    No legal slot — that player is already on your roster.
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
