"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelSelection,
  completeCourtGame,
  createCourtGame,
  placeCard,
  respinIdempotencyKey,
  respinSeason,
  respinTeam,
  selectPlayer,
  swapSlots,
  PerfectSeasonAPIError,
} from "@/lib/perfect-season-api";
import { uiPhaseFromStatus } from "@/lib/court-state";
import {
  CourtLineupPublicState,
  CourtSlotPublic,
  CurrentSpin,
  SlotType,
  SLOT_LABELS,
  STARTER_SLOT_TYPES,
  BENCH_SLOT_TYPES,
} from "@/types/perfect-season";
import SpinStage from "./SpinStage";
import EligiblePlayerSearch from "./EligiblePlayerSearch";
import PeakCardCourt from "./PeakCardCourt";
import CourtLayout from "./CourtLayout";
import SeasonResultStub from "./SeasonResultStub";
import LiveBuildPanel from "./LiveBuildPanel";
import ActionToast from "./ActionToast";
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
  /** Phase 8I: franchise_display_name -> resolved logo URL (readiness
   * endpoint's team_logo_urls), so the spin reel can show a real team logo
   * on every visible item while it's ticking, not just the landed team.
   * Empty whenever the asset gate is off -- SpinStage falls back to the
   * initials badge for any name missing from this map. */
  teamLogoUrls?: Record<string, string>;
}

export default function CourtBuilder({
  initialGameState,
  franchiseNames,
  seasonLabels = [],
  rollableTeamSeasonCount = 0,
  supportedStartSeason = null,
  supportedEndSeason = null,
  teamLogoUrls = {},
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
  // Phase 8C: which axis the most recent respin actually rerolled -- lets
  // SpinStage animate ONLY that wheel and show the other as visibly locked
  // (playtest finding: "team-only respin and season-only respin are not
  // visually clear enough"). Set alongside respinFlashKey on every respin,
  // read once by SpinStage's effect (see its own respinFlashKey comment).
  const [respinKind, setRespinKind] = useState<"team" | "season" | null>(null);
  // Phase 9B rearrange mode: which filled slot's card the user is currently
  // moving, or null when not rearranging. A two-step "pick a card, then pick
  // a destination" flow rather than drag-and-drop -- it works with a keyboard
  // and a screen reader with no extra machinery, and there is no such thing
  // as a half-completed drop.
  const [movingSlot, setMovingSlot] = useState<SlotType | null>(null);
  // Launch-polish §5, gap 1: a third step, ONLY for the higher-stakes case --
  // exchanging two already-placed cards, where two earlier decisions move at
  // once. Set when the clicked destination is itself filled; a move into an
  // open slot (nothing displaced) still executes on the first click, backed
  // by the Undo toast below instead of a confirmation step.
  const [pendingSwapConfirm, setPendingSwapConfirm] = useState<{ from: SlotType; to: SlotType } | null>(null);
  // Launch-polish §5, gap 2: the one-line, auto-dismissing receipt for the
  // last placement or swap, with a single reversing/redirecting action.
  const [actionToast, setActionToast] = useState<{
    message: string;
    actionLabel: string;
    onAction: () => void;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setActionToast(null);
  }, []);
  const showToast = useCallback((message: string, actionLabel: string, onAction: () => void) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setActionToast({ message, actionLabel, onAction });
    toastTimerRef.current = window.setTimeout(() => setActionToast(null), 8000);
  }, []);
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const phase = uiPhaseFromStatus(state.status);
  // A submitted/simulated result is the saved and shared artifact -- it must
  // not mutate, so the server rejects a swap once status is "result_ready"
  // (code "rearrange_after_result") and the UI hides the controls to match.
  const canRearrange = state.status !== "result_ready";
  const filledSlotCount = state.slots.filter((s) => s.filled).length;
  const rearrangeAvailable = canRearrange && filledSlotCount >= 1;

  const cancelRearrange = useCallback(() => {
    setMovingSlot(null);
    setPendingSwapConfirm(null);
  }, []);

  // Escape cancels rearrange mode -- the standard exit for a transient modal
  // interaction mode, so the user is never trapped in "pick a destination".
  useEffect(() => {
    if (!movingSlot) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") cancelRearrange();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [movingSlot, cancelRearrange]);

  // Phase 8D: the API only sends `current_spin` while status ===
  // "selection_pending" (see state.py's `find_spin` gate) -- it goes back
  // to null the instant a player is selected, which is exactly the round
  // SpinStage needs to STAY mounted through (see the SpinStage `collapsed`
  // prop comment for why remounting it replays the ceremony). Cache the
  // most recent non-null spin in a ref so it survives that gap; safe to
  // write during render (a standard "derived cache" ref pattern, not a
  // side effect visible to this render) because it only ever overwrites
  // with a genuinely newer value and every round starts by handing back a
  // fresh non-null current_spin, so the cache can never leak a stale round
  // into the next one.
  const lastSpinRef = useRef<CurrentSpin | null>(null);
  if (state.current_spin) lastSpinRef.current = state.current_spin;
  const roundSpin = state.current_spin ?? lastSpinRef.current;

  // W5: the most recent respin, from the SERVER's own respin_history receipt
  // -- SpinStage renders "away from X" from this, so the flourish can never
  // claim a distance the server did not actually travel. Scoped to the
  // current round so a prior round's respin never leaks into this one's
  // ceremony.
  const lastRespinEntry =
    state.respin_history.length > 0
      ? state.respin_history[state.respin_history.length - 1]
      : null;
  const lastRespin =
    lastRespinEntry && lastRespinEntry.round === state.current_round
      ? { team: lastRespinEntry.from_team, season: lastRespinEntry.from_season }
      : null;

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
    if (next) {
      setState(next);
      // Launch-polish §5, gap 2. There is no backend action that removes a
      // placed card (`action_place_card` in state.py has no inverse -- see
      // the comment on `performSwap` below for the same limit on swaps), so
      // this is honestly labeled "Move", not "Undo": it jumps straight into
      // rearrange mode with the just-placed card preselected as the source,
      // which is the fastest real correction path that exists today, rather
      // than claiming a full reversal the API cannot actually perform.
      const placed = next.slots.find((s) => s.slot_type === slotType);
      if (placed?.player_name) {
        showToast(`Placed ${placed.player_name} in ${SLOT_LABELS[slotType]}.`, "Move", () => {
          setMovingSlot(slotType);
        });
      }
    }
  }

  async function handleCancel() {
    const next = await withBusy(() => cancelSelection(state.game_id));
    if (next) setState(next);
  }

  // W5: the key is DERIVED from state, never randomly generated per call --
  // that is what makes a double-click safe. Both clicks read the same
  // `state.*_respins_used_total` (the first response has not landed yet, so
  // the counter has not moved), so both send the same key and the server
  // treats the second as a replay instead of consuming a second respin. The
  // `busy` guard stays as the first line of defence; this is the second,
  // and the only one that also covers a retried fetch or a refresh fired
  // mid-animation.
  async function handleRespinTeam() {
    const key = respinIdempotencyKey(
      state.game_id, state.current_round, "team", state.team_respins_used_total,
    );
    const next = await withBusy(() => respinTeam(state.game_id, key));
    if (next) {
      setState(next);
      setRespinKind("team");
      setRespinFlashKey((k) => k + 1);
    }
  }

  async function handleRespinSeason() {
    const key = respinIdempotencyKey(
      state.game_id, state.current_round, "season", state.season_respins_used_total,
    );
    const next = await withBusy(() => respinSeason(state.game_id, key));
    if (next) {
      setState(next);
      setRespinKind("season");
      setRespinFlashKey((k) => k + 1);
    }
  }

  /** Perform the rearrange. Never re-spins and never re-selects -- the server
   * only exchanges the two slots' card identity fields and recomputes both
   * slots' role_fit, so the roster count and every card's data are preserved
   * by construction (see state.py::action_swap_slots).
   *
   * Launch-polish §5, gap 2: `action_swap_slots` is its own exact inverse --
   * calling it a second time with the same two slot types puts both cards
   * back exactly where they started, including their recomputed role_fit.
   * That symmetry is what makes a REAL "Undo" (not the honestly-weaker
   * "Move" shortcut `handlePlace` above has to settle for) possible here:
   * `opts.silent` is set on exactly that reversing call, so undoing an undo
   * -- or a toast surviving long enough to fire twice -- can never chain
   * into a second toast.
   */
  const performSwap = useCallback(
    async (from: SlotType, to: SlotType, opts?: { silent?: boolean }) => {
      // Captured BEFORE the request, not read off `next` afterward -- once
      // the swap lands, "from" holds whoever USED to be in "to". The toast
      // and the Undo closure both need to know who was where beforehand.
      const beforeFrom = state.slots.find((s) => s.slot_type === from);
      const beforeTo = state.slots.find((s) => s.slot_type === to);
      const next = await withBusy(() => swapSlots(state.game_id, from, to));
      if (!next) return next;
      setState(next);
      if (!opts?.silent) {
        const wasSwap = !!beforeFrom?.filled && !!beforeTo?.filled;
        const message = wasSwap
          ? `Swapped ${beforeFrom?.player_name ?? SLOT_LABELS[from]} and ${beforeTo?.player_name ?? SLOT_LABELS[to]}.`
          : `Moved ${beforeFrom?.player_name ?? "the card"} to ${SLOT_LABELS[to]}.`;
        showToast(message, "Undo", () => {
          void performSwap(to, from, { silent: true });
        });
      }
      return next;
    },
    [state.game_id, state.slots, showToast],
  );

  /** The click on a swap-target slot. Only the higher-stakes case --
   * displacing a card that was already placed -- pauses for confirmation;
   * a move into an open slot (nothing displaced) still commits on this one
   * click, backed by the Undo toast in `performSwap` instead. */
  function requestSwap(target: SlotType) {
    const from = movingSlot;
    if (!from || from === target) {
      setMovingSlot(null);
      return;
    }
    const targetSlot = state.slots.find((s) => s.slot_type === target);
    if (targetSlot?.filled) {
      setPendingSwapConfirm({ from, to: target });
      return;
    }
    setMovingSlot(null);
    void performSwap(from, target);
  }

  function confirmPendingSwap() {
    if (!pendingSwapConfirm) return;
    const { from, to } = pendingSwapConfirm;
    setPendingSwapConfirm(null);
    setMovingSlot(null);
    void performSwap(from, to);
  }

  function cancelPendingSwap() {
    // `movingSlot` stays set -- declining THIS destination should return to
    // "pick a destination", not discard the whole rearrange.
    setPendingSwapConfirm(null);
  }

  async function handleComplete() {
    const next = await withBusy(() => completeCourtGame(state.game_id));
    if (next) setState(next);
  }

  // Phase 8D: "Play Again" -- starts a fresh, unseeded game in the SAME
  // mode without a page reload (reuses the exact createCourtGame call the
  // initial practice page itself makes server-side -- no parallel "new
  // game" path). Resets every piece of local ceremony-tracking state back
  // to its own initial value so the new game's round 1 gets a real,
  // un-skipped spin ceremony rather than inheriting stale state from the
  // finished game (e.g. revealedRound already matching round 1 would skip
  // straight to "revealed" with no ceremony at all).
  async function handlePlayAgain() {
    const next = await withBusy(() => createCourtGame(state.mode));
    if (next) {
      setState(next);
      setRevealedRound(null);
      setRespinFlashKey(0);
      setRespinKind(null);
      lastSpinRef.current = null;
    }
  }

  const starterSlots = state.slots.filter((s) => STARTER_SLOT_TYPES.includes(s.slot_type));
  const benchSlots = state.slots.filter((s) => BENCH_SLOT_TYPES.includes(s.slot_type));

  function renderSlot(slot: CourtSlotPublic) {
    const pendingSlotFit = phase === "placing"
      ? state.pending_selection?.fit_by_open_slot?.[slot.slot_type]
      : undefined;
    // While a card is being moved, every OTHER slot (filled or empty) is a
    // destination -- moving into an empty slot is a plain move, and into a
    // filled one is a swap. Both go through the same endpoint. Frozen (no
    // target is clickable) while a swap confirmation is already pending, so
    // a second click cannot race the one awaiting "Confirm".
    const isSwapTarget =
      movingSlot != null && movingSlot !== slot.slot_type && !pendingSwapConfirm;
    // Launch-polish §5, gap 3: a FILLED slot during the active placement
    // decision is a genuinely illegal destination for the card about to be
    // placed (see PeakCardCourt's own comment) -- but only when it is not
    // ALSO the live rearrange target/source, which already has its own,
    // higher-priority styling.
    const blockedDuringPlacement = phase === "placing" && slot.filled && movingSlot == null;
    return (
      <PeakCardCourt
        slot={slot}
        isPendingTarget={phase === "placing" && !slot.filled}
        onClick={
          !isSwapTarget && phase === "placing" && !slot.filled && !busy
            ? () => handlePlace(slot.slot_type)
            : undefined
        }
        pendingFit={pendingSlotFit?.role_fit}
        pendingFitSeverity={pendingSlotFit?.role_fit_severity}
        pendingPrimaryPosition={phase === "placing" ? state.pending_selection?.primary_position : undefined}
        onMove={
          rearrangeAvailable && slot.filled && movingSlot == null && !busy && !pendingSwapConfirm
            ? () => setMovingSlot(slot.slot_type)
            : undefined
        }
        onSwapTarget={isSwapTarget && !busy ? () => requestSwap(slot.slot_type) : undefined}
        movingFromSlotLabel={movingSlot ? SLOT_LABELS[movingSlot] : null}
        blockedDuringPlacement={blockedDuringPlacement}
      />
    );
  }

  return (
    <div data-testid="court-builder" className="mx-auto max-w-7xl px-4 py-8 flex flex-col gap-5">
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
              {state.respin_history.length} respin{state.respin_history.length === 1 ? "" : "s"} used this run
              {" "}({state.team_respins_used_total} team, {state.season_respins_used_total} season)
            </span>
          )}
        </div>
      </details>

      {error && (
        <div role="alert" className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--incorrect-bg)", color: "var(--incorrect)" }}>
          {error}
        </div>
      )}

      {!state.simulation_result && (
        /* Phase 8D: the arena shell is now ONE consistent layout at every
           game phase (see .arena-shell in globals.css) -- the court is
           always the dominant column and the spin/candidate panel is
           always the same fixed-width companion, from first paint. There
           is no more mode-dependent resize (Phase 8B/8C's tiny-rail ->
           big-court swap read as an unstable morph, partly because it also
           crossed .court-panel-wrapper's own container-query breakpoint
           mid-transition). Both columns simply stack in document order
           below 1024px -- no separate mobile markup branch to maintain. */
        <div className="arena-shell" data-testid="arena-shell">
          <div className="flex flex-col gap-5 min-w-0 arena-shell-main">
            {/* Top: the current round's constraint (team + era wheel).
                Phase 8D: mounted for the WHOLE round (spinning through
                placing), never conditionally removed -- keyed only on
                current_round, so canceling a selection and returning to
                "spinning" in the SAME round no longer remounts it and
                replays the ceremony. `collapsed` swaps it to a compact
                locked-in readout once placement starts. */}
            {(phase === "spinning" || phase === "placing") && roundSpin && (
              <SpinStage
                key={state.current_round}
                spin={roundSpin}
                roundNumber={state.current_round}
                totalRounds={state.total_rounds}
                franchiseNames={franchiseNames}
                seasonLabels={seasonLabels}
                teamLogoUrls={teamLogoUrls}
                rollableTeamSeasonCount={rollableTeamSeasonCount}
                supportedStartSeason={supportedStartSeason}
                supportedEndSeason={supportedEndSeason}
                onRevealComplete={() => setRevealedRound(state.current_round)}
                respinFlashKey={respinFlashKey}
                respinKind={respinKind}
                respinFrom={lastRespin}
                collapsed={phase === "placing"}
              />
            )}

            {/* Phase 7A Part C: up to 3 team + 3 season respins for the WHOLE
                8-round run (never per-round -- Phase 6G's original per-round
                reset was a bug). Uses the top-level *_total counters, which
                are always run-level and never reset, rather than
                current_spin's own copy of the same numbers. Still only
                shown while this round's player hasn't been picked yet
                (ceremonyRevealed implies status === "selection_pending" --
                the whole block disappears once a player is selected).
                team_year rounds only -- legacy team_decade/exact_team_season/
                open_pool rounds don't have a team+season reel to respin. */}
            {phase === "spinning" && state.current_spin?.spin_type === "team_year" && ceremonyRevealed && (
              <div className="flex flex-col items-center gap-1.5" data-testid="respin-controls">
                <div className="flex items-center gap-2">
                  <button
                    data-testid="respin-team-btn"
                    onClick={handleRespinTeam}
                    disabled={busy || state.team_respins_remaining_total <= 0}
                    className="text-xs font-semibold rounded-full px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
                  >
                    Respin Team ({state.team_respins_remaining_total} left)
                  </button>
                  <button
                    data-testid="respin-season-btn"
                    onClick={handleRespinSeason}
                    disabled={busy || state.season_respins_remaining_total <= 0}
                    className="text-xs font-semibold rounded-full px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
                  >
                    Respin Season ({state.season_respins_remaining_total} left)
                  </button>
                </div>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  Three team respins and three season respins per run. Use them wisely.
                </p>
              </div>
            )}

            {/* Candidate area: clearly its own panel, separate from the court
                rail -- step 1 of this round (choose), never mixed visually
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
                        className="text-[11px] font-semibold"
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
                    <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--peak-accent-text, #f5c842)" }}>
                      Step 2 · Place {state.pending_selection.player_name}
                    </div>
                    Choose any open spot on the court rail — the fit badge shows how well
                    they match that spot, but every open spot is a legal placement.
                  </div>
                  {/* Launch-polish LP2-1: this banner has plenty of room
                      (unlike the roster card's Move button), so the
                      44x44 floor is met by growing the real button
                      itself rather than a separate hit-area wrapper --
                      nothing here was visually cramped to begin with. */}
                  <button
                    data-testid="cancel-selection-btn"
                    onClick={handleCancel}
                    disabled={busy}
                    className="min-h-[44px] shrink-0 rounded px-3 text-xs font-semibold uppercase tracking-wide"
                    style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
                  >
                    Choose someone else
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Rail: the court itself (PG/SG/SF/PF/C) with the bench row
              beneath it -- always visible so the roster-in-progress stays
              legible across both steps, and (lg+) stays pinned in view
              while scrolling the candidate list. CourtLayout's own
              .roster-board provides the visual frame (Phase 6B) -- no
              redundant outer box around it. */}
          <div data-testid="court-grid" className="arena-shell-rail">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Your roster
            </div>

            {/* Phase 9B: rearranging. Users could see a bad position fit but
                had no way to act on it short of a respin (which rerolls the
                team+season and costs a run-level budget) or restarting. This
                is the missing lever, and the copy is explicit that it is NOT
                a respin -- that distinction is the whole reason it's safe to
                offer for free. */}
            {rearrangeAvailable && movingSlot == null && (
              <p className="text-[10px] -mt-1" style={{ color: "var(--text-muted)" }} data-testid="rearrange-hint">
                Move players to improve position fit — this never re-spins.
              </p>
            )}
            {movingSlot != null && !pendingSwapConfirm && (
              <div
                data-testid="rearrange-banner"
                role="status"
                className="rounded-lg px-2.5 py-2 flex items-center justify-between gap-2 -mt-1"
                style={{ background: "var(--peak-accent-bg, rgba(245,200,66,0.08))", border: "1px solid var(--peak-accent-dim)" }}
              >
                <span className="text-[11px]" style={{ color: "var(--text-primary)" }}>
                  Moving from <strong>{SLOT_LABELS[movingSlot]}</strong> — pick a destination slot. No re-spin, no cards lost.
                </span>
                {/* Launch-polish LP2-1: "Cancel" alone is short enough that
                    padding-only growth would meet the height floor but not
                    the width one, so both are pinned explicitly. */}
                <button
                  data-testid="rearrange-cancel-btn"
                  onClick={cancelRearrange}
                  className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded px-3 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
                >
                  Cancel
                </button>
              </div>
            )}
            {/* Launch-polish §5, gap 1: the confirmation step, ONLY for
                displacing an already-placed card. `cancelPendingSwap`
                deliberately leaves `movingSlot` set -- declining this ONE
                destination should return to "pick a destination", not
                discard the whole rearrange and make the player start over. */}
            {pendingSwapConfirm && (
              <div
                data-testid="swap-confirm-banner"
                role="alertdialog"
                aria-label="Confirm swap"
                className="rounded-lg px-2.5 py-2 flex items-center justify-between gap-2 -mt-1"
                style={{ background: "var(--peak-accent-bg, rgba(245,200,66,0.08))", border: "1px solid var(--peak-accent-dim)" }}
              >
                <span className="text-[11px]" style={{ color: "var(--text-primary)" }}>
                  Swap{" "}
                  <strong>
                    {state.slots.find((s) => s.slot_type === pendingSwapConfirm.from)?.player_name ??
                      SLOT_LABELS[pendingSwapConfirm.from]}
                  </strong>{" "}
                  ↔{" "}
                  <strong>
                    {state.slots.find((s) => s.slot_type === pendingSwapConfirm.to)?.player_name ??
                      SLOT_LABELS[pendingSwapConfirm.to]}
                  </strong>
                  ?
                </span>
                {/* Launch-polish LP2-1: both short labels, both pinned to
                    44x44 on width and height -- same reasoning as
                    rearrange-cancel-btn above. */}
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="swap-confirm-btn"
                    onClick={confirmPendingSwap}
                    disabled={busy}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded px-3 text-[10px] font-bold uppercase tracking-wide disabled:opacity-50"
                    style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
                  >
                    Swap
                  </button>
                  <button
                    type="button"
                    data-testid="swap-confirm-cancel-btn"
                    onClick={cancelPendingSwap}
                    disabled={busy}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded px-3 text-[10px] font-semibold uppercase tracking-wide disabled:opacity-50"
                    style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
                  >
                    Cancel
                  </button>
                </span>
              </div>
            )}
            {state.live_build && <LiveBuildPanel liveBuild={state.live_build} />}
            <CourtLayout starterSlots={starterSlots} benchSlots={benchSlots} renderSlot={renderSlot} />

            {phase === "complete" && state.status === "rounds_complete" && (
              <button
                data-testid="complete-season-btn"
                onClick={handleComplete}
                disabled={busy}
                className="rounded-lg py-3 font-semibold"
                style={{ background: "var(--peak-accent, #f5c842)", color: "var(--text-inverse)" }}
              >
                {busy ? "Simulating…" : "Lock Roster & Simulate"}
              </button>
            )}
          </div>
        </div>
      )}

      {state.simulation_result && (
        <div className="mx-auto max-w-2xl w-full">
          <SeasonResultStub
            state={state}
            result={state.simulation_result}
            onPlayAgain={handlePlayAgain}
            playAgainBusy={busy}
          />
        </div>
      )}

      {actionToast && (
        <ActionToast
          message={actionToast.message}
          actionLabel={actionToast.actionLabel}
          onAction={actionToast.onAction}
          onDismiss={dismissToast}
        />
      )}
    </div>
  );
}
