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
import { ladderRows, ladderProgress, slotLabel, ROLE_LABELS, type ScoutIntel } from "@/lib/run-the-table-state";
import { PERK_EXACT_RULE_LABEL, PERK_TERM, perkPlainEffect, perkStrategyHint } from "@/lib/run-the-table-copy";
import type { RunPublicState } from "@/types/run-the-table";
import type { V2ComponentTone } from "../v2-tone";
import { componentTextColor } from "@/lib/utils";

const LANE_TOKEN_TO_TONE: Record<string, V2ComponentTone> = {
  si: "si",
  tp: "tp",
  rec: "rec",
  po: "po",
  team: "team",
};

function StatusStrip({
  state,
  objective,
  scoutIntel,
  restartControl,
}: {
  state: RunPublicState;
  objective: string;
  scoutIntel?: ScoutIntel | null;
  restartControl?: ReactNode;
}) {
  const progress = ladderProgress(state.map);
  return (
    // `data-testid="rtt-hud"` — carried over from legacy `RunHUD`: this is
    // the same credits/lives/act/objective data (`RunPublicState` fields
    // `RunHUD` itself reads, see module docstring), so it keeps the same
    // "the HUD is showing" signal tests already wait on.
    <div className="flex flex-wrap items-center justify-between gap-4" data-testid="rtt-hud">
      <div className="flex items-center gap-4">
        <PeakV2GameStatus label="Live" state="active" />
        <div className="flex flex-col">
          <span
            data-testid="rtt-hud-objective"
            style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.9375rem", color: "var(--v2-text-primary)" }}
          >
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
          {/* Scout & Prepare payoff — the boss's discovered weakness stays
              pinned past the node it was found on; see legacy `RunHUD`'s own
              comment. `scoutIntel` is already `null` the instant it stops
              being about the boss currently ahead (`RunTheTableGame`'s
              `activeScoutIntel`), so no extra gating needed here. */}
          {scoutIntel && (
            <span
              className="truncate"
              data-testid="rtt-hud-scout-pin"
              style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.625rem", fontWeight: 700 }}
            >
              Scouted {scoutIntel.bossName} · weak{" "}
              <span style={{ color: componentTextColor(scoutIntel.weakestLane) }}>{scoutIntel.weakestLabel}</span>
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-6">
        <PeakV2Score data-testid="rtt-credits" value={state.credits} label="Credits" tone="accent" />
        <PeakV2Score data-testid="rtt-lives" value={`${state.lives}/${state.max_lives}`} label="Lives" tone={state.lives <= 1 ? "negative" : "positive"} />
        <PeakV2Score data-testid="rtt-act" value={`${Math.min(state.act, state.acts_total)}/${state.acts_total}`} label="Act" />
        {restartControl}
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
              data-testid={`rtt-map-row-${row.key}`}
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

/**
 * WHAT IS ARMED RIGHT NOW — the V2 counterpart of legacy `RunTray`'s "Armed"
 * block (same `state.armed` data, same testids, so nothing a player already
 * spent credits on — a Scout & Prepare lane bonus, a Role Focus, a reserved
 * card — goes invisible just because the shell around it changed). A
 * preparation/Role Focus/reservation only shows here until it fires; see
 * `RunTray.tsx`'s own comment for the full rationale. Rendered only when
 * something is actually armed.
 */
function ArmedEffects({ state }: { state: RunPublicState }) {
  const reservation =
    state.armed?.reserved_card &&
    (state.armed.reserved_card.status === "live" || state.armed.reserved_card.status === "offered")
      ? state.armed.reserved_card
      : null;
  const armed =
    state.armed && (state.armed.prep || state.armed.role_focus || reservation) ? state.armed : null;
  if (!armed) return null;
  return (
    <div
      className="flex flex-col gap-1.5 p-3"
      data-testid="rtt-armed"
      style={{ border: "1px solid var(--v2-color-accent)", borderRadius: "var(--v2-radius-control)", background: "var(--v2-bg-plane)" }}
    >
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
        Armed
      </span>
      {armed.prep && (
        <p data-testid="rtt-armed-prep" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-primary)" }}>
          <span style={{ color: "var(--v2-color-accent)" }}>{armed.prep.label}</span> prepared{" "}
          <span style={{ fontFamily: "var(--v2-font-mono)" }}>+{armed.prep.bonus}</span> for the act{" "}
          {armed.prep.act} boss. Spent in that battle either way.
        </p>
      )}
      {armed.role_focus && (
        <p data-testid="rtt-armed-role-focus" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-primary)" }}>
          Role Focus on{" "}
          <span style={{ color: "var(--v2-color-accent)" }}>{ROLE_LABELS[armed.role_focus.role]}</span> — the
          next market will carry a legal offer for it.
        </p>
      )}
      {reservation && (
        <p data-testid="rtt-armed-reservation" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-primary)" }}>
          One card reserved at{" "}
          <span style={{ fontFamily: "var(--v2-font-mono)" }}>{reservation.locked_cost}</span> credits
          {reservation.status === "offered" ? " — it is on this board now." : " — it appears in the next Draft Room."}
        </p>
      )}
    </div>
  );
}

function RosterLanesRail({ state }: { state: RunPublicState }) {
  const roster = [...state.starters, ...state.bench];
  return (
    <div className="flex flex-col gap-6">
      <ArmedEffects state={state} />
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

      {/* Front Office Perks (internally: Systems) — same three layers as
          legacy `RunTray`/`SystemSelect` (plan §6): plain effect, one
          strategy hint, then the engine's own summary verbatim behind "See
          exact rule". */}
      <div data-testid="rtt-active-systems">
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
          {PERK_TERM.plural ?? PERK_TERM.display}
        </span>
        {state.systems.length === 0 ? (
          <p className="mt-1" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
            None yet.
          </p>
        ) : (
          <div className="mt-1 flex flex-col gap-2">
            {state.systems.map((sys) => {
              const plain = perkPlainEffect(sys.id);
              const hint = perkStrategyHint(sys.id);
              return (
                <div key={sys.id} className="flex flex-col" data-testid={`rtt-tray-system-${sys.id}`}>
                  <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-color-accent)" }}>
                    {sys.name}
                  </span>
                  <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-primary)" }}>
                    {plain ?? sys.summary}
                  </span>
                  {hint && (
                    <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>
                      {hint}
                    </span>
                  )}
                  {plain && (
                    <details data-testid={`rtt-tray-system-rule-${sys.id}`}>
                      <summary
                        className="cursor-pointer select-none"
                        style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)", textDecoration: "underline", textUnderlineOffset: "2px" }}
                      >
                        {PERK_EXACT_RULE_LABEL}
                        <span className="sr-only"> for {sys.name}</span>
                      </summary>
                      <span
                        className="block pt-0.5"
                        style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-secondary)" }}
                      >
                        {sys.summary}
                      </span>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export interface PeakV2RTTShellProps {
  state: RunPublicState;
  objective: string;
  layout: "live" | "cinematic" | "bare";
  content: ReactNode;
  /** "Start New Run" (the abandon-and-restart control) — same
   *  `RestartRunControl` legacy's `RunHUD` renders, handed down as an
   *  already-built node so this shell does not need its own copy of the
   *  confirm-dialog logic. `null`/omitted once the run is terminal, exactly
   *  as legacy gates it. */
  restartControl?: ReactNode;
  /** The current act's Scout & Prepare report, if any — same
   *  `RunTheTableGame.activeScoutIntel` legacy `RunHUD` reads. */
  scoutIntel?: ScoutIntel | null;
  /** The sticky mobile-only bottom tray (credits/lives/roster pips + the
   *  screen's one primary action) — legacy's `MobileTray`, reused as-is
   *  rather than rebuilt: it is CSS-only responsive chrome (`.rtt-mobile-
   *  tray` hides itself at `lg+`), so it costs nothing on desktop and a
   *  phone loses no functionality just because the shell around it
   *  changed. */
  mobileTray?: ReactNode;
  /** A failed mid-run action's retryable alert (`RunTheTableGame`'s
   *  `error`/`retry` state) — same "Try again" affordance legacy's shell
   *  rendered above the decision surface. Distinct from `RunStartGate`'s own
   *  `rtt-start-error`, which only exists before a run does. */
  errorBanner?: ReactNode;
}

export default function PeakV2RTTShell({ state, objective, layout, content, restartControl, scoutIntel, mobileTray, errorBanner }: PeakV2RTTShellProps) {
  // `data-testid="rtt-shell"` — carried over from legacy's outer wrapper
  // (was `.rtt-shell`): a wide range of unit/e2e tests and screenshot tools
  // wait on this testid as the generic "the game has mounted" signal, not
  // on anything legacy-styling-specific about it, so it stays regardless of
  // which layout is showing.
  if (layout === "bare") {
    // The result/receipt screen (`PeakV2RTTResult`) already owns its own
    // full composition — no shell chrome, no double framing.
    return (
      <PeakV2Shell width="live">
        <div data-testid="rtt-shell">{content}</div>
      </PeakV2Shell>
    );
  }

  if (layout === "cinematic") {
    return (
      <PeakV2Shell width="cinematic">
        <div data-testid="rtt-shell">
          <div className="py-4">
            <StatusStrip state={state} objective={objective} restartControl={restartControl} scoutIntel={scoutIntel} />
          </div>
          <PeakV2Rule spacing="sm" />
          {errorBanner}
          {content}
          {mobileTray}
        </div>
      </PeakV2Shell>
    );
  }

  return (
    <PeakV2Shell width="live-wide">
      <div data-testid="rtt-shell">
        <div className="py-6">
          <StatusStrip state={state} objective={objective} restartControl={restartControl} scoutIntel={scoutIntel} />
        </div>
        <PeakV2Rule spacing="sm" />
        <div className="grid grid-cols-1 gap-8 pb-10 lg:grid-cols-[200px_1fr_240px]">
          <div className="hidden lg:block">
            <RunMapRail state={state} />
          </div>
          {/* The current decision dominates — no border, no card fill, just
              more width and the page's own contrast, per the brief's "the
              current decision should clearly dominate." */}
          <div className="min-w-0 flex flex-col gap-4">
            {errorBanner}
            {content}
          </div>
          <div>
            <RosterLanesRail state={state} />
          </div>
        </div>
        {mobileTray}
      </div>
    </PeakV2Shell>
  );
}
