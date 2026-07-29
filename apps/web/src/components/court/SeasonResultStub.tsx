"use client";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { CourtLineupPublicState, CourtSlotPublic, SimulationResultPublic, STARTER_SLOT_TYPES, BENCH_SLOT_TYPES } from "@/types/perfect-season";
import LineupInsightPanel from "./LineupInsightPanel";
import LeaderboardSubmitPanel from "./LeaderboardSubmitPanel";
import PlayAgainPanel from "./PlayAgainPanel";
import PeakCardCourt from "./PeakCardCourt";
import CourtLayout from "./CourtLayout";
import PeakPicksRecap from "./PeakPicksRecap";
import ShareRunPanel from "./ShareRunPanel";

interface Props {
  state: CourtLineupPublicState;
  result: SimulationResultPublic;
  /** Phase 8D: starts a brand-new game in the same mode without a page
   * reload -- undefined only for any caller that doesn't wire up the loop
   * (there are none left in this codebase, but this keeps the prop honest
   * rather than assuming every future caller wants it). */
  onPlayAgain?: () => void;
  playAgainBusy?: boolean;
  /** Phase 8H: true when viewing someone ELSE's shared result link
   * (/arena/court/results/[id]) -- hides account-specific actions
   * (leaderboard submit, which the backend would 403 as "not your game"
   * anyway) in favor of a clean view + a CTA to start your own run. */
  readOnly?: boolean;
}

// Part F: named result tiers, most-impressive first.
export function resultTier(wins: number): string {
  if (wins >= 82) return "82-0 Immortal";
  if (wins >= 75) return "Dynasty";
  if (wins >= 65) return "Contender";
  if (wins >= 55) return "Playoff Team";
  if (wins >= 45) return "Mid Pack";
  return "Rebuild";
}

function recordFraming(wins: number, losses: number, isIncomplete: boolean): string {
  // Phase 8C: an incomplete-score roster never gets the confident "PERFECT
  // SEASON" framing, even if the noisy win formula happened to clamp to
  // 82 -- one or more cards have no official PEAK3 score, so a "perfect
  // season" claim would overstate precision the data doesn't support.
  if (isIncomplete) return "Provisional record — not all cards are officially scored";
  if (wins >= 82) return "PERFECT SEASON";
  if (losses === 1) return "One loss from perfect";
  if (losses <= 3) return "So close to perfect";
  if (wins >= 60) return "A strong season";
  if (wins >= 45) return "A playoff-caliber season";
  return "A rebuilding season";
}

// Phase 8B: escalating glow intensity behind the hero record, tracking
// resultTier() -- a "wow" moment that scales with real achievement instead
// of a flat, identical presentation for a 16-66 rebuild and an 82-0 perfect
// season. Stays within the single existing --peak-accent identity (see
// .result-hero in globals.css) rather than introducing a new tier-color
// system -- the blueprint's own principle is "selective high-energy
// accents", not a rainbow-coded scoreboard.
function tierGlow(wins: number): "none" | "low" | "mid" | "high" | "max" {
  if (wins >= 82) return "max";
  if (wins >= 75) return "high";
  if (wins >= 65) return "mid";
  if (wins >= 45) return "low";
  return "none";
}

const GUARD_POSITIONS = new Set(["PG", "SG"]);
const WING_POSITIONS = new Set(["SF"]);
const BIG_POSITIONS = new Set(["PF", "C"]);

/** Client-side, from already-revealed slot data only (never a new hidden
 * computation) -- a short phrase describing roster shape, for the share
 * card headline. */
function teamIdentityPhrase(slots: CourtSlotPublic[]): string {
  const starters = slots.filter((s) => STARTER_SLOT_TYPES.includes(s.slot_type));
  const guards = starters.filter((s) => s.primary_position && GUARD_POSITIONS.has(s.primary_position)).length;
  const wings = starters.filter((s) => s.primary_position && WING_POSITIONS.has(s.primary_position)).length;
  const bigs = starters.filter((s) => s.primary_position && BIG_POSITIONS.has(s.primary_position)).length;
  const offPosition = starters.filter((s) => s.role_fit === "off_position").length;

  const scores = slots
    .map((s) => s.season_score ?? s.individual_peak_score)
    .filter((v): v is number => v != null);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  let base: string;
  if (bigs === 0) base = "No interior anchor";
  else if (guards >= 3) base = "Guard overload";
  else if (wings >= 3) base = "Wing factory";
  else if (avgScore != null && avgScore >= 75 && bigs >= 1 && guards >= 1) base = "Balanced contender";
  else if (avgScore != null && avgScore >= 75) base = "Star-heavy";
  else base = "Defensive-minded build";

  if (offPosition >= 3 && !base.includes("position")) {
    return `${base}, but position-broken`;
  }
  return base;
}

function bestAndWorstPick(slots: CourtSlotPublic[]): { best: string | null; weakness: string } {
  const scored = slots
    .map((s) => ({ name: s.player_name, score: s.season_score ?? s.individual_peak_score }))
    .filter((s): s is { name: string; score: number } => s.name != null && s.score != null);
  if (scored.length === 0) {
    return { best: null, weakness: "No exact-season scores available yet for this roster" };
  }
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const unscoredCount = slots.filter((s) => s.filled && s.score_status && s.score_status !== "exact_season_scored").length;
  if (unscoredCount > 0) {
    return { best: best.name, weakness: `${unscoredCount} roster spot${unscoredCount === 1 ? "" : "s"} with no PEAK3 score yet` };
  }
  const worst = scored.reduce((a, b) => (b.score < a.score ? b : a));
  return { best: best.name, weakness: worst.name };
}

/**
 * The broadcast/reveal result screen (Phase 6E rewrite: share-card-first
 * hierarchy -- tier headline, team identity, best pick/weakness, and the
 * final court up top; seed/version/formula/coverage technical receipt moved
 * into a collapsible disclosure at the bottom, out of the primary reading
 * path). This is the ONLY place exact score/rank is ever shown -- the
 * server only includes them in `state.slots` once status is "result_ready"
 * (docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 3.5/3.1 step 7), so
 * rendering `state.slots` here via the same PeakCardCourt used during
 * roster-building naturally reveals them for the first time -- no separate
 * "reveal" data path to keep in sync.
 *
 * Explicitly NOT a real exported/rendered image (canvas/server-render) --
 * that remains future work (product spec Sec 3.7). This pass makes the
 * on-screen composition itself read as one self-contained, screenshot-able
 * unit (bordered shell, PEAK3 accent rail, consistent internal rhythm).
 */
export default function SeasonResultStub({ state, result, onPlayAgain, playAgainBusy = false, readOnly = false }: Props) {
  const reduceMotion = useReducedMotion();
  const starterSlots = state.slots.filter((s) => STARTER_SLOT_TYPES.includes(s.slot_type));
  const benchSlots = state.slots.filter((s) => BENCH_SLOT_TYPES.includes(s.slot_type));
  const isExactSeasonMode = state.experimental_team_year_data_version != null;
  // Phase 8C: an incomplete-score run must never present with the same
  // confident, official-looking precision as a fully-scored one -- the
  // record itself is a real number either way, but the FRAMING around it
  // (perfect-season gold treatment, "PERFECT SEASON" copy) is withheld
  // until every card has a real PEAK3 score. This mirrors the backend's
  // own leaderboard gate (incomplete_score_not_eligible) on the display
  // side, not just the submission side.
  const isIncomplete = result.lineup_score_status === "incomplete";
  const showPerfectStyling = result.is_perfect_season && !isIncomplete;
  const identity = teamIdentityPhrase(state.slots);
  // Staggered broadcast-reveal timing -- each section's own delay, gated
  // by reduced motion (instant, no stagger, for anyone who prefers it).
  const reveal = (index: number) => ({
    initial: reduceMotion ? false : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: reduceMotion ? { duration: 0 } : { duration: 0.35, delay: index * 0.08, ease: "easeOut" as const },
  });
  // Phase 6F Part F: prefer the server-computed, structure-aware
  // explanation (nba_peak.perfect_season.simulation._best_pick_exact /
  // _structural_weakness_exact) -- it names off-position starters with
  // slot context instead of blaming whichever legend happened to score
  // lowest (the "Weakness: Rasheed Wallace" bug). Falls back to the older
  // client-side score-only heuristic only for legacy peak-window boards,
  // which the server doesn't compute these fields for.
  const clientFallback = bestAndWorstPick(state.slots);
  const best = result.best_pick ?? clientFallback.best;
  const weakness = result.structural_weakness ?? clientFallback.weakness;
  // Phase 7A Part F: "Weakness" implies a fault -- at contender/dynasty win
  // totals nothing about the roster IS wrong, so the label switches to
  // "Ceiling limiter" (what's capping the ceiling below 82, not a flaw).
  // Falls back to the same wins>=65 threshold client-side (matching
  // resultTier's own "Contender" band) for legacy boards the server
  // doesn't compute weakness_framing for.
  const weaknessLabel = result.weakness_framing
    ? (result.weakness_framing === "ceiling_limiter" ? "Ceiling limiter" : "Weakness")
    : (result.wins >= 65 ? "Ceiling limiter" : "Weakness");
  const scoredSlotCount = state.slots.filter((s) => s.score_status === "exact_season_scored").length;
  const filledSlotCount = state.slots.filter((s) => s.filled).length;

  return (
    <div data-testid="season-result" className="share-card-shell flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--peak-accent, #f5c842)" }}>
          PEAK3 · 82-0 Peak Season
        </span>
        <div
          className="text-[10px] uppercase tracking-wide rounded px-2 py-1"
          style={{ background: "rgba(245,200,66,0.15)", color: "var(--peak-accent, #f5c842)" }}
          data-testid="v0-simulator-label"
        >
          Experimental simulator
        </div>
      </div>

      <motion.div
        {...reveal(0)}
        className="text-center result-hero"
        data-tier-glow={isIncomplete ? "none" : tierGlow(result.wins)}
        data-testid="result-hero"
      >
        <div
          data-testid="result-tier"
          className="text-xs font-bold uppercase tracking-[0.2em] mb-1"
          style={{ color: "var(--peak-accent, #f5c842)" }}
        >
          {resultTier(result.wins)}
        </div>
        <div className="flex items-center justify-center gap-2">
          <div
            data-testid="season-record"
            className="text-6xl font-black"
            style={{ color: showPerfectStyling ? "var(--peak-accent, #f5c842)" : "var(--text-primary)" }}
          >
            {result.wins}-{result.losses}
          </div>
          {/* Phase 8C: never present an incomplete-score run's record with
              the same official-looking precision as a fully-scored one --
              a visible "Estimated" tag, not just a footnote. */}
          {isIncomplete && (
            <span
              className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-1 self-start mt-2"
              style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.08)" }}
              data-testid="estimated-record-badge"
              title="One or more cards have no official PEAK3 score yet -- this record uses a prototype approximation for those cards."
            >
              Estimated
            </span>
          )}
        </div>
        <div
          className="text-sm font-bold uppercase tracking-wide"
          style={{ color: showPerfectStyling ? "var(--peak-accent, #f5c842)" : "var(--text-secondary)" }}
          data-testid="record-framing"
        >
          {recordFraming(result.wins, result.losses, isIncomplete)}
        </div>
        <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }} data-testid="team-identity-phrase">
          {identity}
        </div>
      </motion.div>

      {onPlayAgain && (
        <motion.div {...reveal(1)}>
          <PlayAgainPanel
            mode={state.mode}
            wins={result.wins}
            losses={result.losses}
            lineupPeakScore={result.lineup_score_status === "complete" ? result.lineup_peak_score : null}
            onPlayAgain={onPlayAgain}
            busy={playAgainBusy}
          />
        </motion.div>
      )}

      {best && (
        <motion.div {...reveal(2)} className="flex gap-2 text-xs justify-center" data-testid="best-and-weakness">
          <span className="rounded-full px-2.5 py-1" style={{ background: "rgba(52,211,153,0.1)", color: "#34d399" }}>
            Best pick: {best}
          </span>
          <span
            className="rounded-full px-2.5 py-1"
            style={{ background: "rgba(251,146,60,0.1)", color: "#fb923c" }}
            data-testid="weakness-label"
          >
            {weaknessLabel}: {weakness}
          </span>
        </motion.div>
      )}

      {/* Phase 8 pre-loop polish: a bare label like "thin bench depth" reads
          as a real basketball insult on its own -- this clarifies it's
          relative to PEAK3's 0-100 all-time-peak scale, not an absolute
          real-world judgment on the players. Only shown when the server
          actually has a detail sentence for this weakness. */}
      {result.structural_weakness_detail && (
        <p
          className="text-xs text-center -mt-2"
          style={{ color: "var(--text-muted)" }}
          data-testid="weakness-detail"
        >
          {result.structural_weakness_detail}
        </p>
      )}

      {/* The durable, comparable score -- unlike the 82-0 record above
          (seeded RNG noise, capped at a fixed 82-game season), this is a
          real mean of the placed cards' own calibrated PEAK3 scores. For
          team-year (exact-season) boards this is withheld entirely --
          shown as score-incomplete -- if even one placed card has no
          exact-season score, rather than silently backfilling with a
          career-peak or approximate value (score_substitution_allowed=false). */}
      <motion.div
        {...reveal(3)}
        data-testid="lineup-peak-score"
        className="rounded-xl p-3 text-center"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--peak-accent-dim)" }}
      >
        <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          PEAK3 Lineup Score
        </div>
        {result.lineup_score_status === "incomplete" ? (
          <>
            <div className="text-xl font-black" style={{ color: "var(--text-muted)" }} data-testid="lineup-score-incomplete">
              Score incomplete
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }} data-testid="score-coverage-note">
              {scoredSlotCount}/{filledSlotCount} exact season cards scored — one or more selected
              player-seasons has no official PEAK3 score yet (below the model&apos;s minutes
              threshold). Projected record above uses a prototype approximation for those cards;
              the lineup score itself is not shown rather than estimated.
            </div>
          </>
        ) : (
          <>
            <div className="text-3xl font-black" style={{ color: "var(--text-primary)" }}>
              {result.lineup_peak_score.toFixed(1)}
              <span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>
                {" "}/ 100
              </span>
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }} data-testid="score-coverage-note">
              {scoredSlotCount}/{filledSlotCount} exact season cards scored · Mean of your 8 cards&apos;{" "}
              real {isExactSeasonMode ? "exact season" : "peak"} PEAK3 scores — the number to compare across runs.
            </div>
          </>
        )}
      </motion.div>

      <motion.div {...reveal(4)} className="flex flex-col gap-2">
        <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Your roster, revealed
        </div>
        <CourtLayout
          starterSlots={starterSlots}
          benchSlots={benchSlots}
          renderSlot={(slot) => <PeakCardCourt slot={slot} />}
        />
      </motion.div>

      <motion.div {...reveal(5)} className="flex flex-col gap-1">
        <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          What decided this
        </div>
        <ul className="text-sm list-disc pl-5" style={{ color: "var(--text-secondary)" }}>
          {result.decisive_factors.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }} data-testid="peak-value-reassurance">
          PEAK3 scores this roster mostly on peak talent and real position fit —
          it never docks a lineup for having too many elite peaks.
        </p>
      </motion.div>

      {result.peak_picks_recap && result.peak_picks_recap.length > 0 && (
        <motion.div {...reveal(6)}>
          <PeakPicksRecap recap={result.peak_picks_recap} />
        </motion.div>
      )}

      <LineupInsightPanel result={result} />

      {readOnly ? (
        <div
          className="rounded-xl p-3 flex items-center justify-between gap-3 text-sm"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
        >
          <span style={{ color: "var(--text-secondary)" }}>Think you can build a better roster?</span>
          <Link
            href="/arena/court/practice/apex_1y"
            className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 shrink-0"
            style={{ background: "var(--peak-accent, #f5c842)", color: "#000" }}
          >
            Build your own
          </Link>
        </div>
      ) : (
        <>
          <ShareRunPanel state={state} result={result} />
          <LeaderboardSubmitPanel gameId={state.game_id} mode={state.mode} lineupScoreStatus={result.lineup_score_status} />
        </>
      )}

      <p
        data-testid="experimental-notice"
        className="text-xs rounded-lg p-3"
        style={{ background: "var(--bg-surface)", color: "var(--text-muted)", border: "1px solid var(--border-default)" }}
      >
        {result.experimental_notice}
      </p>

      {/* Technical receipt -- moved out of the primary share-card reading
          path into a native disclosure, per Part F/G ("push seed/version/
          formula/coverage lower, don't lead with it"). */}
      <details className="text-[10px]" style={{ color: "var(--text-muted)" }} data-testid="result-receipt">
        <summary className="cursor-pointer select-none" style={{ color: "var(--text-secondary)" }}>
          Data receipt
        </summary>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1.5">
          <span>Seed {state.board_seed}</span>
          <span>{state.card_pool_version}</span>
          <span>{result.lineup_model_version}</span>
          <span>{result.simulator_version}</span>
          {state.experimental_team_year_data_version && <span>{state.experimental_team_year_data_version}</span>}
          {state.formula_version && <span>{state.formula_version}</span>}
          {state.coverage_mode && <span>{state.coverage_mode}</span>}
        </div>
      </details>
    </div>
  );
}
