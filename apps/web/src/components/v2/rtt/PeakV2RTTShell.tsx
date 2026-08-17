"use client";

/**
 * PeakV2RTTShell — the page-level V2 composition for RUN THE TABLE (Pass 3).
 *
 * Two layouts, matching the brief's own LIVE/CINEMATIC split for this mode:
 *
 *   `"live"` — the deliberate three-region desktop composition (brief
 *   §Run the Table): RUN MAP rail (`PeakV2RTTRunMap`, real `ladderRows()`) →
 *   CURRENT DECISION (dominant, center) → ROSTER/LANES rail
 *   (`PeakV2RTTRoster`, real `state.starters`/`.bench`/`.lane_profile`).
 *   Uses `width="live-wide"` (Pass 2.5's capability, unused until now) since
 *   this is exactly the "rare surface that genuinely needs three
 *   simultaneous regions" it was built for.
 *
 *   `"cinematic"` — full-bleed, no side rails: the boss intro/lineup reveal
 *   and the battle result. These are genuinely their own moment, not a LIVE
 *   decision with company on either side (verified against the reference,
 *   E2 pages 16-17 — a dark, mostly-empty stage, not the three-zone grid).
 *
 * A slim top status strip (credits/lives/act/objective) renders in BOTH
 * layouts — "keep the shared V2 status idiom consistent across games"
 * (brief §Global coherence) — using the exact same `RunPublicState` fields
 * `RunHUD` already reads, never a recomputation.
 */

import type { ReactNode } from "react";
import PeakV2Shell from "../PeakV2Shell";
import PeakV2GameStatus from "../PeakV2GameStatus";
import PeakV2Score from "../PeakV2Score";
import PeakV2Rule from "../PeakV2Rule";
import PeakV2DataLane from "../PeakV2DataLane";
import { ladderRows, ladderProgress, slotLabel } from "@/lib/run-the-table-state";
import type { RunPublicState } from "@/types/run-the-table";
import type { V2ComponentTone } from "../v2-tone";

const LANE_TOKEN_TO_TONE: Record<string, V2ComponentTone> = {
  si: "si",
  tp: "tp",
  rec: "rec",
  po: "po",
  team: "team",
};

function StatusStrip({ state, objective }: { state: RunPublicState; objective: string }) {
  const progress = ladderProgress(state.map);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <PeakV2GameStatus label="Live" state="active" />
        <div className="flex flex-col">
          <span style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.9375rem", color: "var(--v2-text-primary)" }}>
            {objective}
          </span>
          {/* Run-map substitute on mobile, where the full rail is hidden —
              never zero context for where the run stands. */}
          <span
            className="lg:hidden"
            style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}
          >
            {progress.done} of {progress.total} stages complete
          </span>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <PeakV2Score value={state.credits} label="Credits" tone="accent" />
        <PeakV2Score value={`${state.lives}/${state.max_lives}`} label="Lives" tone={state.lives <= 1 ? "negative" : "positive"} />
        <PeakV2Score value={`${Math.min(state.act, state.acts_total)}/${state.acts_total}`} label="Act" />
      </div>
    </div>
  );
}

function RunMapRail({ state }: { state: RunPublicState }) {
  const rows = ladderRows(state.map);
  return (
    <nav aria-label="Run map" className="flex flex-col gap-1">
      <span
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontSize: "0.6875rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--v2-text-muted)",
        }}
      >
        Run map · Act {state.act}
      </span>
      <ol className="mt-1 flex flex-col">
        {rows.map((row) => {
          const current = row.state === "current";
          const done = row.state === "done" || row.state === "won";
          const lost = row.state === "lost";
          return (
            <li
              key={row.key}
              className="flex items-baseline justify-between gap-2 py-1.5"
              style={{ borderBottom: "1px solid var(--v2-border-subtle)", opacity: row.state === "locked" ? 0.55 : 1 }}
            >
              <span
                className="truncate"
                style={{
                  fontFamily: "var(--v2-font-ui)",
                  fontWeight: current ? 700 : 500,
                  fontSize: row.kind === "boss" ? "0.8125rem" : "0.75rem",
                  textTransform: row.kind === "boss" ? "uppercase" : "none",
                  color: current ? "var(--v2-color-accent)" : "var(--v2-text-secondary)",
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  fontFamily: "var(--v2-font-mono)",
                  fontSize: "0.625rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: done ? "var(--v2-color-positive)" : lost ? "var(--v2-color-negative)" : current ? "var(--v2-color-accent)" : "var(--v2-text-muted)",
                }}
              >
                {row.state === "current" ? "Now" : row.state === "locked" ? "" : row.state}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function RosterLanesRail({ state }: { state: RunPublicState }) {
  const roster = [...state.starters, ...state.bench];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <span
          style={{
            fontFamily: "var(--v2-font-mono)",
            fontSize: "0.6875rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--v2-text-muted)",
          }}
        >
          Roster {roster.filter((s) => s.card).length}/{roster.length}
        </span>
        <ul className="mt-1 flex flex-col">
          {roster.map((slot) => (
            <li
              key={slot.slot_id}
              className="flex items-baseline justify-between gap-2 py-1.5"
              style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}
            >
              <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.625rem", color: "var(--v2-text-muted)", flexShrink: 0 }}>
                {slotLabel(slot)}
              </span>
              {slot.card ? (
                <span
                  className="truncate text-right"
                  style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 600, color: "var(--v2-text-primary)" }}
                >
                  {slot.card.player_name}
                </span>
              ) : (
                <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>Open</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <span
          style={{
            fontFamily: "var(--v2-font-mono)",
            fontSize: "0.6875rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--v2-text-muted)",
          }}
        >
          Your lanes
        </span>
        <div className="mt-2 flex flex-col gap-2.5">
          {state.lane_profile.map((lane) => (
            <PeakV2DataLane
              key={lane.lane}
              label={lane.label}
              tone={LANE_TOKEN_TO_TONE[lane.token] ?? "accent"}
              leftLabel=""
              leftValue={lane.value.toFixed(1)}
              scaleMin={0}
              scaleMax={100}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export interface PeakV2RTTShellProps {
  state: RunPublicState;
  objective: string;
  layout: "live" | "cinematic" | "bare";
  content: ReactNode;
}

export default function PeakV2RTTShell({ state, objective, layout, content }: PeakV2RTTShellProps) {
  if (layout === "bare") {
    // The result/receipt screen already owns its own full composition
    // (`RunResult` reused as-is) — no shell chrome, no double framing.
    return <PeakV2Shell width="live">{content}</PeakV2Shell>;
  }

  if (layout === "cinematic") {
    return (
      <PeakV2Shell width="cinematic">
        <div className="py-4">
          <StatusStrip state={state} objective={objective} />
        </div>
        <PeakV2Rule spacing="sm" />
        {content}
      </PeakV2Shell>
    );
  }

  return (
    <PeakV2Shell width="live-wide">
      <div className="py-6">
        <StatusStrip state={state} objective={objective} />
      </div>
      <PeakV2Rule spacing="sm" />
      <div className="grid grid-cols-1 gap-8 pb-10 lg:grid-cols-[200px_1fr_240px]">
        <div className="hidden lg:block">
          <RunMapRail state={state} />
        </div>
        {/* The current decision dominates — no border, no card fill, just
            more width and the page's own contrast, per the brief's "the
            current decision should clearly dominate." */}
        <div className="min-w-0">{content}</div>
        <div>
          <RosterLanesRail state={state} />
        </div>
      </div>
    </PeakV2Shell>
  );
}
