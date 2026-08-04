"use client";
import { SystemPublic } from "@/types/run-the-table";
import {
  PERK_EXACT_RULE_LABEL,
  PERK_TERM,
  RTT_COPY,
  perkAffectsCopy,
  perkPlainEffect,
  perkStrategyHint,
} from "@/lib/run-the-table-copy";

/**
 * Pick one System from the three the server offered.
 *
 * TERMINOLOGY (plan §5.2). The player reads **Front Office Perk**; the payload
 * field, the receipt and the methodology all still say `system`. The internal
 * name is stated in the header rather than hidden, so a player who meets
 * "Systems" in a receipt or an API response can connect the two without
 * guessing. Nothing is renamed anywhere but here.
 *
 * THREE LAYERS PER CARD (plan §6), in this order and no other:
 *
 *   1. the plain-language effect      — `perkPlainEffect`
 *   2. ONE strategic hint             — `perkStrategyHint`
 *   3. `See exact rule`, expandable   — `sys.summary`, VERBATIM
 *
 * WHY THE EXACT RULE IS STILL PRINTED. The dense line — "Cards in the bottom
 * 55% of PEAK3 3Y overall cost 35% less" — is the ENGINE's own
 * (`SYSTEMS[i]["summary"]` in `config.py`, guarded by that file's
 * `SYSTEM_PUBLISHED_THRESHOLDS` table). Rewriting it in friendlier prose would
 * let the displayed rule drift from the applied rule, which is the one thing
 * config.py's docstring forbids. So it is not rewritten and it is not dropped —
 * it moves BEHIND the first two lines, one tap away, where a player who wants
 * the thresholds finds them and a player meeting the game for the first time is
 * not asked to parse percentiles before they know what a perk does.
 * Transparency is MOVED, never removed.
 *
 * DOM ORDER IS LOAD-BEARING. `e2e/run-the-table.spec.ts:108` clicks
 * `[data-testid="rtt-system-select"] button` — the FIRST button in this
 * subtree. Layer 3 is a `<details>`/`<summary>`, which is NOT a `<button>` and
 * so cannot capture that click; it is still rendered after its option button,
 * inside the same `<li>`, and never in the header.
 */
interface Props {
  offer: SystemPublic[];
  active: SystemPublic[];
  act: number;
  busy: boolean;
  onSelect: (systemId: string) => void;
}

export default function SystemSelect({ offer, active, act, busy, onSelect }: Props) {
  return (
    <section
      data-testid="rtt-system-select"
      data-tour-id="rtt-system-select"
      className="rtt-decision-surface flex flex-col gap-3"
    >
      <header className="flex flex-col gap-1">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--peak-accent-text)" }}
        >
          Act {act} · Choose a {PERK_TERM.display}
        </span>
        <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          How will this front office operate?
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          One {PERK_TERM.display}, kept for the rest of the run. {RTT_COPY.perkBoundary}
        </p>
        {/* Stated in the open, not buried in a tooltip: the receipt, the API and
            the methodology all call this a System. */}
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Receipts and the API call these <strong>{PERK_TERM.internal}s</strong> — same thing.
        </p>
      </header>

      {active.length > 0 && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Already running: {active.map((s) => s.name).join(", ")}.
        </p>
      )}

      {/* Container query, not `sm:` — see `.rtt-decision-surface`. `sm:` fired
          on the VIEWPORT, so a 1024px screen got three ~92px System cards. */}
      <ul className="grid gap-2.5 @[440px]:grid-cols-2 @[640px]:grid-cols-3">
        {offer.map((sys) => {
          const plain = perkPlainEffect(sys.id);
          const hint = perkStrategyHint(sys.id);
          return (
            <li key={sys.id} className="min-w-0 flex flex-col gap-1.5">
              <button
                type="button"
                data-testid={`rtt-system-${sys.id}`}
                onClick={() => onSelect(sys.id)}
                disabled={busy}
                className="rtt-choice-btn h-full w-full text-left disabled:opacity-60"
              >
                <span
                  className="text-[9px] font-semibold uppercase tracking-widest"
                  style={{ color: "var(--text-muted)" }}
                >
                  {perkAffectsCopy(sys.affects)}
                </span>
                <span className="text-sm font-bold" style={{ color: "var(--peak-accent-text)" }}>
                  {sys.name}
                </span>
                {/* LAYER 1 — what it does, in the player's words. */}
                <span
                  className="rtt-perk-effect"
                  data-testid={`rtt-system-effect-${sys.id}`}
                >
                  {plain ?? sys.summary}
                </span>
                {/* LAYER 2 — one line on when it is worth taking. */}
                {hint && (
                  <span
                    className="text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                    data-testid={`rtt-system-hint-${sys.id}`}
                  >
                    {hint}
                  </span>
                )}
              </button>

              {/* LAYER 3 — the engine's exact, threshold-bearing rule,
                  verbatim, one tap away. Only rendered when the friendly line
                  replaced it: an unrecognised System already shows its summary
                  above, and printing it twice would be noise. */}
              {plain && (
                <details className="rtt-perk-rule-details" data-testid={`rtt-system-rule-${sys.id}`}>
                  {/* Underlined inline rather than in CSS: `.rtt-perk-rule` is
                      `display:flex`, which suppresses the native disclosure
                      marker, and this file may not edit `styles/tour.css`. */}
                  <summary
                    className="rtt-perk-rule cursor-pointer select-none self-start"
                    style={{ textDecoration: "underline", textUnderlineOffset: "2px" }}
                  >
                    {PERK_EXACT_RULE_LABEL}
                    <span className="sr-only"> for {sys.name}</span>
                  </summary>
                  <p
                    className="pt-1 text-[11px]"
                    style={{ color: "var(--text-secondary)" }}
                    data-testid={`rtt-system-summary-${sys.id}`}
                  >
                    {sys.summary}
                  </p>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
