"use client";

/**
 * PeakV2CourtLive — the 82-0 court, LIVE (Pass 3). Reuses `CourtLayout`
 * UNCHANGED — its real thin-line court markings (paint/arc/rim) already are
 * "an actual basketball-court composition," per the brief — with a fresh
 * `PeakV2CourtSlotCard` renderer on top. The projected record renders as
 * the cinematic-number headline stat (`PeakV2Score role="moment"`), from
 * the real `live_build.provisional_record_range` — never a static number.
 *
 * Pass 7 (human acceptance testing, §5/§7): a single state banner now covers
 * all four mutually-exclusive states -- minimized chooser waiting to reopen,
 * a player staged and waiting to be placed, an existing player mid-move, or
 * (quietly) rearrange being available with nothing active -- using the exact
 * same `overlayMinimized`/`pending_selection`/`movingSlot` state
 * `CourtBuilder` already computes for legacy. No new state, no new endpoint.
 */

import PeakV2Shell from "../PeakV2Shell";
import PeakV2LiveHeader from "../PeakV2LiveHeader";
import PeakV2GameStatus from "../PeakV2GameStatus";
import PeakV2Score from "../PeakV2Score";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import PeakV2PlayerIdentity from "../PeakV2PlayerIdentity";
import PeakV2CourtSlotCard from "./PeakV2CourtSlotCard";
import CourtLayout from "@/components/court/CourtLayout";
import LiveBuildPanel from "@/components/court/LiveBuildPanel";
import type { CourtLineupPublicState, CourtSlotPublic, SlotType } from "@/types/perfect-season";

export interface PeakV2CourtLiveProps {
  state: CourtLineupPublicState;
  phase: string;
  busy: boolean;
  starterSlots: CourtSlotPublic[];
  benchSlots: CourtSlotPublic[];
  movingSlot: SlotType | null;
  rearrangeAvailable: boolean;
  onPlace: (slotType: SlotType) => void;
  onStartMove: (slotType: SlotType) => void;
  onSwapTarget: (slotType: SlotType) => void;
  onCancelMove: () => void;
  slotLabel: (slot: SlotType) => string;
  onComplete: () => void;
  /** True whenever the chooser exists but is minimized -- the one moment
   *  there is currently no way back into it (Pass 7, task §5). */
  showResumeSelection: boolean;
  onResumeSelection: () => void;
  /** The name of the player already chosen and awaiting placement, or null
   *  when nothing is pending. Drives the "PLACE [PLAYER]" banner (§7). */
  pendingSelectionName: string | null;
  /** Team/season/position instrumentation for that same pending selection
   *  (human acceptance testing, task §8) -- all optional/nullable since a
   *  legacy-shaped peak-window pending selection may not carry team/season. */
  pendingSelectionTeam?: string | null;
  pendingSelectionSeason?: string | null;
  pendingSelectionPosition?: string | null;
  /** Returns to the same round's already-revealed roll/candidate list --
   *  never a respin, never a lost roll (mirrors legacy's "Switch selection"). */
  onSwitchSelection: () => void;
}

export default function PeakV2CourtLive({
  state,
  phase,
  busy,
  starterSlots,
  benchSlots,
  movingSlot,
  rearrangeAvailable,
  onPlace,
  onStartMove,
  onSwapTarget,
  onCancelMove,
  slotLabel,
  onComplete,
  showResumeSelection,
  onResumeSelection,
  pendingSelectionName,
  pendingSelectionTeam,
  pendingSelectionSeason,
  pendingSelectionPosition,
  onSwitchSelection,
}: PeakV2CourtLiveProps) {
  function renderSlot(slot: CourtSlotPublic) {
    const pendingSlotFit = phase === "placing" ? state.pending_selection?.fit_by_open_slot?.[slot.slot_type] : undefined;
    const isSwapTarget = movingSlot != null && movingSlot !== slot.slot_type;
    const isMovingSource = movingSlot === slot.slot_type;
    const blockedDuringPlacement = phase === "placing" && slot.filled && movingSlot == null;
    return (
      <PeakV2CourtSlotCard
        slot={slot}
        isPendingTarget={phase === "placing" && !slot.filled}
        onClick={!isSwapTarget && phase === "placing" && !slot.filled && !busy ? () => onPlace(slot.slot_type) : undefined}
        pendingFit={pendingSlotFit?.role_fit}
        pendingFitSeverity={pendingSlotFit?.role_fit_severity}
        pendingPrimaryPosition={phase === "placing" ? state.pending_selection?.primary_position : undefined}
        onMove={rearrangeAvailable && slot.filled && movingSlot == null && !busy ? () => onStartMove(slot.slot_type) : undefined}
        onSwapTarget={isSwapTarget && !busy ? () => onSwapTarget(slot.slot_type) : undefined}
        onCancelMove={isMovingSource ? onCancelMove : undefined}
        movingFromSlotLabel={movingSlot ? slotLabel(movingSlot) : null}
        blockedDuringPlacement={blockedDuringPlacement}
      />
    );
  }

  // The card currently in hand for a MOVE, looked up from the same
  // slot data already passed down for the court itself -- no new prop from
  // the caller. Gives the "Moving" banner the same real identity
  // instrumentation as the "Place" banner instead of a bare position label.
  const movingSlotData = movingSlot ? [...starterSlots, ...benchSlots].find((s) => s.slot_type === movingSlot) : undefined;

  const record = state.live_build?.provisional_record_range;
  // The caller keeps this component mounted even after the run is complete
  // (the full result reveal renders ADDITIONALLY below it, not instead of
  // it -- same as legacy's own CourtBuilder). A hardcoded "Live"/"active"
  // status left the pulsing dot animating forever on a finished run --
  // a stale "still live" signal on a screen that no longer is. `state`
  // already carries the completion signal there is no reason to
  // re-derive: `simulation_result` is set the moment this run resolves.
  const isComplete = state.status === "rounds_complete" || state.simulation_result != null;

  return (
    <PeakV2Shell width="live">
      <div className="py-6">
        <PeakV2LiveHeader
          as="h1"
          title="82-0 Peak Season"
          subtitle={`Round ${state.current_round} of ${state.total_rounds} · ${state.difficulty === "hard" ? "Hard" : "Easy"} difficulty`}
          status={<PeakV2GameStatus label={isComplete ? "Complete" : "Live"} state={isComplete ? "idle" : "active"} />}
          instrument={
            record ? (
              <PeakV2Score
                role="moment"
                size="lg"
                tone="accent"
                label="Projected season"
                value={
                  record.low_wins === record.high_wins
                    ? `${record.low_wins}-${82 - record.low_wins}`
                    : `${record.low_wins}-${82 - record.low_wins} to ${record.high_wins}-${82 - record.high_wins}`
                }
              />
            ) : null
          }
        />

        {/* ONE stable contextual state banner (Pass 7, task §5/§7). Human
            acceptance testing (task §8) found these are NOT actually
            mutually exclusive as the old comment here assumed: rearranging
            has no phase gate (`onStartMove` only requires a filled slot and
            `movingSlot == null`), so a player can minimize a still-unresolved
            round's chooser ("View court") and then start a MOVE while
            `showResumeSelection` is also true -- reachable live, not just in
            theory. `movingSlot` now wins that race: a card actively picked up
            is the more urgent, more specific thing happening, and "waiting
            on a player" reappears the instant the move is cancelled or
            confirmed (its own condition never stopped being true). */}
        {movingSlot != null ? (
          // Same unified banner grammar as the "Place" state below (task
          // §8: MOVE needs "the same deliberate target-state interaction"),
          // with the same real identity instrumentation -- looked up from
          // the slot data already on the court, see `movingSlotData` above
          // -- and an obvious button (not an inline text link) to cancel.
          <div
            data-testid="moving-active-banner"
            className="mt-3 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap"
            style={{ background: "var(--v2-bg-plane)", border: "1px solid var(--v2-color-accent-dim, var(--v2-color-accent))" }}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--v2-color-accent)" }}>
                Moving
              </span>
              <PeakV2PlayerIdentity
                name={movingSlotData?.player_name ?? slotLabel(movingSlot)}
                meta={[movingSlotData?.team_id ?? undefined, movingSlotData?.season ?? movingSlotData?.anchor_season ?? undefined]
                  .filter(Boolean)
                  .join(" · ") || slotLabel(movingSlot)}
                state="current"
                size="sm"
              />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
                Pick a destination — no re-spin, no cards lost.
              </span>
              <PeakV2SecondaryAction size="sm" onClick={onCancelMove}>
                Cancel move
              </PeakV2SecondaryAction>
            </div>
          </div>
        ) : showResumeSelection ? (
          <div
            className="mt-3 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap"
            style={{ background: "var(--v2-bg-plane)", border: "1px solid var(--v2-color-accent-dim, var(--v2-color-accent))" }}
          >
            <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}>
              Round {state.current_round} is waiting on a player.
            </p>
            <PeakV2PrimaryAction size="sm" onClick={onResumeSelection}>
              Open player pool
            </PeakV2PrimaryAction>
          </div>
        ) : phase === "placing" && pendingSelectionName ? (
          // The ONE active-player treatment (human acceptance testing, task
          // §8): a single instrumented "PLACE / player / team · season ·
          // position" banner, not a prose sentence with the name buried
          // inside it. Reuses `PeakV2PlayerIdentity` (the same identity row
          // every other court/roster surface uses) rather than a bespoke
          // layout, so this reads as the SAME "thing the screen is about
          // right now" grammar as everywhere else in V2.
          <div
            data-testid="placement-active-banner"
            className="mt-3 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap"
            style={{ background: "var(--v2-bg-plane)", border: "1px solid var(--v2-color-accent-dim, var(--v2-color-accent))" }}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--v2-color-accent)" }}>
                Place
              </span>
              <PeakV2PlayerIdentity
                name={pendingSelectionName}
                meta={[pendingSelectionTeam, pendingSelectionSeason].filter(Boolean).join(" · ") || undefined}
                position={pendingSelectionPosition ?? undefined}
                state="current"
                size="sm"
              />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
                Any open spot — the fit badge shows how well they match it.
              </span>
              <PeakV2SecondaryAction size="sm" onClick={onSwitchSelection} disabled={busy}>
                Switch selection
              </PeakV2SecondaryAction>
            </div>
          </div>
        ) : rearrangeAvailable ? (
          <p className="mt-3" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
            Move players to improve position fit — this never re-spins.
          </p>
        ) : null}

        {state.live_build ? (
          <div className="mt-4">
            <LiveBuildPanel liveBuild={state.live_build} />
          </div>
        ) : null}

        <div className="mt-4">
          <CourtLayout starterSlots={starterSlots} benchSlots={benchSlots} renderSlot={renderSlot} />
        </div>

        {phase === "complete" && state.status === "rounds_complete" ? (
          <div className="mt-6">
            <PeakV2PrimaryAction onClick={onComplete} disabled={busy}>
              {busy ? "Simulating…" : "Lock roster & simulate"}
            </PeakV2PrimaryAction>
          </div>
        ) : null}
      </div>
    </PeakV2Shell>
  );
}
