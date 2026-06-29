"use client";
import { LineupDNA, DNA_LABELS } from "@/types/draft";

const DIMS = [
  "primary_creation",
  "scoring_pressure",
  "individual_validation",
  "postseason_translation",
  "team_context",
  "context_completeness",
] as const;

function dimColor(val: number): string {
  if (val < 15) return "#ef4444";  // catastrophic hole
  if (val < 35) return "#f59e0b";
  if (val >= 75) return "#34d399";
  return "#60a5fa";
}

interface Props {
  dna: LineupDNA;
  label?: string;
}

export default function DNABar({ dna, label }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <div
          className="text-xs font-semibold uppercase tracking-wider mb-1"
          style={{ color: "var(--text-secondary)" }}
        >
          {label}
        </div>
      )}
      {DIMS.map((dim) => {
        const val = dna[dim] ?? 0;
        const color = dimColor(val);
        return (
          <div key={dim} className="flex items-center gap-2">
            <div
              className="w-20 text-right text-xs shrink-0"
              style={{ color: "var(--text-muted)" }}
            >
              {DNA_LABELS[dim]}
            </div>
            <div
              className="flex-1 rounded-full h-1.5"
              style={{ background: "var(--border-subtle)" }}
            >
              <div
                className="h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, val)}%`, background: color }}
              />
            </div>
            <div
              className="w-7 text-right text-xs tabular-nums shrink-0"
              style={{ color }}
            >
              {Math.round(val)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
