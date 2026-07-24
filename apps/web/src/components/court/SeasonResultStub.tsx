"use client";
import { CourtLineupPublicState, CourtSlotPublic, SimulationResultPublic, STARTER_SLOT_TYPES, BENCH_SLOT_TYPES } from "@/types/perfect-season";
import LineupInsightPanel from "./LineupInsightPanel";
import PeakCardCourt from "./PeakCardCourt";
import CourtLayout from "./CourtLayout";

interface Props {
  state: CourtLineupPublicState;
  result: SimulationResultPublic;
}

// Part F: named result tiers, most-impressive first.
function resultTier(wins: number): string {
  if (wins >= 82) return "82-0 Immortal";
  if (wins >= 75) return "Dynasty";
  if (wins >= 65) return "Contender";
  if (wins >= 55) return "Playoff Team";
  if (wins >= 45) return "Mid Pack";
  return "Rebuild";
}

function recordFraming(wins: number, losses: number): string {
  if (wins >= 82) return "PERFECT SEASON";
  if (losses === 1) return "One loss from perfect";
  if (losses <= 3) return "So close to perfect";
  if (wins >= 60) return "A strong season";
  if (wins >= 45) return "A playoff-caliber season";
  return "A rebuilding season";
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
export default function SeasonResultStub({ state, result }: Props) {
  const starterSlots = state.slots.filter((s) => STARTER_SLOT_TYPES.includes(s.slot_type));
  const benchSlots = state.slots.filter((s) => BENCH_SLOT_TYPES.includes(s.slot_type));
  const isExactSeasonMode = state.experimental_team_year_data_version != null;
  const identity = teamIdentityPhrase(state.slots);
  const { best, weakness } = bestAndWorstPick(state.slots);
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

      <div className="text-center">
        <div
          data-testid="result-tier"
          className="text-xs font-bold uppercase tracking-[0.2em] mb-1"
          style={{ color: "var(--peak-accent, #f5c842)" }}
        >
          {resultTier(result.wins)}
        </div>
        <div
          data-testid="season-record"
          className="text-5xl font-black"
          style={{ color: result.is_perfect_season ? "var(--peak-accent, #f5c842)" : "var(--text-primary)" }}
        >
          {result.wins}-{result.losses}
        </div>
        <div
          className="text-sm font-bold uppercase tracking-wide"
          style={{ color: result.is_perfect_season ? "var(--peak-accent, #f5c842)" : "var(--text-secondary)" }}
          data-testid="record-framing"
        >
          {recordFraming(result.wins, result.losses)}
        </div>
        <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }} data-testid="team-identity-phrase">
          {identity}
        </div>
      </div>

      {best && (
        <div className="flex gap-2 text-xs justify-center" data-testid="best-and-weakness">
          <span className="rounded-full px-2.5 py-1" style={{ background: "rgba(52,211,153,0.1)", color: "#34d399" }}>
            Best pick: {best}
          </span>
          <span className="rounded-full px-2.5 py-1" style={{ background: "rgba(251,146,60,0.1)", color: "#fb923c" }}>
            Weakness: {weakness}
          </span>
        </div>
      )}

      {/* The durable, comparable score -- unlike the 82-0 record above
          (seeded RNG noise, capped at a fixed 82-game season), this is a
          real mean of the placed cards' own calibrated PEAK3 scores. For
          team-year (exact-season) boards this is withheld entirely --
          shown as score-incomplete -- if even one placed card has no
          exact-season score, rather than silently backfilling with a
          career-peak or approximate value (score_substitution_allowed=false). */}
      <div
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
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Your roster, revealed
        </div>
        <CourtLayout
          starterSlots={starterSlots}
          benchSlots={benchSlots}
          renderSlot={(slot) => <PeakCardCourt slot={slot} />}
        />
      </div>

      <div className="flex flex-col gap-1">
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
      </div>

      <LineupInsightPanel result={result} />

      <p
        data-testid="experimental-notice"
        className="text-xs rounded-lg p-3"
        style={{ background: "var(--bg-surface)", color: "var(--text-muted)", border: "1px solid var(--border-default)" }}
      >
        {result.experimental_notice} This prototype does not yet write to a global
        leaderboard — a future release will let you compare your PEAK3 Lineup Score
        against other runs.
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
