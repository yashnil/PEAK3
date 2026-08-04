"use client";
import { DraftCard as DraftCardType, ROLE_LABELS, DraftRole } from "@/types/draft";

// Theme-aware `--accent-*` tokens (P3-G2), not literal hex -- same five hues
// `--role-*` uses (this card's role identity, just not that literal token:
// `--role-*` is RTT's own roster-role system, a different semantic reusing
// the same palette by coincidence).
//
// P6-b CORRECTION: this comment used to claim --accent-* is "text-safe in
// both themes" -- it is not, and that exact claim is why the bug below
// shipped. --accent-* IS darkened per theme (unlike --role-*), but only
// enough to clear a PLAIN card; used as `color` on top of a color-mix wash
// of itself (the role pill below, `color-mix(roleColor 20%, transparent)`),
// axe measured it failing 4.23-4.40:1 in light mode. `--accent-*-text` is
// the actually-text-safe sibling, darkened again specifically for that case.
const ROLE_COLORS: Record<DraftRole, string> = {
  lead_creator: "var(--accent-pink)",
  guard_wing: "var(--accent-blue)",
  wing_forward: "var(--accent-violet)",
  forward_big: "var(--accent-orange)",
  anchor: "var(--accent-emerald)",
};

/** Text-safe siblings of `ROLE_COLORS` (P6-b) -- use for `color`, never for a
 *  background or border, where `ROLE_COLORS` itself is correct. */
const ROLE_TEXT_COLORS: Record<DraftRole, string> = {
  lead_creator: "var(--accent-pink-text)",
  guard_wing: "var(--accent-blue-text)",
  wing_forward: "var(--accent-violet-text)",
  forward_big: "var(--accent-orange-text)",
  anchor: "var(--accent-emerald-text)",
};

interface Props {
  card: DraftCardType;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  showRole?: DraftRole | null;
  compact?: boolean;
  eligible?: boolean;
}

export default function DraftCard({
  card,
  selected = false,
  dimmed = false,
  onClick,
  showRole,
  compact = false,
  eligible,
}: Props) {
  const primaryRole = showRole ?? card.primary_role;
  const roleColor = primaryRole ? ROLE_COLORS[primaryRole] : "var(--text-secondary)";
  // `var(--text-secondary)` is already text-safe on its own -- no separate
  // "-text" fallback needed when there is no role.
  const roleTextColor = primaryRole ? ROLE_TEXT_COLORS[primaryRole] : "var(--text-secondary)";

  const scoreDisplay = Math.round(card.individual_peak_score);
  const rankDisplay = `#${card.individual_peak_rank}`;

  const yearLabel =
    card.duration_years === 1
      ? card.anchor_season
      : `${card.start_season} – ${card.end_season}`;

  return (
    <button
      data-testid="offer-card"
      data-eligible={eligible !== false ? "true" : "false"}
      onClick={onClick}
      disabled={!onClick}
      aria-pressed={selected}
      style={{
        opacity: dimmed ? 0.35 : 1,
        borderColor: selected ? roleColor : "var(--border-default)",
        // `color-mix`, not a hex-alpha suffix -- `roleColor` is now a
        // `var(--accent-*)` reference (P3-G2), and appending a hex pair to
        // a var() reference is invalid CSS.
        boxShadow: selected ? `0 0 0 2px color-mix(in srgb, ${roleColor} 40%, transparent)` : undefined,
      }}
      className={[
        "relative flex flex-col text-left w-full rounded-xl border transition-[background-color,border-color,box-shadow,opacity] duration-150",
        "bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]",
        compact ? "p-3 gap-1" : "p-4 gap-2",
        onClick ? "cursor-pointer" : "cursor-default",
        selected ? "ring-2" : "",
      ].join(" ")}
    >
      {/* Score badge */}
      <div className="flex items-start justify-between gap-2">
        <div
          className="text-2xl font-bold tabular-nums leading-none"
          style={{ color: "var(--text-primary)" }}
        >
          {scoreDisplay}
        </div>
        <div
          className="text-xs font-mono px-1.5 py-0.5 rounded"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-secondary)",
          }}
        >
          {rankDisplay}
        </div>
      </div>

      {/* Player name */}
      <div
        className="font-semibold leading-tight text-sm"
        style={{ color: "var(--text-primary)" }}
      >
        {card.player_name}
      </div>

      {/* Season window */}
      <div
        className="text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        {yearLabel}
      </div>

      {/* Primary role pill */}
      {primaryRole && !compact && (
        <div className="mt-1">
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{
              background: `color-mix(in srgb, ${roleColor} 20%, transparent)`,
              color: roleTextColor,
              border: `1px solid color-mix(in srgb, ${roleColor} 40%, transparent)`,
            }}
          >
            {ROLE_LABELS[primaryRole]}
          </span>
        </div>
      )}

      {/* Data completeness badge */}
      {card.data_completeness !== "complete" && (
        <div
          className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--warning)" }}
          title="Data may be incomplete"
        />
      )}
    </button>
  );
}
