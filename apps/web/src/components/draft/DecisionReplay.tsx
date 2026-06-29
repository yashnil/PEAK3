"use client";
import { RoundHistoryEntry, ROLE_LABELS } from "@/types/draft";

interface Props {
  history: RoundHistoryEntry[];
}

/**
 * Decision replay: for each completed round, show the three offers the player
 * saw and highlight the card they drafted (and the role it filled). Read-only.
 * Uses only data the player already saw — never future offers.
 */
export default function DecisionReplay({ history }: Props) {
  if (!history || history.length === 0) return null;

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-4"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-secondary)" }}
      >
        Decision replay
      </div>

      {history.map((rh) => (
        <div key={rh.round} className="flex flex-col gap-1.5">
          <div
            className="text-[11px] font-medium uppercase tracking-wide"
            style={{ color: "var(--text-muted)" }}
          >
            Round {rh.round}
            {rh.reframed ? " · reframed" : ""} · drafted as{" "}
            {ROLE_LABELS[rh.role]}
          </div>
          <div className="flex flex-col gap-1">
            {rh.offers.map((offer) => {
              const picked = offer.peak_window_id === rh.selected_card_id;
              return (
                <div
                  key={offer.peak_window_id}
                  className="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm"
                  style={{
                    background: picked
                      ? "color-mix(in srgb, var(--peak-accent) 14%, transparent)"
                      : "transparent",
                    border: picked
                      ? "1px solid color-mix(in srgb, var(--peak-accent) 45%, transparent)"
                      : "1px solid var(--border-subtle)",
                    opacity: picked ? 1 : 0.6,
                  }}
                >
                  <span
                    className="truncate"
                    style={{
                      color: picked
                        ? "var(--text-primary)"
                        : "var(--text-secondary)",
                      fontWeight: picked ? 600 : 400,
                    }}
                  >
                    {picked ? "✓ " : ""}
                    {offer.player_name}
                  </span>
                  <span
                    className="shrink-0 tabular-nums text-xs ml-2"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {offer.individual_peak_score.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
