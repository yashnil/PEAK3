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
  CurrentSpin,
  SlotType,
  SLOT_LABELS,
  STARTER_SLOT_TYPES,
  BENCH_SLOT_TYPES,
  fitLabel,
} from "@/types/perfect-season";
import ActionToast from "./ActionToast";
import { useCommandLane } from "@/lib/game-feel/authoritative";
import type { EventMomentData } from "@/components/game-feel";
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
  /**
   * EVERY ACTION GOES THROUGH ONE LANE (game-feel reconstruction). A plain
   * `busy` boolean used to disable everything at once and, worse, drop the
   * click handler off an open slot while a request was in flight -- the
   * slot flipped from a `<button>` to a dead `<div>` for the round trip, so
   * a second click landed on nothing. The lane serializes commands, refuses
   * a duplicate exclusive command before any handler runs, and publishes
   * WHICH command is pending so the exact control that owns it can show
   * its pending state while everything else stays a real, merely-disabled
   * control.
   */
  const lane = useCommandLane();
  const busy = lane.busy;
  const pendingKind = lane.pending;
  /** The candidate row / slot the pending command is about, for its own
   *  pressed-and-pending treatment. */
  const [pendingTarget, setPendingTarget] = useState<{ kind: string; key: string } | null>(null);
  /** What the latest snapshot just did -- a placed card, the fifth starter,
   *  a completed roster. Derived from the server's response, never timed. */
  const [moment, setMoment] = useState<EventMomentData | null>(null);
  /** Bumped per new round and per new game, for the round card. */
  const roundKey = `${state.game_id}:${state.current_round}`;
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

  // THE UNDO TOAST MUST NOT SURVIVE THE RUN. It is an undo affordance for a
  // placement, bounded by the server's own `expires_at`; once the roster is
  // locked and simulated the server rejects any mutation
  // ("rearrange_after_result"), so the toast is offering an action that
  // cannot succeed. It also sits fixed over the page, so on the result
  // screen it covered the revealed roster and clipped a player's team and
  // season behind it (design-review/11, and reproduced in this pass's own
  // C05 capture before this fix). Dismissed the moment the result exists.
  useEffect(() => {
    if (state.status === "result_ready") dismissToast();
  }, [state.status, dismissToast]);
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

  /**
   * Run one command through the lane. `undefined` means it did not produce a
   * state: refused as a duplicate (`null` from the lane) or failed (the
   * message lands in the error banner). Exclusive by default: one decision
   * at a time, and a second press of the same decision is inert.
   */
  const runCommand = useCallback(
    async <T,>(kind: string, fn: () => Promise<T>, target?: string): Promise<T | undefined> => {
      if (lane.pendingNow() !== null) return undefined;
      setError(null);
      if (target !== undefined) setPendingTarget({ kind, key: target });
      try {
        const result = await lane.run(kind, fn);
        return result === null ? undefined : result;
      } catch (e) {
        const msg = e instanceof PerfectSeasonAPIError ? e.message : "Something went wrong. Please try again.";
        setError(msg);
        return undefined;
      } finally {
        setPendingTarget(null);
      }
    },
    [lane],
  );

  /**
   * WHAT A PLACEMENT JUST DID, read off the two snapshots. The moment is
   * announced by the same render that draws the new slot, so it can never
   * describe a roster the screen is not yet showing. Rare moments earn more:
   * the fifth starter and the finished roster hold longer than a routine
   * placement.
   */
  function momentForPlacement(before: CourtLineupPublicState, after: CourtLineupPublicState): EventMomentData | null {
    const placed = after.slots.find((slot) => slot.filled && !before.slots.find((b) => b.slot_type === slot.slot_type)?.filled);
    if (!placed) return null;
    const starters = after.slots.filter((slot) => slot.filled && STARTER_SLOT_TYPES.includes(slot.slot_type)).length;
    const filled = after.slots.filter((slot) => slot.filled).length;
    const id = `v${after.state_version}`;
    if (filled === after.slots.length) {
      return { id, kind: "roster-complete", title: "Roster complete", detail: `${placed.player_name} → ${SLOT_LABELS[placed.slot_type]} · lock it in`, tone: "accent", durationMs: 1800 };
    }
    if (starters === STARTER_SLOT_TYPES.length && STARTER_SLOT_TYPES.includes(placed.slot_type)) {
      return { id, kind: "starting-five", title: "Starting five set", detail: `${placed.player_name} → ${SLOT_LABELS[placed.slot_type]}`, tone: "accent", durationMs: 1600 };
    }
    const fit = placed.role_fit ? fitLabel(placed.role_fit, placed.role_fit_severity) : null;
    return { id, kind: "pick", title: `${placed.player_name} → ${SLOT_LABELS[placed.slot_type]}`, detail: fit ? `Round ${before.current_round} · ${fit}` : `Round ${before.current_round}`, tone: "neutral" };
  }

  async function handleSelect(playerSlug: string) {
    const next = await runCommand("select", () => selectPlayer(state.game_id, playerSlug), playerSlug);
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
      const next = await runCommand("undo", () => undoLastPlacement(gameId, expectedVersion, key));
      // Dismissed either way. A rejection here is always one of three
      // server-authoritative, already-player-legible reasons (surfaced
      // through the ordinary `error` banner by `runCommand` itself, same as
      // any other action): the window expired, an intervening action
      // superseded it, or the caller fell out of sync -- re-showing the
      // same Undo button would just fail again the same way.
      dismissToast();
      if (next) setState(next);
    },
    [dismissToast, runCommand],
  );

  async function handlePlace(slotType: SlotType) {
    const before = state;
    const next = await runCommand("place", () => placeCard(state.game_id, slotType), slotType);
    if (next) {
      // ONE RENDER: the roster, and what it just did.
      setMoment(momentForPlacement(before, next));
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
    const next = await runCommand("cancel", () => cancelSelection(state.game_id));
    if (next) setState(next);
  }

  // Gameplay-polish: "Give me a suggestion" -- Easy mode only, once per run.
  // The server computes the recommendation (raw score + best position fit
  // across the open slots) entirely itself; this only stores the identity it
  // returns for the highlight/confirmation, never a number.
  async function handleHint() {
    const result = await runCommand("hint", () => requestHint(state.game_id));
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
    const next = await runCommand("respin_team", () => respinTeam(state.game_id, key));
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
    const next = await runCommand("respin_season", () => respinSeason(state.game_id, key));
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
      const next = await runCommand("swap", () => swapSlots(state.game_id, from, to), to);
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
    [state.game_id, state.slots, showToast, performUndo, runCommand],
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
    const next = await runCommand("complete", () => completeCourtGame(state.game_id));
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
  async function handlePlayAgain(): Promise<boolean> {
    const next = await runCommand("play_again", () => createCourtGame(state.mode));
    if (next) {
      // NOTHING LEAKS FROM THE FINISHED RUN: every piece of local ceremony
      // and moment state goes back to its initial value before the new
      // game's own round 1 opens with a real, un-skipped round card + spin.
      setMoment(null);
      setMovingSlot(null);
      setOverlayMinimized(false);
      dismissToast();
      setState(next);
      setRevealedRound(null);
      setRespinFlashKey(0);
      setRespinKind(null);
      setRespinPending(false);
      setHint(null);
      lastSpinRef.current = null;
      revealedSpinRef.current = null;
      try {
        window.scrollTo({ top: 0, behavior: "auto" });
      } catch {
        // jsdom has no scrolling; the new run still mounts at the top.
      }
      return true;
    }
    return false;
  }

  const starterSlots = state.slots.filter((s) => STARTER_SLOT_TYPES.includes(s.slot_type));
  const benchSlots = state.slots.filter((s) => BENCH_SLOT_TYPES.includes(s.slot_type));

  // V2's own live court + chooser (Pass 3) — the exact same state/handlers
  // computed above, no second reducer or API call. `PeakV2CourtChooser`
  // reuses `SpinStage`/`EligiblePlayerSearch` verbatim (see its own
  // docstring); only the chrome around them and the court itself are new.
  const v2View = (
    <div data-testid="court-builder">
      {/* A rejected action (a bad respin, a stale placement, …) — same
          `error` state legacy's own banner reads, previously computed and
          silently dropped for V2 players (nothing here read it at all). */}
      {error && (
        <div
          role="alert"
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--incorrect-bg)", color: "var(--incorrect)" }}
        >
          {error}
        </div>
      )}
      {/* Mirrors legacy's own `!state.simulation_result` gate exactly: the
          live, still-editable court is the build surface, and
          `PeakV2CourtResult` below is the separate, read-only broadcast
          reveal -- never both mounted at once. Without this gate, once a
          run completes `state.slots` carries the same now-revealed scores
          both components read, and the live court's own slot cards (now
          also revealed) render a SECOND, redundant copy of every
          `revealed-score-line`/`peak-locked-note` right alongside the
          result screen's -- exactly the kind of doubled, inconsistent
          surface CLAUDE.md's "no server-side answer storage" / single
          source of truth principle warns against, not a deliberate second
          reveal. */}
      {!state.simulation_result && (
        <>
          <PeakV2CourtLive
            state={state}
            phase={phase}
            busy={busy}
            pendingKind={pendingKind}
            pendingSlot={pendingTarget && (pendingTarget.kind === "place" || pendingTarget.kind === "swap") ? (pendingTarget.key as SlotType) : null}
            moment={moment}
            onMomentDone={(id) => setMoment((current) => (current?.id === id ? null : current))}
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
              pendingKind={pendingKind}
              pendingSlug={pendingTarget?.kind === "select" ? pendingTarget.key : null}
              roundKey={roundKey}
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
              hintSlug={hint?.playerSlug ?? null}
              onHint={handleHint}
            />
          )}
        </>
      )}
    </div>
  );

  return (
    <>
      {v2View}
      {state.simulation_result && (
        <PeakV2CourtResult
          state={state}
          result={state.simulation_result}
          onPlayAgain={handlePlayAgain}
          playAgainBusy={pendingKind === "play_again"}
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
