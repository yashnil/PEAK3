"use client";
import { CurrentSpin } from "@/types/perfect-season";

interface Props {
  spin: CurrentSpin;
  roundNumber: number;
  totalRounds: number;
}

export default function SpinStage({ spin, roundNumber, totalRounds }: Props) {
  const label =
    spin.spin_type === "open_pool"
      ? "Open Pool"
      : `${spin.franchise_display_name ?? ""} ${spin.era_label ? "· " + spin.era_label : ""}`.trim();

  return (
    <div
      data-testid="spin-stage"
      className="rounded-2xl border p-4 flex flex-col gap-1"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
    >
      <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
        <span>
          Round {roundNumber} / {totalRounds}
        </span>
        {spin.spin_type !== "open_pool" && (
          <span
            data-testid="interim-data-label"
            className="rounded px-2 py-0.5"
            style={{ background: "rgba(245,200,66,0.15)", color: "var(--peak-accent, #f5c842)" }}
          >
            Interim team data — limited coverage
          </span>
        )}
      </div>
      <div className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
        {label || "Build your roster"}
      </div>
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {spin.spin_type === "team_decade" && "Pick one eligible player from this era."}
        {spin.spin_type === "exact_team_season" && "Pick one eligible player from this exact roster."}
        {spin.spin_type === "open_pool" && "Pick one eligible player."}
      </p>
    </div>
  );
}
