"use client";
import { DraftCard, DraftRole, ROLE_LABELS, DRAFT_ROLES } from "@/types/draft";

const ROLE_COLORS: Record<DraftRole, string> = {
  lead_creator: "#f472b6",
  guard_wing: "#60a5fa",
  wing_forward: "#a78bfa",
  forward_big: "#fb923c",
  anchor: "#34d399",
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
      className="flex flex-col gap-4 rounded-xl p-4 border"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border-default)",
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <div
            className="font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            Assign role for {card.player_name}
          </div>
          <div
            className="text-xs mt-0.5"
            style={{ color: "var(--text-secondary)" }}
          >
            PEAK {Math.round(card.individual_peak_score)} · {card.anchor_season}
          </div>
        </div>
        <button
          onClick={onCancel}
          className="text-xs px-2 py-1 rounded"
          style={{ color: "var(--text-muted)", background: "var(--bg-surface)" }}
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
              key={role}
              disabled={!eligible}
              onClick={() => eligible && onSelect(role)}
              className={[
                "flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-all",
                "border",
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
                background: isSelected ? `${color}15` : "var(--bg-surface)",
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
        onClick={onConfirm}
        disabled={!selectedRole || submitting}
        className="py-2 rounded-lg text-sm font-semibold transition-all"
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
