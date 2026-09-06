"use client";

/**
 * PeakV2RTTDraftRoom — the flagship decision: choose your peak.
 *
 * The offers dominate. Three or four exact-peak cards are dealt across the
 * decision surface; the roster, the resources and the run track are context
 * around them, never competitors. The rhythm is fixed:
 *
 *   deal (cards enter, staggered) → pick (one card lifts, the others recede,
 *   the credits meter projects the cost, the legal roster slots light) →
 *   lock (one press on a slot; the button holds `pending`) → consequence
 *   (the server's snapshot lands: the slot locks, the credits tween, the
 *   moment reads the name) → advance (the track moves).
 *
 * Nothing is computed here. `selectable`, `legal_slots`, `blocked_reason`,
 * `effective_cost` and `veteran_minimum_eligible` are the server's, and the
 * signing is one `onBuy` promise so the button can show its own envelope.
 */

import { useEffect, useMemo, useState } from "react";
import type { ActiveNode, DraftOffer, RosterSlotPublic } from "@/types/run-the-table";
import { draftOffers, slotLabel, type ScoutIntel, cardLaneSummary } from "@/lib/run-the-table-state";
import { bossRelevanceSentence, creditsForegoneSentence } from "@/lib/run-the-table-copy";
import GameActionButton from "@/components/game-feel/GameActionButton";
import CardArrival from "@/components/game-feel/CardArrival";
import PeakV2RTTOfferCard from "./PeakV2RTTOfferCard";
import PeakV2RTTDecisionHead from "./PeakV2RTTDecisionHead";
import PeakV2RTTCoach from "./PeakV2RTTCoach";
import { markCoachSeen } from "@/lib/run-the-table-coach";

interface Props {
  node: ActiveNode;
  slots: RosterSlotPublic[];
  credits: number;
  busy: boolean;
  act: number;
  stage: number;
  stagesPerAct: number;
  onBuy: (offer: DraftOffer, slotId: string, useVeteranMinimum: boolean) => Promise<unknown>;
  onPass: () => Promise<unknown>;
  /** The cost the header meter should project, or null. */
  onProject?: (cost: number | null, targetedSlots: string[]) => void;
  scoutIntel?: ScoutIntel | null;
}

export default function PeakV2RTTDraftRoom({ node, slots, credits, busy, act, stage, stagesPerAct, onBuy, onPass, onProject, scoutIntel = null }: Props) {
  const offers = draftOffers(node);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [useVetMin, setUseVetMin] = useState(true);

  // A refreshed market is a new board: nothing stays selected across it.
  const dealKey = `${node.node_id}:${node.refreshes_used ?? 0}`;
  useEffect(() => {
    setSelectedId(null);
  }, [dealKey]);

  const selected = offers.find((o) => o.card_id === selectedId) ?? null;
  const vetMinApplies = !!selected?.veteran_minimum_eligible && useVetMin;
  const payable = selected ? (vetMinApplies ? 0 : selected.cost) : 0;
  const canAfford = payable <= credits;
  const targeted = useMemo(() => selected?.legal_slots ?? [], [selected]);

  useEffect(() => {
    onProject?.(selected ? payable : null, targeted);
    return () => onProject?.(null, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.card_id, payable, targeted.join("|")]);

  return (
    <div data-testid="rtt-draft-room" className="rtt-draft" data-selected={selected ? "true" : "false"}>
      <PeakV2RTTDecisionHead
        eyebrow={`Act ${act} · Stop ${stage} of ${stagesPerAct} · Draft Room`}
        title={selected ? `Sign ${selected.player_name}?` : "Choose your peak."}
        context={selected ? creditsForegoneSentence(credits, payable) : `${offers.length} exact peak windows on the board. Sign one into a legal slot, or pass.`}
        aside={<PeakV2RTTCoach coach="first_choice" active={!selected} />}
      />

      <ul className="rtt-deal" data-count={offers.length} data-testid="rtt-draft-offers">
        {offers.map((offer, i) => {
          const isSelected = offer.card_id === selectedId;
          const blocked = !offer.selectable;
          const strongest = cardLaneSummary(offer.lane_percentiles).strongest.lane;
          const relevance = scoutIntel ? bossRelevanceSentence(strongest, scoutIntel.bossName, scoutIntel.weakestLane, scoutIntel.weakestLabel) : null;
          return (
            <PeakV2RTTOfferCard
              key={offer.card_id}
              card={offer}
              index={i}
              dealKey={dealKey}
              selected={isSelected}
              blocked={blocked}
              blockedReason={blocked ? offer.blocked_reason || "Cannot be signed right now." : null}
              price={offer.veteran_minimum_eligible ? "FREE" : offer.reserved ? `Reserved · ${offer.cost}` : offer.cost}
              priceTone={offer.veteran_minimum_eligible ? "positive" : "accent"}
              badge={offer.reserved ? "Reserved" : undefined}
              note={relevance}
              disabled={busy}
              size="lg"
              testId={`rtt-offer-${offer.card_id}`}
              onSelect={() => {
                markCoachSeen("first_choice");
                setSelectedId(isSelected ? null : offer.card_id);
              }}
            />
          );
        })}
      </ul>

      {selected ? (
        <CardArrival arrivalKey={selected.card_id} direction="up" variant="slot" className="rtt-commit" testId="rtt-draft-commit">
          <div className="rtt-commit-head">
            <span className="rtt-eyebrow">Sign into</span>
            {selected.veteran_minimum_eligible ? (
              <label className="rtt-commit-vet">
                <input type="checkbox" checked={useVetMin} onChange={(e) => setUseVetMin(e.target.checked)} disabled={busy} />
                Veteran Minimum — free, once per act
              </label>
            ) : null}
          </div>
          <PeakV2RTTCoach coach="first_credit" active={payable > 0} />
          {!canAfford ? (
            <p className="rtt-commit-short" role="alert">
              Not enough credits — this costs {payable} and you hold {credits}.
            </p>
          ) : null}
          <ul className="rtt-commit-slots">
            {selected.legal_slots.map((slotId) => {
              const slot = slots.find((s) => s.slot_id === slotId);
              const label = slot ? slotLabel(slot) : slotId;
              return (
                <li key={slotId}>
                  <GameActionButton
                    variant={slot?.card ? "secondary" : "primary"}
                    size="sm"
                    disabled={busy || !canAfford}
                    pendingLabel="Signing…"
                    data-testid={`rtt-draft-slot-${slotId}`}
                    onAction={() => {
                      markCoachSeen("first_credit");
                      return onBuy(selected, slotId, vetMinApplies);
                    }}
                  >
                    <span className="rtt-commit-slot-label">{label}</span>
                    <span className="rtt-commit-slot-sub">{slot?.card ? `replaces ${slot.card.player_name}` : "open"}</span>
                  </GameActionButton>
                </li>
              );
            })}
          </ul>
        </CardArrival>
      ) : null}

      {node.can_pass ? (
        <div className="rtt-pass">
          <GameActionButton variant="secondary" size="sm" data-testid="rtt-draft-pass" disabled={busy} pendingLabel="Passing…" onAction={onPass}>
            Pass · keep {credits} credits
          </GameActionButton>
        </div>
      ) : null}
    </div>
  );
}
