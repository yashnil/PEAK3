"use client";
import { useState } from "react";
import {
  completeCourtGame,
  placeCard,
  selectPlayer,
  PerfectSeasonAPIError,
} from "@/lib/perfect-season-api";
import { uiPhaseFromStatus } from "@/lib/court-state";
import { CourtLineupPublicState, SlotType } from "@/types/perfect-season";
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

      {error && (
        <div role="alert" className="rounded-lg px-3 py-2 text-sm" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
          {error}
        </div>
      )}

      {phase !== "complete" && state.current_spin && (
        <SpinStage spin={state.current_spin} roundNumber={state.current_round} totalRounds={state.total_rounds} />
      )}

      {phase === "spinning" && state.current_spin && (
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

      <div data-testid="court-grid" className="grid grid-cols-4 gap-2">
        {state.slots.map((slot) => (
          <PeakCardCourt
            key={slot.slot_type}
            slot={slot}
            isPendingTarget={phase === "placing" && !slot.filled}
            onClick={
              phase === "placing" && !slot.filled && !busy ? () => handlePlace(slot.slot_type) : undefined
            }
          />
        ))}
      </div>

      {phase === "complete" && state.status === "rounds_complete" && (
        <button
          data-testid="complete-season-btn"
          onClick={handleComplete}
          disabled={busy}
          className="rounded-lg py-3 font-semibold"
          style={{ background: "var(--peak-accent, #f5c842)", color: "#000" }}
        >
          {busy ? "Simulating…" : "Simulate Season"}
        </button>
      )}

      {state.simulation_result && <SeasonResultStub result={state.simulation_result} />}
    </div>
  );
}
