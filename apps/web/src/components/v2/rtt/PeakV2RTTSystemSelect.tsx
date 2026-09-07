"use client";

/**
 * PeakV2RTTSystemSelect — choose a Front Office Perk.
 *
 * Three perk cards, one press each. Same three layers as before (plain
 * effect, one hint, the engine's exact rule behind "See exact rule" — never
 * rewritten, because `sys.summary` is the threshold the engine actually
 * applies), presented as pressable cards rather than rows so the choice
 * reads like the draft it precedes.
 */

import type { SystemPublic } from "@/types/run-the-table";
import { PERK_EXACT_RULE_LABEL, PERK_TERM, RTT_COPY, perkAffectsCopy, perkPlainEffect, perkStrategyHint } from "@/lib/run-the-table-copy";
import GameActionButton from "@/components/game-feel/GameActionButton";
import CardArrival from "@/components/game-feel/CardArrival";
import PeakV2RTTDecisionHead from "./PeakV2RTTDecisionHead";

interface Props {
  offer: SystemPublic[];
  active: SystemPublic[];
  act: number;
  busy: boolean;
  onSelect: (systemId: string) => Promise<unknown>;
}

export default function PeakV2RTTSystemSelect({ offer, active, act, busy, onSelect }: Props) {
  return (
    <section data-testid="rtt-system-select" data-tour-id="rtt-system-select" className="rtt-perk-select">
      <PeakV2RTTDecisionHead
        eyebrow={`Act ${act} · ${PERK_TERM.display}`}
        title={active.length === 0 ? "How will this front office operate?" : "Add a second perk."}
        context={`Kept for the rest of the run. ${RTT_COPY.perkBoundary}`}
        aside={active.length > 0 ? <span className="rtt-eyebrow">Running: {active.map((s) => s.name).join(", ")}</span> : null}
      />
      <ul className="rtt-perk-cards" data-count={offer.length}>
        {offer.map((sys, i) => {
          const plain = perkPlainEffect(sys.id);
          const hint = perkStrategyHint(sys.id);
          return (
            <CardArrival key={sys.id} arrivalKey={sys.id} as="li" variant="slot" className="rtt-perk-card-arrival">
              <div className="rtt-perk-card" style={{ ["--rtt-deal-index" as string]: i } as React.CSSProperties}>
                <span className="rtt-eyebrow">{perkAffectsCopy(sys.affects)}</span>
                <span className="rtt-perk-card-name">{sys.name}</span>
                <span className="rtt-perk-card-effect" data-testid={`rtt-system-effect-${sys.id}`}>
                  {plain ?? sys.summary}
                </span>
                {hint ? (
                  <span className="rtt-perk-card-hint" data-testid={`rtt-system-hint-${sys.id}`}>
                    {hint}
                  </span>
                ) : null}
                {plain ? (
                  <details data-testid={`rtt-system-rule-${sys.id}`} className="rtt-perk-rule">
                    <summary>
                      {PERK_EXACT_RULE_LABEL}
                      <span className="sr-only"> for {sys.name}</span>
                    </summary>
                    <p data-testid={`rtt-system-summary-${sys.id}`}>{sys.summary}</p>
                  </details>
                ) : null}
                <GameActionButton size="sm" data-testid={`rtt-system-${sys.id}`} disabled={busy} pendingLabel="Choosing…" onAction={() => onSelect(sys.id)}>
                  Choose {sys.name}
                </GameActionButton>
              </div>
            </CardArrival>
          );
        })}
      </ul>
      <p className="rtt-fineprint">Receipts and the API call these {PERK_TERM.internal}s — same thing.</p>
    </section>
  );
}
