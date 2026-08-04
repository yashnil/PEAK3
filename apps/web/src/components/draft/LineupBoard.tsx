"use client";
import { SelectedCard, DRAFT_ROLES, DraftRole, ROLE_LABELS, DraftCard } from "@/types/draft";

// Theme-aware `--accent-*` tokens (P3-G2) -- see the identical comment in
// DraftCard.tsx, which owns the canonical explanation of this mapping.
const ROLE_COLORS: Record<DraftRole, string> = {
  lead_creator: "var(--accent-pink)",
  guard_wing: "var(--accent-blue)",
  wing_forward: "var(--accent-violet)",
  forward_big: "var(--accent-orange)",
  anchor: "var(--accent-emerald)",
};

interface Props {
  selectedCards: SelectedCard[];
  openRoles: DraftRole[];
  heldCard?: DraftCard | null;
}

export default function LineupBoard({ selectedCards, openRoles, heldCard }: Props) {
  // Build a map from role → selected card
  const byRole = new Map<DraftRole, SelectedCard>();
  for (const sc of selectedCards) {
    byRole.set(sc.role, sc);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="text-xs font-semibold uppercase tracking-wider mb-1"
        style={{ color: "var(--text-secondary)" }}
      >
        Your Lineup
      </div>
      {DRAFT_ROLES.map((role) => {
        const filled = byRole.get(role);
        const isOpen = openRoles.includes(role);
        const color = ROLE_COLORS[role];

        return (
          <div
            key={role}
            className="flex items-center gap-2 rounded-lg px-3 py-2"
            style={{
              // `color-mix`, not a hex-alpha suffix -- `color` is now a
              // `var(--accent-*)` reference (P3-G2).
              background: filled ? `color-mix(in srgb, ${color} 10%, transparent)` : "var(--bg-elevated)",
              border: `1px solid ${filled ? `color-mix(in srgb, ${color} 40%, transparent)` : "var(--border-subtle)"}`,
            }}
          >
            {/* Role indicator */}
            <div
              className="w-1 self-stretch rounded-full shrink-0"
              style={{ background: filled ? color : "var(--border-subtle)" }}
            />

            {/* Role label */}
            <div
              className="text-xs font-medium w-24 shrink-0"
              style={{ color: filled ? color : "var(--text-muted)" }}
            >
              {ROLE_LABELS[role]}
            </div>

            {/* Card name or placeholder */}
            {filled ? (
              <div className="flex-1 flex items-center justify-between min-w-0">
                <span
                  className="text-sm font-semibold truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {filled.card.player_name}
                </span>
                <span
                  className="text-xs tabular-nums shrink-0 ml-2"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {Math.round(filled.card.individual_peak_score)}
                </span>
              </div>
            ) : isOpen ? (
              <span
                className="text-xs italic"
                style={{ color: "var(--text-muted)" }}
              >
                {role === "anchor" && heldCard
                  ? `(held: ${heldCard.player_name})`
                  : "open"}
              </span>
            ) : (
              <span
                className="text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                —
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
