"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelSelection,
  completeCourtGame,
  createCourtGame,
  placeCard,
  requestHint,
  respinIdempotencyKey,
  respinSeason,
  respinTeam,
  selectPlayer,
  swapSlots,
  undoIdempotencyKey,
  undoLastPlacement,
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
import UiVersionSwitch from "@/components/v2/UiVersionSwitch";
import PeakV2CourtLive from "@/components/v2/court/PeakV2CourtLive";
import PeakV2CourtChooser from "@/components/v2/court/PeakV2CourtChooser";
import PeakV2CourtResult from "@/components/v2/court/PeakV2CourtResult";

interface Props {
  initialGameState: CourtLineupPublicState;
  franchiseNames: string[];
  /** Real, resolvable exact-season pool for team_year spins' second reel
   * (readiness endpoint's experimental_team_year_season_labels) -- empty for
   * every non-team_year board. */
  seasonLabels?: string[];
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
  // Respin reveal boundary (bug: "the new team/year is visible before the
  // reel lands"). `state.current_spin` becomes the NEW, authoritative spin
  // the instant respinTeam/respinSeason resolves -- SpinStage itself already
  // gates its own "You rolled: X" text on its internal `respinning` flag, but
  // everything CourtBuilder renders directly from `state.current_spin` (the
  // roll summary, the candidate list) had no equivalent gate and simply
  // rendered whatever the latest state was. `respinPending` is true from the
  // moment a respin is requested until SpinStage reports (via
  // `onRespinSettled`) that the reel has actually visually landed;
  // `revealedSpinRef` holds the last spin that was safe to show, so
  // CourtBuilder can keep displaying the PREVIOUS team/season/candidates
  // for that whole window instead of either leaking the new ones early or
  // blanking the region (which would be its own collapse).
  const [respinPending, setRespinPending] = useState(false);
  const revealedSpinRef = useRef<CurrentSpin | null>(null);
  if (state.current_spin && !respinPending) revealedSpinRef.current = state.current_spin;
  // Phase 9B rearrange mode: which filled slot's card the user is currently
  // moving, or null when not rearranging. A two-step "pick a card, then pick
  // a destination" flow rather than drag-and-drop -- it works with a keyboard
  // and a screen reader with no extra machinery, and there is no such thing
  // as a half-completed drop.
  const [movingSlot, setMovingSlot] = useState<SlotType | null>(null);
  // E1: the selection overlay can be MINIMIZED to work the court underneath
  // (rearranging mid-run is a real capability the old two-column layout had,
  // and the overlay must not remove it). Purely view state: the round, the
  // roll, the respin budget and the candidate pool are untouched — the
  // overlay reopens on the floating "Resume selection" control, and reopens
  // ITSELF the moment a new round rolls (see the effect below).
  const [overlayMinimized, setOverlayMinimized] = useState(false);
  useEffect(() => {
    // A new roll is a new decision: never leave it minimized behind a court
    // the player finished rearranging two rounds ago.
    setOverlayMinimized(false);
  }, [state.current_round]);
  // Gameplay-polish: the hint's recommendation is scoped to the round it was
  // requested for -- once the round advances, that candidate offer is gone,
  // so the highlight/confirmation must go with it. `state.hint_used` (the
  // durable, persisted "already used this run" flag the button itself reads)
  // is untouched by this -- only the ephemeral display resets.
  const [hint, setHint] = useState<{ playerSlug: string; playerName: string } | null>(null);
  useEffect(() => {
    setHint(null);
  }, [state.current_round]);
  // E3 (polish pass): the third step is GONE. Displacing an already-placed
  // card used to pause on a separate "Swap?" confirmation banner rendered
  // elsewhere on the page — easy to miss, and the extra click it demanded
  // protected nothing the Undo toast does not already protect better (a
  // confirmation guards against a click you have not made yet; Undo reverses
  // the one you actually made, through the server's own
  // `action_undo_last_placement`, with a server-enforced window). Click a
  // legal destination — empty or occupied — and the move/swap commits
  // immediately, with Undo offered on the toast either way.
  // Launch-polish LP2-2: the one-line, auto-dismissing receipt for the last
  // placement or swap, with a single REAL reversing action (see
  // `performUndo` below). The toast's own visible duration is not a
  // separate client-invented timer -- it is derived from the SAME
  // `undo.expires_at` the server enforces server-side (state.py's
  // UNDO_WINDOW_SECONDS), so the affordance disappears exactly when the
  // server would start rejecting it, never later.
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
  const showToast = useCallback(
    (message: string, actionLabel: string, onAction: () => void, expiresAt?: string | null) => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setActionToast({ message, actionLabel, onAction });
      // Falls back to 8s only if the server ever omits `expires_at` (it
      // does not, for a successful place/swap) -- defensive, not the
      // normal path.
      const durationMs = expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now()) : 8000;
      toastTimerRef.current = window.setTimeout(() => setActionToast(null), durationMs);
    },
    [],
  );
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
  // The reveal-safe spin for anything CourtBuilder renders directly (not
  // through SpinStage, which manages its own reveal timing internally):
  // the previous spin while a respin is still visually landing, the real
  // one otherwise.
  const displaySpin = respinPending ? (revealedSpinRef.current ?? roundSpin) : roundSpin;

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

  // Launch-polish LP2-2: the ONE place a real Undo is ever requested from.
  //
  // Takes `gameId`/`expectedVersion` as PARAMETERS, captured by the caller
  // from the server response that made the toast appear (`next.game_id`,
  // `next.state_version`) -- deliberately NOT read from the component's own
  // `state` at call time. `showToast`'s `onAction` closure is created
  // inside `handlePlace`/`performSwap` during the render that just called
  // `setState(next)`; React state updates are async, so `state` in THAT
  // closure is still last render's value until the next render actually
  // happens. Reading `state.state_version` here instead of `next.state_version`
  // would send the version from BEFORE the placement/swap that produced the
  // very toast the user is clicking -- an `expected_state_version` that is
  // stale by exactly one, on every single click, for no reason a player
  // could ever explain. Capturing the exact value the server already
  // returned sidesteps the whole class of bug.
  const performUndo = useCallback(
    async (gameId: string, expectedVersion: number) => {
      const key = undoIdempotencyKey(gameId, expectedVersion);
      const next = await withBusy(() => undoLastPlacement(gameId, expectedVersion, key));
      // Dismissed either way. A rejection here is always one of three
      // server-authoritative, already-player-legible reasons (surfaced
      // through the ordinary `error` banner by `withBusy` itself, same as
      // any other action): the window expired, an intervening action
      // superseded it, or the caller fell out of sync -- re-showing the
      // same Undo button would just fail again the same way.
      dismissToast();
      if (next) setState(next);
    },
    [dismissToast],
  );

  async function handlePlace(slotType: SlotType) {
    const next = await withBusy(() => placeCard(state.game_id, slotType));
    if (next) {
      setState(next);
      // Launch-polish LP2-2: a REAL Undo now exists
      // (state.py::action_undo_last_placement), so the toast offers exactly
      // that -- not the old "Move" shortcut into rearrange mode, which was
      // an honest label for a real limitation that no longer exists.
      // `next.undo` is computed by the server the same way the undo action
      // itself validates, so this can never offer an Undo the endpoint
      // would actually refuse.
      const placed = next.slots.find((s) => s.slot_type === slotType);
      if (placed?.player_name && next.undo.available) {
        const { game_id: gameId, state_version: expectedVersion, undo } = next;
        showToast(
          `Placed ${placed.player_name} in ${SLOT_LABELS[slotType]}.`,
          "Undo",
          () => void performUndo(gameId, expectedVersion),
          undo.expires_at,
        );
      }
    }
  }

  async function handleCancel() {
    const next = await withBusy(() => cancelSelection(state.game_id));
    if (next) setState(next);
  }

  // Gameplay-polish: "Give me a suggestion" -- Easy mode only, once per run.
  // The server computes the recommendation (raw score + best position fit
  // across the open slots) entirely itself; this only stores the identity it
  // returns for the highlight/confirmation, never a number.
  async function handleHint() {
    const result = await withBusy(() => requestHint(state.game_id));
    if (result) {
      setState(result.state);
      setHint({ playerSlug: result.hint.player_slug, playerName: result.hint.player_name });
    }
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
    setRespinPending(true);
    const next = await withBusy(() => respinTeam(state.game_id, key));
    if (next) {
      setState(next);
      setRespinKind("team");
      setRespinFlashKey((k) => k + 1);
    } else {
      setRespinPending(false);
    }
  }

  async function handleRespinSeason() {
    const key = respinIdempotencyKey(
      state.game_id, state.current_round, "season", state.season_respins_used_total,
    );
    setRespinPending(true);
    const next = await withBusy(() => respinSeason(state.game_id, key));
    if (next) {
      setState(next);
      setRespinKind("season");
      setRespinFlashKey((k) => k + 1);
    } else {
      setRespinPending(false);
    }
  }

  /** Perform the rearrange. Never re-spins and never re-selects -- the server
   * only exchanges the two slots' card identity fields and recomputes both
   * slots' role_fit, so the roster count and every card's data are preserved
   * by construction (see state.py::action_swap_slots).
   *
   * Launch-polish LP2-2: the toast's Undo now goes through the same
   * authoritative `performUndo` `handlePlace` uses -- not a second call to
   * `swapSlots` with the arguments reversed. The old client-side trick
   * (re-swap the same two slots) happened to also be correct here, since a
   * swap is its own inverse, but it had no server-enforced window, no
   * protection against an intervening action superseding it, and no
   * idempotency guard beyond `busy`. `action_undo_last_placement` gives all
   * three for free and unifies place/swap behind one endpoint, so there is
   * no reason left to keep the bespoke path.
   */
  const performSwap = useCallback(
    async (from: SlotType, to: SlotType) => {
      // Captured BEFORE the request, not read off `next` afterward -- once
      // the swap lands, "from" holds whoever USED to be in "to". The toast
      // needs to know who was where beforehand.
      const beforeFrom = state.slots.find((s) => s.slot_type === from);
      const beforeTo = state.slots.find((s) => s.slot_type === to);
      const next = await withBusy(() => swapSlots(state.game_id, from, to));
      if (!next) return next;
      setState(next);
      if (next.undo.available) {
        const wasSwap = !!beforeFrom?.filled && !!beforeTo?.filled;
        const message = wasSwap
          ? `Swapped ${beforeFrom?.player_name ?? SLOT_LABELS[from]} and ${beforeTo?.player_name ?? SLOT_LABELS[to]}.`
          : `Moved ${beforeFrom?.player_name ?? "the card"} to ${SLOT_LABELS[to]}.`;
        const { game_id: gameId, state_version: expectedVersion, undo } = next;
        showToast(message, "Undo", () => void performUndo(gameId, expectedVersion), undo.expires_at);
      }
      return next;
    },
    [state.game_id, state.slots, showToast, performUndo],
  );

  /** The click on a destination slot while a card is being moved (E3).
   * Empty target — move immediately. Occupied target — swap immediately.
   * Every placement in this game is positionally legal by rule (soft
   * placement; fit is advisory and shown on the badge), so there is no
   * illegal destination to block; the safety net is the Undo toast
   * `performSwap` raises, which reverses the committed action through the
   * server's own undo endpoint. Clicking the SOURCE card again cancels —
   * handled in `renderSlot`, alongside Escape and the Cancel control. */
  function requestSwap(target: SlotType) {
    const from = movingSlot;
    if (!from || from === target) {
      setMovingSlot(null);
      return;
    }
    setMovingSlot(null);
    void performSwap(from, target);
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
      setRespinPending(false);
      setHint(null);
      lastSpinRef.current = null;
      revealedSpinRef.current = null;
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
    // filled one is an immediate swap (E3). Both go through the same endpoint
    // and both raise the Undo toast.
    const isSwapTarget = movingSlot != null && movingSlot !== slot.slot_type;
    // The card being moved: clicking it again is the third cancel path,
    // beside Escape and the banner's Cancel control (E3).
    const isMovingSource = movingSlot === slot.slot_type;
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
          rearrangeAvailable && slot.filled && movingSlot == null && !busy
            ? () => setMovingSlot(slot.slot_type)
            : undefined
        }
        onSwapTarget={isSwapTarget && !busy ? () => requestSwap(slot.slot_type) : undefined}
        onCancelMove={isMovingSource ? cancelRearrange : undefined}
        movingFromSlotLabel={movingSlot ? SLOT_LABELS[movingSlot] : null}
        blockedDuringPlacement={blockedDuringPlacement}
      />
    );
  }

  // V2's own live court + chooser (Pass 3) — the exact same state/handlers
  // computed above, no second reducer or API call. `PeakV2CourtChooser`
  // reuses `SpinStage`/`EligiblePlayerSearch` verbatim (see its own
  // docstring); only the chrome around them and the court itself are new.
  const v2View = (
    <>
      <PeakV2CourtLive
        state={state}
        phase={phase}
        busy={busy}
        starterSlots={starterSlots}
        benchSlots={benchSlots}
        movingSlot={movingSlot}
        rearrangeAvailable={rearrangeAvailable}
        onPlace={handlePlace}
        onStartMove={(slotType) => setMovingSlot(slotType)}
        onSwapTarget={requestSwap}
        onCancelMove={cancelRearrange}
        slotLabel={(slot) => SLOT_LABELS[slot]}
        onComplete={handleComplete}
        // Pass 7 (human acceptance testing, §5): the SAME `overlayMinimized`
        // state that already preserves round/roll/respins/candidates
        // untouched on close (see the state's own docstring above) -- V2
        // just never rendered a way back in. `setOverlayMinimized(false)` is
        // the exact same reopen legacy's "Resume selection" banner already
        // calls; no new state, no new endpoint.
        showResumeSelection={phase === "spinning" && overlayMinimized}
        onResumeSelection={() => setOverlayMinimized(false)}
        pendingSelectionName={state.pending_selection?.player_name ?? null}
        // Human acceptance testing, task §8: the "PLACE [player]" banner
        // gains real TEAM · SEASON · POSITION instrumentation instead of a
        // bare name -- all three are already on `pending_selection` (no
        // new fetch), just not previously threaded through.
        pendingSelectionTeam={state.pending_selection?.team_name ?? null}
        pendingSelectionSeason={state.pending_selection?.season ?? null}
        pendingSelectionPosition={state.pending_selection?.primary_position ?? null}
        onSwitchSelection={handleCancel}
      />
      {(phase === "spinning" || phase === "placing") && roundSpin && (
        <PeakV2CourtChooser
          // Mirrors legacy's own `hidden={phase !== "spinning" || overlayMinimized}`
          // exactly, inverted for an `open` prop: the panel auto-steps aside
          // the instant a selection is pending (`phase === "placing"`) so the
          // now-clickable court slots underneath are reachable, not just
          // visible — the same real state `renderSlot`'s `onClick` already
          // gates on. Never a second, drifted copy of that condition.
          open={phase === "spinning" && !overlayMinimized}
          onClose={() => setOverlayMinimized(true)}
          roundNumber={state.current_round}
          totalRounds={state.total_rounds}
          spin={roundSpin}
          franchiseNames={franchiseNames}
          seasonLabels={seasonLabels}
          teamLogoUrls={teamLogoUrls}
          onRevealComplete={() => setRevealedRound(state.current_round)}
          onRespinSettled={() => setRespinPending(false)}
          respinFlashKey={respinFlashKey}
          respinKind={respinKind}
          respinFrom={lastRespin}
          collapsed={phase === "placing"}
          ceremonyRevealed={ceremonyRevealed}
          displaySpin={displaySpin}
          candidates={displaySpin?.candidates ?? null}
          onSelectCandidate={handleSelect}
          busy={busy}
          respinPending={respinPending}
          canRespinTeam={state.team_respins_remaining_total > 0}
          canRespinSeason={state.season_respins_remaining_total > 0}
          teamRespinsLeft={state.team_respins_remaining_total}
          seasonRespinsLeft={state.season_respins_remaining_total}
          onRespinTeam={handleRespinTeam}
          onRespinSeason={handleRespinSeason}
          difficulty={state.difficulty ?? "easy"}
          hintUsed={!!state.hint_used}
          hintMessage={hint ? `PEAK3 suggests: ${hint.playerName}` : null}
          onHint={handleHint}
        />
      )}
    </>
  );

  return (
    <>
    <UiVersionSwitch
      legacy={
    <div data-testid="court-builder" className="mx-auto max-w-7xl px-4 py-8 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          82-0 Peak Season
        </h1>
        <div className="flex items-center gap-1.5">
          {/* Gameplay-polish: the run's frozen difficulty -- especially
              important in Hard mode, where the respin budget below reads
              "(1 left)" instead of the usual "(3 left)" and this badge is
              the thing that explains why. */}
          <span
            data-testid="difficulty-badge"
            className="text-[9px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5"
            style={
              state.difficulty === "hard"
                ? { color: "var(--incorrect)", background: "var(--incorrect-bg)" }
                : { color: "var(--peak-accent-text, #f5c842)", background: "var(--peak-accent-bg)" }
            }
            title={
              state.difficulty === "hard"
                ? "Hard: 1 team respin + 1 season respin for the whole run, no hint"
                : "Easy: 3 team respins + 3 season respins for the whole run, plus a one-time hint"
            }
          >
            {state.difficulty === "hard" ? "Hard" : "Easy"}
          </span>
          <span
            className="text-[9px] uppercase tracking-wide rounded px-1.5 py-0.5"
            style={{ color: "var(--text-muted)" }}
            title="v0 experimental simulator -- see the data receipt for version details"
          >
            Experimental
          </span>
        </div>
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
        /* E1 (polish pass): THE COURT IS THE STABLE PRIMARY CANVAS. The
           two-column `.arena-shell` — spin/candidates in a main column, the
           court in a 460px sticky rail — made the object of the game a
           sidebar and gave the page two competing scroll surfaces. The court
           now renders centered as the page's one canvas, fully mounted at
           every phase, and the whole selection step opens in a viewport
           overlay above it (below in the JSX, above in z-order). */
        <div className="courtb-stage" data-testid="courtb-stage">
          {/* THE SELECTION OVERLAY. The WRAPPER stays mounted for the whole
              round and hides via `hidden` while a selection is being placed —
              SpinStage replays its reveal ceremony if remounted, and "choose
              someone else" must return to this round's already-revealed roll,
              not to a fresh ceremony (see lastSpinRef above). The pieces that
              are conditional (`respin-controls`, `candidate-panel`) unmount
              exactly as they always did, so every existing count/visibility
              contract about them still holds. */}
          {(phase === "spinning" || phase === "placing") && roundSpin && (
            <div
              className="courtb-overlay-scrim"
              data-testid="selection-overlay-scrim"
              hidden={phase !== "spinning" || overlayMinimized}
              // 2.4: clicking the backdrop enters View Court, same as the
              // explicit button. Guarded on `target === currentTarget` --
              // this element WRAPS the panel rather than sitting behind it
              // as a separate layer, so every click inside the panel also
              // bubbles here, and only a click that landed on the scrim
              // itself (never on a descendant) should count as "outside".
              onClick={(e) => {
                if (e.target === e.currentTarget) setOverlayMinimized(true);
              }}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-label={`Round ${state.current_round} of ${state.total_rounds} — choose a player`}
                className="courtb-overlay"
                data-testid="selection-overlay"
              >
                <div className="courtb-overlay-head">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold uppercase tracking-wider shrink-0" style={{ color: "var(--text-muted)" }}>
                      Round {state.current_round} / {state.total_rounds}
                    </span>
                    {displaySpin && displaySpin.spin_type !== "open_pool" && ceremonyRevealed && (
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span
                          aria-hidden="true"
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: getTeamColors(displaySpin.franchise_display_name).primary }}
                        />
                        <span
                          className="text-[12px] font-semibold truncate"
                          style={{ color: "var(--text-primary)" }}
                          data-testid="overlay-roll-summary"
                        >
                          {displaySpin.franchise_display_name} · {displaySpin.era_label}
                          <span style={{ color: "var(--text-muted)" }}>
                            {" "}· {displaySpin.candidates.length} eligible
                          </span>
                        </span>
                      </span>
                    )}
                  </div>
                  {/* RESPINS LIVE IN THE HEADER — visible without scrolling
                      to the bottom of a long candidate list (E1). Same
                      run-level budget semantics as always (Phase 7A Part C:
                      3 team + 3 season for the WHOLE 8-round run). */}
                  {phase === "spinning" && state.current_spin?.spin_type === "team_year" && ceremonyRevealed && (
                    <div className="flex items-center gap-2 shrink-0" data-testid="respin-controls">
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
                  )}
                  {/* E1: step aside to work the court (move/swap cards) without
                      losing the roll. The candidate list, respins and the
                      round's whole state are exactly as left on resume. */}
                  <button
                    type="button"
                    data-testid="minimize-overlay-btn"
                    onClick={() => setOverlayMinimized(true)}
                    className="text-xs font-semibold rounded-full px-3 py-1.5 shrink-0"
                    style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
                  >
                    View court
                  </button>
                </div>

                <div
                  className="courtb-overlay-body"
                  // Gameplay-polish: the difficulty badge/hint affordance
                  // added enough header height that this region's content can
                  // now genuinely overflow and scroll on shorter viewports --
                  // a scrollable region with no focusable content of its own
                  // is unreachable by keyboard (axe `scrollable-region-
                  // focusable`), same defect class `SettledLotTray`'s panel
                  // already guards against (see its own comment). The
                  // container itself takes focus so Tab can always reach and
                  // scroll it, regardless of whether it happens to overflow
                  // at the current viewport size.
                  tabIndex={0}
                >
                  {/* The round's constraint ceremony (team + era wheel).
                      Phase 8D contract unchanged: keyed only on
                      current_round, mounted through spinning AND placing
                      (the wrapper hides, this never unmounts), so canceling
                      a selection never replays the ceremony. */}
                  <SpinStage
                    key={state.current_round}
                    spin={roundSpin}
                    roundNumber={state.current_round}
                    totalRounds={state.total_rounds}
                    franchiseNames={franchiseNames}
                    seasonLabels={seasonLabels}
                    teamLogoUrls={teamLogoUrls}
                    onRevealComplete={() => setRevealedRound(state.current_round)}
                    onRespinSettled={() => setRespinPending(false)}
                    respinFlashKey={respinFlashKey}
                    respinKind={respinKind}
                    respinFrom={lastRespin}
                    collapsed={phase === "placing"}
                  />

                  {/* Candidate discovery: search + list, scrolling INSIDE the
                      overlay body — the page never scrolls to choose. */}
                  {phase === "spinning" && displaySpin && ceremonyRevealed && (
                    <div
                      data-testid="candidate-panel"
                      className="rounded-2xl border p-4 flex flex-col gap-3"
                      style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                          Step 1 · Choose a player
                        </div>
                        {/* Gameplay-polish: Easy mode only, and only while a
                            candidate offer is actually open -- not during a
                            respin's reel animation, and never in Hard mode
                            (which never gets a hint at all). Stays visible
                            (disabled, relabeled) after use rather than
                            disappearing, so "already used this run" is
                            legible on its own, including after a reload. */}
                        {state.difficulty === "easy" && (
                          <button
                            type="button"
                            data-testid="hint-btn"
                            onClick={handleHint}
                            disabled={busy || respinPending || state.hint_used}
                            className="text-xs font-semibold rounded-full px-3 py-1.5 disabled:opacity-50 pk-lift pk-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                            style={{
                              background: state.hint_used ? "var(--bg-surface)" : "var(--peak-accent, #f5c842)",
                              color: state.hint_used ? "var(--text-muted)" : "var(--text-inverse)",
                              border: "1px solid var(--border-default)",
                            }}
                          >
                            {state.hint_used ? "Hint used" : "Give me a suggestion"}
                          </button>
                        )}
                      </div>
                      {hint && (
                        <p
                          data-testid="hint-message"
                          className="text-xs font-semibold -mt-1 pk-reveal"
                          style={{ color: "var(--peak-accent-text, #f5c842)" }}
                        >
                          PEAK3 suggests: {hint.playerName}
                        </p>
                      )}
                      <EligiblePlayerSearch
                        candidates={displaySpin.candidates}
                        onSelect={handleSelect}
                        disabled={busy || respinPending}
                        highlightSlug={hint?.playerSlug ?? null}
                      />
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* Step 2, ON THE COURT (E1 variant B): selecting a candidate
              closes the overlay and the court's open slots light up. The
              banner names the selection and offers the way back. */}
          {phase === "placing" && state.pending_selection && (
            <div
              data-testid="placing-banner"
              className="rounded-xl p-3 text-sm flex flex-col gap-2"
              style={{ background: "var(--peak-accent-bg, rgba(245,200,66,0.08))", border: "1px solid var(--peak-accent-dim)", color: "var(--text-primary)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--peak-accent-text, #f5c842)" }}>
                    Selected: {state.pending_selection.player_name}
                  </div>
                  Choose any open spot on the court — the fit badge shows how well
                  they match that spot, but every open spot is a legal placement.
                </div>
                {/* "SWITCH SELECTION" (E1): returns to the same round's
                    already-revealed roll and candidate list — never a respin,
                    never a lost roll. `action_cancel_selection` server-side. */}
                <button
                  data-testid="cancel-selection-btn"
                  onClick={handleCancel}
                  disabled={busy}
                  className="min-h-[44px] shrink-0 rounded px-3 text-xs font-semibold uppercase tracking-wide"
                  style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
                >
                  Switch selection
                </button>
              </div>
            </div>
          )}

          {/* The way back into a minimized selection (E1). 2.5: the "Round X
              of Y is waiting — rearrange your court, then come back to the
              roll" line added nothing the button itself doesn't already say
              — a strong, obvious action is the whole requirement here, not
              an explanation of what it does. */}
          {phase === "spinning" && overlayMinimized && (
            <div
              className="rounded-xl p-3 flex items-center justify-center"
              data-testid="resume-selection-banner"
              style={{ background: "var(--peak-accent-bg, rgba(245,200,66,0.08))", border: "1px solid var(--peak-accent-dim)" }}
            >
              <button
                type="button"
                data-testid="resume-selection-btn"
                onClick={() => setOverlayMinimized(false)}
                className="pk-lift pk-press min-h-[44px] w-full rounded-lg px-4 text-sm font-bold uppercase tracking-wide"
                style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
              >
                Resume selection
              </button>
            </div>
          )}

          {/* The court — the page's one stable canvas. */}
          <div data-testid="court-grid" className="flex flex-col gap-2.5">
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
            {movingSlot != null && (
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
    </div>
      }
      v2={v2View}
    />
      {state.simulation_result && (
        <UiVersionSwitch
          legacy={
            <div className="mx-auto max-w-2xl w-full">
              <SeasonResultStub
                state={state}
                result={state.simulation_result}
                onPlayAgain={handlePlayAgain}
                playAgainBusy={busy}
              />
            </div>
          }
          v2={
            <PeakV2CourtResult
              state={state}
              result={state.simulation_result}
              onPlayAgain={handlePlayAgain}
              playAgainBusy={busy}
            />
          }
        />
      )}

      {actionToast && (
        <ActionToast
          message={actionToast.message}
          actionLabel={actionToast.actionLabel}
          onAction={actionToast.onAction}
          onDismiss={dismissToast}
        />
      )}
    </>
  );
}
