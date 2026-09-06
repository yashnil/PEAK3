"use client";

/**
 * PeakV2RTTChoiceNode — a written choice (Rest / Bank): two doors, one
 * press. A click on a choice IS the decision. Every choice states what it
 * costs you (`nodeChoiceTradeoff`) beneath its label, and a disabled choice
 * says why.
 */

import type { ActiveNode } from "@/types/run-the-table";
import { nodeChoiceTradeoff, nodeTypeCopy } from "@/lib/run-the-table-copy";
import GameActionButton from "@/components/game-feel/GameActionButton";
import CardArrival from "@/components/game-feel/CardArrival";
import PeakV2RTTDecisionHead from "./PeakV2RTTDecisionHead";

interface Props {
  node: ActiveNode;
  busy: boolean;
  act: number;
  stage: number;
  stagesPerAct: number;
  onChoose: (choiceId: string) => Promise<unknown>;
}

export default function PeakV2RTTChoiceNode({ node, busy, act, stage, stagesPerAct, onChoose }: Props) {
  const choices = node.choices ?? [];
  const copy = nodeTypeCopy(node.node_type);
  return (
    <div data-testid="rtt-choice-node" className="rtt-written">
      <PeakV2RTTDecisionHead eyebrow={`Act ${act} · Stop ${stage} of ${stagesPerAct} · ${copy.label}`} title={node.title} context={copy.purpose} />
      <ul className="rtt-doors" data-count={choices.length}>
        {choices.map((choice, i) => {
          const tradeoff = nodeChoiceTradeoff(node.node_type, choice.id);
          const disabled = busy || choice.disabled === true;
          return (
            <CardArrival key={choice.id} arrivalKey={choice.id} as="li" variant="slot" className="rtt-door-arrival">
              <GameActionButton
                variant="secondary"
                className="rtt-door"
                style={{ ["--rtt-door-accent" as string]: copy.accentVar, ["--rtt-deal-index" as string]: i } as React.CSSProperties}
                data-testid={`rtt-choice-${choice.id}`}
                disabled={disabled}
                aria-disabled={disabled || undefined}
                pendingLabel={<span className="rtt-door-body"><span className="rtt-door-title">Taking…</span></span>}
                onAction={() => onChoose(choice.id)}
              >
                <span className="rtt-door-body">
                  <span className="rtt-door-title">{choice.label}</span>
                  <span className="rtt-door-purpose">{choice.description}</span>
                  {tradeoff ? (
                    <span className="rtt-door-consequence" data-testid={`rtt-choice-tradeoff-${choice.id}`}>
                      {tradeoff}
                    </span>
                  ) : null}
                  {choice.disabled ? (
                    <span className="rtt-door-blocked" data-testid={`rtt-choice-disabled-${choice.id}`}>
                      {node.node_type === "rest_bank" ? "Nothing to recover — you are at full lives." : "Not available on this node."}
                    </span>
                  ) : null}
                </span>
              </GameActionButton>
            </CardArrival>
          );
        })}
      </ul>
    </div>
  );
}
