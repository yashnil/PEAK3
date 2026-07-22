"use client";
import { LineupEvaluation, ReceiptItem, SynergyItem } from "@/types/draft";

function ReceiptItemRow({ item }: { item: ReceiptItem }) {
  const typeColors: Record<string, string> = {
    talent_core: "#f5c842",
    strength: "#34d399",
    weakness: "#ef4444",
    warning: "#f59e0b",
    synergy: "#a78bfa",
    draft_summary: "#60a5fa",
    data_note: "#6b7280",
  };
  const color = typeColors[item.item_type] ?? "#8c8fa8";

  return (
    <div
      className="rounded-lg px-3 py-2.5 border"
      style={{
        background: `${color}08`,
        borderColor: `${color}30`,
      }}
    >
      <div
        className="text-xs font-semibold"
        style={{ color }}
      >
        {item.title}
      </div>
      <p
        className="text-sm mt-0.5 leading-snug"
        style={{ color: "var(--text-secondary)" }}
      >
        {item.plain_language}
      </p>
    </div>
  );
}

function SynergyRow({ item }: { item: SynergyItem }) {
  if (!item.triggered) return null;
  const color = item.rule_type === "positive" ? "#34d399" : "#ef4444";
  const sign = item.adjustment >= 0 ? "+" : "";
  return (
    <div
      className="flex items-start gap-2 text-xs py-1"
      style={{ color: "var(--text-secondary)" }}
    >
      <span style={{ color }}>{sign}{(item.adjustment * 100).toFixed(1)}%</span>
      <span>{item.title}</span>
    </div>
  );
}

interface Props {
  evaluation: LineupEvaluation;
  onShare?: () => void;
}

export default function DraftReceipt({ evaluation, onShare }: Props) {
  const {
    lineup_peak_rating,
    talent_score,
    coverage_score,
    draft_efficiency,
    board_percentile,
    synergy_items,
    receipt_items,
    lineup_model_version,
  } = evaluation;

  const effPct = draft_efficiency != null ? Math.round(draft_efficiency * 100) : null;
  const pctLabel = board_percentile != null ? Math.round(board_percentile) : null;
  const ratingDisplay = Math.round(lineup_peak_rating * 10) / 10;

  return (
    <div data-testid="peak-receipt" className="flex flex-col gap-5">
      {/* Experimental disclaimer */}
      <div
        className="text-xs px-3 py-2 rounded-lg border"
        style={{
          background: "#f59e0b10",
          borderColor: "#f59e0b40",
          color: "#f59e0b",
        }}
      >
        ⚠ Experimental lineup model ({lineup_model_version}). Ratings are a
        hypothesis, not a prediction of game outcomes or objective truth.
      </div>

      {/* Main score */}
      <div className="flex items-end gap-4">
        <div>
          <div
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            Lineup Peak Rating
          </div>
          <div
            className="text-5xl font-bold tabular-nums"
            style={{ color: "var(--peak-accent)" }}
          >
            {ratingDisplay}
          </div>
        </div>

        <div className="flex flex-col gap-1 mb-1">
          {effPct != null && (
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {effPct}%
              </span>{" "}
              draft efficiency
            </div>
          )}
          {pctLabel != null && (
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Beat{" "}
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {pctLabel}%
              </span>{" "}
              of valid lineups
            </div>
          )}
        </div>
      </div>

      {/* Component scores */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Talent", value: talent_score, color: "#f5c842" },
          { label: "Coverage", value: coverage_score, color: "#60a5fa" },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="rounded-lg p-3 border"
            style={{
              background: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {label}
            </div>
            <div
              className="text-xl font-bold tabular-nums"
              style={{ color }}
            >
              {Math.round(value * 10) / 10}
            </div>
          </div>
        ))}
      </div>

      {/* Synergy breakdown */}
      {synergy_items.some((s) => s.triggered) && (
        <div>
          <div
            className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: "var(--text-secondary)" }}
          >
            Synergy
          </div>
          {synergy_items.map((s) => (
            <SynergyRow key={s.rule_id} item={s} />
          ))}
        </div>
      )}

      {/* Receipt items */}
      <div className="flex flex-col gap-2">
        <div
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-secondary)" }}
        >
          Peak Receipt
        </div>
        {receipt_items.map((item) => (
          <ReceiptItemRow key={item.id} item={item} />
        ))}
      </div>

      {/* Share */}
      {onShare && (
        <button
          onClick={onShare}
          className="py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
          style={{
            background: "var(--border-default)",
            color: "var(--text-primary)",
          }}
        >
          Create Challenge Link
        </button>
      )}
    </div>
  );
}
