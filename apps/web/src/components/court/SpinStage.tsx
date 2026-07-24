"use client";
import { useEffect, useState } from "react";
import { CurrentSpin, ERA_LABELS } from "@/types/perfect-season";
import { getTeamColors } from "@/lib/team-colors";

interface Props {
  spin: CurrentSpin;
  roundNumber: number;
  totalRounds: number;
  /** The actual resolvable team-wheel pool (readiness endpoint) -- the team
   * reel cycles through exactly this list, never a broader decorative list
   * that includes franchises no spin could ever land on. */
  franchiseNames: string[];
  /** The actual resolvable exact-season pool (readiness endpoint,
   * experimental_team_year_season_labels) -- used ONLY for team_year spins'
   * second reel. Never falls back to the decade ERA_LABELS, which would mix
   * a decade string into a round that will resolve to an exact season. */
  seasonLabels: string[];
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
 * Team wheel + second wheel (season for team_year, era/decade for team_decade
 * and exact_team_season) spin ceremony (Phase 6B: premium reel/reveal
 * visual pass over the Phase 6A mechanic) -- two reels cycle -> lock ->
 * eligible-count reveal, THEN (via onRevealComplete) the parent shows
 * actual candidate names.
 *
 * The backend already resolved the spin and sent full candidate data the
 * moment this component receives `spin` -- this ceremony is purely
 * client-side pacing. No candidate name or count is rendered by this
 * component until the "revealed" phase, and the parent (CourtBuilder) does
 * not mount the actual candidate-selection UI until onRevealComplete fires,
 * so nothing leaks early regardless of what's already in memory. The reel
 * cycling itself only ever shows names drawn from `franchiseNames` (the true
 * resolvable set) and either the fixed `ERA_LABELS` or the true resolvable
 * `seasonLabels` set -- never a name that could not actually be the spin's
 * outcome, and never a decade label mixed into a team_year round or vice
 * versa (Phase 6A Goal 5/6: the wheel must not mix decade and exact-year
 * labels).
 *
 * Respects prefers-reduced-motion by skipping straight to "revealed" with
 * no timers at all -- not just faster CSS, genuinely instant. The reel
 * streak/lock-flash CSS (globals.css .spin-reel*) is also neutralized by
 * the global prefers-reduced-motion media rule as a second, belt-and-
 * suspenders layer.
 */
export default function SpinStage({ spin, roundNumber, totalRounds, franchiseNames, seasonLabels, onRevealComplete }: Props) {
  // Always start in "spinning" for the initial render (server AND client)
  // -- checking prefers-reduced-motion here via a useState initializer
  // would run against `window === undefined` during SSR, and React reuses
  // that SSR'd value through hydration rather than recomputing it
  // client-side, so a real client-side reduced-motion preference would be
  // silently ignored. Instead, the check happens inside the effect below,
  // which only ever runs in the browser after mount.
  const [phase, setPhase] = useState<CeremonyPhase>("spinning");
  const [teamTick, setTeamTick] = useState(0);
  const [secondTick, setSecondTick] = useState(0);
  const isTwoWheel = spin.spin_type !== "open_pool";
  const isTeamYear = spin.spin_type === "team_year";
  const teamPool = franchiseNames.length > 0 ? franchiseNames : [spin.franchise_display_name ?? "Open Pool"];
  const secondPool = isTeamYear
    ? (seasonLabels.length > 0 ? seasonLabels : [spin.era_label ?? ""])
    : ERA_LABELS;
  const secondWheelLabel = isTeamYear ? "Season" : "Era";

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
        setSecondTick((t) => t + 1);
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

  const teamDisplayName = phase === "spinning" ? teamPool[teamTick % teamPool.length] : spin.franchise_display_name ?? "Open Pool";
  const secondDisplay = phase === "spinning" ? secondPool[secondTick % secondPool.length] : spin.era_label ?? "";
  const colors = getTeamColors(phase === "spinning" ? teamDisplayName : spin.franchise_display_name);

  return (
    <div
      data-testid="spin-stage"
      data-phase={phase}
      className="spin-reel p-4 flex flex-col gap-3"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="round-progress-dots" aria-hidden="true">
          {Array.from({ length: totalRounds }).map((_, i) => {
            const n = i + 1;
            const state = n < roundNumber ? "done" : n === roundNumber ? "current" : "upcoming";
            return <span key={n} className="round-progress-dot" data-state={state} />;
          })}
        </div>
        <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
          Round {roundNumber} / {totalRounds}
        </span>
      </div>

      {spin.spin_type !== "open_pool" && phase === "revealed" && (
        <span
          data-testid="interim-data-label"
          className="self-start rounded px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: "rgba(245,200,66,0.15)", color: "var(--peak-accent, #f5c842)" }}
        >
          {isTeamYear ? "Exact-season data — limited coverage" : "Interim team data — limited coverage"}
        </span>
      )}

      {isTwoWheel ? (
        <div className="grid grid-cols-2 gap-3" role="status" aria-live="polite">
          <div
            data-testid="team-wheel"
            className={`spin-reel-streak-bg rounded-2xl p-4 flex flex-col items-center justify-center gap-2 text-center ${phase === "locked" ? "spin-ceremony-lock-flash" : ""}`}
            data-phase={phase}
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-muted, #333)", minHeight: 108 }}
          >
            <div
              data-testid="team-badge"
              aria-hidden="true"
              className={`rounded-full flex items-center justify-center font-black text-base ${phase === "spinning" ? "spin-ceremony-reel-tick" : ""}`}
              style={{
                width: 52,
                height: 52,
                background: colors.primary,
                color: colors.secondary,
                border: `2.5px solid ${colors.secondary}`,
                boxShadow: phase === "revealed" ? `0 0 0 4px color-mix(in srgb, ${colors.primary} 25%, transparent)` : undefined,
              }}
            >
              {colors.initials}
            </div>
            <div className="min-w-0 w-full">
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                Team
              </div>
              <div
                className={`text-sm font-black truncate ${phase === "spinning" ? "spin-ceremony-reel-tick" : ""}`}
                style={{ color: "var(--text-primary)" }}
              >
                {teamDisplayName}
              </div>
            </div>
          </div>
          <div
            data-testid="era-wheel"
            className={`spin-reel-streak-bg rounded-2xl p-4 flex flex-col items-center justify-center gap-2 text-center ${phase === "locked" ? "spin-ceremony-lock-flash" : ""}`}
            data-phase={phase}
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-muted, #333)", minHeight: 108 }}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
              {secondWheelLabel}
            </div>
            <div
              className={`text-2xl font-black ${phase === "spinning" ? "spin-ceremony-reel-tick" : ""}`}
              style={{ color: phase === "revealed" ? "var(--peak-accent, #f5c842)" : "var(--text-primary)" }}
            >
              {secondDisplay}
            </div>
          </div>
        </div>
      ) : (
        <div className="py-3 flex items-center justify-center gap-2" data-testid="spin-ceremony-spinning" role="status" aria-live="polite">
          {phase === "spinning" && <span className="spin-ceremony-dot" aria-hidden="true" />}
          <span className="text-lg font-bold" style={{ color: "var(--text-secondary)" }}>
            {phase === "spinning" ? "Spinning the open pool…" : "Open Pool"}
          </span>
        </div>
      )}

      {phase === "revealed" && (
        <div className="text-xs" style={{ color: "var(--text-secondary)" }} data-testid="eligible-count-reveal">
          {spin.spin_type !== "open_pool" && (
            <div data-testid="roll-summary" className="text-sm font-bold mb-0.5" style={{ color: "var(--text-primary)" }}>
              You rolled: {spin.franchise_display_name} · {spin.era_label}
            </div>
          )}
          <span>
            {spin.candidates.length} eligible player{spin.candidates.length === 1 ? "" : "s"} found
            {spin.spin_type === "team_decade" && " for this team and era — pick one to start."}
            {spin.spin_type === "exact_team_season" && " on this exact roster — pick one to start."}
            {spin.spin_type === "team_year" && " on this exact roster — pick one to start."}
            {spin.spin_type === "open_pool" && " — pick one to start."}
          </span>
        </div>
      )}
    </div>
  );
}
