"use client";
import { SimulationResultPublic } from "@/types/perfect-season";

const COMPONENT_LABELS: Record<string, string> = {
  talent_core: "Talent core",
  creation_coverage: "Creation coverage",
  scoring_coverage: "Scoring coverage",
  postseason_pedigree: "Postseason pedigree",
  team_context_depth: "Team context depth",
  role_overlap_penalty: "Role overlap penalty",
};

/**
 * Post-completion lineup-fit component breakdown -- display-only,
 * component-by-component (never one unexplained "chemistry" number),
 * per master plan Sec 5.6 and ADR-005 Decision 4.
 */
export default function LineupInsightPanel({ result }: { result: SimulationResultPublic }) {
  return (
    <div data-testid="lineup-insight-panel" className="flex flex-col gap-2">
      <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Lineup fit components
      </div>
      {Object.entries(result.fit_components).map(([key, value]) => {
        const pct = Math.max(0, Math.min(100, ((value + 15) / 115) * 100));
        return (
          <div key={key} className="flex flex-col gap-0.5">
            <div className="flex justify-between text-xs" style={{ color: "var(--text-secondary)" }}>
              <span>{COMPONENT_LABELS[key] ?? key}</span>
              <span>{value.toFixed(1)}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-surface)" }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: value < 0 ? "#ef4444" : "var(--peak-accent, #f5c842)" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
