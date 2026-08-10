"use client";
import { LineupEvaluation, ReceiptItem, SynergyItem } from "@/types/draft";
// See its own docstring for why a result number is not `AnimatedNumber`.
import { ResultNumber } from "@/components/game/result-number";

/** The receipt's own display format, kept in one place so the counting number
 *  and the value it lands on are formatted by the same function. One decimal
 *  at most, and no trailing `.0` — exactly what this screen printed before. */
const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);

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

      {/* Main score. A raised plate with an accent crown rather than bare text
          on the page: this number is the whole result of the draft, and it was
          rendering with less chrome than the disclaimer above it. */}
      <div className="pk-reveal pk-depth pk-crown pk-crown-accent flex items-end gap-4 rounded-xl p-3" style={{ "--pk-reveal-index": 0 } as React.CSSProperties}>
        <div>
          {/* WAS `--text-muted`. It is the name of the 48px number under it. */}
          <div
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Lineup Peak Rating
          </div>
          <div
            className="font-display text-5xl font-bold"
            style={{ color: "var(--peak-accent-text)" }}
          >
            <ResultNumber value={ratingDisplay} format={oneDecimal} />
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
      <div
        className="pk-reveal grid grid-cols-2 gap-2"
        style={{ "--pk-reveal-index": 1 } as React.CSSProperties}
      >
        {[
          { label: "Talent", value: talent_score, color: "var(--peak-accent-text, #f5c842)" },
          { label: "Coverage", value: coverage_score, color: "var(--accent-blue)" },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="pk-depth pk-crown rounded-lg p-3 border"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            {/* WAS `--text-muted`. Two words, and they are the only way to
                tell the two tiles apart. */}
            <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              {label}
            </div>
            <div
              className="font-display text-xl font-bold"
              style={{ color }}
            >
              <ResultNumber value={value} format={oneDecimal} />
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
          type="button"
          onClick={onShare}
          className="pk-lift pk-press py-2.5 rounded-lg text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
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
