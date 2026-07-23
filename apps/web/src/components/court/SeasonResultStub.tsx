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
 * The broadcast/reveal result screen. This is the ONLY place exact
 * score/rank is ever shown -- the server only includes them in `state.slots`
 * once status is "result_ready" (docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md
 * Sec 3.5/3.1 step 7), so rendering `state.slots` here via the same
 * PeakCardCourt used during roster-building naturally reveals them for the
 * first time -- no separate "reveal" data path to keep in sync.
 *
 * Explicitly NOT the full broadcast-style presentation (animated count-up,
 * loss timeline, share card) from master plan Sec 13.6 -- those are
 * deferred (PHASE_5X_ARENA_OVERHAUL_PLAN.md Phase 5X.7). This is the
 * record/roster/breakdown moment, not the animated version of it.
 */
export default function SeasonResultStub({ state, result }: Props) {
  const starterSlots = state.slots.filter((s) => STARTER_SLOT_TYPES.includes(s.slot_type));
  const benchSlots = state.slots.filter((s) => BENCH_SLOT_TYPES.includes(s.slot_type));

  return (
    <div data-testid="season-result" className="flex flex-col gap-4">
      <div
        className="text-[10px] uppercase tracking-wide rounded px-2 py-1 self-start"
        style={{ background: "rgba(245,200,66,0.15)", color: "var(--peak-accent, #f5c842)" }}
        data-testid="v0-simulator-label"
      >
        v0 prototype simulator
      </div>

      <div className="text-center">
        <div
          data-testid="season-record"
          className="text-4xl font-black"
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
        {result.experimental_notice}
      </p>
    </div>
  );
}
