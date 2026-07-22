"use client";
import { SimulationResultPublic } from "@/types/perfect-season";
import LineupInsightPanel from "./LineupInsightPanel";

/**
 * v0 result screen -- record, expected-wins range, decisive factors,
 * explicit experimental notice. Explicitly NOT the full broadcast-style
 * presentation (master plan Sec 13.6) -- deferred, see
 * PHASE_5_COURTBUILDER_VERTICAL_SLICE.md Sec 3/7.
 */
export default function SeasonResultStub({ result }: { result: SimulationResultPublic }) {
  return (
    <div data-testid="season-result" className="flex flex-col gap-4">
      <div className="text-center">
        <div
          data-testid="season-record"
          className="text-4xl font-black"
          style={{ color: result.is_perfect_season ? "var(--peak-accent, #f5c842)" : "var(--text-primary)" }}
        >
          {result.wins}-{result.losses}
        </div>
        {result.is_perfect_season && (
          <div className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--peak-accent, #f5c842)" }}>
            Perfect Season
          </div>
        )}
        <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          Expected wins: {result.expected_wins} (range {result.expected_wins_low}–{result.expected_wins_high})
        </div>
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
