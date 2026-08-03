"use client";
import { RunPublicState } from "@/types/run-the-table";
import { rosterPips } from "@/lib/run-the-table-state";

/**
 * The sticky bottom tray, mobile only (`.rtt-mobile-tray` hides itself at
 * lg+). Credits, lives, roster pips and the screen's ONE primary action, so a
 * phone never has to scroll to find either the resources a decision costs or
 * the button that commits it.
 *
 * Every control is at least 44x44px (`.rtt-tap`), and the tray reserves
 * `env(safe-area-inset-bottom)` so the action clears a home indicator.
 */
interface Props {
  state: RunPublicState;
  primaryLabel?: string | null;
  onPrimary?: (() => void) | null;
  primaryDisabled?: boolean;
}

export default function MobileTray({
  state,
  primaryLabel = null,
  onPrimary = null,
  primaryDisabled = false,
}: Props) {
  const pips = rosterPips(state);
  return (
    <div className="rtt-mobile-tray" data-testid="rtt-mobile-tray" data-tour-id="rtt-mobile-tray">
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Cr
            </span>
            <span
              className="score-number text-sm font-bold"
              style={{ color: "var(--peak-accent-text)" }}
              data-testid="rtt-mobile-credits"
            >
              {state.credits}
            </span>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Lives
            </span>
            <span
              className="score-number text-sm font-bold"
              style={{ color: state.lives <= 1 ? "var(--incorrect)" : "var(--correct)" }}
              data-testid="rtt-mobile-lives"
            >
              {state.lives}
            </span>
          </div>
          <ul className="flex items-center gap-1" aria-label="Roster slots filled">
            {pips.map((pip) => (
              <li
                key={pip.slot_id}
                className="rounded-full"
                style={{
                  width: pip.is_starter ? 10 : 7,
                  height: pip.is_starter ? 10 : 7,
                  background: pip.filled ? "var(--peak-accent)" : "var(--border-emphasis)",
                }}
              >
                <span className="sr-only">{`${pip.slot_id}: ${pip.filled ? "filled" : "empty"}`}</span>
              </li>
            ))}
          </ul>
        </div>
        {primaryLabel && onPrimary && (
          <button
            type="button"
            data-testid="rtt-mobile-primary"
            onClick={onPrimary}
            disabled={primaryDisabled}
            className="rtt-tap ml-auto shrink-0 rounded-lg px-4 text-xs font-bold uppercase tracking-wide disabled:opacity-50"
            style={{ background: "var(--peak-accent)", color: "#000" }}
          >
            {primaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
