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

        {/* ONE stable contextual state banner (Pass 7, task §5/§7) -- exactly
            one of these four states is ever true at once, so the player
            always has a single, unambiguous read of "what is happening right
            now" instead of competing hint/instruction lines. */}
        {showResumeSelection ? (
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
          <div
            className="mt-3 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap"
            style={{ background: "var(--v2-bg-plane)", border: "1px solid var(--v2-color-accent-dim, var(--v2-color-accent))" }}
          >
            <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-primary)" }}>
              <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--v2-color-accent)" }}>
                Place
              </span>{" "}
              {pendingSelectionName} — choose any open spot; the fit badge shows how well they match it.
            </p>
            <button
              type="button"
              onClick={onSwitchSelection}
              disabled={busy}
              className="underline"
              style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}
            >
              Switch selection
            </button>
          </div>
        ) : movingSlot != null ? (
          <p className="mt-3" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-color-accent)" }}>
            <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Moving
            </span>{" "}
            {slotLabel(movingSlot)} — pick a destination. No re-spin, no cards lost.{" "}
            <button type="button" onClick={onCancelMove} className="underline">
              Cancel move
            </button>
          </p>
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
