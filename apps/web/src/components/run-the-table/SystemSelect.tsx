"use client";
import { SystemPublic } from "@/types/run-the-table";

/**
 * Pick one System from the three the server offered.
 *
 * The summary text is the ENGINE's own (`SYSTEMS[i]["summary"]` in
 * config.py) — the exact thresholds and discounts the pricing code will apply.
 * Rewriting it here in friendlier prose would let the displayed rule drift
 * from the applied rule, which is the one thing config.py's docstring forbids.
 */
interface Props {
  offer: SystemPublic[];
  active: SystemPublic[];
  act: number;
  busy: boolean;
  onSelect: (systemId: string) => void;
}

const AFFECTS_LABEL: Record<string, string> = {
  price: "Pricing",
  battle: "Battle",
  economy: "Economy",
};

export default function SystemSelect({ offer, active, act, busy, onSelect }: Props) {
  return (
    <section data-testid="rtt-system-select" className="rtt-decision-surface flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--peak-accent)" }}
        >
          Act {act} · Choose a System
        </span>
        <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          How will this front office operate?
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          One System, kept for the rest of the run. It changes what cards cost you or how your
          bench counts — never what a player is worth.
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
        {offer.map((sys) => (
          <li key={sys.id} className="min-w-0">
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
                {AFFECTS_LABEL[sys.affects] ?? sys.affects}
              </span>
              <span className="text-sm font-bold" style={{ color: "var(--peak-accent)" }}>
                {sys.name}
              </span>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {sys.summary}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
