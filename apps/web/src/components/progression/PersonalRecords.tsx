"use client";

import { PersonalRecord, RECORD_TYPE_LABELS, MODE_LABELS } from "@/lib/progression-api";

interface Props {
  records: PersonalRecord[];
}

function formatValue(record: PersonalRecord): string {
  if (record.record_type === "draft_efficiency") {
    return `${(record.record_value * 100).toFixed(1)}%`;
  }
  if (record.record_type === "daily_percentile") {
    return `Top ${record.record_value.toFixed(1)}%`;
  }
  return record.record_value.toFixed(1);
}

export function PersonalRecords({ records }: Props) {
  if (records.length === 0) {
    return (
      <p className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }}>
        No personal records yet. Complete games to set records.
      </p>
    );
  }

  // Group by record_type
  const byType: Record<string, PersonalRecord[]> = {};
  for (const r of records) {
    (byType[r.record_type] ??= []).push(r);
  }

  return (
    <div className="space-y-4">
      {Object.entries(byType).map(([type, recs]) => (
        <div key={type}>
          <h4
            className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: "var(--text-muted)" }}
          >
            {RECORD_TYPE_LABELS[type] ?? type}
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {recs.sort((a, b) => a.mode.localeCompare(b.mode)).map((r) => (
              <div
                key={`${r.record_type}-${r.mode}`}
                className="rounded-lg border p-3"
                style={{
                  background: "var(--bg-surface)",
                  borderColor: "var(--border-subtle)",
                }}
                role="article"
                aria-label={`${RECORD_TYPE_LABELS[type] ?? type} — ${MODE_LABELS[r.mode] ?? r.mode}: ${formatValue(r)}`}
              >
                <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
                  {MODE_LABELS[r.mode] ?? r.mode}
                </div>
                <div
                  className="text-xl font-bold tabular-nums"
                  style={{ color: "var(--peak-accent)" }}
                >
                  {formatValue(r)}
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {new Date(r.achieved_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
