"use client";
import { Check, TrendingUp } from "lucide-react";
import { PeakPickRecapEntry, SLOT_LABELS, SlotType } from "@/types/perfect-season";

interface Props {
  recap: PeakPickRecapEntry[];
}

/**
 * Phase 8H: "What PEAK3 would have picked" -- a round-by-round comparison
 * between the player's actual pick and the highest-scored candidate that
 * was genuinely still available at that point in the run (server-computed,
 * see state.py::_compute_peak_picks_recap -- never fabricated, and never
 * shown before the roster is complete, so this never leaks a live round's
 * scores before a pick is made).
 *
 * This is the core of the new "PEAK3 AI pick" product differentiator: a
 * reason to be curious after a run ends, a way to learn from the model's
 * own read on the round, and a concrete answer to "how did I actually do
 * compared to just taking the best player every time" -- something a
 * simple random-roster game has no equivalent of.
 */
export default function PeakPicksRecap({ recap }: Props) {
  if (recap.length === 0) return null;
  const matchedCount = recap.filter((r) => r.matched).length;

  return (
    <div
      data-testid="peak-picks-recap"
      className="rounded-xl p-3 flex flex-col gap-2.5"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp size={14} style={{ color: "var(--peak-accent, #f5c842)" }} aria-hidden="true" />
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            What PEAK3 would have picked
          </span>
        </div>
        <span
          className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5"
          style={{ background: "rgba(245,200,66,0.12)", color: "var(--peak-accent, #f5c842)" }}
          data-testid="peak-picks-match-count"
        >
          {matchedCount}/{recap.length} matched
        </span>
      </div>
      <p className="text-[11px] -mt-1" style={{ color: "var(--text-muted)" }}>
        The highest-rated player still available each round, compared to who you actually took.
      </p>
      <ul className="flex flex-col gap-1" data-testid="peak-picks-recap-list">
        {recap.map((entry) => (
          <li
            key={entry.round_number}
            data-testid="peak-picks-recap-row"
            data-matched={entry.matched}
            className="flex items-center gap-2 text-xs rounded-lg px-2 py-1.5"
            style={{ background: entry.matched ? "rgba(52,211,153,0.07)" : "var(--bg-elevated)" }}
          >
            <span
              className="text-[9px] font-bold uppercase tracking-wide shrink-0 w-14"
              style={{ color: "var(--text-muted)" }}
            >
              Rd {entry.round_number} · {SLOT_LABELS[entry.slot_type as SlotType] ?? entry.slot_type}
            </span>
            {entry.matched ? (
              <span className="flex items-center gap-1 flex-1 min-w-0" style={{ color: "#34d399" }}>
                <Check size={12} aria-hidden="true" className="shrink-0" />
                <span className="truncate font-semibold">You matched PEAK3&apos;s pick -- {entry.picked_player_name}</span>
              </span>
            ) : (
              <span className="flex-1 min-w-0 truncate" style={{ color: "var(--text-secondary)" }}>
                <span style={{ color: "var(--text-primary)" }}>
                  You: {entry.picked_player_name ?? "--"}
                  {entry.picked_score != null ? ` (${entry.picked_score.toFixed(1)})` : ""}
                </span>
                {" · "}
                <span style={{ color: "var(--peak-accent, #f5c842)" }}>
                  PEAK3: {entry.peak_pick_player_name}
                  {entry.peak_pick_score != null ? ` (${entry.peak_pick_score.toFixed(1)})` : ""}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
