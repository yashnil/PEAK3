"use client";

/**
 * PeakV2RTTTradeDesk — the V2 "current decision" for a `trade_desk` node,
 * in the same LIVE grammar `PeakV2RTTDraftRoom.tsx` already established:
 * hairline-divided `<ul>` rows instead of bordered/filled card buttons,
 * `PeakV2PlayerIdentity`/`PeakV2Score` for identity and numbers, a
 * `PeakV2Rule` in place of a nested bordered review panel, and
 * `PeakV2DataLane` for the lane-by-lane comparison (the exact pattern
 * `PeakV2RTTBattleResult.tsx` already uses for a real lane comparison).
 *
 * This is a straight V2 re-presentation of `TradeDesk.tsx`, not a
 * reimplementation: the four-step flow (send out → bring in → review →
 * confirm/cancel), the `TradeSelection` state machine, and every legality,
 * cost and refund figure are the SAME calls into `lib/run-the-table-state`
 * the legacy component makes. Nothing here re-derives role eligibility, a
 * net cost, or a refund — `buildTradeReview`, `chooseOutgoing`,
 * `chooseIncoming`, `incomingEligibility`, `outgoingAdvisory` and
 * `outgoingDeadEnd` are reused verbatim. The one deliberate departure is
 * presentational: colour tokens are resolved through the V2 `v2ToneVar`
 * vocabulary (`--v2-color-positive`/`--v2-color-negative`/the five
 * component tones) rather than the legacy `--correct`/`--incorrect`/
 * `laneColorVar` custom properties, mirroring how `PeakV2RTTShell.tsx` and
 * `PeakV2RTTBattleResult.tsx` already map lane tokens to `V2ComponentTone`
 * locally instead of importing the legacy hex/var lookup.
 */

import { useEffect, useState } from "react";
import { Ban, Check } from "lucide-react";
import { ActiveNode } from "@/types/run-the-table";
import {
  cardLaneSummary,
  EMPTY_TRADE_SELECTION,
  ROLE_LABELS,
  ScoutIntel,
  TradeSelection,
  buildTradeReview,
  chooseIncoming,
  chooseOutgoing,
  clearTradeSelection,
  formatSigned,
  incomingEligibility,
  outgoingAdvisory,
  outgoingDeadEnd,
  slotLabel,
  tradeIncoming,
  tradeOutgoing,
} from "@/lib/run-the-table-state";
import { bossRelevanceSentence, creditsForegoneSentence, nodeTypeCopy } from "@/lib/run-the-table-copy";
import PeakV2RTTDecisionHead from "./PeakV2RTTDecisionHead";
import PeakV2RTTCoach from "./PeakV2RTTCoach";
import GameActionButton from "@/components/game-feel/GameActionButton";
import PeakV2PlayerIdentity from "../PeakV2PlayerIdentity";
import PeakV2Score from "../PeakV2Score";
import PeakV2DataLane from "../PeakV2DataLane";
import PeakV2Rule from "../PeakV2Rule";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import { v2ToneVar } from "../v2-tone";
import type { V2ComponentTone, V2Tone } from "../v2-tone";

/** Lane token → V2 component tone. Same local lookup `PeakV2RTTShell.tsx`
 *  and `PeakV2RTTBattleResult.tsx` already keep, rather than the legacy
 *  `laneColorVar` hex/var approach. */
const LANE_TOKEN_TO_TONE: Record<string, V2ComponentTone> = {
  si: "si",
  tp: "tp",
  rec: "rec",
  po: "po",
  team: "team",
};

/** The colour a signed credit/lane delta should read in, in V2 tokens —
 *  the presentational equivalent of `signedColorVar`, which resolves to the
 *  legacy `--correct`/`--incorrect`/`--text-muted` custom properties. The
 *  SIGN comparison is the same; only the resolved token differs. */
function v2SignedTone(value: number): V2Tone {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function v2SignedColor(value: number): string {
  return v2ToneVar(v2SignedTone(value)) ?? "var(--v2-text-muted)";
}

interface Props {
  node: ActiveNode;
  credits: number;
  busy: boolean;
  onTrade: (outgoingSlotId: string, incomingCardId: string, netCost: number) => Promise<unknown>;
  onDecline: () => Promise<unknown>;
  act?: number;
  stage?: number;
  stagesPerAct?: number;
  /** The current act's Scout & Prepare report, if taken — same payoff as
   *  `PeakV2RTTDraftRoom`/legacy `TradeDesk`: an incoming card whose
   *  strongest lane counters the scouted weakness gets the "Scouted: hits
   *  …" line. */
  scoutIntel?: ScoutIntel | null;
}

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </span>
  );
}

/** A numbered step label. The step number/checkmark is the non-colour half
 *  of "state is never carried by colour alone" — same rule the legacy
 *  `StepHeading` states, just in the V2 micro-label idiom. */
function StepLabel({ step, title, done }: { step: number; title: string; done: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontSize: "0.6875rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: done ? "var(--v2-color-accent)" : "var(--v2-text-muted)",
        }}
      >
        Step {step} · {title}
      </span>
      {done ? (
        <Check size={11} strokeWidth={3} aria-hidden="true" style={{ color: "var(--v2-color-accent)" }} />
      ) : (
        <span className="sr-only">— not yet chosen</span>
      )}
    </div>
  );
}

function StrongestLaneDot({ token }: { token: string }) {
  const tone = LANE_TOKEN_TO_TONE[token];
  if (!tone) return null;
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: v2ToneVar(tone) }}
    />
  );
}

/** One label/value stat in the review grid — the V2-typography equivalent
 *  of the legacy `Row` `<dt>/<dd>` pair. */
function ReviewStat({ label, value, color = "var(--v2-text-secondary)" }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span
        className="truncate"
        style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: "var(--v2-mono-feature)",
          fontWeight: 700,
          fontSize: "0.8125rem",
          color,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** Row chrome shared by the outgoing and incoming lists — hairline bottom,
 *  gold left-accent when selected, dimmed when blocked. Selection/blocked
 *  state is never carried by this colour alone: every caller also pairs it
 *  with `aria-pressed`/`aria-disabled` and a text reason. */
function rowStyle(selected: boolean, blocked: boolean): React.CSSProperties {
  return {
    borderBottom: "1px solid var(--v2-border-subtle)",
    borderLeft: `2px solid ${selected ? "var(--v2-color-accent)" : "transparent"}`,
    paddingLeft: "var(--v2-space-3)",
    opacity: blocked ? 0.55 : 1,
  };
}

const ROW_BUTTON_CLASS =
  "flex w-full flex-col gap-1 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60";

export default function PeakV2RTTTradeDesk({
  node,
  credits,
  busy,
  onTrade,
  onDecline,
  scoutIntel = null,
  act,
  stage,
  stagesPerAct,
}: Props) {
  const incoming = tradeIncoming(node);
  const outgoing = tradeOutgoing(node);
  const [selection, setSelection] = useState<TradeSelection>(EMPTY_TRADE_SELECTION);

  // Reset on a node change — the caller cannot rely on a `key` here, same
  // constraint the legacy `TradeDesk` documents (`RunTheTableGame` renders
  // this in one branch of a long if/else chain).
  useEffect(() => {
    setSelection(EMPTY_TRADE_SELECTION);
  }, [node.node_id]);

  const pickedOut = outgoing.find((s) => s.slot_id === selection.outgoingSlotId) ?? null;
  const pickedIn = incoming.find((c) => c.card_id === selection.incomingCardId) ?? null;
  const review = buildTradeReview(node, selection, credits);
  const canConfirm = review !== null && review.blockedReason === null;

  function handleOutgoing(slotId: string): void {
    setSelection((current) => chooseOutgoing(current, slotId, incoming));
  }

  function handleIncoming(cardId: string): void {
    setSelection((current) => chooseIncoming(current, cardId));
  }

  return (
    <div data-testid="rtt-trade-desk" className="rtt-trade">
      <PeakV2RTTDecisionHead
        eyebrow={act ? `Act ${act} · Stop ${stage} of ${stagesPerAct} · Trade Desk` : "Trade Desk"}
        title={review ? `${review.outgoing.card.player_name} out, ${review.incoming.player_name} in?` : "Make a trade, or stand pat."}
        context={review ? `Net ${review.net} credits.` : node.summary}
        aside={<PeakV2RTTCoach coach="first_choice" active={review === null} />}
      />
      <details className="rtt-perk-rule rtt-trade-rule">
        <summary>How refunds work</summary>
        <span>{nodeTypeCopy("trade_desk").consequence}</span>
      </details>

      <div className="mt-4 grid gap-8 sm:grid-cols-2">
        {/* ---- Step 1 — who leaves --------------------------------------- */}
        <div className="min-w-0">
          <StepLabel step={1} title="Send out" done={pickedOut !== null} />
          <p className="mt-1" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
            Choose one player already on your roster.
          </p>
          <ul className="mt-1 flex flex-col">
            {outgoing.map((slot) => {
              const selected = slot.slot_id === selection.outgoingSlotId;
              // The outgoing column is NEVER gated — Step 1, and returning
              // to it resets Step 2 by design (`chooseOutgoing` drops an
              // incompatible incoming pick). A slot no offer on the board
              // can legally fill is surfaced as a neutral advisory before
              // it is clicked, never as a disabled control.
              const deadEnd = outgoingDeadEnd(slot, incoming);
              const advisory = selected ? null : (outgoingAdvisory(slot, pickedIn) ?? deadEnd);
              return (
                <li key={slot.slot_id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    disabled={busy}
                    onClick={() => handleOutgoing(slot.slot_id)}
                    className={ROW_BUTTON_CLASS}
                    style={rowStyle(selected, false)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <PeakV2PlayerIdentity
                        name={slot.card.player_name}
                        meta={`${slotLabel(slot)}${slot.is_starter ? " · Starter" : " · Bench"}`}
                        state={selected ? "selected" : "default"}
                        size="sm"
                      />
                      <PeakV2Score value={`+${slot.refund}`} label="Refund" tone="positive" size="sm" />
                    </div>
                    {advisory ? (
                      <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}>
                        {advisory}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* ---- Step 2 — who arrives -------------------------------------- */}
        <div className="min-w-0">
          <StepLabel step={2} title="Bring in" done={pickedIn !== null} />
          <p className="mt-1" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
            {pickedOut
              ? outgoingDeadEnd(pickedOut, incoming)
                ? `None of these players may play ${slotLabel(pickedOut)}. Pick a different player to send out, or decline.`
                : `Only players the model lists as legal for ${slotLabel(pickedOut)} can be picked.`
              : "Pick who leaves first — legality depends on the slot."}
          </p>
          <ul className="mt-1 flex flex-col">
            {incoming.map((card) => {
              const selected = card.card_id === selection.incomingCardId;
              const { eligible, reason } = selected ? { eligible: true, reason: null } : incomingEligibility(card, pickedOut);
              const blocked = !eligible;
              const strongest = cardLaneSummary(card.lane_percentiles).strongest;
              // Scout & Prepare payoff — same comparison `PeakV2RTTDraftRoom`
              // and the legacy `TradeDesk` use: does this card's own
              // strongest lane counter the scouted boss's weakest one?
              const relevance = scoutIntel
                ? bossRelevanceSentence(strongest.lane, scoutIntel.bossName, scoutIntel.weakestLane, scoutIntel.weakestLabel)
                : null;
              return (
                <li key={card.card_id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-disabled={blocked || undefined}
                    disabled={busy}
                    onClick={() => {
                      if (blocked) return;
                      handleIncoming(card.card_id);
                    }}
                    className={ROW_BUTTON_CLASS}
                    style={rowStyle(selected, blocked)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <StrongestLaneDot token={strongest.token} />
                        <PeakV2PlayerIdentity
                          name={card.player_name}
                          meta={`${card.window_label} · ${ROLE_LABELS[card.primary_role] ?? card.primary_role}`}
                          state={selected ? "selected" : "default"}
                          size="sm"
                        />
                      </div>
                      <div className="flex shrink-0 items-baseline gap-1.5">
                        {card.base_cost !== card.cost ? (
                          <span
                            style={{
                              fontFamily: "var(--v2-font-mono)",
                              fontSize: "0.6875rem",
                              color: "var(--v2-text-muted)",
                              textDecoration: "line-through",
                            }}
                          >
                            {card.base_cost}
                          </span>
                        ) : null}
                        <PeakV2Score value={card.cost} label="Cost" size="sm" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      {/* "What is foregone" (§5): the card's cost against
                          credits on hand, plus the slot it would replace
                          once Step 1 has picked who leaves. */}
                      <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}>
                        {creditsForegoneSentence(credits, card.cost)}
                        {pickedOut ? ` Replaces ${slotLabel(pickedOut)}.` : ""}
                      </span>
                      {relevance ? (
                        <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-color-positive)" }}>
                          {relevance}
                        </span>
                      ) : null}
                      {blocked && reason ? (
                        <span
                          className="flex items-center gap-1"
                          style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-color-negative)" }}
                        >
                          <Ban size={10} aria-hidden="true" />
                          {reason}
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <PeakV2Rule spacing="md" />

      {/* ---- Step 3 — review, Step 4 — confirm ---------------------------- */}
      <div>
        <StepLabel step={3} title="Review the trade" done={canConfirm} />

        {review === null ? (
          <p className="mt-2" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-muted)" }}>
            {pickedOut
              ? "Now pick one incoming player to see the full deal."
              : pickedIn
                ? "Now pick the roster player who leaves to see the full deal."
                : "Pick one roster player and one incoming player to see the full deal."}
          </p>
        ) : (
          <>
            {/* The one-line headline — `net N credits` is the number the
                player is agreeing to. */}
            <p className="mt-2" style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.9375rem", color: "var(--v2-text-primary)" }}>
              {review.outgoing.card.player_name} out, {review.incoming.player_name} in — net{" "}
              <span
                style={{
                  fontFamily: "var(--v2-font-mono)",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 700,
                  color: review.net > 0 ? "var(--v2-text-primary)" : "var(--v2-color-positive)",
                }}
              >
                {review.net}
              </span>{" "}
              credits.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
              <ReviewStat label={`Refund · ${review.outgoing.card.player_name}`} value={`+${review.refund}`} color="var(--v2-color-positive)" />
              <ReviewStat label={`Cost · ${review.incoming.player_name}`} value={`−${review.cost}`} color="var(--v2-text-primary)" />
              <ReviewStat
                label="Net credit change"
                value={review.net === 0 ? "0" : formatSigned(-review.net, 0)}
                color={v2SignedColor(-review.net)}
              />
              <ReviewStat
                label="Credits after the trade"
                value={String(review.creditsAfter)}
                color={review.affordable ? "var(--v2-text-primary)" : "var(--v2-color-negative)"}
              />
              <ReviewStat label={`Role in ${review.slotLabel}, before`} value={review.roleBefore} />
              <ReviewStat label={`Role in ${review.slotLabel}, after`} value={review.roleAfter} />
            </div>

            {/* Projected five-lane change — the CARDS' change, not the
                roster's (the roster total also depends on starter/bench
                weighting, which only the server recomputes). Reuses
                `PeakV2DataLane`, the same primitive
                `PeakV2RTTBattleResult` uses for a real lane comparison. */}
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <MicroLabel>Five-lane change in this slot</MicroLabel>
                <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>
                  Engine lane rating 0-100
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {review.laneDeltas.map((lane) => (
                  <div key={lane.lane} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <PeakV2DataLane
                        label={lane.label}
                        tone={LANE_TOKEN_TO_TONE[lane.token] ?? "accent"}
                        leftLabel="Outgoing"
                        leftValue={lane.outgoing.toFixed(1)}
                        rightLabel="Incoming"
                        rightValue={lane.incoming.toFixed(1)}
                        scaleMin={0}
                        scaleMax={100}
                      />
                    </div>
                    <span
                      className="shrink-0"
                      style={{
                        fontFamily: "var(--v2-font-mono)",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 700,
                        fontSize: "0.8125rem",
                        minWidth: "3rem",
                        textAlign: "right",
                        color: v2SignedColor(lane.delta),
                      }}
                    >
                      {formatSigned(lane.delta, 1)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>
                These are the two cards&apos; own lane values on the 0-100 scale the battle uses. Your roster
                total also depends on starter/bench weighting, which the server recomputes when the trade
                lands.
              </p>
            </div>

            <p
              className="mt-3"
              style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, color: review.legal ? "var(--v2-color-positive)" : "var(--v2-color-negative)" }}
            >
              {review.legal
                ? `Roster stays legal — the model lists ${review.slotLabel} among ${review.incoming.player_name}'s eligible slots.`
                : review.blockedReason}
            </p>
            {review.legal && review.blockedReason ? (
              <p className="mt-1" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-color-negative)" }}>
                {review.blockedReason}
              </p>
            ) : null}
          </>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <GameActionButton
            size="sm"
            data-testid="rtt-trade-confirm"
            disabled={busy || !canConfirm}
            pendingLabel="Trading…"
            onAction={() => {
              if (!review || !canConfirm) return Promise.resolve(null);
              return onTrade(review.outgoing.slot_id, review.incoming.card_id, review.net);
            }}
          >
            Confirm trade
          </GameActionButton>
          <PeakV2SecondaryAction
            size="sm"
            disabled={busy || (pickedIn === null && pickedOut === null)}
            onClick={() => setSelection(clearTradeSelection())}
          >
            Cancel
          </PeakV2SecondaryAction>
        </div>
      </div>

      {node.can_decline ? (
        <div className="mt-4">
          <GameActionButton variant="secondary" size="sm" data-testid="rtt-trade-decline" disabled={busy} pendingLabel="Declining…" onAction={onDecline}>
            Decline · stand pat
          </GameActionButton>
        </div>
      ) : null}
    </div>
  );
}
