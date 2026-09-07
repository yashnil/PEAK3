"use client";

/**
 * PeakV2RTTCreditSinks — the priced controls a node offers, as one quiet
 * row under the decision: name, price, one line, and the reason when it is
 * locked. Every price is the payload's; `selectable` is the server's own
 * conjunction of available AND affordable.
 */

import type { CreditSink } from "@/types/run-the-table";
import { creditSinkPlainEffect, sinkUnavailableReason } from "@/lib/run-the-table-copy";
import GameActionButton from "@/components/game-feel/GameActionButton";

interface Props {
  sinks: CreditSink[];
  busy: boolean;
  onSpend: (sink: CreditSink) => Promise<unknown>;
  heading?: string;
}

export default function PeakV2RTTCreditSinks({ sinks, busy, onSpend, heading }: Props) {
  if (sinks.length === 0) return null;
  return (
    <div data-testid="rtt-credit-sinks" className="rtt-sinks">
      <span className="rtt-eyebrow">{heading ?? "Spend credits"}</span>
      <ul className="rtt-sinks-list">
        {sinks.map((sink) => {
          const reason = sink.selectable ? null : sinkUnavailableReason(sink.unavailable_reason);
          const plain = creditSinkPlainEffect(sink.id);
          return (
            <li key={sink.id} className="rtt-sink" data-selectable={sink.selectable ? "true" : "false"}>
              <span className="rtt-sink-text">
                <span className="rtt-sink-name">
                  {sink.name}
                  <span className="rtt-sink-limit"> · {sink.limit}</span>
                </span>
                <span className="rtt-sink-effect">{plain ?? sink.summary}</span>
                {reason ? (
                  <span className="rtt-sink-blocked" data-testid={`rtt-sink-blocked-${sink.id}`}>
                    {reason}
                  </span>
                ) : null}
              </span>
              <GameActionButton
                variant="secondary"
                size="sm"
                data-testid={`rtt-sink-${sink.id}`}
                data-sink-selectable={sink.selectable ? "true" : "false"}
                disabled={busy || !sink.selectable}
                pendingLabel="Spending…"
                onAction={() => onSpend(sink)}
              >
                <span data-testid={`rtt-sink-cost-${sink.id}`}>{sink.cost}</span> cr
              </GameActionButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
