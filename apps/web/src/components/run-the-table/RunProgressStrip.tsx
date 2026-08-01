"use client";
import { MapAct } from "@/types/run-the-table";
import { ladderProgress, ladderRows } from "@/lib/run-the-table-state";

/**
 * Mobile-only progress strip: the same nine ladder rows as the desktop map,
 * collapsed into one horizontal run of ticks. It answers "how far in am I"
 * without asking a phone to render a nine-row rail above the decision.
 */
interface Props {
  map: MapAct[];
}

export default function RunProgressStrip({ map }: Props) {
  const rows = ladderRows(map);
  const { done, total } = ladderProgress(map);
  return (
    <div
      data-testid="rtt-progress-strip"
      data-tour-id="rtt-progress-strip"
      className="flex flex-col gap-1.5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          Run progress
        </span>
        <span className="score-number text-[10px]" style={{ color: "var(--text-secondary)" }}>
          {done}/{total}
        </span>
      </div>
      <ol className="flex items-center gap-1" aria-label="Run progress">
        {rows.map((row) => {
          const isBoss = row.kind === "boss";
          const color =
            row.state === "current"
              ? "var(--peak-accent)"
              : row.state === "done" || row.state === "won"
                ? "var(--correct)"
                : row.state === "lost"
                  ? "var(--incorrect)"
                  : "var(--border-emphasis)";
          return (
            <li
              key={row.key}
              className="flex-1 rounded-full"
              style={{ height: isBoss ? 8 : 4, background: color }}
              title={`${row.label} — ${row.state}`}
            >
              <span className="sr-only">{`${row.label}: ${row.state}`}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
