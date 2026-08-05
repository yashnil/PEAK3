"use client";
import { LiveBuild } from "@/types/perfect-season";

interface Props {
  liveBuild: LiveBuild;
}

/**
 * Phase 6E Part D: compact "Live Build" feedback panel -- shown once at
 * least one player is placed, so a run has tension and the user can read
 * their own build instead of only finding out at the very end.
 *
 * Deliberately does NOT show a number score anywhere (the server only ever
 * sends a coarse win-range and text tags, never a hidden per-card score --
 * see state.py::_compute_live_build), and never recommends a specific
 * candidate for the open round -- this describes what's already been
 * placed, not what to pick next.
 */
const CONFIDENCE_LABEL: Record<string, string> = {
  early_projection: "Early projection",
  narrowing_projection: "Narrowing projection",
  ready_to_simulate: "Ready to simulate",
};

export default function LiveBuildPanel({ liveBuild }: Props) {
  const { placed_count, total_rounds, scored_count, unscored_count, identity_tags, needs, provisional_record_range, projection_confidence } = liveBuild;
  const scoreLabel =
    unscored_count === 0
      ? `${scored_count}/${placed_count} scored`
      : `${scored_count}/${placed_count} scored, ${unscored_count} pending`;

  return (
    <div
      data-testid="live-build-panel"
      className="rounded-xl px-3 py-2.5 flex flex-col gap-1.5"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          Live Build
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }} data-testid="live-build-progress">
          {placed_count}/{total_rounds} placed · {scoreLabel}
        </span>
      </div>

      {provisional_record_range && (
        <div className="text-sm" data-testid="live-build-record-range">
          {provisional_record_range.low_wins === provisional_record_range.high_wins ? (
            <span className="font-bold" style={{ color: "var(--peak-accent-text, #f5c842)" }}>
              {provisional_record_range.low_wins}-{82 - provisional_record_range.low_wins}
            </span>
          ) : (
            <span className="font-bold" style={{ color: "var(--peak-accent-text, #f5c842)" }}>
              {provisional_record_range.low_wins}-{82 - provisional_record_range.low_wins}
              {" "}to{" "}
              {provisional_record_range.high_wins}-{82 - provisional_record_range.high_wins}
            </span>
          )}{" "}
          <span style={{ color: "var(--text-muted)" }} data-testid="live-build-confidence">
            {CONFIDENCE_LABEL[projection_confidence] ?? "Provisional"}
          </span>
        </div>
      )}

      {(identity_tags.length > 0 || needs.length > 0) && (
        <div className="flex flex-wrap gap-1.5" data-testid="live-build-tags">
          {identity_tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5"
              style={{ color: "var(--text-secondary)", background: "var(--pk-surface-inset, var(--bg-elevated))" }}
            >
              {tag}
            </span>
          ))}
          {needs.map((n) => (
            <span
              key={n}
              className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5"
              style={{ color: "var(--peak-accent-text, #f5c842)", background: "var(--peak-accent-bg)" }}
            >
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
