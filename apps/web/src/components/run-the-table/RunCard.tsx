"use client";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import { LANE_FIELDS, RunCardPublic } from "@/types/run-the-table";
import { ROLE_COLOR_VARS, ROLE_LABELS, laneColorVar } from "@/lib/run-the-table-state";

const LANE_TOKENS = ["si", "tp", "rec", "po", "team"] as const;

/**
 * Lane display names, in `LANE_FIELDS` order.
 *
 * `RunCardPublic.lane_percentiles` is a bare `Record<LaneField, number>` — the
 * only lane payload on the API that carries no `label`, unlike
 * `LaneProfileEntry`. So the names have to live here, mirrored from
 * config.py's `LANE_LABELS` exactly as `LANE_TOKENS` above already mirrors
 * `LANE_TOKENS`. The NUMBERS are still entirely the server's.
 */
const LANE_SR_LABELS = [
  "Statistical Impact",
  "Traditional Production",
  "Individual Recognition",
  "Playoff Rate Impact",
  "Team Result",
] as const;

/**
 * One exact 3-year peak card.
 *
 * Shows what the Draft Room is required to show: cost, role eligibility,
 * overall PEAK3 score, and a compact five-lane fingerprint. Every one of those
 * numbers is read straight off the payload — the fingerprint bars use
 * `lane_percentiles`, which the engine already scaled 0-100.
 *
 * No player photograph and no team logo: `PlayerAvatar` renders an initials
 * medallion, which is the licensed-safe treatment used everywhere else.
 */
interface Props {
  card: RunCardPublic;
  /** What this card costs right now, if it is purchasable in this context. */
  cost?: number | null;
  /** Shown struck through beside `cost` when a System discounted it. */
  strikeCost?: number | null;
  costLabel?: string;
  compact?: boolean;
  showFingerprint?: boolean;
  /** Extra content under the fingerprint (buttons, blocked reasons). */
  children?: React.ReactNode;
}

export default function RunCard({
  card,
  cost = null,
  strikeCost = null,
  costLabel = "Cost",
  compact = false,
  showFingerprint = true,
  children,
}: Props) {
  const roleColor = ROLE_COLOR_VARS[card.primary_role] ?? "var(--peak-accent)";
  return (
    <div className="flex flex-col gap-2 min-w-0" data-testid="rtt-run-card">
      <div className="flex items-start gap-2.5 min-w-0">
        <PlayerAvatar name={card.player_name} size={compact ? 32 : 38} />
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-baseline gap-2 min-w-0">
            <span
              className={`font-semibold truncate ${compact ? "text-[13px]" : "text-sm"}`}
              style={{ color: "var(--text-primary)" }}
            >
              {card.player_name}
            </span>
            <span
              className="score-number text-[11px] shrink-0"
              style={{ color: "var(--peak-accent)" }}
              title="PEAK3 3-year prime score"
            >
              {card.prime_score.toFixed(1)}
            </span>
          </div>
          <span className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
            {card.window_label} · <span className="score-number">{card.overall_percentile.toFixed(1)}</span>
            th pct
          </span>
        </div>
        {cost !== null && (
          <div className="flex flex-col items-end shrink-0">
            <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {costLabel}
            </span>
            <span className="flex items-baseline gap-1">
              {strikeCost !== null && strikeCost !== cost && (
                <span
                  className="score-number text-[10px] line-through"
                  style={{ color: "var(--text-muted)" }}
                >
                  {strikeCost}
                </span>
              )}
              <span
                className="score-number text-sm font-bold"
                style={{ color: cost === 0 ? "var(--correct)" : "var(--text-primary)" }}
              >
                {cost}
              </span>
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span
          className="text-[9px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5"
          style={{
            color: roleColor,
            background: "var(--bg-surface)",
            border: `1px solid color-mix(in srgb, ${roleColor} 40%, transparent)`,
          }}
        >
          {ROLE_LABELS[card.primary_role] ?? card.primary_role}
        </span>
        {card.eligible_roles
          .filter((r) => r !== card.primary_role)
          .map((role) => (
            <span
              key={role}
              className="text-[9px] uppercase tracking-wider rounded px-1.5 py-0.5"
              style={{ color: "var(--text-muted)", background: "var(--bg-surface)" }}
            >
              {ROLE_LABELS[role] ?? role}
            </span>
          ))}
      </div>

      {showFingerprint && (
        <>
          <div className="flex items-end gap-1" aria-hidden="true" data-testid="rtt-card-fingerprint">
            {LANE_FIELDS.map((lane, i) => {
              const pct = card.lane_percentiles[lane] ?? 0;
              return (
                <span
                  key={lane}
                  className="flex-1 rounded-sm"
                  style={{
                    height: `${Math.max(2, Math.min(100, pct) * 0.16)}px`,
                    background: laneColorVar(LANE_TOKENS[i]),
                    opacity: 0.85,
                  }}
                />
              );
            })}
          </div>
          {/* The bars stay `aria-hidden` — bar height is not information a
              screen reader can use. This sentence IS the fingerprint: without
              it `lane_percentiles` appeared nowhere in the accessible tree and
              a non-sighted player drafted on the overall score alone. */}
          <span className="sr-only" data-testid="rtt-card-fingerprint-sr">
            {`Lane percentiles — ${LANE_FIELDS.map(
              (lane, i) =>
                `${LANE_SR_LABELS[i]} ${(card.lane_percentiles[lane] ?? 0).toFixed(0)}`,
            ).join(", ")}.`}
          </span>
        </>
      )}

      {card.cost_modifiers.length > 0 && (
        <p className="text-[10px]" style={{ color: "var(--correct)" }}>
          {card.cost_modifiers.join(" · ")}
        </p>
      )}

      {children}
    </div>
  );
}
