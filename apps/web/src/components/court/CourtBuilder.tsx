"use client";
import { useState } from "react";
import {
  cancelSelection,
  completeCourtGame,
  placeCard,
  respinSeason,
  respinTeam,
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
import LiveBuildPanel from "./LiveBuildPanel";
import { getTeamColors } from "@/lib/team-colors";

interface Props {
  initialGameState: CourtLineupPublicState;
  franchiseNames: string[];
  /** Real, resolvable exact-season pool for team_year spins' second reel
   * (readiness endpoint's experimental_team_year_season_labels) -- empty for
   * every non-team_year board. */
  seasonLabels?: string[];
  /** Coverage numbers for confident spinner copy (Phase 6E Part G) --
   * replaces vague "limited coverage" text with real figures. */
  rollableTeamSeasonCount?: number;
  supportedStartSeason?: string | null;
  supportedEndSeason?: string | null;
}

export default function CourtBuilder({
  initialGameState,
  franchiseNames,
  seasonLabels = [],
  rollableTeamSeasonCount = 0,
  supportedStartSeason = null,
  supportedEndSeason = null,
}: Props) {
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
  // Phase 6G Part C: bumped on every successful respin, purely to drive
  // SpinStage's brief "just respun" flash -- never affects which round is
  // considered revealed.
  const [respinFlashKey, setRespinFlashKey] = useState(0);

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

  async function handleRespinTeam() {
    const next = await withBusy(() => respinTeam(state.game_id));
    if (next) {
      setState(next);
      setRespinFlashKey((k) => k + 1);
    }
  }

  async function handleRespinSeason() {
    const next = await withBusy(() => respinSeason(state.game_id));
    if (next) {
      setState(next);
      setRespinFlashKey((k) => k + 1);
    }
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
          className="text-[9px] uppercase tracking-wide rounded px-1.5 py-0.5"
          style={{ color: "var(--text-muted)" }}
          title="v0 experimental simulator -- see the data receipt for version details"
        >
          Experimental
        </span>
      </div>
      <p className="text-xs -mt-3" style={{ color: "var(--text-muted)" }} data-testid="position-logic-note">
        Build eight exact player-season cards from real rosters. PEAK3 rewards talent first, then fit.
      </p>

      <details className="text-[10px] -mt-2" style={{ color: "var(--text-muted)" }} data-testid="board-receipt">
        <summary className="cursor-pointer select-none" style={{ color: "var(--text-secondary)" }}>
          Data receipt
        </summary>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1">
          <span>Seed {state.board_seed}</span>
          <span>{state.card_pool_version}</span>
          <span>{state.board_generator_version}</span>
          {state.experimental_team_year_data_version && <span>{state.experimental_team_year_data_version}</span>}
          {state.coverage_mode && <span data-testid="coverage-mode">{state.coverage_mode}</span>}
          {state.respin_history.length > 0 && (
            <span data-testid="respin-receipt-count">
              {state.respin_history.length} respin{state.respin_history.length === 1 ? "" : "s"} used
              {" "}({state.respin_history.filter((r) => r.kind === "team").length} team,{" "}
              {state.respin_history.filter((r) => r.kind === "season").length} season)
            </span>
          )}
        </div>
      </details>

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
              seasonLabels={seasonLabels}
              rollableTeamSeasonCount={rollableTeamSeasonCount}
              supportedStartSeason={supportedStartSeason}
              supportedEndSeason={supportedEndSeason}
              onRevealComplete={() => setRevealedRound(state.current_round)}
              respinFlashKey={respinFlashKey}
            />
          )}

          {/* Phase 6G Part C: up to 3 team + 3 season respins, only while
              this round's player hasn't been picked yet (ceremonyRevealed
              implies status === "selection_pending" -- the whole block
              disappears once a player is selected, matching the backend's
              own "locked after selection" rule). team_year rounds only --
              legacy team_decade/exact_team_season/open_pool rounds don't
              have a team+season reel to respin. */}
          {phase === "spinning" && state.current_spin?.spin_type === "team_year" && ceremonyRevealed && (
            <div className="flex flex-col items-center gap-1.5" data-testid="respin-controls">
              <div className="flex items-center gap-2">
                <button
                  data-testid="respin-team-btn"
                  onClick={handleRespinTeam}
                  disabled={busy || (state.current_spin.team_respins_used ?? 0) >= (state.current_spin.team_respins_max ?? 0)}
                  className="text-xs font-semibold rounded-full px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
                >
                  Respin Team ({Math.max(0, (state.current_spin.team_respins_max ?? 0) - (state.current_spin.team_respins_used ?? 0))} left)
                </button>
                <button
                  data-testid="respin-season-btn"
                  onClick={handleRespinSeason}
                  disabled={busy || (state.current_spin.season_respins_used ?? 0) >= (state.current_spin.season_respins_max ?? 0)}
                  className="text-xs font-semibold rounded-full px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
                >
                  Respin Season ({Math.max(0, (state.current_spin.season_respins_max ?? 0) - (state.current_spin.season_respins_used ?? 0))} left)
                </button>
              </div>
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                Respins reset each round. Leaderboards track respin count.
              </p>
            </div>
          )}

          {/* Candidate area: clearly its own panel, separate from the court
              below -- step 1 of this round (choose), never mixed visually
              with step 2 (place). */}
          {phase === "spinning" && state.current_spin && ceremonyRevealed && (
            <div
              data-testid="candidate-panel"
              className="rounded-2xl border p-4 flex flex-col gap-3"
              style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  Step 1 · Choose a player
                </div>
                {state.current_spin.spin_type !== "open_pool" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      aria-hidden="true"
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: getTeamColors(state.current_spin.franchise_display_name).primary }}
                    />
                    <span
                      className="text-[11px] font-semibold truncate max-w-[180px]"
                      style={{ color: "var(--text-secondary)" }}
                      title={`${state.current_spin.franchise_display_name} · ${state.current_spin.era_label}`}
                    >
                      {state.current_spin.franchise_display_name} · {state.current_spin.era_label}
                    </span>
                  </div>
                )}
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
              stays legible across both steps. CourtLayout's own
              .roster-board provides the visual frame (Phase 6B) -- no
              redundant outer box around it. */}
          <div data-testid="court-grid" className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Your roster
            </div>
            {state.live_build && <LiveBuildPanel liveBuild={state.live_build} />}
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
