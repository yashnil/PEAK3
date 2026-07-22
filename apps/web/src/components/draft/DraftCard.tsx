"use client";
import { DraftCard as DraftCardType, ROLE_LABELS, DraftRole } from "@/types/draft";

const ROLE_COLORS: Record<DraftRole, string> = {
  lead_creator: "#f472b6",
  guard_wing: "#60a5fa",
  wing_forward: "#a78bfa",
  forward_big: "#fb923c",
  anchor: "#34d399",
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
  const roleColor = primaryRole ? ROLE_COLORS[primaryRole] : "#8c8fa8";

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
        boxShadow: selected ? `0 0 0 2px ${roleColor}40` : undefined,
      }}
      className={[
        "relative flex flex-col text-left w-full rounded-xl border transition-all duration-150",
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
              background: `${roleColor}20`,
              color: roleColor,
              border: `1px solid ${roleColor}40`,
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
          style={{ background: "#f59e0b" }}
          title="Data may be incomplete"
        />
      )}
    </button>
  );
}
