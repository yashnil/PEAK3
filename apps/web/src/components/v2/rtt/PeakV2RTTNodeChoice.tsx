"use client";

/**
 * PeakV2RTTNodeChoice — the fork: two doors, one stop.
 *
 * Two large pressable doors, each carrying only what the player needs to
 * choose: the node kind (its glyph and accent), the generator's title for
 * THIS seed, one line of purpose, one line of consequence. The long
 * explanatory paragraph a Scout & Prepare node used to carry is now taught
 * on the node itself, the first time it is opened (`PeakV2RTTCoach`).
 *
 * DOM order is unchanged on purpose: the option list is the first
 * interactive content, so `[data-testid="rtt-node-choice"] button` still
 * means "the first stage option".
 */

import type { NodeType, StageOption } from "@/types/run-the-table";
import { NODE_ICON_PATHS, RTT_COPY, nodeTypeCopy } from "@/lib/run-the-table-copy";
import GameActionButton from "@/components/game-feel/GameActionButton";
import CardArrival from "@/components/game-feel/CardArrival";
import PeakV2RTTDecisionHead from "./PeakV2RTTDecisionHead";

interface Props {
  options: StageOption[];
  act: number;
  stage: number;
  stagesPerAct: number;
  busy: boolean;
  onChoose: (option: StageOption) => Promise<unknown>;
}

function NodeTypeGlyph({ type }: { type: NodeType }) {
  const copy = nodeTypeCopy(type);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true" focusable="false" style={{ flexShrink: 0, color: copy.accentVar }}>
      <path d={NODE_ICON_PATHS[copy.icon]} />
    </svg>
  );
}

export default function PeakV2RTTNodeChoice({ options, act, stage, stagesPerAct, busy, onChoose }: Props) {
  return (
    <div data-testid="rtt-node-choice" className="rtt-fork">
      <PeakV2RTTDecisionHead eyebrow={`Act ${act} · Stop ${stage} of ${stagesPerAct}`} title="Where next?" context={RTT_COPY.branch} />
      <ul className="rtt-doors" data-count={options.length}>
        {options.map((option, i) => {
          const copy = nodeTypeCopy(option.node_type);
          return (
            <CardArrival key={option.node_id} arrivalKey={option.node_id} as="li" variant="slot" className="rtt-door-arrival">
              <GameActionButton
                variant="secondary"
                data-testid={`rtt-node-option-${option.node_id}`}
                data-node-type={option.node_type}
                className="rtt-door"
                style={{ ["--rtt-door-accent" as string]: copy.accentVar, ["--rtt-deal-index" as string]: i } as React.CSSProperties}
                disabled={busy}
                pendingLabel={
                  <span className="rtt-door-body">
                    <span className="rtt-door-kind">
                      <NodeTypeGlyph type={option.node_type} />
                      <span style={{ color: copy.accentTextVar }}>{copy.label}</span>
                    </span>
                    <span className="rtt-door-title">Opening…</span>
                  </span>
                }
                onAction={() => onChoose(option)}
              >
                <span className="rtt-door-body">
                  <span className="rtt-door-kind">
                    <NodeTypeGlyph type={option.node_type} />
                    <span style={{ color: copy.accentTextVar }}>{copy.label}</span>
                  </span>
                  <span className="rtt-door-title">{option.title}</span>
                  <span className="rtt-door-purpose">{copy.purpose}</span>
                  <span className="rtt-door-consequence">{nodeConsequenceShort(option.node_type)}</span>
                </span>
              </GameActionButton>
            </CardArrival>
          );
        })}
      </ul>
    </div>
  );
}

/** One line per node kind — the full consequence text stays in "How to play"
 *  and on the node itself. */
function nodeConsequenceShort(type: NodeType): string {
  switch (type) {
    case "draft_room":
      return "Sign one card or pass. Costs credits.";
    case "trade_desk":
      return "Swap one roster player. The refund offsets the incoming price.";
    case "film_room":
      return "Scout the boss free, or spend to shape the next market.";
    case "rest_bank":
      return "Recover a life or bank credits. Roster unchanged.";
    default:
      return "";
  }
}
