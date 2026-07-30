"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Lock } from "lucide-react";
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
  /** Phase 8C: which axis the most recent respin actually rerolled. Only
   * that wheel re-ticks; the other renders a visibly "locked" state
   * (playtest finding: team-only/season-only respins weren't visually
   * distinct). null outside of an active respin. */
  respinKind?: "team" | "season" | null;
  /** Phase 8D: render the compact "locked in" summary instead of the full
   * two-wheel ceremony card. Used while the player is placing their already-
   * chosen card on the court (step 2 of the round) -- the roll itself
   * already happened and finished revealing, so the full ceremony card would
   * just be dead weight competing with the court for space. Critically, this
   * prop does NOT gate whether SpinStage mounts (the parent keeps it mounted
   * for the entire round, spinning through placing, keyed only on
   * `roundNumber`) -- it only changes what the already-settled ceremony
   * renders. That's what fixes the "spinner replays when you reselect a
   * player" bug: previously the parent unmounted this component entirely
   * during placement, so canceling a selection (back to spinning, SAME
   * round) remounted it fresh and re-ran the mount-only ceremony effect. */
  collapsed?: boolean;
  /** Phase 8I: franchise_display_name -> resolved logo URL (readiness
   * endpoint's team_logo_urls). Passed straight through to the team reel so
   * every visible item can show its real logo while ticking, not just the
   * team that ends up landed -- falls back to the initials badge per-item
   * when a name has no entry (asset gate off, or that team unresolved). */
  teamLogoUrls?: Record<string, string>;
}

type CeremonyPhase = "spinning" | "locked" | "revealed";
type RampStage = "fast" | "medium" | "slow";

// Phase 8I: user playtest feedback was explicit -- "the spinner is still too
// fast" / "should spend a little more time as a reveal event, but not
// become annoying". This supersedes the older ARENA_OVERHAUL_PRODUCT_SPEC.md
// Sec 3.2 "under 2 seconds" TOTAL-ceremony guidance that shaped the previous
// 1250/400/300 split -- SPIN_MS alone now targets the product's own
// "roughly 1.6-2.4s" guidance for the initial spin, LOCK_MS/COUNT_MS
// unchanged (the landing beat was already reading as intentional; the
// complaint was specifically about the reel itself feeling rushed).
const SPIN_MS = 2000;
const LOCK_MS = 400;
const COUNT_MS = 300;
// Three discrete stages instead of two (fast -> medium -> slow) spreads the
// deceleration across more perceptible steps for a smoother spin-down feel,
// while staying deterministic/trivially cancelable -- same reasoning as the
// original two-stage design, just one more step given the longer SPIN_MS
// budget now has room for it.
const FAST_TICK_MS = 85;
const MEDIUM_TICK_MS = 150;
const SLOW_TICK_MS = 260;
const RAMP_TO_MEDIUM_MS = Math.round(SPIN_MS * 0.4);
const RAMP_TO_SLOW_MS = Math.round(SPIN_MS * 0.72);
// Reduced-motion still shows a real, discrete state machine (spinning ->
// locked -> revealed) instead of one continuous cycling animation -- "simple
// stepped reveal", not literally nothing -- but with near-zero delays so it
// stays well under the existing <500ms Playwright budget for this path.
const REDUCED_MOTION_LOCK_MS = 40;
const REDUCED_MOTION_REVEAL_MS = 40;
// Phase 8I: bumped from 480ms (product guidance: respin should read as a
// real re-roll, target ~1.0-1.6s) -- still meaningfully shorter than the
// first roll of a round (the player already knows what they're waiting
// for), just no longer so short it barely registers as a reel scroll.
const RESPIN_REROLL_MS = 1200;
const RESPIN_RAMP_TO_SLOW_MS = Math.round(RESPIN_REROLL_MS * 0.55);

// Phase 8J: fixed number of ticks the reel travels from start to landing,
// for the initial spin and for a respin respectively. Chosen to sit safely
// UNDER the number of ticks that naturally fire within SPIN_MS/
// RESPIN_REROLL_MS at the fast/medium/slow cadence above (roughly 15 ticks
// fire in a ~2000ms initial spin; roughly 10 fire in a ~1200ms respin) --
// so in the overwhelming common case the reel reaches its target through
// ordinary ticking, with 1-2 ticks of margin to spare, rather than relying
// on the safety-net snap (see the ceremony effects below) to cover for
// normal timer variance.
const INITIAL_SPIN_TRAVEL_TICKS = 13;
const RESPIN_TRAVEL_TICKS = 8;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Phase 8J: the deterministic reel target -- root-cause fix for "the reel
 * visually showed 2016-17, then the result became 1999-00". The OLD
 * ticking model just incremented a counter forever (`t => t + 1`, no
 * destination) while a completely separate `phase === "revealed"` branch
 * swapped in the real `spin.franchise_display_name`/`era_label` once the
 * ceremony's fixed timers ran out -- the ticking reel and the final result
 * were never the same computation, so nothing guaranteed they'd agree.
 *
 * This computes a target position for the ticking counter such that
 * `targetCumulative % pool.length === indexOf(target in pool)` EXACTLY --
 * i.e. the tick counter's own value, once it reaches targetCumulative, maps
 * to the real backend-selected string by construction, not by coincidence.
 * It always travels exactly `travelTicks` positions from start to target
 * (regardless of pool size or where the target falls in it), so the
 * ceremony's total duration stays fixed while still scrolling through
 * `travelTicks` distinct real pool entries before landing.
 *
 * If `target` isn't found in `pool` (should not normally happen -- the
 * readiness endpoint's pools are the true resolvable sets), the real target
 * is appended to a local copy of the pool rather than ever letting the reel
 * converge on a different, wrong value.
 */
function computeReelTarget(
  pool: readonly string[],
  target: string,
  travelTicks: number,
): { pool: readonly string[]; startCumulative: number; targetCumulative: number } {
  let effectivePool: readonly string[] = pool;
  let finalIndex = pool.indexOf(target);
  if (finalIndex === -1) {
    effectivePool = [...pool, target];
    finalIndex = effectivePool.length - 1;
  }
  const poolLength = effectivePool.length;
  if (poolLength <= 0) {
    return { pool: effectivePool, startCumulative: 0, targetCumulative: 0 };
  }
  const laps = Math.ceil((travelTicks + 1) / poolLength);
  const targetCumulative = finalIndex + poolLength * laps;
  const startCumulative = targetCumulative - travelTicks;
  return { pool: effectivePool, startCumulative, targetCumulative };
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
/** Phase 8H: rebuilt as a real VERTICAL slot reel -- the single biggest
 * remaining gap from the "still doesn't feel like a real wheel" feedback.
 * The previous version only slid the CENTER item (a fade/pop swap); the
 * side items just sat at static offsets, so the strip as a whole never
 * read as one continuously-scrolling reel. This version keys every
 * visible item by its POOL INDEX (not its slot position) and lets
 * motion/react's `layout` prop do the actual sliding: when a tick shifts
 * every item up one slot, each element's key stays attached to the same
 * pool entry, so framer-motion computes a real FLIP position transition
 * for the whole column at once -- a genuine scroll, not five independent
 * animations pretending to be one. AnimatePresence handles the item that
 * scrolls off the top and the new one entering from the bottom.
 *
 * Known, accepted edge case: for a short pool (e.g. the 9-entry decade
 * ERA_LABELS list), a pool index can recur within one ~10-14-tick spin,
 * which very occasionally reorders instead of sliding for that one tick.
 * Harmless and rare -- never happens for the much larger team pool, and
 * the reduced-motion path (which never ticks at all) is unaffected. */
function ReelStrip({
  items,
  activeIndex,
  rampStage,
  reduceMotion,
  logoUrls,
  centerTestId,
}: {
  items: readonly string[];
  activeIndex: number;
  rampStage: RampStage;
  reduceMotion: boolean;
  /** Phase 8I: team name -> logo URL, team reel only -- the season/era reel
   * simply never passes this, so it renders text-only exactly as before. */
  logoUrls?: Record<string, string>;
  /** Phase 8J: stable test id + data-final-value on the CENTER (payline)
   * row only -- lets a test assert "whatever the reel is actually showing
   * under the payline right now" without depending on animation timing or
   * screenshots, and compare it directly against data-selected-team/
   * data-selected-season on the wheel container (see SpinStage below). */
  centerTestId?: string;
}) {
  const windowSize = 5;
  const center = Math.floor(windowSize / 2);
  const visible = Array.from({ length: windowSize }, (_, i) => {
    const idx = ((activeIndex - center + i) % items.length + items.length) % items.length;
    return { poolIndex: idx, label: items[idx], slot: i };
  });
  const tickDuration = rampStage === "fast" ? 0.075 : rampStage === "medium" ? 0.13 : 0.22;

  return (
    <div className="spin-reel-strip" data-phase="spinning" data-ramp={rampStage} aria-hidden="true">
      <AnimatePresence initial={false} mode="popLayout">
        {visible.map(({ poolIndex, label, slot }) => {
          const distance = Math.abs(slot - center);
          const isActive = slot === center;
          const colors = logoUrls ? getTeamColors(label) : null;
          const logoUrl = logoUrls?.[label];
          return (
            <motion.div
              key={poolIndex}
              layout={!reduceMotion}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: Math.max(0.22, 1 - distance * 0.3) }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : tickDuration, ease: "easeOut" }}
              className={`spin-reel-strip-row ${isActive ? "spin-reel-strip-active" : "spin-reel-strip-item"}`}
              style={{ transform: reduceMotion ? undefined : `scale(${1 - distance * 0.14})` }}
              data-testid={isActive ? centerTestId : undefined}
              data-final-value={isActive ? label : undefined}
            >
              {colors && (
                <span className="spin-reel-strip-logo-wrap" aria-hidden="true">
                  <span
                    data-testid="reel-logo-fallback"
                    className="spin-reel-strip-logo-fallback"
                    style={{ background: colors.primary, color: colors.secondary }}
                  >
                    {colors.initials}
                  </span>
                  {logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      data-testid="reel-logo-img"
                      src={logoUrl}
                      alt=""
                      className="spin-reel-strip-logo-img"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                </span>
              )}
              <span className="spin-reel-strip-label">{label}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
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
  respinKind = null,
  collapsed = false,
  teamLogoUrls = {},
}: Props) {
  // Phase 8C: explicit gate for every new `motion.*` animation added this
  // pass -- the project's existing global CSS `prefers-reduced-motion`
  // override (globals.css) only neutralizes CSS @keyframes/transitions, not
  // motion's WAAPI/RAF-driven animations, so it does not cover these by
  // itself (confirmed against motion.dev's own docs). The JS ceremony-timer
  // paths below already skip ticking entirely under reduced motion; this
  // hook additionally simplifies the per-tick/lock motion flourishes to
  // instant, no-transform state changes.
  const reduceMotion = useReducedMotion();
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
  // Phase 8 pre-loop polish: a respin previously only flashed the wheel
  // boxes' border for 350ms while the text silently swapped underneath --
  // playtest finding #1 was that this doesn't read as "a new roll is
  // happening". `respinning` briefly shows the reel actually ticking again
  // (same ReelStrip used for the first roll of the round) before settling
  // on the new team/season, so a respin looks and feels like a real re-roll
  // instead of a text swap. `phase` itself is never touched by this -- a
  // respin only fires once phase is already "revealed" (see
  // CourtBuilder.tsx's respin-controls gate), so this is a purely additive
  // overlay state, not a re-entry into the spinning/locked state machine.
  const [respinning, setRespinning] = useState(false);
  const [respinTick, setRespinTick] = useState(0);
  const [respinRampStage, setRespinRampStage] = useState<RampStage>("fast");
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

  // Phase 8J: the ACTUAL pool each ReelStrip renders from -- normally
  // identical to teamPool/secondPool above, but computeReelTarget appends
  // the real backend value if it was somehow missing from the readiness
  // pool, so the reel is guaranteed to render from whatever pool its
  // target index was actually computed against. Refs (not state) because
  // they're only ever written at the start of a ceremony/respin effect,
  // before any tick fires -- no render needs to be triggered by the write
  // itself, only by the tick state updates that follow it.
  const teamReelPoolRef = useRef<readonly string[]>(teamPool);
  const secondReelPoolRef = useRef<readonly string[]>(secondPool);
  const respinReelPoolRef = useRef<readonly string[]>([]);

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
    let mediumInterval: number | undefined;
    let slowInterval: number | undefined;
    let rampToMediumTimer: number | undefined;
    let rampToSlowTimer: number | undefined;
    // Phase 8J: deterministic targets -- computed ONCE here, before any
    // tick fires, from the real backend-selected spin.franchise_display_
    // name/era_label. Every tick below clamps toward these exact values
    // (never an unbounded counter), so the reel can only ever converge on
    // the same result the parent will display once phase leaves
    // "spinning" -- root-cause fix for the reel showing one team/season and
    // the result becoming a different one.
    let teamTarget = 0;
    let secondTarget = 0;
    if (isTwoWheel) {
      const teamGoal = computeReelTarget(teamPool, spin.franchise_display_name ?? "", INITIAL_SPIN_TRAVEL_TICKS);
      const secondGoal = computeReelTarget(secondPool, spin.era_label ?? "", INITIAL_SPIN_TRAVEL_TICKS);
      teamReelPoolRef.current = teamGoal.pool;
      secondReelPoolRef.current = secondGoal.pool;
      teamTarget = teamGoal.targetCumulative;
      secondTarget = secondGoal.targetCumulative;
      setTeamTick(teamGoal.startCumulative);
      setSecondTick(secondGoal.startCumulative);

      fastInterval = window.setInterval(() => {
        setTeamTick((t) => Math.min(t + 1, teamTarget));
        setSecondTick((t) => Math.min(t + 1, secondTarget));
      }, FAST_TICK_MS);
      rampToMediumTimer = window.setTimeout(() => {
        if (fastInterval) window.clearInterval(fastInterval);
        setRampStage("medium");
        mediumInterval = window.setInterval(() => {
          setTeamTick((t) => Math.min(t + 1, teamTarget));
          setSecondTick((t) => Math.min(t + 1, secondTarget));
        }, MEDIUM_TICK_MS);
      }, RAMP_TO_MEDIUM_MS);
      rampToSlowTimer = window.setTimeout(() => {
        if (mediumInterval) window.clearInterval(mediumInterval);
        setRampStage("slow");
        slowInterval = window.setInterval(() => {
          setTeamTick((t) => Math.min(t + 1, teamTarget));
          setSecondTick((t) => Math.min(t + 1, secondTarget));
        }, SLOW_TICK_MS);
      }, RAMP_TO_SLOW_MS);
    }
    const t1 = window.setTimeout(() => {
      if (fastInterval) window.clearInterval(fastInterval);
      if (mediumInterval) window.clearInterval(mediumInterval);
      if (slowInterval) window.clearInterval(slowInterval);
      // Safety net only -- natural ticking is scheduled with margin to
      // spare (see INITIAL_SPIN_TRAVEL_TICKS's own comment) so this should
      // normally be a no-op, but it guarantees the reel can NEVER settle
      // into "locked" short of (or past) the real target, regardless of
      // real browser timer jitter.
      if (isTwoWheel) {
        setTeamTick(teamTarget);
        setSecondTick(secondTarget);
      }
      setPhase("locked");
      setWasLocked(true);
    }, SPIN_MS);
    const t2 = window.setTimeout(() => setPhase("revealed"), SPIN_MS + LOCK_MS);
    const t3 = window.setTimeout(() => onRevealComplete?.(), SPIN_MS + LOCK_MS + COUNT_MS);
    return () => {
      if (fastInterval) window.clearInterval(fastInterval);
      if (mediumInterval) window.clearInterval(mediumInterval);
      if (slowInterval) window.clearInterval(slowInterval);
      if (rampToMediumTimer) window.clearTimeout(rampToMediumTimer);
      if (rampToSlowTimer) window.clearTimeout(rampToSlowTimer);
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
    if (prefersReducedMotion()) {
      // Reduced motion: keep the brief border flash only, never the
      // ticking reel -- same discipline as the main ceremony effect above.
      const t = window.setTimeout(() => setJustRespun(false), 350);
      return () => window.clearTimeout(t);
    }
    setRespinning(true);
    setRespinRampStage("fast");

    // Phase 8J: same deterministic-target model as the main ceremony
    // effect. Only ONE axis ever ticks during a respin (the other renders
    // its already-settled value, never mounting ReelStrip at all -- see
    // teamIsTicking/seasonIsTicking below) so this only needs to resolve
    // whichever pool/target respinKind currently points at.
    const respinPool = respinKind === "team" ? teamPool : secondPool;
    const respinTargetValue = respinKind === "team" ? (spin.franchise_display_name ?? "") : (spin.era_label ?? "");
    const goal = computeReelTarget(respinPool, respinTargetValue, RESPIN_TRAVEL_TICKS);
    respinReelPoolRef.current = goal.pool;
    const respinTarget = goal.targetCumulative;
    setRespinTick(goal.startCumulative);

    let fastInterval: number | undefined = window.setInterval(() => {
      setRespinTick((t) => Math.min(t + 1, respinTarget));
    }, FAST_TICK_MS);
    let slowInterval: number | undefined;
    const rampTimer = window.setTimeout(() => {
      if (fastInterval) window.clearInterval(fastInterval);
      fastInterval = undefined;
      setRespinRampStage("slow");
      slowInterval = window.setInterval(() => {
        setRespinTick((t) => Math.min(t + 1, respinTarget));
      }, SLOW_TICK_MS);
    }, RESPIN_RAMP_TO_SLOW_MS);
    const t1 = window.setTimeout(() => {
      if (fastInterval) window.clearInterval(fastInterval);
      if (slowInterval) window.clearInterval(slowInterval);
      // Safety net, same reasoning as the main ceremony effect above.
      setRespinTick(respinTarget);
      setRespinning(false);
    }, RESPIN_REROLL_MS);
    const t2 = window.setTimeout(() => setJustRespun(false), RESPIN_REROLL_MS + 100);
    return () => {
      window.clearTimeout(rampTimer);
      if (fastInterval) window.clearInterval(fastInterval);
      if (slowInterval) window.clearInterval(slowInterval);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // Fires once per real respin only, keyed on respinFlashKey -- reads
    // respinKind/teamPool/secondPool/spin from the render that scheduled
    // this effect (already the NEW post-respin values, since CourtBuilder.
    // tsx's respin handlers call setState+setRespinKind+setRespinFlashKey
    // together before this effect can re-run), not stale ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respinFlashKey]);

  // Phase 8C: per-wheel ticking/locked state, replacing the single
  // combined `isTicking` both wheels shared before -- during the FIRST
  // roll of a round both wheels tick together (unchanged); during a
  // respin, only the respun axis ticks and the other renders locked.
  const teamIsTicking = respinning ? respinKind === "team" : phase === "spinning";
  const seasonIsTicking = respinning ? respinKind === "season" : phase === "spinning";
  const teamIsLocked = respinning && respinKind === "season";
  const seasonIsLocked = respinning && respinKind === "team";
  const teamDisplayName = teamIsTicking ? teamPool[(respinning ? respinTick : teamTick) % teamPool.length] : spin.franchise_display_name ?? "Team-season unavailable";
  const secondDisplay = seasonIsTicking ? secondPool[(respinning ? respinTick : secondTick) % secondPool.length] : spin.era_label ?? "";
  const colors = getTeamColors(teamIsTicking ? teamDisplayName : spin.franchise_display_name);

  const coverageNote =
    isTeamYear && rollableTeamSeasonCount > 0 && supportedStartSeason && supportedEndSeason
      ? { count: rollableTeamSeasonCount.toLocaleString(), range: `${supportedStartSeason} to ${supportedEndSeason}` }
      : null;

  // Phase 8D: collapsed only ever renders once the roll has already settled
  // (CourtBuilder only enters "placing" after a candidate is chosen, which
  // itself requires the ceremony to have already revealed) -- so this is a
  // pure readout of the already-locked spin.franchise_display_name/era_label,
  // never a state the ticking/reel logic above needs to drive.
  if (collapsed) {
    return (
      <div
        data-testid="spin-stage"
        data-phase={phase}
        data-collapsed="true"
        className="spin-reel-collapsed flex items-center justify-between gap-2.5 rounded-xl px-3.5 py-2.5"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-bold shrink-0" style={{ color: "var(--text-muted)" }}>
            Rd {roundNumber}/{totalRounds}
          </span>
          {isTwoWheel ? (
            <>
              {/* Phase 8F: real team logo when the asset flag resolved one,
                  same graceful onError fallback to the color dot as the
                  full ceremony's own team badge below -- team pictures are
                  explicitly asked for in "at least... locked spin summary". */}
              {spin.team_logo_url && !logoFailed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  data-testid="team-logo-collapsed"
                  src={spin.team_logo_url}
                  alt=""
                  aria-hidden="true"
                  width={16}
                  height={16}
                  style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }}
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: colors.primary }}
                />
              )}
              <span className="text-xs font-black truncate" style={{ color: "var(--text-primary)" }}>
                {spin.franchise_display_name} · {spin.era_label}
              </span>
            </>
          ) : (
            <span className="text-xs font-black" style={{ color: "var(--text-primary)" }}>
              Full player pool
            </span>
          )}
        </div>
        <span
          className="text-[9px] font-bold uppercase tracking-widest flex items-center gap-1 shrink-0"
          style={{ color: "var(--text-muted)" }}
        >
          <Lock size={10} aria-hidden="true" /> Locked
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="spin-stage"
      data-phase={phase}
      data-was-locked={wasLocked}
      className="spin-reel p-4 flex flex-col gap-3"
      style={{ "--reel-accent": colors.primary } as CSSProperties}
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
            (coverageNote
              ? `${coverageNote.count} rollable team-seasons · ${coverageNote.range}`
              // Phase 8F: this fallback used to unconditionally say
              // "Experimental exact-season mode" even for a team_decade
              // (whole-decade, not a specific season) spin -- honest,
              // spin_type-aware labels instead. Only ever shown at all
              // once a developer explicitly disables the flagship team_year
              // engine (COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED=false)
              // -- not reachable in the default flagship configuration.
              : spin.spin_type === "team_decade"
                ? "Legacy era-based fallback mode"
                : "Legacy roster fallback mode")}
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

      {respinning && (
        <div className="respin-banner text-center" data-testid="respin-banner">
          Respinning…
        </div>
      )}

      {isTwoWheel ? (
        <div className="grid grid-cols-2 gap-3" role="status" aria-live="polite">
          <div
            data-testid="team-wheel"
            data-respinning={justRespun}
            data-locked={teamIsLocked}
            // Phase 8J: the real backend-selected value for this axis --
            // source of truth a test compares the reel's centered/settled
            // display against (see spin-team-reel-center's data-final-value
            // above/below).
            data-selected-team={spin.franchise_display_name ?? ""}
            className={`spin-wheel-box spin-reel-streak-bg rounded-2xl p-5 flex flex-col items-center justify-center gap-2.5 text-center ${phase === "locked" || (justRespun && !teamIsLocked) ? "spin-ceremony-lock-flash" : ""}`}
            data-phase={respinning ? (teamIsTicking ? "spinning" : "revealed") : phase}
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-muted, #333)",
              minHeight: 128,
              opacity: teamIsLocked ? 0.55 : 1,
              "--slot-accent": colors.primary,
            } as CSSProperties}
          >
            <AnimatePresence>
              {teamIsLocked && (
                <motion.div
                  data-testid="team-wheel-locked-badge"
                  className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest"
                  style={{ color: "var(--text-muted)" }}
                  initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2 }}
                >
                  <Lock size={11} aria-hidden="true" /> Locked
                </motion.div>
              )}
            </AnimatePresence>
            {phase === "revealed" && !respinning && spin.team_logo_url && !logoFailed ? (
              // No configured remote-image domain allowlist yet -- see PlayerAvatar's module docstring.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-testid="team-badge"
                src={spin.team_logo_url}
                alt=""
                aria-hidden="true"
                width={60}
                height={60}
                style={{
                  width: 60,
                  height: 60,
                  objectFit: "contain",
                  boxShadow: `0 0 0 4px color-mix(in srgb, ${colors.primary} 25%, transparent)`,
                }}
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <div
                data-testid="team-badge"
                aria-hidden="true"
                className={`rounded-full flex items-center justify-center font-black text-lg ${teamIsTicking ? "spin-ceremony-reel-tick" : ""}`}
                style={{
                  width: 60,
                  height: 60,
                  background: colors.primary,
                  color: colors.secondary,
                  border: `2.5px solid ${colors.secondary}`,
                  boxShadow: phase === "revealed" && !respinning ? `0 0 0 4px color-mix(in srgb, ${colors.primary} 25%, transparent)` : undefined,
                }}
              >
                {colors.initials}
              </div>
            )}
            <div className="min-w-0 w-full">
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                Team
              </div>
              {teamIsTicking ? (
                <ReelStrip
                  items={respinning ? respinReelPoolRef.current : teamReelPoolRef.current}
                  activeIndex={respinning ? respinTick : teamTick}
                  rampStage={respinning ? respinRampStage : rampStage}
                  reduceMotion={!!reduceMotion}
                  logoUrls={teamLogoUrls}
                  centerTestId="spin-team-reel-center"
                />
              ) : (
                <motion.div
                  key={teamDisplayName}
                  data-testid="spin-team-reel-center"
                  data-final-value={teamDisplayName}
                  className="text-base font-black name-2line"
                  style={{ color: "var(--text-primary)" }}
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeOut" }}
                >
                  {teamDisplayName}
                </motion.div>
              )}
            </div>
          </div>
          <div
            data-testid="era-wheel"
            data-respinning={justRespun}
            data-locked={seasonIsLocked}
            // Phase 8J: real backend-selected value for the season/era axis.
            data-selected-season={spin.era_label ?? ""}
            className={`spin-wheel-box spin-reel-streak-bg rounded-2xl p-5 flex flex-col items-center justify-center gap-2.5 text-center ${phase === "locked" || (justRespun && !seasonIsLocked) ? "spin-ceremony-lock-flash" : ""}`}
            data-phase={respinning ? (seasonIsTicking ? "spinning" : "revealed") : phase}
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-muted, #333)",
              minHeight: 128,
              opacity: seasonIsLocked ? 0.55 : 1,
              "--slot-accent": colors.primary,
            } as CSSProperties}
          >
            <AnimatePresence>
              {seasonIsLocked && (
                <motion.div
                  data-testid="era-wheel-locked-badge"
                  className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest"
                  style={{ color: "var(--text-muted)" }}
                  initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2 }}
                >
                  <Lock size={11} aria-hidden="true" /> Locked
                </motion.div>
              )}
            </AnimatePresence>
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
              {secondWheelLabel}
            </div>
            {seasonIsTicking ? (
              <ReelStrip
                items={respinning ? respinReelPoolRef.current : secondReelPoolRef.current}
                activeIndex={respinning ? respinTick : secondTick}
                rampStage={respinning ? respinRampStage : rampStage}
                reduceMotion={!!reduceMotion}
                centerTestId="spin-season-reel-center"
              />
            ) : (
              <motion.div
                key={secondDisplay}
                data-testid="spin-season-reel-center"
                data-final-value={secondDisplay}
                className="text-2xl font-black"
                style={{ color: phase === "revealed" ? "var(--peak-accent, #f5c842)" : "var(--text-primary)" }}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeOut" }}
              >
                {secondDisplay}
              </motion.div>
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

      {phase === "revealed" && !respinning && (
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
