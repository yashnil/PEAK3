import Link from "next/link";
import type { Metadata } from "next";
import {
  DraftMode,
  MODE_LABELS,
  MODE_DESCRIPTIONS,
} from "@/types/draft";
import { getCourtBuilderReadiness } from "@/lib/perfect-season-api";

export const metadata: Metadata = {
  title: "Arena — 82-0 Peak Season | PEAK3",
  description:
    "Spin a team and era, build a position-aware roster from real NBA peak windows, and chase a perfect 82-0 season.",
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

export default async function ArenaPage() {
  // CourtBuilder (Phase 5C prototype) is only presented as the flagship
  // when the server reports it enabled -- never assumed available
  // (ADR-005 Decision 7; PHASE_5_COURTBUILDER_VERTICAL_SLICE.md Sec 6
  // rollout boundaries). A fetch failure (e.g. API down) is treated as
  // "not enabled" -- fail closed, never show a link to a mode that may
  // not work.
  let courtBuilderEnabled = false;
  try {
    const readiness = await getCourtBuilderReadiness();
    courtBuilderEnabled = readiness.courtbuilder_enabled;
  } catch {
    courtBuilderEnabled = false;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {courtBuilderEnabled && (
        <div
          data-testid="courtbuilder-hero"
          className="mb-8 rounded-2xl border p-6 flex flex-col gap-3"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--peak-accent, #f5c842)" }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] uppercase tracking-wide rounded px-2 py-0.5"
              style={{ background: "var(--bg-surface)", color: "var(--peak-accent, #f5c842)", border: "1px solid var(--peak-accent, #f5c842)" }}
            >
              Flagship prototype
            </span>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            82-0 Peak Season
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Spin a team and era, build a position-aware 5+3 roster from
            exact NBA player-seasons, and chase a perfect season. Ratings
            stay hidden until the final reveal, then you get a full receipt
            — including what PEAK3 itself would have picked each round.
          </p>
          {/* Phase 9A: the daily challenge is the return loop -- given equal
              visual weight beside free play (a distinct blue accent, matching
              the daily badge used on the scorecard and in run history), not
              buried as a secondary link. Free play stays the primary CTA for
              a first-time visitor who hasn't got a reason to care about
              "today's" board yet. */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/arena/court/practice/apex_1y"
              className="px-5 py-2.5 rounded-lg text-sm font-semibold"
              style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
            >
              Build a Perfect Season
            </Link>
            <Link
              href="/arena/court/daily/apex_1y"
              data-testid="daily-peak-season-cta"
              className="px-5 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ background: "rgba(96,165,250,0.12)", color: "#60a5fa", borderColor: "#60a5fa" }}
            >
              Play today&apos;s Daily
            </Link>
            <Link
              href="/arena/court/history"
              data-testid="court-history-link"
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-secondary)" }}
            >
              Your runs →
            </Link>
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Everyone gets the same Daily spin sequence each day — save your run to track personal
            bests and come back tomorrow.
          </p>
        </div>
      )}

      <div className="mb-8">
        <h2
          className="text-xl font-bold"
          style={{ color: "var(--text-primary)" }}
        >
          Peak Draft (Legacy / Labs)
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
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
