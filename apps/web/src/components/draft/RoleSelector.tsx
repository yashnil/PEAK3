"use client";
import { DraftCard, DraftRole, ROLE_LABELS, DRAFT_ROLES } from "@/types/draft";

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
  card: DraftCard;
  openRoles: DraftRole[];
  selectedRole: DraftRole | null;
  onSelect: (role: DraftRole) => void;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}

export default function RoleSelector({
  card,
  openRoles,
  selectedRole,
  onSelect,
  onCancel,
  onConfirm,
  submitting,
}: Props) {
  const eligibleOpen = card.eligible_roles.filter((r) => openRoles.includes(r));

  return (
    <div
      className="pk-depth pk-crown-accent flex flex-col gap-4 rounded-xl p-4 border"
      style={{
        borderColor: "var(--peak-accent-edge)",
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <div
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Assign role
          </div>
          <div
            className="font-semibold mt-0.5"
            style={{ color: "var(--text-primary)" }}
          >
            {card.player_name}
          </div>
          <div
            className="score-number text-xs mt-0.5"
            style={{ color: "var(--text-secondary)" }}
          >
            PEAK {Math.round(card.individual_peak_score)} · {card.anchor_season}
          </div>
        </div>
        <button
          onClick={onCancel}
          className="pk-lift pk-press text-xs px-2 py-1 rounded-lg border"
          style={{
            color: "var(--text-secondary)",
            background: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
          }}
        >
          ✕ Cancel
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {DRAFT_ROLES.map((role) => {
          const eligible = eligibleOpen.includes(role);
          const isOpen = openRoles.includes(role);
          const color = ROLE_COLORS[role];
          const isSelected = selectedRole === role;

          return (
            <button
              data-testid="role-btn"
              data-role={role}
              key={role}
              disabled={!eligible}
              onClick={() => eligible && onSelect(role)}
              className={[
                "flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-[background-color,border-color,opacity]",
                "border",
                eligible ? "pk-lift pk-press" : "",
                !isOpen
                  ? "opacity-25 cursor-not-allowed"
                  : !eligible
                  ? "opacity-35 cursor-not-allowed"
                  : "cursor-pointer",
                isSelected
                  ? `border-[${color}]`
                  : "border-transparent hover:border-[var(--border-default)]",
              ].join(" ")}
              style={{
                background: isSelected ? `color-mix(in srgb, ${color} 15%, transparent)` : "var(--bg-surface)",
                borderColor: isSelected ? color : "var(--border-subtle)",
              }}
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: eligible ? color : "var(--text-muted)" }}
              />
              <span
                className="text-sm font-medium"
                style={{
                  color: eligible ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {ROLE_LABELS[role]}
              </span>
              {!isOpen && (
                <span
                  className="text-xs ml-auto"
                  style={{ color: "var(--text-muted)" }}
                >
                  filled
                </span>
              )}
              {isOpen && !eligible && (
                <span
                  className="text-xs ml-auto"
                  style={{ color: "var(--text-muted)" }}
                >
                  ineligible
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button
        data-testid="lock-in"
        onClick={onConfirm}
        disabled={!selectedRole || submitting}
        className="pk-lift pk-press py-2 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        style={{
          background: selectedRole && !submitting ? "var(--peak-accent)" : "var(--border-default)",
          color: selectedRole && !submitting ? "var(--text-inverse)" : "var(--text-muted)",
          cursor: selectedRole && !submitting ? "pointer" : "not-allowed",
        }}
      >
        {submitting ? "Submitting…" : "Lock In"}
      </button>
    </div>
  );
}
