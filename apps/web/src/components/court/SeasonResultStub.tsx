"use client";
import { CourtLineupPublicState, SimulationResultPublic, STARTER_SLOT_TYPES, BENCH_SLOT_TYPES } from "@/types/perfect-season";
import LineupInsightPanel from "./LineupInsightPanel";
import PeakCardCourt from "./PeakCardCourt";
import CourtLayout from "./CourtLayout";

interface Props {
  state: CourtLineupPublicState;
  result: SimulationResultPublic;
}

function recordFraming(wins: number, losses: number): string {
  if (wins >= 82) return "PERFECT SEASON";
  if (losses === 1) return "One loss from perfect";
  if (losses <= 3) return "So close to perfect";
  if (wins >= 60) return "A strong season";
  if (wins >= 45) return "A playoff-caliber season";
  return "A rebuilding season";
}

/**
 * The broadcast/reveal result screen (Phase 6B: composed as a single
 * cohesive "share-card" shell, .share-card-shell in globals.css, rather
 * than a plain unframed vertical stack -- the literal "not shareable"
 * finding this pass addresses). This is the ONLY place exact score/rank is
 * ever shown -- the server only includes them in `state.slots` once status
 * is "result_ready" (docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 3.5/
 * 3.1 step 7), so rendering `state.slots` here via the same PeakCardCourt
 * used during roster-building naturally reveals them for the first time --
 * no separate "reveal" data path to keep in sync.
 *
 * Explicitly NOT a real exported/rendered image (canvas/server-render) --
 * that remains future work (product spec Sec 3.7). This pass makes the
 * on-screen composition itself read as one self-contained, screenshot-able
 * unit (bordered shell, PEAK3 accent rail, consistent internal rhythm).
 */
export default function SeasonResultStub({ state, result }: Props) {
  const starterSlots = state.slots.filter((s) => STARTER_SLOT_TYPES.includes(s.slot_type));
  const benchSlots = state.slots.filter((s) => BENCH_SLOT_TYPES.includes(s.slot_type));

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
          v0 prototype simulator
        </div>
      </div>

      <div className="text-center">
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
        <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          Expected wins: {result.expected_wins} (range {result.expected_wins_low}–{result.expected_wins_high})
        </div>
      </div>

      {/* The durable, comparable score (Phase 6A Goal 9) -- unlike the 82-0
          record above (seeded RNG noise, capped at a fixed 82-game season),
          this is a real mean of the 8 placed cards' own calibrated PEAK3
          individual_peak_score values. Visually secondary to the record
          (which stays the fun headline outcome) but the number worth
          comparing across different rosters/runs. */}
      <div
        data-testid="lineup-peak-score"
        className="rounded-xl p-3 text-center"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--peak-accent-dim)" }}
      >
        <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          PEAK3 Lineup Score
        </div>
        <div className="text-3xl font-black" style={{ color: "var(--text-primary)" }}>
          {result.lineup_peak_score.toFixed(1)}
          <span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>
            {" "}/ 100
          </span>
        </div>
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Mean of your 8 cards&apos; real PEAK3 peak scores — the number to compare across runs.
        </div>
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

      <div
        data-testid="result-receipt"
        className="text-[10px] flex flex-wrap gap-x-3 gap-y-0.5 pt-1"
        style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-default)" }}
      >
        <span>Seed {state.board_seed}</span>
        <span>{state.card_pool_version}</span>
        <span>{result.lineup_model_version}</span>
        <span>{result.simulator_version}</span>
        {state.experimental_team_year_data_version && <span>{state.experimental_team_year_data_version}</span>}
        {state.formula_version && <span>{state.formula_version}</span>}
        {state.coverage_mode && <span>{state.coverage_mode}</span>}
      </div>
    </div>
  );
}
