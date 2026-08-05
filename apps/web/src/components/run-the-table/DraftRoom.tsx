"use client";
import { useState } from "react";
import { ActiveNode, DraftOffer, RosterSlotPublic } from "@/types/run-the-table";
import { cardLaneSummary, draftOffers, ScoutIntel, slotLabel } from "@/lib/run-the-table-state";
import { bossRelevanceSentence, creditsForegoneSentence } from "@/lib/run-the-table-copy";
import { Coachmark } from "@/components/ui/GuidedTour";
import RunCard from "./RunCard";

/**
 * Draft Room: three priced cards, buy one into a legal slot or pass.
 *
 * Two-step "pick a card, then pick a slot" — the same pattern CourtBuilder
 * uses for rearranging, and for the same reason: it works with a keyboard and
 * a screen reader with no drag machinery, and there is no half-completed drop.
 *
 * `cost`, `effective_cost`, `legal_slots`, `affordable`, `selectable` and
 * `blocked_reason` are ALL the server's. The only thing computed here is which
 * of the server's two prices to display once the player toggles the Veteran
 * Minimum off — and even then both numbers came from the payload.
 */
interface Props {
  node: ActiveNode;
  slots: RosterSlotPublic[];
  credits: number;
  busy: boolean;
  onBuy: (offer: DraftOffer, slotId: string, useVeteranMinimum: boolean) => void;
  onPass: () => void;
  /** The current act's Scout & Prepare report, if taken — see
   *  `RunTheTableGame`'s `activeScoutIntel`. Drives the "Scouted: hits …"
   *  line on any offer whose strongest lane counters the scouted weakness,
   *  and the matching highlight on its button. */
  scoutIntel?: ScoutIntel | null;
}

export default function DraftRoom({
  node,
  slots,
  credits,
  busy,
  onBuy,
  onPass,
  scoutIntel = null,
}: Props) {
  const offers = draftOffers(node);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Defaults ON when eligible, because that is the assumption the server's own
  // `effective_cost` / `affordable` / `selectable` fields were computed under.
  // Turning it off is a deliberate "save it for a better card this act" move.
  const [useVetMin, setUseVetMin] = useState(true);

  const selected = offers.find((o) => o.card_id === selectedId) ?? null;
  const vetMinApplies = !!selected?.veteran_minimum_eligible && useVetMin;
  const payable = selected ? (vetMinApplies ? 0 : selected.cost) : 0;
  const canAfford = payable <= credits;

  function slotById(slotId: string): RosterSlotPublic | undefined {
    return slots.find((s) => s.slot_id === slotId);
  }

  return (
    <section data-testid="rtt-draft-room" className="rtt-decision-surface flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--peak-accent-text)" }}
        >
          Draft Room
        </span>
        <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          {node.title}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {node.summary}
        </p>
      </header>

      {/* Container breakpoints, not viewport ones: this grid lives in a column
          that is ~324px wide at a 1024px viewport and ~724px at 1440px, so
          `md:grid-cols-3` was three ~92px cards on the narrow screen and three
          truncated ~235px cards on the wide one. See `.rtt-decision-surface`. */}
      <ul
        className="grid gap-2.5 @[560px]:grid-cols-2"
        data-testid="rtt-draft-offers"
      >
        {offers.map((offer) => {
          const isSelected = offer.card_id === selectedId;
          const free = offer.veteran_minimum_eligible;
          // A blocked offer is NOT `disabled`: `disabled` strips it from the
          // tab order, so a keyboard user never reached the one thing that
          // explains the grey card. `aria-disabled` + a click guard keeps it
          // focusable and inert. `busy` is transient and keeps using
          // `disabled`.
          const blocked = !offer.selectable;
          // Scout & Prepare payoff (brief §E / P3-E2): does this offer's own
          // strongest lane counter the scouted boss's weakest one? Pure
          // comparison of two `LaneField`s the server already sent
          // (`cardLaneSummary`, `ScoutIntel.weakestLane`) — never a new
          // ranking of the card.
          const relevance = scoutIntel
            ? bossRelevanceSentence(
                cardLaneSummary(offer.lane_percentiles).strongest.lane,
                scoutIntel.bossName,
                scoutIntel.weakestLane,
                scoutIntel.weakestLabel,
              )
            : null;
          const matchesScout = relevance !== null;
          return (
            <li key={offer.card_id} className="min-w-0">
              <button
                type="button"
                data-testid={`rtt-offer-${offer.card_id}`}
                data-matches-scout={matchesScout ? "true" : "false"}
                aria-pressed={isSelected}
                aria-disabled={blocked || undefined}
                onClick={() => {
                  if (blocked) return;
                  setSelectedId(isSelected ? null : offer.card_id);
                }}
                disabled={busy}
                className="rtt-offer-btn h-full w-full text-left disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  borderColor: isSelected
                    ? "var(--peak-accent)"
                    : blocked
                      ? "var(--border-subtle)"
                      : "var(--border-default)",
                  // Recessed by fill, never by opacity: a 0.55 wash would have
                  // dragged the blocked reason below AA on the one card that
                  // most needs to be read.
                  background: isSelected
                    ? "var(--peak-accent-bg)"
                    : blocked
                      ? "var(--bg-page)"
                      : "var(--bg-elevated)",
                  // The scout-match highlight is a RING, layered on top of the
                  // selection/blocked fill logic above rather than replacing
                  // it — a scouted card that is also selected or blocked must
                  // still read as selected/blocked first.
                  boxShadow: matchesScout && !blocked ? "inset 0 0 0 2px var(--peak-accent)" : undefined,
                }}
              >
                <RunCard
                  card={offer}
                  cost={free && useVetMin ? 0 : offer.cost}
                  strikeCost={free && useVetMin ? offer.cost : offer.base_cost}
                  // WHAT IS FOREGONE, not just what is gained (§5) — the
                  // card's own gain is already stated above this line;
                  // credits are the scarce resource the decision spends.
                  foregoneSentence={
                    blocked ? null : creditsForegoneSentence(credits, free && useVetMin ? 0 : offer.cost)
                  }
                  bossRelevance={relevance}
                />
                {free && (
                  <span
                    className="mt-1 inline-block text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5"
                    style={{ background: "var(--correct-bg)", color: "var(--correct)" }}
                  >
                    Veteran Minimum eligible
                  </span>
                )}
                {/* Always rendered when blocked. The server may send
                    `selectable: false` with a null `blocked_reason`, which
                    used to grey the card with no explanation at all. */}
                {blocked && (
                  <span
                    data-testid={`rtt-offer-blocked-${offer.card_id}`}
                    className="mt-1 block text-[10px] font-semibold"
                    style={{ color: "var(--incorrect)" }}
                  >
                    {offer.blocked_reason || "Cannot be drafted right now."}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {selected && (
        <div
          data-testid="rtt-draft-slot-picker"
          className="rounded-xl border p-3 flex flex-col gap-2.5"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--peak-accent-dim)" }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Where does {selected.player_name} go?
            </h3>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Pays <span className="score-number">{payable}</span> of{" "}
              <span className="score-number">{credits}</span> credits
            </span>
          </div>

          {selected.veteran_minimum_eligible && (
            <label
              className="rtt-checkbox-row text-xs"
              style={{ color: "var(--text-secondary)" }}
              data-testid="rtt-vet-min-row"
            >
              <input
                type="checkbox"
                data-testid="rtt-vet-min-toggle"
                checked={useVetMin}
                onChange={(e) => setUseVetMin(e.target.checked)}
                disabled={busy}
              />
              <span>Use this act&apos;s Veteran Minimum (one card free per act)</span>
            </label>
          )}

          {!canAfford && (
            <p className="text-xs font-semibold" style={{ color: "var(--incorrect)" }}>
              Not enough credits at <span className="score-number">{payable}</span>.
            </p>
          )}

          <ul className="flex flex-wrap gap-2">
            {selected.legal_slots.map((slotId) => {
              const slot = slotById(slotId);
              return (
                <li key={slotId}>
                  <button
                    type="button"
                    data-testid={`rtt-draft-slot-${slotId}`}
                    onClick={() => onBuy(selected, slotId, vetMinApplies)}
                    disabled={busy || !canAfford}
                    className="rtt-tap rounded-lg px-3 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: "var(--bg-surface)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-emphasis)",
                    }}
                  >
                    {slot ? slotLabel(slot) : slotId}
                    {slot?.card ? (
                      <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
                        replaces {slot.card.player_name}
                      </span>
                    ) : (
                      <span className="block text-[10px]" style={{ color: "var(--correct)" }}>
                        empty
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {node.can_pass && (
        <div>
          <button
            type="button"
            data-testid="rtt-draft-pass"
            onClick={onPass}
            disabled={busy}
            className="rtt-tap rounded-lg px-4 text-xs font-semibold uppercase tracking-wide disabled:opacity-60"
            style={{
              background: "var(--bg-surface)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-default)",
            }}
          >
            Pass · keep the credits
          </button>
        </div>
      )}

      {/* LAST in DOM order, deliberately. `e2e/run-the-table.spec.ts` drives a
          Draft Room by clicking `rtt-draft-pass`, and `stepOnce`'s other
          surfaces click the first enabled button inside the surface — a
          coachmark's "Got it" placed earlier would capture that click. */}
      <Coachmark id="draft_room" />
    </section>
  );
}
