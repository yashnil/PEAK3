"use client";

/**
 * PeakV2RTTDraftRoom — the V2 "current decision" for a `draft_room` node
 * (Pass 3), the flagship/most common RTT decision and the one the reference
 * mockup depicts directly (E2 page 12/16 — engine-priced cards, sign into a
 * legal slot). Same two-step "pick a card, then pick a slot" interaction
 * `DraftRoom.tsx` already uses; every price, legality and blocked-reason
 * string is the server's (`draftOffers`, `DraftOffer`) — nothing here
 * recomputes a cost or invents hint copy.
 */

import { useState } from "react";
import { ActiveNode, DraftOffer, RosterSlotPublic } from "@/types/run-the-table";
import { cardLaneSummary, draftOffers, slotLabel } from "@/lib/run-the-table-state";
import { creditsForegoneSentence } from "@/lib/run-the-table-copy";
import PeakV2LiveHeader from "../PeakV2LiveHeader";
import PeakV2PlayerIdentity from "../PeakV2PlayerIdentity";
import PeakV2Score from "../PeakV2Score";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import { RANKING_COMPONENT_TONE } from "@/lib/v2-component-map";
import { v2ToneVar } from "../v2-tone";

interface Props {
  node: ActiveNode;
  slots: RosterSlotPublic[];
  credits: number;
  busy: boolean;
  onBuy: (offer: DraftOffer, slotId: string, useVeteranMinimum: boolean) => void;
  onPass: () => void;
}

function StrongestLaneDot({ offer }: { offer: DraftOffer }) {
  const strongest = cardLaneSummary(offer.lane_percentiles).strongest.lane;
  const tone = RANKING_COMPONENT_TONE[strongest as keyof typeof RANKING_COMPONENT_TONE];
  if (!tone) return null;
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: v2ToneVar(tone) }}
    />
  );
}

export default function PeakV2RTTDraftRoom({ node, slots, credits, busy, onBuy, onPass }: Props) {
  const offers = draftOffers(node);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [useVetMin, setUseVetMin] = useState(true);

  const selected = offers.find((o) => o.card_id === selectedId) ?? null;
  const vetMinApplies = !!selected?.veteran_minimum_eligible && useVetMin;
  const payable = selected ? (vetMinApplies ? 0 : selected.cost) : 0;
  const canAfford = payable <= credits;

  return (
    <div>
      <PeakV2LiveHeader title="Draft Room" subtitle={node.summary} as="h1" />

      <ul className="mt-4 flex flex-col">
        {offers.map((offer) => {
          const isSelected = offer.card_id === selectedId;
          const blocked = !offer.selectable;
          const free = offer.veteran_minimum_eligible;
          return (
            <li key={offer.card_id}>
              <button
                type="button"
                aria-pressed={isSelected}
                aria-disabled={blocked || undefined}
                disabled={busy}
                onClick={() => {
                  if (blocked) return;
                  setSelectedId(isSelected ? null : offer.card_id);
                }}
                className="flex w-full items-center justify-between gap-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  borderBottom: "1px solid var(--v2-border-subtle)",
                  borderLeft: `2px solid ${isSelected ? "var(--v2-color-accent)" : "transparent"}`,
                  paddingLeft: "var(--v2-space-3)",
                  opacity: blocked ? 0.55 : 1,
                }}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <StrongestLaneDot offer={offer} />
                  <PeakV2PlayerIdentity
                    name={offer.player_name}
                    meta={`${offer.window_label} · ${offer.primary_role}`}
                    state={isSelected ? "selected" : "default"}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {blocked ? (
                    <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-color-negative)" }}>
                      {offer.blocked_reason || "Cannot be drafted right now."}
                    </span>
                  ) : free ? (
                    <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-color-positive)" }}>
                      FREE
                    </span>
                  ) : (
                    <PeakV2Score value={offer.cost} label="Credits" size="sm" />
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {selected ? (
        <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--v2-border-subtle)" }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.9375rem", color: "var(--v2-text-primary)" }}>
              Where does {selected.player_name} go?
            </p>
            <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}>
              {creditsForegoneSentence(credits, payable)}
            </span>
          </div>

          {selected.veteran_minimum_eligible ? (
            <label className="mt-2 flex items-center gap-2 text-xs" style={{ color: "var(--v2-text-secondary)", fontFamily: "var(--v2-font-ui)" }}>
              <input type="checkbox" checked={useVetMin} onChange={(e) => setUseVetMin(e.target.checked)} disabled={busy} />
              Use this act&apos;s Veteran Minimum (one card free per act)
            </label>
          ) : null}

          {!canAfford ? (
            <p className="mt-2" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-color-negative)" }}>
              Not enough credits at {payable}.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {selected.legal_slots.map((slotId) => {
              const slot = slots.find((s) => s.slot_id === slotId);
              return (
                <PeakV2SecondaryAction
                  key={slotId}
                  size="sm"
                  disabled={busy || !canAfford}
                  onClick={() => onBuy(selected, slotId, vetMinApplies)}
                >
                  {slot ? slotLabel(slot) : slotId}
                  {slot?.card ? ` · replaces ${slot.card.player_name}` : " · open"}
                </PeakV2SecondaryAction>
              );
            })}
          </div>
        </div>
      ) : null}

      {node.can_pass ? (
        <div className="mt-4">
          <PeakV2SecondaryAction onClick={onPass} disabled={busy}>
            Pass · keep the credits
          </PeakV2SecondaryAction>
        </div>
      ) : null}
    </div>
  );
}
