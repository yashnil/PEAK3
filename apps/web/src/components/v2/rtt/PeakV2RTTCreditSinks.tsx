"use client";

/**
 * PeakV2RTTCreditSinks — the V2 presentation of the priced controls a node
 * offers (spec §4): Market Refresh, Reserve a Card, Role Focus, Emergency
 * Recovery. A straight V2 re-presentation of legacy `CreditSinks.tsx`, not a
 * reimplementation — same payload, same three rules that component's own
 * docstring states (no price computed here, a locked control is shown with
 * its reason, `selectable` is the server's own conjunction of available AND
 * affordable) — only the visual grammar changes.
 *
 * WHY THIS FILE EXISTS. `RunTheTableGame.tsx`'s `v2Content` branches for
 * Trade Desk and the generic Choice/Rest-Bank node rendered legacy
 * `CreditSinks` UNCHANGED — `rounded-xl border`, `var(--bg-surface)`,
 * `var(--text-muted)`, `.rtt-choice-btn`, none of them V2 tokens. That is
 * exactly the "legacy content under `?ui=v2`" failure mode this pass exists
 * to close: a real, interactive control (Market Refresh, Emergency Recovery)
 * sitting inside an otherwise fully V2 screen, styled as if V2 did not exist.
 * This component is the fix — hairline rows and V2 typography, matching the
 * grammar `PeakV2RTTChoiceNode.tsx`/`PeakV2RTTScoutPrepare.tsx` already use
 * for a priced, selectable row.
 */

import type { CreditSink } from "@/types/run-the-table";
import { creditSinkPlainEffect, sinkUnavailableReason } from "@/lib/run-the-table-copy";
import PeakV2Score from "../PeakV2Score";

interface Props {
  sinks: CreditSink[];
  busy: boolean;
  onSpend: (sink: CreditSink) => void;
  /** Rendered above the row. Omitted when the surface already has a heading. */
  heading?: string;
}

const EYEBROW_STYLE = {
  fontFamily: "var(--v2-font-mono)",
  fontSize: "0.6875rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
  color: "var(--v2-text-muted)",
};

const SECONDARY_STYLE = {
  fontFamily: "var(--v2-font-ui)",
  fontSize: "0.75rem",
  color: "var(--v2-text-secondary)",
};

const MUTED_STYLE = {
  fontFamily: "var(--v2-font-ui)",
  fontSize: "0.6875rem",
  color: "var(--v2-text-muted)",
};

const NEGATIVE_STYLE = {
  fontFamily: "var(--v2-font-ui)",
  fontSize: "0.6875rem",
  fontWeight: 700,
  color: "var(--v2-color-negative)",
};

export default function PeakV2RTTCreditSinks({ sinks, busy, onSpend, heading }: Props) {
  if (sinks.length === 0) return null;

  return (
    <div data-testid="rtt-credit-sinks" className="mt-4">
      <span style={EYEBROW_STYLE}>{heading ?? "Spend credits"}</span>
      <ul className="mt-1 flex flex-col">
        {sinks.map((sink) => {
          const reason = sink.selectable ? null : sinkUnavailableReason(sink.unavailable_reason);
          const plain = creditSinkPlainEffect(sink.id);
          const blocked = busy || !sink.selectable;
          return (
            <li key={sink.id}>
              <button
                type="button"
                data-testid={`rtt-sink-${sink.id}`}
                data-sink-selectable={sink.selectable ? "true" : "false"}
                onClick={() => onSpend(sink)}
                disabled={blocked}
                className="pk-lift flex w-full flex-col gap-1 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed"
                style={{
                  borderBottom: "1px solid var(--v2-border-subtle)",
                  borderLeft: `2px solid ${sink.selectable && !busy ? "var(--v2-color-accent)" : "transparent"}`,
                  paddingLeft: "var(--v2-space-3)",
                  opacity: sink.selectable ? 1 : 0.55,
                }}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span
                    style={{
                      fontFamily: "var(--v2-font-ui)",
                      fontWeight: 700,
                      fontSize: "0.875rem",
                      color: "var(--v2-text-primary)",
                    }}
                  >
                    {sink.name}
                  </span>
                  {/* The price, from the payload. Never a literal. */}
                  <span data-testid={`rtt-sink-cost-${sink.id}`} className="shrink-0">
                    <PeakV2Score value={sink.cost} label="Credits" size="sm" />
                  </span>
                </span>
                {plain ? <span style={SECONDARY_STYLE}>{plain}</span> : null}
                {/* The engine's own published rule, verbatim, one line down —
                    the same "transparency is moved, never removed"
                    arrangement legacy already keeps. */}
                <span style={MUTED_STYLE}>{sink.summary}</span>
                <span style={MUTED_STYLE}>Limit: {sink.limit}</span>
                {reason ? (
                  <span data-testid={`rtt-sink-blocked-${sink.id}`} style={NEGATIVE_STYLE}>
                    {reason}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
