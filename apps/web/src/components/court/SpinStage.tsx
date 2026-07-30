"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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

/** Phase 9B: a reel's animation stage.
 *  armed     -> strip mounted at startIndex, no transition (one frame only)
 *  spinning  -> long eased transition toward target + overshoot
 *  settling  -> short back-eased rebound onto the exact target
 *  done      -> strip UNMOUNTED, settled value rendered as plain text
 * "done" must unmount the strip: the e2e suite reads
 * `[data-testid="team-wheel"].innerText()`, which would otherwise return all
 * ~140 strip labels instead of the landed team. */
type ReelStage = "armed" | "spinning" | "settling" | "done";

interface ReelRun {
  strip: readonly string[];
  targetIndex: number;
  startIndex: number;
  finalLabel: string;
  stage: ReelStage;
  spinMs: number;
  settleMs: number;
  /** Changes per spin/respin so a new run always remounts cleanly. */
  runKey: string;
}

// Phase 8I: user playtest feedback was explicit -- "the spinner is still too
// fast" / "should spend a little more time as a reveal event, but not
// become annoying". This supersedes the older ARENA_OVERHAUL_PRODUCT_SPEC.md
// Sec 3.2 "under 2 seconds" TOTAL-ceremony guidance that shaped the previous
// 1250/400/300 split -- SPIN_MS alone now targets the product's own
// "roughly 1.6-2.4s" guidance for the initial spin, LOCK_MS/COUNT_MS
// unchanged (the landing beat was already reading as intentional; the
// complaint was specifically about the reel itself feeling rushed).
const LOCK_MS = 350;
const COUNT_MS = 300;

// ---------------------------------------------------------------------------
// Phase 9B: continuous, GPU-composited reel motion.
//
// ROOT CAUSES this replaces (the reel was deterministic since Phase 8J but
// still read as "laggy/glitchy, not a real wheel"):
//
//  C1, the dominant glitch: the old reel row carried BOTH `layout` and
//      `style={{ transform: scale(...) }}`. motion/react drives `layout`
//      (FLIP) by writing element.style.transform directly, so React's own
//      per-tick commit wrote a scale()-only transform over the top of
//      motion's in-flight translate -- every row teleported to its raw
//      layout position for one frame, ~150 one-frame pops per spin.
//  C2: `.spin-reel-strip-active` gave the centered row a different
//      font-size/padding than its siblings, so row heights changed every
//      tick and the centered flex column re-laid-out underneath the FLIP.
//  C3: 85ms per row is ~12fps of perceived motion -- text swapping, not
//      spinning.
//  C4: three chained setIntervals swapped by setTimeouts left dead gaps of
//      up to ~235ms and ~410ms at the ramp boundaries (two visible stalls).
//  C5: `Math.min(t + 1, target)` reached the target with ticks to spare,
//      then sat frozen for up to ~520ms before LOCKED -- read as a hang.
//  C6: one interval callback advanced both reels, so they moved in perfect
//      lockstep and stopped on the same frame; real reels never do.
//  C7: per-tick accent recompute invalidated color-mix() box-shadow blurs,
//      forcing a style recalc + repaint of both wheel boxes every 85ms.
//  C9: the 5-entry decade pool equals the window size, so that reel never
//      actually scrolled at all -- it shuffled.
//
// THE FIX: one `transform: translate3d()` transition per reel, on a single
// pre-built strip element. Once the only animating property is a transform
// and nothing in the subtree invalidates layout during the transition, the
// animation runs on the COMPOSITOR thread -- so a busy main thread (Next
// route compile, hydration, image decode) can no longer stall it, which was
// the actual failure mode. It also drops React work during the spin from
// ~15 full reconciliations to 4 state changes per reel.
//
// Deliberately NOT requestAnimationFrame: rAF would buy arbitrary easing but
// schedules on the main thread, trading a compositor-driven animation for a
// main-thread one to gain easing fidelity this doesn't need. Accelerate ->
// glide -> settle is expressed by CHAINING two transitions instead.
// ---------------------------------------------------------------------------

/** Uniform row height. Uniform is load-bearing, not cosmetic: it is the C2
 * fix. Every row is exactly this tall, and the payline is a static overlay on
 * the window rather than a class on the moving row. */
const ROW_H = 30;
const WINDOW_ROWS = 3;
const WINDOW_H = ROW_H * WINDOW_ROWS;
/** Transform that puts strip row `i` under the centre payline. */
const offsetForRow = (i: number) => -(i * ROW_H) + (WINDOW_H - ROW_H) / 2;

/** Rows travelled per spin. CONSTANT for every roll, independent of pool
 * size and of where the target happens to sit -- so every spin has the same
 * duration and the same deceleration curve, with no "some rolls take longer"
 * tell and no positional bias. 62 rows x 30px = 1860px of travel. */
const TRAVEL_ROWS = 62;
const TRAVEL_ROWS_RESPIN = 34;
/** Hard guard on strip size (worst real case is ~141 rows for the 47-season
 * pool; the 5-entry decade pool becomes 14 laps of real DOM rows, which is
 * what fixes C9). */
const MAX_STRIP_ROWS = 160;

/** Phase 1: fast burst that decelerates hard. Verified against this curve --
 * 19% of the time covers 48.5% of the distance (~95 rows/sec, a blurred
 * burst), then 74% of the time has covered 97.4%, so the final ~1.6 rows
 * creep past over the last ~430ms and individual team names are readable as
 * they decelerate into the payline. */
const SPIN_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";
const SPIN_TEAM_MS = 1650;
/** Staggered on purpose -- this is the C6 fix. Two independent physical reels
 * never stop on the same frame. */
const SPIN_SEASON_MS = 1900;
const SPIN_RESPIN_MS = 1050;
/** Phase 2: a 0.3-row overshoot rebounding with a slight back-ease reads as a
 * mechanical detent click rather than an abrupt stop. */
const OVERSHOOT_ROWS = 0.3;
const SETTLE_MS = 220;
const SETTLE_RESPIN_MS = 200;
const SETTLE_EASE = "cubic-bezier(0.34, 1.42, 0.64, 1)";
/** transitionend is not delivered if the tab backgrounds mid-transition, so
 * every stage also arms a timeout. Both paths are guarded on the current
 * stage so they can never double-advance. */
const TRANSITION_FALLBACK_MS = 120;
/** Total ceremony: 1900 (slowest reel) + 220 settle + 350 lock + 300 count. */
const SPIN_MS = SPIN_SEASON_MS + SETTLE_MS;
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
const RESPIN_REROLL_MS = SPIN_RESPIN_MS + SETTLE_RESPIN_MS;



function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Phase 9B: plan one reel spin as a REPEATED STRIP with the target row sitting
 * deep inside it -- replacing Phase 8J's modular tick-counter arithmetic.
 *
 * Phase 8J made landing deterministic by construction
 * (`targetCumulative % pool.length === indexOf(target)`), and that guarantee is
 * PRESERVED here, just expressed geometrically instead of modularly:
 * `strip[targetIndex] === target` is true by construction, so the row that
 * geometrically comes to rest under the payline IS the backend-selected value.
 * There is no separate "settled" computation that could disagree with it.
 *
 * Why a repeated strip rather than a modular window: a strip is a single static
 * element that can be moved with one composited transform. The old model had to
 * re-render a 5-row window on every tick to simulate motion, which is what made
 * the reel main-thread-bound and janky.
 *
 * Exported for unit testing -- the invariants below are cheap to assert and are
 * the whole correctness argument for the spinner, so they should not require a
 * browser to verify.
 */
export function planReel(
  pool: readonly string[],
  target: string,
  travel: number,
): {
  strip: readonly string[];
  targetIndex: number;
  startIndex: number;
  finalLabel: string;
} {
  // Same defensive guarantee as Phase 8J: if the readiness pool somehow lacks
  // the real backend value, append it rather than ever letting the reel come to
  // rest on a different, wrong string.
  const effective = pool.includes(target) ? [...pool] : [...pool, target];
  const safePool = effective.length > 0 ? effective : [target];
  const poolLength = safePool.length;
  const finalPoolIndex = safePool.indexOf(target);

  // Enough laps that the target can sit in the LAST repetition with a full
  // window of real rows above it at t=0 (so the window is never partially
  // empty, and the pre-spin row under the payline is not the answer).
  const naturalRepeats = Math.max(3, Math.ceil((travel + WINDOW_ROWS + 1) / poolLength) + 1);
  // Hard ceiling on DOM size. Reached only by a pathologically small pool
  // (a 1-entry pool would otherwise want `travel + 4` repetitions); clamping
  // costs nothing because a strip only needs to be long enough to contain the
  // travel, and the target index is derived from the clamped value below so the
  // landing guarantee is unaffected.
  const repeats = Math.max(1, Math.min(naturalRepeats, Math.floor(MAX_STRIP_ROWS / poolLength) || 1));
  const strip: string[] = Array.from(
    { length: repeats * poolLength },
    (_, i) => safePool[i % poolLength],
  );
  const targetIndex = (repeats - 1) * poolLength + finalPoolIndex;
  return {
    strip,
    targetIndex,
    // Constant travel distance for every spin -- see TRAVEL_ROWS.
    startIndex: targetIndex - travel,
    finalLabel: target,
  };
}

/** Phase 9B: one reel = one clipping window + one pre-built strip moved by a
 * single composited transform.
 *
 * The window keeps the class name `.spin-reel-strip` (its meaning changes from
 * "the flex column of 5 rows" to "the clipping window") because the e2e suite
 * asserts on that class: exactly 2 present while spinning, 0 under reduced
 * motion. Documented here so the rename is not mistaken for a leftover.
 *
 * Every row is created ONCE per spin and never reconciled again -- which is
 * what makes mid-animation logo pop-in structurally impossible (C-logos) and
 * removes the per-tick React work entirely.
 *
 * `data-final-value` carries the backend value from t=0. That is correct, not a
 * leak of future state: the value is already deterministic before the animation
 * starts (the server picked it), and exposing it lets a test assert "the reel
 * can never resolve to something else" without racing the animation. The
 * on-screen answer is still hidden until the strip physically arrives, because
 * the span is `hidden`. */
function ReelWindow({
  run,
  logoUrls,
  failedLogos,
  onLogoError,
  windowTestId,
  stripTestId,
  centerTestId,
  onSettled,
}: {
  run: ReelRun;
  /** Team reel only -- the season/era reel never passes this and renders
   * text-only, exactly as before. */
  logoUrls?: Record<string, string>;
  failedLogos: ReadonlySet<string>;
  onLogoError: (url: string) => void;
  windowTestId: string;
  stripTestId: string;
  centerTestId: string;
  onSettled: () => void;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);

  const restingIndex =
    run.stage === "armed"
      ? run.startIndex
      : run.stage === "spinning"
        ? run.targetIndex + OVERSHOOT_ROWS
        : run.targetIndex;

  const transition =
    run.stage === "spinning"
      ? `transform ${run.spinMs}ms ${SPIN_EASE}`
      : run.stage === "settling"
        ? `transform ${run.settleMs}ms ${SETTLE_EASE}`
        : "none";

  return (
    <div
      className="spin-reel-strip"
      data-testid={windowTestId}
      data-stage={run.stage}
      data-phase="spinning"
      aria-hidden="true"
    >
      <div
        ref={stripRef}
        className="spin-reel-track"
        data-testid={stripTestId}
        data-target-index={run.targetIndex}
        data-row-count={run.strip.length}
        style={{
          transform: `translate3d(0, ${offsetForRow(restingIndex)}px, 0)`,
          transition,
        }}
        onTransitionEnd={(e) => {
          // Only the strip's own transform ends a stage -- not a descendant's
          // opacity, and not a bubbled event from a logo.
          if (e.propertyName !== "transform" || e.target !== stripRef.current) return;
          onSettled();
        }}
      >
        {run.strip.map((label, i) => {
          const colors = logoUrls ? getTeamColors(label) : null;
          const logoUrl = logoUrls?.[label];
          const showLogo = !!logoUrl && !failedLogos.has(logoUrl);
          return (
            <div className="spin-reel-row" key={i} data-testid="reel-row" data-label={label}>
              {colors && (
                <span className="spin-reel-row-logo" aria-hidden="true">
                  <span
                    data-testid="reel-logo-fallback"
                    className="spin-reel-row-logo-fallback"
                    style={{ background: colors.primary, color: colors.secondary }}
                  >
                    {colors.initials}
                  </span>
                  {showLogo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      data-testid="reel-logo-img"
                      src={logoUrl}
                      alt=""
                      width={24}
                      height={24}
                      decoding="async"
                      className="spin-reel-row-logo-img"
                      // Declarative, so a known-bad URL renders no <img> on ANY
                      // row and stays suppressed across rounds -- the old
                      // imperative style.display="none" was lost on remount, so
                      // a 404 logo re-fetched and re-failed every time.
                      onError={() => onLogoError(logoUrl)}
                    />
                  )}
                </span>
              )}
              <span className="spin-reel-row-label">{label}</span>
            </div>
          );
        })}
      </div>
      <div className="spin-reel-payline" aria-hidden="true" />
      <span data-testid={centerTestId} data-final-value={run.finalLabel} hidden />
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
  // Phase 9B: per-reel runs replace teamTick/secondTick/respinTick/rampStage/
  // respinRampStage. Independent per reel, which is what allows the staggered
  // landing (C6 fix).
  const [teamRun, setTeamRun] = useState<ReelRun | null>(null);
  const [seasonRun, setSeasonRun] = useState<ReelRun | null>(null);
  const [failedLogos, setFailedLogos] = useState<ReadonlySet<string>>(() => new Set());
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

  const markLogoFailed = useCallback((url: string) => {
    setFailedLogos((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
  }, []);

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
    // Phase 9B: plan both reels once, up front, from the real backend-selected
    // values. Nothing about the animation can change where they land.
    if (isTwoWheel) {
      const teamPlan = planReel(teamPool, spin.franchise_display_name ?? "", TRAVEL_ROWS);
      const seasonPlan = planReel(secondPool, spin.era_label ?? "", TRAVEL_ROWS);
      setTeamRun({ ...teamPlan, stage: "armed", spinMs: SPIN_TEAM_MS, settleMs: SETTLE_MS, runKey: `team:${roundNumber}` });
      setSeasonRun({ ...seasonPlan, stage: "armed", spinMs: SPIN_SEASON_MS, settleMs: SETTLE_MS, runKey: `season:${roundNumber}` });
    }
    const t1 = window.setTimeout(() => {
      // Phase 9B: no snap needed -- a reel's resting transform IS its target
      // by construction (planReel), so there is nothing to correct for here.
      // LOCK fires after the SLOWEST reel has settled (see SPIN_MS).
      setPhase("locked");
      setWasLocked(true);
    }, SPIN_MS);
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

    // Phase 9B: only the respun AXIS gets a new run. The other reel stays at
    // stage "done" with its settled value + locked badge, which is what keeps
    // respins axis-locked (a team respin must never move the season reel).
    const respinPool = respinKind === "team" ? teamPool : secondPool;
    const respinTargetValue = respinKind === "team" ? (spin.franchise_display_name ?? "") : (spin.era_label ?? "");
    const plan = planReel(respinPool, respinTargetValue, TRAVEL_ROWS_RESPIN);
    const run: ReelRun = {
      ...plan,
      stage: "armed",
      spinMs: SPIN_RESPIN_MS,
      settleMs: SETTLE_RESPIN_MS,
      runKey: `respin:${respinKind}:${respinFlashKey}`,
    };
    if (respinKind === "team") setTeamRun(run);
    else setSeasonRun(run);

    const t1 = window.setTimeout(() => {
      setRespinning(false);
    }, RESPIN_REROLL_MS);
    const t2 = window.setTimeout(() => setJustRespun(false), RESPIN_REROLL_MS + 100);
    return () => {
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

  // Phase 9B: advance a reel's stage machine. Called from the strip's own
  // transitionend AND from a timeout fallback, so both are guarded on the
  // current stage -- transitionend is not delivered if the tab backgrounds
  // mid-transition, and a double-advance would skip the settle beat.
  const advanceReel = useCallback((axis: "team" | "season") => {
    const setter = axis === "team" ? setTeamRun : setSeasonRun;
    setter((prev) => {
      if (!prev) return prev;
      if (prev.stage === "spinning") return { ...prev, stage: "settling" };
      if (prev.stage === "settling") return { ...prev, stage: "done" };
      return prev;
    });
  }, []);

  // Two-frame arm. Setting the start and end transform in the same commit
  // produces NO transition at all (the browser never observes the start value),
  // so the strip is mounted at startIndex for one frame, then flipped to
  // "spinning" on the next -- which is what actually starts the animation.
  useEffect(() => {
    const runs: Array<["team" | "season", ReelRun | null]> = [
      ["team", teamRun],
      ["season", seasonRun],
    ];
    const rafs: number[] = [];
    const timers: number[] = [];
    for (const [axis, run] of runs) {
      if (!run) continue;
      const setter = axis === "team" ? setTeamRun : setSeasonRun;
      if (run.stage === "armed") {
        const r1 = requestAnimationFrame(() => {
          const r2 = requestAnimationFrame(() => {
            setter((prev) => (prev && prev.stage === "armed" ? { ...prev, stage: "spinning" } : prev));
          });
          rafs.push(r2);
        });
        rafs.push(r1);
      } else if (run.stage === "spinning" || run.stage === "settling") {
        const budget = (run.stage === "spinning" ? run.spinMs : run.settleMs) + TRANSITION_FALLBACK_MS;
        timers.push(window.setTimeout(() => advanceReel(axis), budget));
      }
    }
    return () => {
      rafs.forEach((r) => cancelAnimationFrame(r));
      timers.forEach((t) => window.clearTimeout(t));
    };
    // Intentionally keyed on runKey+stage rather than the run OBJECTS: the
    // effect must re-arm exactly when a reel starts a new spin or changes
    // stage, and never merely because a new object identity was produced.
    // Depending on the objects themselves would re-enter on every setter call
    // and cancel the in-flight rAF/timeout that drives the very transition
    // being scheduled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamRun?.runKey, teamRun?.stage, seasonRun?.runKey, seasonRun?.stage, advanceReel]);

  // Phase 8C: per-wheel ticking/locked state, replacing the single
  // combined `isTicking` both wheels shared before -- during the FIRST
  // roll of a round both wheels tick together (unchanged); during a
  // respin, only the respun axis ticks and the other renders locked.
  // Phase 9B: a reel is "ticking" while its OWN run is unfinished -- not while
  // a shared `phase` says so. That is what lets the two reels land at different
  // moments (C6) while each still hands off to its settled text the instant it
  // personally arrives (C5: no dead freeze waiting for a shared timer).
  const teamIsTicking = teamRun !== null && teamRun.stage !== "done";
  const seasonIsTicking = seasonRun !== null && seasonRun.stage !== "done";
  const teamIsLocked = respinning && respinKind === "season";
  const seasonIsLocked = respinning && respinKind === "team";
  // Phase 9B: the settled values. While a reel is ticking these are NOT read
  // for the reel itself (the strip owns what is on screen) -- the reel is the
  // single source of visual truth, so there is no second value that could
  // disagree with it.
  const teamDisplayName = spin.franchise_display_name ?? "Team-season unavailable";
  const secondDisplay = spin.era_label ?? "";
  // Accent/badge colour is resolved ONCE from the real landed team, and only
  // APPLIED once the team reel is no longer ticking (see teamAccentReady). The
  // old code recomputed this every tick from the ticking pool value, which
  // invalidated the wheel boxes' color-mix() box-shadow blurs and forced a
  // style recalc + repaint every 85ms (C7) -- and showing it during the spin
  // would also leak the answer before the reel arrives.
  const colors = getTeamColors(spin.franchise_display_name);
  const teamAccentReady = !teamIsTicking;

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
      style={{ "--reel-accent": teamAccentReady ? colors.primary : "var(--text-muted)" } as CSSProperties}
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
              "--slot-accent": teamAccentReady ? colors.primary : "var(--text-muted)",
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
                className="rounded-full flex items-center justify-center font-black text-lg"
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
              {teamIsTicking && teamRun ? (
                <ReelWindow
                  key={teamRun.runKey}
                  run={teamRun}
                  logoUrls={teamLogoUrls}
                  failedLogos={failedLogos}
                  onLogoError={markLogoFailed}
                  windowTestId="team-reel-window"
                  stripTestId="team-reel-strip"
                  centerTestId="spin-team-reel-center"
                  onSettled={() => advanceReel("team")}
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
              "--slot-accent": teamAccentReady ? colors.primary : "var(--text-muted)",
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
            {seasonIsTicking && seasonRun ? (
              <ReelWindow
                key={seasonRun.runKey}
                run={seasonRun}
                failedLogos={failedLogos}
                onLogoError={markLogoFailed}
                windowTestId="era-reel-window"
                stripTestId="era-reel-strip"
                centerTestId="spin-season-reel-center"
                onSettled={() => advanceReel("season")}
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
