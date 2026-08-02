"use client";
import type { CreditSink } from "@/types/run-the-table";
import { creditSinkPlainEffect, sinkUnavailableReason } from "@/lib/run-the-table-copy";

/**
 * The priced controls a node offers (spec §4): Market Refresh, Reserve a Card,
 * Role Focus, Emergency Recovery.
 *
 * ONE COMPONENT FOR ALL FOUR, because the payload gives all four the identical
 * shape (`CreditSink`) and the differences between them are all values rather
 * than structure. Adding a fifth sink to `config.CREDIT_SINKS` renders here
 * with no client change at all.
 *
 * THREE RULES THIS COMPONENT KEEPS:
 *
 * 1. **No price is stated here.** `cost`, `limit` and `summary` arrive on the
 *    payload with the exact values the engine charges. The plain-language line
 *    beside them (`creditSinkPlainEffect`) is deliberately non-numeric, so it
 *    cannot drift from `config.py`.
 * 2. **A locked control is SHOWN, with its reason.** Hiding it is how a player
 *    never learns the sink exists. `sink.unavailable_reason` is the engine's
 *    own stable code, rendered as a sentence — "Not enough credits", "This
 *    market has already been refreshed", "Already used this run" are three
 *    different problems with three different answers.
 * 3. **`selectable` is the server's conjunction of available AND affordable.**
 *    The button binds to that one boolean; it never re-derives affordability
 *    from `credits >= cost`, which is how a client ends up offering a purchase
 *    the server then refuses.
 */
interface Props {
  sinks: CreditSink[];
  busy: boolean;
  onSpend: (sink: CreditSink) => void;
  /** Rendered above the row. Omitted when the surface already has a heading. */
  heading?: string;
}

export default function CreditSinks({ sinks, busy, onSpend, heading }: Props) {
  if (sinks.length === 0) return null;

  return (
    <section
      data-testid="rtt-credit-sinks"
      className="flex flex-col gap-2 rounded-xl border p-3"
      style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
    >
      <h3
        className="text-[10px] font-bold uppercase tracking-widest"
        style={{ color: "var(--text-muted)" }}
      >
        {heading ?? "Spend credits"}
      </h3>
      <ul className="grid gap-2 @[440px]:grid-cols-2">
        {sinks.map((sink) => {
          const reason = sink.selectable ? null : sinkUnavailableReason(sink.unavailable_reason);
          const plain = creditSinkPlainEffect(sink.id);
          return (
            <li key={sink.id} className="min-w-0">
              <button
                type="button"
                data-testid={`rtt-sink-${sink.id}`}
                data-sink-selectable={sink.selectable ? "true" : "false"}
                onClick={() => onSpend(sink)}
                disabled={busy || !sink.selectable}
                className="rtt-choice-btn h-full w-full text-left disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className="text-sm font-bold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {sink.name}
                  </span>
                  {/* The price, from the payload. Never a literal. */}
                  <span
                    className="score-number shrink-0 text-xs font-bold"
                    data-testid={`rtt-sink-cost-${sink.id}`}
                    style={{ color: "var(--peak-accent)" }}
                  >
                    {sink.cost} cr
                  </span>
                </span>
                {plain && (
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {plain}
                  </span>
                )}
                {/* The engine's own published rule, verbatim, one line down —
                    the same "transparency is moved, never removed" arrangement
                    the perks use. */}
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {sink.summary}
                </span>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  Limit: {sink.limit}
                </span>
                {reason && (
                  <span
                    className="text-[10px] font-semibold"
                    data-testid={`rtt-sink-blocked-${sink.id}`}
                    style={{ color: "var(--incorrect)" }}
                  >
                    {reason}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
