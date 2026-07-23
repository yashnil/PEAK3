"use client";
import { useEffect, useState } from "react";
import { CurrentSpin, ERA_LABELS } from "@/types/perfect-season";

interface Props {
  spin: CurrentSpin;
  roundNumber: number;
  totalRounds: number;
  /** The actual resolvable team-wheel pool (readiness endpoint) -- the team
   * reel cycles through exactly this list, never a broader decorative list
   * that includes franchises no spin could ever land on. */
  franchiseNames: string[];
  /** Fired once the ceremony finishes and candidates are safe to reveal. */
  onRevealComplete?: () => void;
}

type CeremonyPhase = "spinning" | "locked" | "revealed";

// Total ceremony budget stays well under the 2s ceiling
// (ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 3.2).
const SPIN_MS = 900;
const LOCK_MS = 450;
const COUNT_MS = 350;
const REEL_TICK_MS = 90;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Team wheel + era wheel spin ceremony: two reels cycle -> lock -> eligible-
 * count reveal, THEN (via onRevealComplete) the parent shows actual
 * candidate names.
 *
 * The backend already resolved the spin and sent full candidate data the
 * moment this component receives `spin` -- this ceremony is purely
 * client-side pacing. No candidate name or count is rendered by this
 * component until the "revealed" phase, and the parent (CourtBuilder) does
 * not mount the actual candidate-selection UI until onRevealComplete fires,
 * so nothing leaks early regardless of what's already in memory. The reel
 * cycling itself only ever shows names drawn from `franchiseNames` (the true
 * resolvable set) and the fixed `ERA_LABELS` -- never a name that could not
 * actually be the spin's outcome.
 *
 * Respects prefers-reduced-motion by skipping straight to "revealed" with
 * no timers at all -- not just faster CSS, genuinely instant.
 */
export default function SpinStage({ spin, roundNumber, totalRounds, franchiseNames, onRevealComplete }: Props) {
  // Always start in "spinning" for the initial render (server AND client)
  // -- checking prefers-reduced-motion here via a useState initializer
  // would run against `window === undefined` during SSR, and React reuses
  // that SSR'd value through hydration rather than recomputing it
  // client-side, so a real client-side reduced-motion preference would be
  // silently ignored. Instead, the check happens inside the effect below,
  // which only ever runs in the browser after mount.
  const [phase, setPhase] = useState<CeremonyPhase>("spinning");
  const [teamTick, setTeamTick] = useState(0);
  const [eraTick, setEraTick] = useState(0);
  const isTwoWheel = spin.spin_type !== "open_pool";
  const teamPool = franchiseNames.length > 0 ? franchiseNames : [spin.franchise_display_name ?? "Open Pool"];

  useEffect(() => {
    if (prefersReducedMotion()) {
      setPhase("revealed");
      onRevealComplete?.();
      return;
    }
    let reelInterval: number | undefined;
    if (isTwoWheel) {
      reelInterval = window.setInterval(() => {
        setTeamTick((t) => t + 1);
        setEraTick((t) => t + 1);
      }, REEL_TICK_MS);
    }
    const t1 = window.setTimeout(() => {
      if (reelInterval) window.clearInterval(reelInterval);
      setPhase("locked");
    }, SPIN_MS);
    const t2 = window.setTimeout(() => setPhase("revealed"), SPIN_MS + LOCK_MS);
    const t3 = window.setTimeout(() => onRevealComplete?.(), SPIN_MS + LOCK_MS + COUNT_MS);
    return () => {
      if (reelInterval) window.clearInterval(reelInterval);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
    // Ceremony re-runs once per round only -- keyed by the parent via
    // `key={roundNumber}` on this component, so this effect intentionally
    // runs once per mount, not per prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teamDisplay = phase === "spinning" ? teamPool[teamTick % teamPool.length] : spin.franchise_display_name ?? "Open Pool";
  const eraDisplay = phase === "spinning" ? ERA_LABELS[eraTick % ERA_LABELS.length] : spin.era_label ?? "";

  return (
    <div
      data-testid="spin-stage"
      data-phase={phase}
      className="rounded-2xl border p-4 flex flex-col gap-2 overflow-hidden"
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

      {isTwoWheel ? (
        <div className="flex items-stretch gap-2" role="status" aria-live="polite">
          <div
            data-testid="team-wheel"
            className={`flex-1 rounded-xl p-3 text-center ${phase === "locked" ? "spin-ceremony-lock-flash" : ""}`}
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-muted, #333)" }}
          >
            <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Team
            </div>
            <div
              className={`text-base font-bold ${phase === "spinning" ? "spin-ceremony-reel-tick" : ""}`}
              style={{ color: "var(--text-primary)" }}
            >
              {teamDisplay}
            </div>
          </div>
          <div
            data-testid="era-wheel"
            className={`flex-1 rounded-xl p-3 text-center ${phase === "locked" ? "spin-ceremony-lock-flash" : ""}`}
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-muted, #333)" }}
          >
            <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Era
            </div>
            <div
              className={`text-base font-bold ${phase === "spinning" ? "spin-ceremony-reel-tick" : ""}`}
              style={{ color: "var(--text-primary)" }}
            >
              {eraDisplay}
            </div>
          </div>
        </div>
      ) : (
        <div className="py-2 flex items-center gap-2" data-testid="spin-ceremony-spinning" role="status" aria-live="polite">
          {phase === "spinning" && <span className="spin-ceremony-dot" aria-hidden="true" />}
          <span className="text-lg font-bold" style={{ color: "var(--text-secondary)" }}>
            {phase === "spinning" ? "Spinning the open pool…" : "Open Pool"}
          </span>
        </div>
      )}

      {phase === "revealed" && (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }} data-testid="eligible-count-reveal">
          {spin.candidates.length} eligible player{spin.candidates.length === 1 ? "" : "s"} found
          {spin.spin_type === "team_decade" && " for this team and era — pick one to start."}
          {spin.spin_type === "exact_team_season" && " on this exact roster — pick one to start."}
          {spin.spin_type === "open_pool" && " — pick one to start."}
        </p>
      )}
    </div>
  );
}
