import Link from "next/link";
import type { Metadata } from "next";
import {
  DraftMode,
  MODE_LABELS,
  MODE_DESCRIPTIONS,
} from "@/types/draft";

export const metadata: Metadata = {
  title: "Arena — Peak Draft | PEAK3",
  description:
    "Draft your all-time 5-player lineup from NBA history windows. An experimental lineup model rates your selections.",
};

const MODES: DraftMode[] = ["apex_1y", "prime_3y", "foundation_5y"];
const MODE_ICONS = { apex_1y: "⚡", prime_3y: "✦", foundation_5y: "🏛" };
const MODE_CSS: Record<DraftMode, string> = {
  apex_1y: "#ff6b47",
  prime_3y: "#f5c842",
  foundation_5y: "#4a90d9",
};

function ModeCard({ mode }: { mode: DraftMode }) {
  const color = MODE_CSS[mode];
  return (
    <div
      className="rounded-2xl border p-5 flex flex-col gap-4"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border-default)",
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-2xl">{MODE_ICONS[mode]}</span>
        <div>
          <div
            className="font-bold text-base"
            style={{ color: "var(--text-primary)" }}
          >
            {MODE_LABELS[mode]}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {MODE_DESCRIPTIONS[mode]}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Link
          href={`/arena/daily/${mode}`}
          className="block text-center py-2 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
          style={{ background: color, color: "#000" }}
        >
          Daily Draft
        </Link>
        <Link
          href={`/arena/practice/${mode}`}
          className="block text-center py-2 rounded-lg text-sm font-medium transition-all"
          style={{
            background: "var(--bg-surface)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border-default)",
          }}
        >
          Practice
        </Link>
      </div>
    </div>
  );
}

export default function ArenaPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8">
        <h1
          className="text-3xl font-bold"
          style={{ color: "var(--text-primary)" }}
        >
          Peak Draft Arena
        </h1>
        <p className="mt-2 text-base" style={{ color: "var(--text-secondary)" }}>
          Build a 5-player lineup from NBA peak windows. 5 rounds. 3 offers each.
          Use Hold to bank a card or Reframe to swap the entire round.
        </p>
        <div
          className="mt-3 text-xs px-3 py-2 rounded-lg border inline-block"
          style={{
            background: "#f59e0b10",
            borderColor: "#f59e0b40",
            color: "#f59e0b",
          }}
        >
          ⚠ The lineup rating is an experimental model — not a prediction of wins or objective truth.
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {MODES.map((m) => (
          <ModeCard key={m} mode={m} />
        ))}
      </div>

      {/* Ranked is a distinct, separately-labeled mode — not Daily, not Practice. */}
      <div
        className="mt-6 rounded-2xl border p-5 flex items-center justify-between gap-4"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
      >
        <div>
          <div className="font-bold text-base" style={{ color: "var(--text-primary)" }}>
            Ranked (closed alpha)
          </div>
          <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Play the same hidden board as a matched opponent. Independent per-queue rating.
          </div>
        </div>
        <Link
          href="/arena/ranked"
          className="shrink-0 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
        >
          View Ranked
        </Link>
      </div>

      <div className="mt-10 text-xs" style={{ color: "var(--text-muted)" }}>
        <p>
          Card scores are the official individual PEAK3 scores — unchanged.
          Lineup ratings use a separate experimental model (lineup_peak_rating).
          Never presented as game predictions.
        </p>
      </div>
    </div>
  );
}
