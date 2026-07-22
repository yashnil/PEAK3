"use client";
import { useState } from "react";
import {
  completeCourtGame,
  placeCard,
  selectPlayer,
  PerfectSeasonAPIError,
} from "@/lib/perfect-season-api";
import { uiPhaseFromStatus } from "@/lib/court-state";
import { CourtLineupPublicState, SlotType, STARTER_SLOT_TYPES, BENCH_SLOT_TYPES } from "@/types/perfect-season";
import SpinStage from "./SpinStage";
import EligiblePlayerSearch from "./EligiblePlayerSearch";
import PeakCardCourt from "./PeakCardCourt";
import SeasonResultStub from "./SeasonResultStub";

interface Props {
  initialGameState: CourtLineupPublicState;
}

export default function CourtBuilder({ initialGameState }: Props) {
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

  async function handleComplete() {
    const next = await withBusy(() => completeCourtGame(state.game_id));
    if (next) setState(next);
  }

  const starterSlots = state.slots.filter((s) => STARTER_SLOT_TYPES.includes(s.slot_type));
  const benchSlots = state.slots.filter((s) => BENCH_SLOT_TYPES.includes(s.slot_type));

  function slotProps(slot: (typeof state.slots)[number]) {
    return {
      slot,
      isPendingTarget: phase === "placing" && !slot.filled,
      onClick: phase === "placing" && !slot.filled && !busy ? () => handlePlace(slot.slot_type) : undefined,
    };
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
        Starter positions (PG/SG/SF/PF/C) use an early approximation from
        each player&apos;s lineup archetype, not verified NBA position data — off-position
        placements are always allowed.
      </p>

      {error && (
        <div role="alert" className="rounded-lg px-3 py-2 text-sm" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
          {error}
        </div>
      )}

      {!state.simulation_result && (
        <>
          {phase === "spinning" && state.current_spin && (
            <SpinStage
              key={state.current_round}
              spin={state.current_spin}
              roundNumber={state.current_round}
              totalRounds={state.total_rounds}
              onRevealComplete={() => setRevealedRound(state.current_round)}
            />
          )}

          {phase === "spinning" && state.current_spin && ceremonyRevealed && (
            <EligiblePlayerSearch
              candidates={state.current_spin.candidates}
              onSelect={handleSelect}
              disabled={busy}
            />
          )}

          {phase === "placing" && state.pending_selection && (
            <div className="rounded-xl p-3 text-sm" style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}>
              Placing <strong>{state.pending_selection.player_name}</strong> — choose any open court or bench spot below.
            </div>
          )}

          <div data-testid="court-grid" className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Starters
              </div>
              <div data-testid="starters-grid" className="grid grid-cols-5 gap-2">
                {starterSlots.map((slot) => (
                  <PeakCardCourt key={slot.slot_type} {...slotProps(slot)} />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Bench
              </div>
              <div data-testid="bench-grid" className="grid grid-cols-3 gap-2">
                {benchSlots.map((slot) => (
                  <PeakCardCourt key={slot.slot_type} {...slotProps(slot)} />
                ))}
              </div>
            </div>
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
