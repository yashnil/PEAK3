"use client";

/**
 * Your heat so far: four KEEP slots filling in order, and a compact CUT ledger.
 * Built from YOUR recorded decisions and the cards already dealt -- never
 * another seat's. Between heats the slots show the heat just scored, from its
 * public result.
 *
 * The slots are the shared `RosterSlotLock` primitive (the list item itself),
 * so a keep lands with the same lock beat a drafted player does elsewhere.
 */

import { Scissors } from "lucide-react";

import type { PrimeCutCard, PrimeCutMatchView } from "@/types/prime-cut";
import { RosterSlotLock } from "@/components/game-feel";
import { windowRange } from "./PrimeCutCard";

export default function PrimeCutLedger({ view, heatCards }: { view: PrimeCutMatchView; heatCards: PrimeCutCard[] }) {
  const state = view.public_state;
  const live = state.phase === "card" || state.phase === "card_forced" || state.phase === "heat_open";
  const lastResult = state.heat_results[state.heat_results.length - 1];
  const yourResult = lastResult?.seats.find((s) => s.seat_index === view.your_seat_index);
  const cards: PrimeCutCard[] = live ? heatCards : lastResult?.cards ?? [];
  const byIndex = new Map(cards.map((card) => [card.card_index, card]));
  const decisions = live ? view.private_state.decisions : yourResult?.decisions ?? [];
  const keeps = decisions.filter((d) => d.decision === "keep");
  const cuts = decisions.filter((d) => d.decision === "cut");

  return (
    <>
      <section className="pcut-slots" aria-label="Your keeps this heat" data-testid="pcut-slots">
        <h2 className="pcut-side-title">
          Keeps <span className="pk-numeral">{keeps.length}/4</span>
        </h2>
        <ol className="pcut-slots-list">
          {Array.from({ length: 4 }, (_, slot) => {
            const record = keeps[slot];
            const card = record ? byIndex.get(record.card_index) : undefined;
            return (
              <RosterSlotLock
                key={slot}
                slot={String(slot + 1)}
                state={card ? "filled" : "empty"}
                placeholder="Open"
                size="sm"
                className="pcut-slot"
                testId={`pcut-slot-${slot}`}
              >
                {card ? (
                  <span className="pcut-slot-body">
                    <span className="pcut-slot-name">{card.player_name}</span>
                    <span className="pcut-slot-window pk-numeral">
                      {windowRange(card.start_season, card.end_season)}
                    </span>
                    {record?.auto ? <span className="pcut-slot-auto">{record.auto}</span> : null}
                  </span>
                ) : null}
              </RosterSlotLock>
            );
          })}
        </ol>
      </section>
      <section className="pcut-ledger" aria-label="Your cuts this heat" data-testid="pcut-ledger">
        <h2 className="pcut-side-title">
          Cuts <span className="pk-numeral">{cuts.length}/4</span>
        </h2>
        {cuts.length === 0 ? (
          <p className="pcut-ledger-empty">No cuts yet.</p>
        ) : (
          <ol className="pcut-ledger-list">
            {cuts.map((record) => {
              const card = byIndex.get(record.card_index);
              return (
                <li key={record.card_index} className="pcut-ledger-item">
                  <Scissors size={12} aria-hidden="true" />
                  <span>{card?.player_name ?? `Card ${record.card_index + 1}`}</span>
                  {record.auto ? <span className="pcut-slot-auto">{record.auto}</span> : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </>
  );
}
