"use client";
import { useEffect, useState } from "react";
import { CurrentSpin } from "@/types/perfect-season";

interface Props {
  spin: CurrentSpin;
  roundNumber: number;
  totalRounds: number;
  /** Fired once the ceremony finishes and candidates are safe to reveal. */
  onRevealComplete?: () => void;
}

type CeremonyPhase = "spinning" | "locked" | "revealed";

// Total ceremony budget stays well under the 2s ceiling
// (ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 3.2).
const SPIN_MS = 900;
const LOCK_MS = 450;
const COUNT_MS = 350;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Team/decade spin ceremony: spin -> lock -> eligible-count reveal, THEN
 * (via onRevealComplete) the parent shows actual candidate names.
 *
 * The backend already resolved the spin and sent full candidate data the
 * moment this component receives `spin` -- this ceremony is purely
 * client-side pacing. No candidate name or count is rendered by this
 * component until the "revealed" phase, and the parent (CourtBuilder) does
 * not mount the actual candidate-selection UI until onRevealComplete fires,
 * so nothing leaks early regardless of what's already in memory.
 *
 * Respects prefers-reduced-motion by skipping straight to "revealed" with
 * no timers at all -- not just faster CSS, genuinely instant.
 */
export default function SpinStage({ spin, roundNumber, totalRounds, onRevealComplete }: Props) {
  // Always start in "spinning" for the initial render (server AND client)
  // -- checking prefers-reduced-motion here via a useState initializer
  // would run against `window === undefined` during SSR, and React reuses
  // that SSR'd value through hydration rather than recomputing it
  // client-side, so a real client-side reduced-motion preference would be
  // silently ignored. Instead, the check happens inside the effect below,
  // which only ever runs in the browser after mount.
  const [phase, setPhase] = useState<CeremonyPhase>("spinning");

  useEffect(() => {
    if (prefersReducedMotion()) {
      setPhase("revealed");
      onRevealComplete?.();
      return;
    }
    const t1 = window.setTimeout(() => setPhase("locked"), SPIN_MS);
    const t2 = window.setTimeout(() => setPhase("revealed"), SPIN_MS + LOCK_MS);
    const t3 = window.setTimeout(() => onRevealComplete?.(), SPIN_MS + LOCK_MS + COUNT_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
    // Ceremony re-runs once per round only -- keyed by the parent via
    // `key={roundNumber}` on this component, so this effect intentionally
    // runs once per mount, not per prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label =
    spin.spin_type === "open_pool"
      ? "Open Pool"
      : `${spin.franchise_display_name ?? ""}${spin.era_label ? " · " + spin.era_label : ""}`.trim();

  return (
    <div
      data-testid="spin-stage"
      data-phase={phase}
      className="rounded-2xl border p-4 flex flex-col gap-1 overflow-hidden"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
    >
      <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
        <span>
          Round {roundNumber} / {totalRounds}
        </span>
        {spin.spin_type !== "open_pool" && phase === "revealed" && (
          <span
            data-testid="interim-data-label"
            className="rounded px-2 py-0.5"
            style={{ background: "rgba(245,200,66,0.15)", color: "var(--peak-accent, #f5c842)" }}
          >
            Interim team data — limited coverage
          </span>
        )}
      </div>

      {phase === "spinning" ? (
        <div
          className="py-2 flex items-center gap-2"
          data-testid="spin-ceremony-spinning"
          role="status"
          aria-live="polite"
        >
          <span className="spin-ceremony-dot" aria-hidden="true" />
          <span className="text-lg font-bold" style={{ color: "var(--text-secondary)" }}>
            Spinning the era wheel…
          </span>
        </div>
      ) : (
        <div className={phase === "locked" ? "spin-ceremony-lock-flash" : ""} role="status" aria-live="polite">
          <div className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            {label || "Build your roster"}
          </div>
          {phase === "revealed" && (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }} data-testid="eligible-count-reveal">
              {spin.candidates.length} eligible player{spin.candidates.length === 1 ? "" : "s"} found
              {spin.spin_type === "team_decade" && " for this era — pick one to start."}
              {spin.spin_type === "exact_team_season" && " on this exact roster — pick one to start."}
              {spin.spin_type === "open_pool" && " — pick one to start."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
