"use client";

/**
 * PeakV2RTTSystemSelect — the V2 "current decision" for a `system_select`
 * node: pick one of the three offered Front Office Perks (Pass 3). This is
 * the center content only; `PeakV2RTTShell` (layout="live") already renders
 * the run-map/roster rails and the status strip around it.
 *
 * Same server-authoritative choice `SystemSelect.tsx` renders, and the SAME
 * three-layer information architecture (plan §6) — this is a re-presentation
 * of that grammar in the V2 idiom, not a different decision:
 *
 *   1. `perkPlainEffect(sys.id)` — the plain-language effect
 *   2. `perkStrategyHint(sys.id)` — one strategic hint
 *   3. `sys.summary`, the engine's own threshold-bearing rule, VERBATIM,
 *      behind a `See exact rule` disclosure — one tap away, never dropped.
 *
 * See `SystemSelect.tsx`'s docstring for why layer 3 is never rewritten:
 * `sys.summary` is `SYSTEMS[i]["summary"]` in `config.py`, guarded by that
 * file's `SYSTEM_PUBLISHED_THRESHOLDS` table, and rewriting it would let the
 * displayed rule drift from the applied one.
 *
 * Hairline rows, not bordered cards — three short options read fine as a
 * vertical list at every width this shell renders at, so this skips the
 * container-query grid `SystemSelect.tsx` needs for its taller cards.
 * Selection is a dedicated `PeakV2SecondaryAction` per row (gold stays
 * reserved for focus/selection elsewhere in this system, and this screen has
 * no staged/uncommitted state to distinguish — picking a Perk submits it).
 */

import { SystemPublic } from "@/types/run-the-table";
import {
  PERK_EXACT_RULE_LABEL,
  PERK_TERM,
  RTT_COPY,
  perkAffectsCopy,
  perkPlainEffect,
  perkStrategyHint,
} from "@/lib/run-the-table-copy";
import PeakV2LiveHeader from "../PeakV2LiveHeader";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";

interface Props {
  offer: SystemPublic[];
  active: SystemPublic[];
  act: number;
  busy: boolean;
  onSelect: (systemId: string) => void;
}

export default function PeakV2RTTSystemSelect({ offer, active, act, busy, onSelect }: Props) {
  return (
    <section data-testid="rtt-system-select" data-tour-id="rtt-system-select">
      <PeakV2LiveHeader
        as="h1"
        status={
          <span
            style={{
              fontFamily: "var(--v2-font-mono)",
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--v2-text-muted)",
            }}
          >
            Act {act}
          </span>
        }
        title="How will this front office operate?"
        subtitle={`One ${PERK_TERM.display}, kept for the rest of the run. ${RTT_COPY.perkBoundary}`}
      />

      {/* Stated in the open, not buried in a tooltip: the receipt, the API and
          the methodology all call this a System. */}
      <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
        Receipts and the API call these <strong>{PERK_TERM.internal}s</strong> — same thing.
      </p>

      {active.length > 0 && (
        <p
          className="mt-1"
          style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}
        >
          Already running: {active.map((s) => s.name).join(", ")}.
        </p>
      )}

      <ul className="mt-3 flex flex-col">
        {offer.map((sys, i) => {
          const plain = perkPlainEffect(sys.id);
          const hint = perkStrategyHint(sys.id);
          return (
            <li key={sys.id}>
              <div
                className="flex flex-col gap-1.5 py-3.5"
                style={{ borderTop: i === 0 ? "1px solid var(--v2-border-subtle)" : undefined, borderBottom: "1px solid var(--v2-border-subtle)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span
                      style={{
                        fontFamily: "var(--v2-font-mono)",
                        fontSize: "0.625rem",
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--v2-text-muted)",
                      }}
                    >
                      {perkAffectsCopy(sys.affects)}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--v2-font-ui)",
                        fontWeight: 700,
                        fontSize: "0.9375rem",
                        color: "var(--v2-text-primary)",
                      }}
                    >
                      {sys.name}
                    </span>
                  </div>
                  <PeakV2SecondaryAction
                    size="sm"
                    data-testid={`rtt-system-${sys.id}`}
                    disabled={busy}
                    onClick={() => onSelect(sys.id)}
                    className="shrink-0"
                  >
                    Choose
                    <span className="sr-only"> {sys.name}</span>
                  </PeakV2SecondaryAction>
                </div>

                {/* LAYER 1 — what it does, in the player's words. */}
                <span
                  data-testid={`rtt-system-effect-${sys.id}`}
                  style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}
                >
                  {plain ?? sys.summary}
                </span>

                {/* LAYER 2 — one line on when it is worth taking. */}
                {hint && (
                  <span
                    data-testid={`rtt-system-hint-${sys.id}`}
                    style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}
                  >
                    {hint}
                  </span>
                )}

                {/* LAYER 3 — the engine's exact, threshold-bearing rule,
                    verbatim, one tap away. Only rendered when the friendly
                    line replaced it above — an unrecognised System already
                    shows its summary as layer 1, and printing it twice would
                    be noise. */}
                {plain && (
                  <details data-testid={`rtt-system-rule-${sys.id}`}>
                    <summary
                      className="cursor-pointer select-none"
                      style={{
                        fontFamily: "var(--v2-font-ui)",
                        fontSize: "0.75rem",
                        color: "var(--v2-text-secondary)",
                        textDecoration: "underline",
                        textUnderlineOffset: "2px",
                        width: "fit-content",
                      }}
                    >
                      {PERK_EXACT_RULE_LABEL}
                      <span className="sr-only"> for {sys.name}</span>
                    </summary>
                    <p
                      data-testid={`rtt-system-summary-${sys.id}`}
                      className="pt-1"
                      style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}
                    >
                      {sys.summary}
                    </p>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
