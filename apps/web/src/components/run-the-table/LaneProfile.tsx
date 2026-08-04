"use client";
import { LaneProfileEntry } from "@/types/run-the-table";
import { laneColorVar } from "@/lib/run-the-table-state";
import { componentTextColor } from "@/lib/utils";

/**
 * The five-lane roster profile.
 *
 * Every value is `lane_index` rescaled 0-100 by the ENGINE (see
 * nba_peak/run_the_table/battle.py::lane_score) and arrives on the payload —
 * the bar width is `value%` with no client-side normalisation, so what is
 * drawn is exactly what the battle will compare.
 */
interface Props {
  lanes: LaneProfileEntry[];
  /** Optional second series drawn as a thin marker on the same track — used to
   *  overlay the revealed boss's profile on the player's. */
  compare?: LaneProfileEntry[] | null;
  compareLabel?: string;
  dense?: boolean;
  showWeights?: boolean;
  /**
   * Let each bar travel from its previous width to its new one.
   *
   * CSS only (`.rtt-lane-bar-animated` transitions `width`), so the value the
   * bar ends on is still the server's `value` with no client normalisation —
   * the transition is purely how it gets there. `prefers-reduced-motion` zeroes
   * the duration in rtt-polish.css.
   */
  animate?: boolean;
}

export default function LaneProfile({
  lanes,
  compare = null,
  compareLabel = "Opponent",
  dense = false,
  showWeights = false,
  animate = false,
}: Props) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="rtt-lane-profile">
      {lanes.map((lane) => {
        const color = laneColorVar(lane.token);
        const other = compare?.find((c) => c.lane === lane.lane) ?? null;
        return (
          <div key={lane.lane} className="flex items-center gap-2">
            <div
              className={dense ? "w-[74px] shrink-0 text-[10px]" : "w-[92px] shrink-0 text-[11px]"}
              style={{ color: "var(--text-muted)" }}
              title={
                showWeights && lane.peak3_weight != null
                  ? `${lane.label} — ${Math.round(lane.peak3_weight * 100)}% of the PEAK3 score`
                  : lane.label
              }
            >
              {lane.label}
            </div>
            <div
              className="relative flex-1 rounded-full h-1.5 min-w-0"
              style={{ background: "var(--border-subtle)" }}
            >
              <div
                className={`h-1.5 rounded-full${animate ? " rtt-lane-bar-animated" : ""}`}
                data-testid={`rtt-lane-bar-${lane.lane}`}
                style={{ width: `${Math.max(0, Math.min(100, lane.value))}%`, background: color }}
              />
              {other && (
                <span
                  aria-hidden="true"
                  className="absolute top-[-2px] h-[10px] w-[2px] rounded-full"
                  style={{
                    left: `${Math.max(0, Math.min(100, other.value))}%`,
                    background: "var(--text-secondary)",
                  }}
                  title={`${compareLabel}: ${other.value.toFixed(1)}`}
                />
              )}
            </div>
            {/* The lane's own number, never colored with `laneColorVar` (a
                fill/border accent, same as the bar above) — the frozen
                `--comp-*` hex measures 1.6-2.6:1 as text on Arena Day,
                failing even the 3:1 large-text floor. `componentTextColor`
                (lib/utils.ts, P3-G2) keeps the lane's identity colour while
                clearing AA, rather than dropping to neutral text. */}
            <div
              className="score-number w-9 shrink-0 text-right text-[11px]"
              style={{ color: componentTextColor(lane.lane) }}
            >
              {lane.value.toFixed(1)}
            </div>
            {/* `title` on an `aria-hidden` tick is exposed to nobody and
                reachable by no keyboard, so the entire payoff of a Film Room
                scout — the boss's lane values — was invisible. This line is
                the only place a screen reader can get it. Same for the PEAK3
                weight, which was also title-only. */}
            {(other != null || (showWeights && lane.peak3_weight != null)) && (
              <span className="sr-only" data-testid={`rtt-lane-sr-${lane.lane}`}>
                {showWeights && lane.peak3_weight != null
                  ? `${lane.label} is ${Math.round(lane.peak3_weight * 100)}% of the PEAK3 score. `
                  : ""}
                {other != null
                  ? `${compareLabel} in ${lane.label}: ${other.value.toFixed(1)}.`
                  : ""}
              </span>
            )}
          </div>
        );
      })}
      {compare && (
        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          The tick on each track is {compareLabel}&apos;s value in that lane.
        </p>
      )}
    </div>
  );
}
