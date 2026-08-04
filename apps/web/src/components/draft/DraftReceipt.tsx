"use client";
import { LineupEvaluation, ReceiptItem, SynergyItem } from "@/types/draft";

// Theme-aware tokens (P3-G2), not literal hex: this map used to feed both a
// text `color` AND a `${color}08`/`${color}30` hex-alpha-suffix background/
// border, which is exactly the pattern that produced invalid CSS the moment
// any of these became a `var(--token)` reference (see the same fix in
// `progression/AchievementCard.tsx`) -- so both the color source AND the
// alpha-blend method change together below.
function ReceiptItemRow({ item }: { item: ReceiptItem }) {
  const typeColors: Record<string, string> = {
    talent_core: "var(--peak-accent-text, #f5c842)",
    strength: "var(--accent-emerald)",
    weakness: "var(--incorrect)",
    warning: "var(--warning)",
    synergy: "var(--accent-violet)",
    draft_summary: "var(--accent-blue)",
    data_note: "var(--text-muted)",
  };
  const color = typeColors[item.item_type] ?? "var(--text-secondary)";

  return (
    <div
      className="rounded-lg px-3 py-2.5 border"
      style={{
        background: `color-mix(in srgb, ${color} 3%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 19%, transparent)`,
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
  const color = item.rule_type === "positive" ? "var(--accent-emerald)" : "var(--incorrect)";
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
          background: "var(--warning-bg)",
          borderColor: "color-mix(in srgb, var(--warning) 40%, transparent)",
          color: "var(--warning)",
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
            style={{ color: "var(--peak-accent-text)" }}
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
          { label: "Talent", value: talent_score, color: "var(--peak-accent-text, #f5c842)" },
          { label: "Coverage", value: coverage_score, color: "var(--accent-blue)" },
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
          className="py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
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
