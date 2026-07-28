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
  /** Phase 6E Part G: real coverage numbers for confident copy -- replaces
   * vague "limited coverage" text. 0/null falls back to a plain
   * "Experimental exact-season mode" label instead of a fabricated number. */
  rollableTeamSeasonCount?: number;
  supportedStartSeason?: string | null;
  supportedEndSeason?: string | null;
  /** Fired once the ceremony finishes and candidates are safe to reveal. */
  onRevealComplete?: () => void;
  /** Phase 6G Part C: incremented by the parent on every successful respin
   * (team or season). SpinStage doesn't replay the full spin ceremony for a
   * respin (it already happened once for this round) -- it just briefly
   * flashes the two wheel boxes so a respin still reads as a real, felt
   * game action rather than a silent text swap. */
  respinFlashKey?: number;
}

type CeremonyPhase = "spinning" | "locked" | "revealed";
type RampStage = "fast" | "slow";

// Total ceremony budget stays under the 2s hard ceiling
// (ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 3.2: "under 2 seconds") -- Phase 8
// pre-loop polish pushes the budget much closer to that ceiling (was ~1.7s
// total, felt fast/mechanical) for a more deliberate, suspenseful ceremony,
// while still leaving real margin under 2000ms.
const SPIN_MS = 1250;
const LOCK_MS = 400;
const COUNT_MS = 300;
// Phase 6G Part B (Phase 8: ramp switch moved earlier, from 55% to 45% of
// the spin budget, so more of the ceremony is spent in the dramatic,
// visibly-decelerating "slow" stage rather than the blurry "fast" one) --
// fast reel ticks for the first ~45% of the spin budget, then a visibly
// slower "decelerating" tick rate for the rest, so the reel reads as
// spinning-down-to-a-stop rather than a flat blur that abruptly halts. Two
// discrete stages (not a continuous easing curve) keeps this trivially
// cancelable/deterministic -- only ever two live intervals.
const FAST_TICK_MS = 90;
const SLOW_TICK_MS = 220;
const RAMP_SWITCH_MS = Math.round(SPIN_MS * 0.45);
// Reduced-motion still shows a real, discrete state machine (spinning ->
// locked -> revealed) instead of one continuous cycling animation -- "simple
// stepped reveal", not literally nothing -- but with near-zero delays so it
// stays well under the existing <500ms Playwright budget for this path.
const REDUCED_MOTION_LOCK_MS = 40;
const REDUCED_MOTION_REVEAL_MS = 40;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A small horizontal strip of pool items centered on the current tick --
 * the visual "reel" (Phase 6G Part B: replaces the single centered
 * name-swap with something that actually looks like it's cycling through
 * many real options, proving broad team/season coverage rather than just
 * asserting it in a coverage-count line). Purely cosmetic: the ACTUAL
 * selection is always `spin.franchise_display_name`/`spin.era_label`,
 * already resolved server-side before this component ever mounts -- this
 * strip never drives or previews the real outcome, it only dresses up the
 * "spinning" phase. */
function ReelStrip({
  items,
  activeIndex,
  rampStage,
}: {
  items: readonly string[];
  activeIndex: number;
  rampStage: RampStage;
}) {
  const windowSize = 5;
  const center = Math.floor(windowSize / 2);
  const visible = Array.from({ length: windowSize }, (_, i) => {
    const idx = ((activeIndex - center + i) % items.length + items.length) % items.length;
    return items[idx];
  });
  return (
    <div className="spin-reel-strip" data-phase="spinning" data-ramp={rampStage} aria-hidden="true">
      {visible.map((label, i) => (
        <span key={i} className={i === center ? "spin-reel-strip-active" : "spin-reel-strip-item"}>
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * Team wheel + second wheel (season for team_year, era/decade for team_decade
 * and exact_team_season) spin ceremony -- "Team + Season Reel Spinner v2"
 * (Phase 6G Part B: adds a real reel-strip, a fast->slow speed ramp, and
 * always-visible coverage copy on top of the Phase 6B lock/reveal mechanic)
 * -- two reels cycle -> lock -> eligible-count reveal, THEN (via
 * onRevealComplete) the parent shows actual candidate names.
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
 * versa.
 *
 * Respects prefers-reduced-motion via a stepped (not zero-delay, not
 * continuously animated) reveal -- see REDUCED_MOTION_*_MS. The reel
 * streak/lock-flash/reel-strip CSS (globals.css .spin-reel*) is also
 * neutralized entirely by the global prefers-reduced-motion media rule as a
 * second, belt-and-suspenders layer.
 */
export default function SpinStage({
  spin,
  roundNumber,
  totalRounds,
  franchiseNames,
  seasonLabels,
  rollableTeamSeasonCount = 0,
  supportedStartSeason = null,
  supportedEndSeason = null,
  onRevealComplete,
  respinFlashKey = 0,
}: Props) {
  // Always start in "spinning" for the initial render (server AND client)
  // -- checking prefers-reduced-motion here via a useState initializer
  // would run against `window === undefined` during SSR, and React reuses
  // that SSR'd value through hydration rather than recomputing it
  // client-side, so a real client-side reduced-motion preference would be
  // silently ignored. Instead, the check happens inside the effect below,
  // which only ever runs in the browser after mount.
  const [phase, setPhase] = useState<CeremonyPhase>("spinning");
  // Persists once true (never reset) -- unlike `phase`, this survives past
  // the brief ~450ms "locked" window so a test asserting after the
  // ceremony settles can still prove the locked phase actually happened,
  // without racing a live transient render (see the "locked state" e2e
  // test's own comment for why that race is real, not just theoretical).
  const [wasLocked, setWasLocked] = useState(false);
  const [rampStage, setRampStage] = useState<RampStage>("fast");
  const [teamTick, setTeamTick] = useState(0);
  const [secondTick, setSecondTick] = useState(0);
  const [logoFailed, setLogoFailed] = useState(false);
  const [justRespun, setJustRespun] = useState(false);
  const isTwoWheel = spin.spin_type !== "open_pool";
  const isTeamYear = spin.spin_type === "team_year";
  // Defensive fallback only -- every two-wheel spin (team_decade,
  // exact_team_season, team_year) always carries a real franchise_display_name
  // from the backend. If one somehow arrives null, this is a genuine missing-
  // data state, not a normal "open pool" outcome -- label it honestly as
  // such rather than with "Open Pool" branding (Phase 6C cleanup).
  const teamPool = franchiseNames.length > 0 ? franchiseNames : [spin.franchise_display_name ?? "Team-season unavailable"];
  const secondPool = isTeamYear
    ? (seasonLabels.length > 0 ? seasonLabels : [spin.era_label ?? ""])
    : ERA_LABELS;
  const secondWheelLabel = isTeamYear ? "Season" : "Era";

  useEffect(() => {
    if (prefersReducedMotion()) {
      setPhase("locked");
      setWasLocked(true);
      const t1 = window.setTimeout(() => setPhase("revealed"), REDUCED_MOTION_LOCK_MS);
      const t2 = window.setTimeout(
        () => onRevealComplete?.(),
        REDUCED_MOTION_LOCK_MS + REDUCED_MOTION_REVEAL_MS,
      );
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    }
    let fastInterval: number | undefined;
    let slowInterval: number | undefined;
    let rampTimer: number | undefined;
    if (isTwoWheel) {
      fastInterval = window.setInterval(() => {
        setTeamTick((t) => t + 1);
        setSecondTick((t) => t + 1);
      }, FAST_TICK_MS);
      rampTimer = window.setTimeout(() => {
        if (fastInterval) window.clearInterval(fastInterval);
        setRampStage("slow");
        slowInterval = window.setInterval(() => {
          setTeamTick((t) => t + 1);
          setSecondTick((t) => t + 1);
        }, SLOW_TICK_MS);
      }, RAMP_SWITCH_MS);
    }
    const t1 = window.setTimeout(() => {
      if (fastInterval) window.clearInterval(fastInterval);
      if (slowInterval) window.clearInterval(slowInterval);
      setPhase("locked");
      setWasLocked(true);
    }, SPIN_MS);
    const t2 = window.setTimeout(() => setPhase("revealed"), SPIN_MS + LOCK_MS);
    const t3 = window.setTimeout(() => onRevealComplete?.(), SPIN_MS + LOCK_MS + COUNT_MS);
    return () => {
      if (fastInterval) window.clearInterval(fastInterval);
      if (slowInterval) window.clearInterval(slowInterval);
      if (rampTimer) window.clearTimeout(rampTimer);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
    // Ceremony re-runs once per round only -- keyed by the parent via
    // `key={roundNumber}` on this component, so this effect intentionally
    // runs once per mount, not per prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Skip the initial mount (respinFlashKey starts at 0 and this effect
    // fires once on mount regardless) -- only a real increment from a
    // successful respin should flash.
    if (respinFlashKey === 0) return;
    setJustRespun(true);
    const t = window.setTimeout(() => setJustRespun(false), 350);
    return () => window.clearTimeout(t);
  }, [respinFlashKey]);

  const teamDisplayName = phase === "spinning" ? teamPool[teamTick % teamPool.length] : spin.franchise_display_name ?? "Team-season unavailable";
  const secondDisplay = phase === "spinning" ? secondPool[secondTick % secondPool.length] : spin.era_label ?? "";
  const colors = getTeamColors(phase === "spinning" ? teamDisplayName : spin.franchise_display_name);

  const coverageNote =
    isTeamYear && rollableTeamSeasonCount > 0 && supportedStartSeason && supportedEndSeason
      ? { count: rollableTeamSeasonCount.toLocaleString(), range: `${supportedStartSeason} to ${supportedEndSeason}` }
      : null;

  return (
    <div
      data-testid="spin-stage"
      data-phase={phase}
      data-was-locked={wasLocked}
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

      {/* Phase 6G Part B: always-visible coverage line -- proves broad
          team/season reach instead of only asserting it once, after the
          fact, in the post-reveal badge. Text changes per phase so it reads
          as live progress ("spinning through / searching") rather than a
          static label repeated three times. */}
      {isTwoWheel && (
        <div
          data-testid="spin-coverage-line"
          className="text-[11px] font-semibold text-center"
          style={{ color: "var(--text-muted)" }}
        >
          {phase === "spinning" && (
            <>
              {coverageNote
                ? `Spinning through ${coverageNote.count} team-seasons`
                : "Searching every team"}
              {" · "}
              {coverageNote ? `searching ${coverageNote.range}` : "searching all eligible seasons"}
            </>
          )}
          {phase === "locked" && "Locking in your roll…"}
          {phase === "revealed" &&
            (coverageNote ? `${coverageNote.count} rollable team-seasons · ${coverageNote.range}` : "Experimental exact-season mode")}
        </div>
      )}

      {phase === "locked" && (
        <div
          data-testid="spin-locked-badge"
          className="spin-locked-stamp self-center text-xs font-black uppercase tracking-[0.3em]"
        >
          Locked
        </div>
      )}

      {isTwoWheel ? (
        <div className="grid grid-cols-2 gap-3" role="status" aria-live="polite">
          <div
            data-testid="team-wheel"
            className={`spin-reel-streak-bg rounded-2xl p-4 flex flex-col items-center justify-center gap-2 text-center ${phase === "locked" || justRespun ? "spin-ceremony-lock-flash" : ""}`}
            data-phase={phase}
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-muted, #333)", minHeight: 108 }}
          >
            {phase === "revealed" && spin.team_logo_url && !logoFailed ? (
              // No configured remote-image domain allowlist yet -- see PlayerAvatar's module docstring.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-testid="team-badge"
                src={spin.team_logo_url}
                alt=""
                aria-hidden="true"
                width={52}
                height={52}
                style={{
                  width: 52,
                  height: 52,
                  objectFit: "contain",
                  boxShadow: `0 0 0 4px color-mix(in srgb, ${colors.primary} 25%, transparent)`,
                }}
                onError={() => setLogoFailed(true)}
              />
            ) : (
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
            )}
            <div className="min-w-0 w-full">
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                Team
              </div>
              {phase === "spinning" ? (
                <ReelStrip items={teamPool} activeIndex={teamTick} rampStage={rampStage} />
              ) : (
                <div
                  className="text-sm font-black truncate"
                  style={{ color: "var(--text-primary)" }}
                  title={teamDisplayName}
                >
                  {teamDisplayName}
                </div>
              )}
            </div>
          </div>
          <div
            data-testid="era-wheel"
            className={`spin-reel-streak-bg rounded-2xl p-4 flex flex-col items-center justify-center gap-2 text-center ${phase === "locked" || justRespun ? "spin-ceremony-lock-flash" : ""}`}
            data-phase={phase}
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-muted, #333)", minHeight: 108 }}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
              {secondWheelLabel}
            </div>
            {phase === "spinning" ? (
              <ReelStrip items={secondPool} activeIndex={secondTick} rampStage={rampStage} />
            ) : (
              <div
                className="text-2xl font-black"
                style={{ color: phase === "revealed" ? "var(--peak-accent, #f5c842)" : "var(--text-primary)" }}
              >
                {secondDisplay}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="py-3 flex items-center justify-center gap-2" data-testid="spin-ceremony-spinning" role="status" aria-live="polite">
          {phase === "spinning" && <span className="spin-ceremony-dot" aria-hidden="true" />}
          <span className="text-lg font-bold" style={{ color: "var(--text-secondary)" }}>
            {/* Legacy team+decade fallback only -- team_year mode never
                produces spin_type "open_pool" (Phase 6C removed that path
                entirely for team-year boards). Deliberately not branded
                "Open Pool" -- describes what it actually is: an
                unconstrained draw from the full duration pool, not a
                team+season-constrained roll. */}
            {phase === "spinning" ? "Spinning the full player pool…" : "Full player pool"}
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
