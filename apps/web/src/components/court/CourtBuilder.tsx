"use client";
import { useState } from "react";
import {
  cancelSelection,
  completeCourtGame,
  placeCard,
  selectPlayer,
  PerfectSeasonAPIError,
} from "@/lib/perfect-season-api";
import { uiPhaseFromStatus } from "@/lib/court-state";
import { CourtLineupPublicState, CourtSlotPublic, SlotType, STARTER_SLOT_TYPES, BENCH_SLOT_TYPES } from "@/types/perfect-season";
import SpinStage from "./SpinStage";
import EligiblePlayerSearch from "./EligiblePlayerSearch";
import PeakCardCourt from "./PeakCardCourt";
import CourtLayout from "./CourtLayout";
import SeasonResultStub from "./SeasonResultStub";

interface Props {
  initialGameState: CourtLineupPublicState;
  franchiseNames: string[];
}

export default function CourtBuilder({ initialGameState, franchiseNames }: Props) {
  const [state, setState] = useState<CourtLineupPublicState>(initialGameState);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which round the spin ceremony has finished revealing for, or null.
  // Derived comparison (`revealedRound === state.current_round`) rather
  // than a resettable boolean + effect: an effect that reset a boolean on
  // every round change raced with SpinStage's own reduced-motion path,
  // whose onRevealComplete fires (child effects run before parent effects
  // on mount) BEFORE the reset effect ran, so the reset silently clobbered
  // the just-set "revealed" signal back to false. Tracking the round
  // number directly has no such ordering dependency.
  const [revealedRound, setRevealedRound] = useState<number | null>(null);
  const ceremonyRevealed = revealedRound === state.current_round;

  const phase = uiPhaseFromStatus(state.status);

  async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof PerfectSeasonAPIError ? e.message : "Something went wrong. Please try again.";
      setError(msg);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function handleSelect(playerSlug: string) {
    const next = await withBusy(() => selectPlayer(state.game_id, playerSlug));
    if (next) setState(next);
  }

  async function handlePlace(slotType: SlotType) {
    const next = await withBusy(() => placeCard(state.game_id, slotType));
    if (next) setState(next);
  }

  async function handleCancel() {
    const next = await withBusy(() => cancelSelection(state.game_id));
    if (next) setState(next);
  }

  async function handleComplete() {
    const next = await withBusy(() => completeCourtGame(state.game_id));
    if (next) setState(next);
  }

  const starterSlots = state.slots.filter((s) => STARTER_SLOT_TYPES.includes(s.slot_type));
  const benchSlots = state.slots.filter((s) => BENCH_SLOT_TYPES.includes(s.slot_type));

  function renderSlot(slot: CourtSlotPublic) {
    return (
      <PeakCardCourt
        slot={slot}
        isPendingTarget={phase === "placing" && !slot.filled}
        onClick={phase === "placing" && !slot.filled && !busy ? () => handlePlace(slot.slot_type) : undefined}
        pendingFit={phase === "placing" ? state.pending_selection?.fit_by_open_slot?.[slot.slot_type] : undefined}
        pendingPrimaryPosition={phase === "placing" ? state.pending_selection?.primary_position : undefined}
      />
    );
  }

  return (
    <div data-testid="court-builder" className="mx-auto max-w-3xl px-4 py-8 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          82-0 Peak Season
        </h1>
        <span
          className="text-[10px] uppercase tracking-wide rounded px-2 py-1"
          style={{ background: "var(--bg-surface)", color: "var(--text-muted)", border: "1px solid var(--border-default)" }}
        >
          Prototype
        </span>
      </div>
      <p className="text-xs -mt-3" style={{ color: "var(--text-muted)" }} data-testid="position-logic-note">
        Prototype mode: roster eligibility uses interim team-year coverage and
        manual position checks. Full historical roster expansion is not yet
        live — off-position placements are always allowed, and PEAK3 scores
        your roster mostly on peak talent, not on penalizing a stacked lineup.
      </p>

      {error && (
        <div role="alert" className="rounded-lg px-3 py-2 text-sm" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
          {error}
        </div>
      )}

      {!state.simulation_result && (
        <>
          {/* Top: the current round's constraint (team + era wheel). */}
          {phase === "spinning" && state.current_spin && (
            <SpinStage
              key={state.current_round}
              spin={state.current_spin}
              roundNumber={state.current_round}
              totalRounds={state.total_rounds}
              franchiseNames={franchiseNames}
              onRevealComplete={() => setRevealedRound(state.current_round)}
            />
          )}

          {/* Candidate area: clearly its own panel, separate from the court
              below -- step 1 of this round (choose), never mixed visually
              with step 2 (place). */}
          {phase === "spinning" && state.current_spin && ceremonyRevealed && (
            <div
              data-testid="candidate-panel"
              className="rounded-2xl border p-4 flex flex-col gap-2"
              style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
            >
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Step 1 · Choose a player
              </div>
              <EligiblePlayerSearch
                candidates={state.current_spin.candidates}
                onSelect={handleSelect}
                disabled={busy}
              />
            </div>
          )}

          {phase === "placing" && state.pending_selection && (
            <div
              data-testid="placing-banner"
              className="rounded-xl p-3 text-sm flex flex-col gap-2"
              style={{ background: "var(--peak-accent-bg, rgba(245,200,66,0.08))", border: "1px solid var(--peak-accent-dim)", color: "var(--text-primary)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--peak-accent, #f5c842)" }}>
                    Step 2 · Place {state.pending_selection.player_name}
                  </div>
                  Choose any open court or bench spot below — the fit badge shows how well
                  they match that spot, but every open spot is a legal placement.
                </div>
                <button
                  data-testid="cancel-selection-btn"
                  onClick={handleCancel}
                  disabled={busy}
                  className="text-xs font-semibold uppercase tracking-wide rounded px-2 py-1 shrink-0"
                  style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
                >
                  Choose someone else
                </button>
              </div>
            </div>
          )}

          {/* Middle/bottom: the court itself (PG/SG/SF/PF/C) with the bench
              rail beneath it -- always visible so the roster-in-progress
              stays legible across both steps. */}
          <div
            data-testid="court-grid"
            className="rounded-2xl border p-3 flex flex-col gap-2"
            style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
          >
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Your roster
            </div>
            <CourtLayout starterSlots={starterSlots} benchSlots={benchSlots} renderSlot={renderSlot} />
          </div>

          {phase === "complete" && state.status === "rounds_complete" && (
            <button
              data-testid="complete-season-btn"
              onClick={handleComplete}
              disabled={busy}
              className="rounded-lg py-3 font-semibold"
              style={{ background: "var(--peak-accent, #f5c842)", color: "#000" }}
            >
              {busy ? "Simulating…" : "Lock Roster & Simulate"}
            </button>
          )}
        </>
      )}

      {state.simulation_result && <SeasonResultStub state={state} result={state.simulation_result} />}
    </div>
  );
}
