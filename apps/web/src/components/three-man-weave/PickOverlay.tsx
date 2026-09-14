"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { GameActionButton } from "@/components/game-feel";
import type {
  ArenaSeatPublic,
  TmwRoll,
  TmwRoster,
  TmwSlotType,
} from "@/types/three-man-weave";
import {
  TMW_FITS_AFTER_REARRANGEMENT,
  TMW_SLOT_LABELS,
  TMW_SLOT_TYPES,
} from "@/types/three-man-weave";
import type { TmwCandidate, TmwLockEntry } from "@/lib/three-man-weave-state";
import {
  TMW_LAST_CALL,
  TMW_LAST_CALL_MS,
  TMW_TIMEOUT_CONSEQUENCE,
  TMW_TIMEOUT_RESOLVING,
  eligibilityLine,
  emptyPoolReason,
  filterCandidatesByPosition,
  fitLabel,
  landingSlot,
  legalMoveTargets,
  lockedMatches,
  placementsAfterMove,
  positionsLine,
  searchCandidates,
  seatAccent,
  seatLabel,
  slotAbbrev,
  takenThisRoll,
  rollScopeLine,
} from "@/lib/three-man-weave-state";
import ArenaTimer from "@/components/shared/ArenaTimer";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import PlacementBoard, { type PlacementMode } from "./PlacementBoard";

/**
 * The draft room: choose a player, then click where they go.
 *
 * THE CORE IDEA IS UNCHANGED AND IS THE RIGHT ONE: the roster is the control.
 *
 *   1. Pick a candidate on the left. It highlights.
 *   2. Every legal slot on the right lights up; illegal ones step back.
 *   3. Click a slot. The card stages there, and any player the arrangement
 *      would move shows its destination ON ITS OWN SLOT.
 *   4. A real primary button commits: "Draft Kevin Garnett at PF".
 *
 * A `<select>` survives as an explicitly-labelled accessible fallback, rendered
 * after the board, offering nothing the board does not.
 *
 * WHAT TMW-11 CHANGED
 * -------------------
 * 1. HEADSHOTS ON CANDIDATE ROWS, through the one shared `PlayerAvatar`
 *    primitive. In production it renders its designed medallion for nearly
 *    every historical player; the row is laid out for that, not around it.
 *
 * 2. AT ZERO SECONDS THE PANEL LOCKS. `ArenaTimer` has always supported
 *    `onExpire` and neither of this mode's timers passed it, so at 0s the
 *    selection panel stayed fully interactive -- a click then landed outside
 *    the server's two-second grace and came back as `stale_state_version`,
 *    which reads as the game refusing a legal pick. Expiry now switches the
 *    surface to an explicit locked resolution state.
 *
 * 3. THE TIMEOUT COPY TELLS THE TRUTH. It used to read "Timeout drafts the best
 *    available player for you", which was false and was also an instruction to
 *    exploit it. See `TMW_TIMEOUT_CONSEQUENCE`.
 *
 * 4. THE EMPTY STATE DISTINGUISHES THREE DIFFERENT FACTS. One sentence -- "No
 *    eligible player matches that search." -- was printed when (a) the name was
 *    already drafted and the lock is GLOBAL across every roll, (b) a position
 *    filter was hiding them, or (c) they genuinely never played for this
 *    franchise in this decade. That is the whole of the "Dennis Rodman is
 *    missing from the Spurs pool" report: he is in the pool, and a Rodman taken
 *    off an earlier Pistons or Bulls roll is gone from it. Searching a drafted
 *    name now names the seat and the round that took them.
 *
 * NOTHING HERE DECIDES LEGALITY. Every legal-slot set comes from the server's
 * own `candidate_fits` verdict, and a rearrangement commits the server's own
 * `plan` verbatim. THE SEARCH BOX AND THE FILTER CHIPS ARE VIEW STATE ONLY:
 * they never reach a command, and the timeout fallback is resolved server-side
 * from the full feasible pool, so narrowing this list cannot change what an
 * expired turn drafts (unless the player has staged a choice -- see below).
 *
 * SELECTION IS NOT COMMITMENT (Pass 1).
 * ---------------------------------------
 * A candidate click and a slot click STAGE only, via `onStage` -- they no
 * longer draft. Two explicit affordances resolve a staged choice:
 * "Draft {name} at {slot}" commits it (`onPick`), "Cancel selection" drops it
 * (`onStage(null, null)`). This reverses the previous "click is the decision"
 * fix (see the old docstring on `select`, kept below for the incident it
 * closed), but stays safe against the SAME incident because staging is now
 * SERVER-VISIBLE: a timeout drafts the staged choice instead of the weaker
 * `autopick` fallback (see `mode._reduce_timeout`), so a player who staged
 * and then ran out of clock still gets exactly what they chose. What clicking
 * can no longer do is draft a player the user did not explicitly confirm.
 */
export default function PickOverlay({
  open,
  roll,
  roundNumber,
  pickNumber,
  totalRounds,
  candidates,
  roster,
  seats,
  yourSeatIndex,
  lockedEntries = [],
  stagedPick = null,
  deadlineAt,
  turnSeconds,
  busy,
  pendingKind = null,
  pendingSlots = [],
  onPick,
  onStage,
  onMove,
  onClose,
}: {
  open: boolean;
  roll: TmwRoll | null;
  roundNumber: number | null;
  pickNumber: number;
  totalRounds: number;
  candidates: TmwCandidate[];
  roster: TmwRoster | null;
  seats: ArenaSeatPublic[];
  yourSeatIndex: number | null;
  /** Every identity already off the board, for the empty state. */
  lockedEntries?: TmwLockEntry[];
  /** This seat's SERVER-VISIBLE staged choice for the current turn, or null.
   *  Hydrates local selection on mount/reconnect -- see the mount effect
   *  below. */
  stagedPick?: { player_slug: string; slot_type: TmwSlotType } | null;
  /** Local monotonic deadline; see `ArenaTimer`. */
  deadlineAt: number | null;
  turnSeconds: number;
  busy: boolean;
  /** Which exclusive command the room's lane currently holds, for the
   *  button that owns it to show its pending state. */
  pendingKind?: string | null;
  /** Slots whose card is an optimistic, not-yet-acknowledged placement. */
  pendingSlots?: readonly TmwSlotType[];
  /** COMMITS. Only ever called from an explicit "Draft {name} at {slot}"
   *  press. Resolves `true` when the server accepted the pick. */
  onPick: (candidate: TmwCandidate, slot: TmwSlotType) => Promise<boolean> | void;
  /** STAGES (or, with both arguments null, CLEARS). Never drafts -- see this
   *  module's docstring. Fired on every candidate/slot click so the server
   *  can prefer the staged choice if the clock runs out. */
  onStage: (candidate: TmwCandidate | null, slot: TmwSlotType | null) => void;
  /** Commit a rearrangement of the existing roster. The COMPLETE final
   *  assignment, slot -> player_slug, which is the only shape the server takes. */
  onMove: (placements: Record<string, string>) => Promise<boolean> | void;
  onClose: () => void;
}) {
  const headingId = useId();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<TmwSlotType[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [slot, setSlot] = useState<TmwSlotType | null>(null);
  /** The slot whose occupant the player is relocating, in `moving` mode. */
  const [movingFrom, setMovingFrom] = useState<TmwSlotType | null>(null);
  /**
   * WHICH DEADLINE EXPIRED, not a boolean.
   *
   * A `boolean` here was reset by the "fresh turn, fresh decision" effect
   * below, and lost the race every time: React runs a CHILD's effects before
   * its parent's, so `ArenaTimer` fired `onExpire` on mount for an
   * already-past deadline and this component then cleared the flag one effect
   * later. Storing the deadline the expiry belongs to makes the state
   * self-invalidating -- a new turn carries a new deadline, so a stale expiry
   * simply stops matching and nothing has to remember to clear it.
   */
  const [expiredDeadline, setExpiredDeadline] = useState<number | null>(null);
  /**
   * The deadline whose LAST-CALL WINDOW has also elapsed — the hard lock.
   *
   * Same self-invalidating shape as `expiredDeadline` and for the same reason.
   */
  const [lockedDeadline, setLockedDeadline] = useState<number | null>(null);
  /** The countdown has reached zero. The server may still accept a pick. */
  const lastCall = deadlineAt !== null && expiredDeadline === deadlineAt;
  /** The grace window is gone too. Nothing sent from here can land. */
  const expired = deadlineAt !== null && lockedDeadline === deadlineAt;
  const searchRef = useRef<HTMLInputElement | null>(null);

  // THE HARD LOCK IS ONE TIMER, ARMED BY EXPIRY. It is keyed to the deadline
  // that expired, so a new turn's deadline simply stops matching and the lock
  // releases itself — nothing has to remember to clear it.
  useEffect(() => {
    if (expiredDeadline === null) return;
    const at = expiredDeadline;
    const timer = window.setTimeout(() => setLockedDeadline(at), TMW_LAST_CALL_MS);
    return () => window.clearTimeout(timer);
  }, [expiredDeadline]);

  // A CLOSED OVERLAY HOLDS NO DECISION. `open` gates a `return null` below
  // these hooks, so this component stays mounted -- and used to keep a
  // half-made move alive across somebody else's whole turn, ready to be
  // rendered against a roster that had moved on. Clearing on close means the
  // surface can only ever re-open on a decision made in the turn it belongs
  // to; the mount/turn-change effect below then hydrates the server's own
  // staged choice, which is the only selection that legitimately survives.
  useEffect(() => {
    if (open) return;
    setSelected(null);
    setSlot(null);
    setMovingFrom(null);
  }, [open]);

  /** Clears local selection -- or, given a staged choice, HYDRATES it. */
  const reset = useCallback(
    (hydrate?: { player_slug: string; slot_type: TmwSlotType } | null) => {
      setQuery("");
      setFilters([]);
      setSelected(hydrate?.player_slug ?? null);
      setSlot(hydrate?.slot_type ?? null);
      setMovingFrom(null);
    },
    [],
  );

  // A fresh turn is a fresh decision. Resetting on the roll AND the pick number
  // means a player never returns to the clock with the previous round's search
  // still narrowing a different pool -- and never inherits a stale expiry.
  //
  // HYDRATED FROM `stagedPick` ON THAT SAME TRANSITION -- a mount (fresh page
  // load, reconnect) or a genuine turn change may find a choice this seat
  // already staged before a refresh, and it must render as still selected,
  // not blank. `stagedPick` is deliberately NOT a dependency here: it changes
  // as a SIDE EFFECT of `select`/`selectPlacementSlot` staging through the
  // server, and re-running this effect on every one of those round trips
  // would wipe the search box and position filters the player is actively
  // using mid-selection. Reading it only at mount/turn-change time is
  // correct because staging is already scoped server-side to the CURRENT
  // turn (cleared on any turn change, see `draft.py`'s `apply_pick`), so by
  // construction it can never belong to a different turn than the one this
  // effect just opened on.
  useEffect(() => {
    if (!open) return;
    reset(stagedPick);
    // Focus the search rather than the dialog: the first thing a drafter does
    // is look for a name, and landing on the input skips a tab for everyone
    // while still putting focus inside the dialog for a screen reader.
    const timer = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roll?.roll_id, pickNumber, reset]);

  // Escape backs out of the current selection before it closes the dialog: a
  // player who staged the wrong slot should not have to leave the room to undo
  // it. A turn you must resolve still has no cancel, which is why the last
  // Escape returns to the board rather than dismissing the clock.
  //
  // BACKING OUT OF A CANDIDATE SELECTION ALSO CLEARS THE SERVER'S STAGED
  // CHOICE. A move-in-progress (`movingFrom`) has no staged pick to clear --
  // rearranging never stages a draft.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (movingFrom !== null || selected !== null) {
        event.stopPropagation();
        if (selected !== null) onStage(null, null);
        setSelected(null);
        setSlot(null);
        setMovingFrom(null);
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onStage, movingFrom, selected]);

  const nameOf = useMemo(() => {
    const byslug = new Map<string, string>();
    for (const candidate of candidates) {
      byslug.set(candidate.player_slug, candidate.player_name);
    }
    for (const pick of Object.values(roster?.slots ?? {})) {
      if (pick) byslug.set(pick.player_slug, pick.player_name);
    }
    return (slug: string) => byslug.get(slug) ?? slug;
  }, [candidates, roster]);

  const searched = useMemo(() => searchCandidates(candidates, query), [candidates, query]);
  const shown = useMemo(
    () => filterCandidatesByPosition(searched, filters),
    [searched, filters],
  );
  const hiddenByFilter = searched.length - shown.length;

  // SEARCH ALSO LOOKS AT WHO IS ALREADY GONE. Not to offer them -- they are
  // unpickable -- but so the empty state can say WHY the name is not here.
  const locked = useMemo(
    () => lockedMatches(lockedEntries, query),
    [lockedEntries, query],
  );
  // THE TABLE STATE OF THIS ROLL: who has already taken a name from it.
  const taken = useMemo(
    () => takenThisRoll(lockedEntries, roundNumber, yourSeatIndex),
    [lockedEntries, roundNumber, yourSeatIndex],
  );

  const chosen = useMemo(
    () => candidates.find((c) => c.player_slug === selected) ?? null,
    [candidates, selected],
  );

  // -- what is legal right now ----------------------------------------------

  /**
   * THE CARD BEING MOVED, RESOLVED AGAINST THE AUTHORITATIVE ROSTER.
   *
   * THIS IS THE ROSTER-MOVE CRASH (P0), and the fix is the line below it.
   * `movingFrom` is a SLOT NAME held in local state; `movingPick` is whoever
   * the server currently says is standing in it, which can be nobody. `mode`
   * was derived from `movingFrom` alone -- so "moving" could be true while
   * `movingPick` was null -- and three places then dereferenced
   * `movingPick!.player_name`, throwing
   * `TypeError: Cannot read properties of null (reading 'player_name')`
   * out of render. React has no way to recover from that, so Next.js paints
   * "Application error: a client-side exception has occurred".
   *
   * The stale slot is easy to produce, because `open` gates a `return null`
   * BELOW these hooks: the overlay closing does not unmount the component, so
   * `movingFrom` survives every closed window and every authoritative roster
   * replacement. Start a move (Manu at SG), lose the turn to the clock, come
   * back next round after the source slot has been emptied -- by the move
   * itself, by a rearrangement made from the court between turns, or by the
   * timeout's own pick -- and the FIRST render of the reopened overlay throws,
   * before the "fresh turn, fresh decision" effect below has had a chance to
   * clear anything. (Effects run after render. They always did.)
   *
   * Deriving `mode` from the RESOLVED pick makes the invariant structural
   * rather than remembered: `mode === "moving"` now IMPLIES a non-null
   * `movingPick`, so there is nothing left to assert and no ordering to get
   * right. `movingFrom` is additionally self-healed below, so the board never
   * marks a source slot that no longer holds anyone.
   */
  const movingPick = movingFrom ? (roster?.slots[movingFrom] ?? null) : null;

  const placementSlots = useMemo<TmwSlotType[]>(
    () => (chosen ? placementOptionsFor(chosen) : []),
    [chosen],
  );

  const mode: PlacementMode =
    movingPick !== null ? "moving" : chosen !== null ? "placing" : "idle";
  /** `movingFrom` only while it still names an occupied slot -- see `movingPick`. */
  const activeMoveFrom = movingPick !== null ? movingFrom : null;

  // BOTH HALVES OF A SWAP ARE CHECKED. This used to filter on the moving
  // player's own positions only, so a destination whose occupant could not play
  // the source slot was offered as legal and refused by the server on commit.
  // `legalMoveTargets` validates the whole resulting assignment.
  const moveDestinations = useMemo<TmwSlotType[]>(
    () => (activeMoveFrom ? legalMoveTargets(roster, activeMoveFrom) : []),
    [roster, activeMoveFrom],
  );

  // A SLOT WHOSE OCCUPANT IS GONE IS NOT A MOVE IN PROGRESS. The render is
  // already safe (see `movingPick`); this drops the dead slot name so the
  // board stops marking it and the next click starts a real move.
  useEffect(() => {
    if (movingFrom !== null && movingPick === null) {
      setMovingFrom(null);
      setSlot(null);
    }
  }, [movingFrom, movingPick]);

  const legalSlots = mode === "moving" ? moveDestinations : placementSlots;
  const stagedSlot = mode === "idle" ? null : slot;

  /**
   * Which of your own players the current staging would relocate, and where to.
   *
   * For a placement this is the SERVER's plan, read off `fit.moves`. For a move
   * it is the single swap the click implies. Either way the annotation lands on
   * the slot it affects, which is what turns "fits after rearrangement" from a
   * label into an arrangement.
   */
  const vacating = useMemo<Record<string, TmwSlotType>>(() => {
    if (mode === "moving" && activeMoveFrom && slot) {
      const displaced = roster?.slots[slot] ?? null;
      return displaced
        ? { [slot]: activeMoveFrom, [activeMoveFrom]: slot }
        : { [activeMoveFrom]: slot };
    }
    if (mode === "placing" && chosen && slot) {
      const out: Record<string, TmwSlotType> = {};
      for (const move of chosen.fit.moves ?? []) {
        out[move.from_slot] = move.to_slot;
      }
      return out;
    }
    return {};
  }, [mode, activeMoveFrom, slot, roster, chosen]);

  const moveSummary = useMemo(() => {
    if (mode !== "placing" || !chosen) return [] as string[];
    return (chosen.fit.moves ?? []).map(
      (move) =>
        `${nameOf(move.player_slug)}: ${TMW_SLOT_LABELS[move.from_slot]} → ${TMW_SLOT_LABELS[move.to_slot]}`,
    );
  }, [mode, chosen, nameOf]);

  /**
   * Select a candidate. STAGES only — never commits.
   *
   * PASS 1 REVERSED THE PRIOR "click is the decision" FIX (kept here for the
   * incident it closed, gameplay-experience-polish 3.2): a player who
   * clicked a legal candidate and never separately pressed "Draft {name} at
   * {slot}" used to lose that pick to the server's timeout fallback exactly
   * as if nothing had been chosen (reported: Amar'e Stoudemire clicked,
   * Brevin Knight drafted by the fallback). That fix made the click itself
   * the submission. The new requirement is the opposite — an accidental
   * click must never irrevocably draft — so it is reversed here, but the
   * ORIGINAL INCIDENT DOES NOT REOPEN: `onStage` below makes the choice
   * server-visible the instant it is made, and a timeout now drafts THAT
   * instead of the weak `autopick` fallback (`mode._reduce_timeout`). The
   * player therefore still gets exactly what they selected if the clock
   * runs out, without the click having to be the draft.
   *
   * When the candidate has exactly one legal slot, that slot is also staged
   * immediately (there is no second decision to make) — but staged, not
   * committed; "Draft {name} at {slot}" still has to be pressed, or the
   * `<select>` fallback's own commit used, same as the multi-slot case.
   */
  const select = useCallback((candidate: TmwCandidate) => {
    // Selecting a candidate always cancels a move in progress: the two are
    // different intentions and the board can only stage one of them.
    setMovingFrom(null);
    setSelected(candidate.player_slug);
    const options = placementOptionsFor(candidate);
    if (options.length === 1) {
      setSlot(options[0]);
      if (!expired) onStage(candidate, options[0]);
      return;
    }
    setSlot(null);
  }, [expired, onStage]);

  /** The board's own slot click, while placing a multi-slot candidate:
   *  stages the pair server-side — never commits, see `select` above and
   *  this module's docstring. Only wired for `mode === "placing"`
   *  (drafting); a rearrange-mode slot click still only sets local state
   *  (`setSlot` via `onSelectSlot` below), since a move has its own
   *  explicit confirm step and never stages a draft. */
  const selectPlacementSlot = useCallback(
    (targetSlot: TmwSlotType) => {
      setSlot(targetSlot);
      if (chosen && !expired) onStage(chosen, targetSlot);
    },
    [chosen, expired, onStage],
  );

  /**
   * COMMIT A REARRANGEMENT — acknowledged locally in the same frame as the
   * press, reconciled against the server's answer.
   *
   * THE TRANSIENT STATE IS DROPPED BEFORE THE AWAIT, not after it. Holding a
   * slot name across a round trip is what kept a dead `movingFrom` alive long
   * enough to be rendered against a roster that had moved (see `movingPick`),
   * and it also meant the board sat in "moving" for the whole request while
   * the arrangement it described was already decided. `onMove` stages the new
   * arrangement in the room the instant it is called, so the roster the
   * player sees is the one they just asked for -- marked pending until the
   * authoritative snapshot replaces it, and rolled back by that same snapshot
   * if the server refuses.
   */
  const commitMove = useCallback(async () => {
    if (!activeMoveFrom || !slot || !roster) return false;
    const placements = placementsAfterMove(roster, activeMoveFrom, slot);
    setMovingFrom(null);
    setSlot(null);
    const outcome = await onMove(placements);
    return outcome !== false;
  }, [activeMoveFrom, slot, roster, onMove]);

  if (!open) return null;

  // `mode` already implies the operand each of these needs (`movingPick` for
  // "moving", `chosen` for "placing"); the redundant null checks are kept
  // because TypeScript narrows on them and the JSX below then needs no
  // assertion anywhere -- which is the whole point of the P0 fix.
  const canCommitPlacement = mode === "placing" && !!chosen && !!slot && !expired;
  const canCommitMove = mode === "moving" && !!movingPick && !!slot && !expired;

  return (
    <div className="tmw-overlay-scrim" data-testid="tmw-pick-overlay-scrim">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="tmw-pick-overlay"
        data-mode={mode}
        data-expired={expired ? "true" : "false"}
        className="tmw-overlay"
      >
        <header className="tmw-overlay-head">
          <div className="tmw-overlay-head-meta">
            <p className="tmw-overlay-round pk-numeral">
              Round {roundNumber ?? "—"} of {totalRounds} · pick {pickNumber} of{" "}
              {totalRounds * seats.length}
            </p>
            {/* THE ROLL IS THE REVEAL, INSIDE THE SURFACE THAT USES IT.
                When the human leads a round there is no room for a blocking
                ceremony -- the server clock is already running -- so the
                franchise x decade animates in here instead, with every control
                live from the first frame. See `WeaveSpinner`'s docstring. */}
            <h2 id={headingId} className="tmw-overlay-title" data-testid="tmw-overlay-roll">
              {roll ? (
                <>
                  <span className="tmw-overlay-franchise">{roll.franchise_display_name}</span>
                  <span className="tmw-overlay-decade">{roll.decade}</span>
                </>
              ) : (
                "Your pick"
              )}
            </h2>
            {/* THE RULE, AS TABLE STATE. Instead of a sentence about names
                being gone for every seat, the names that ARE gone from this
                roll, marked with the seat that took them -- or, when you
                open the roll, the fact that nobody has. The sentence
                survives for screen readers. */}
            <div
              className="tmw-overlay-taken"
              data-testid="tmw-overlay-taken"
              data-count={taken.length}
            >
              <span className="sr-only">
                Everyone drafts from this roll; once a name is taken it is gone for every seat.{" "}
                {taken.length === 0
                  ? "Nobody has drafted from this roll yet."
                  : `Taken so far: ${taken
                      .map((entry) =>
                        `${seatLabel(seats, entry.seatIndex)} took ${entry.playerName}${entry.slotType ? ` at ${TMW_SLOT_LABELS[entry.slotType] ?? entry.slotType}` : ""}`,
                      )
                      .join("; ")}.`}
              </span>
              {taken.length === 0 ? (
                <span className="tmw-overlay-taken-open" aria-hidden="true">
                  <span className="tmw-overlay-taken-label">You open this roll</span>
                  <span className="tmw-overlay-taken-hint">{seats.length} seats draft from it</span>
                </span>
              ) : (
                <span className="tmw-overlay-taken-list" aria-hidden="true">
                  <span className="tmw-overlay-taken-label">Taken this roll</span>
                  {taken.map((entry) => (
                    <span
                      key={entry.playerSlug}
                      className="tmw-overlay-taken-chip"
                      data-testid={`tmw-overlay-taken-${entry.seatIndex}`}
                      data-seat-accent={seatAccent(entry.seatIndex)}
                    >
                      <span className="tmw-overlay-taken-seat">{seatLabel(seats, entry.seatIndex)}</span>
                      <span className="tmw-overlay-taken-name">{entry.playerName}</span>
                      {entry.slotType ? <span className="tmw-overlay-taken-slot">{slotAbbrev(entry.slotType)}</span> : null}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </div>
          <ArenaTimer
            deadlineAt={deadlineAt}
            totalSeconds={turnSeconds}
            label="Your pick"
            consequence={TMW_TIMEOUT_CONSEQUENCE}
            yours
            onExpire={() => setExpiredDeadline(deadlineAt)}
            testId="tmw-overlay-clock"
          />
        </header>

        {/* TWO STATES AT ZERO, NOT ONE (TMW-11, TMW-D3).
            LAST CALL: the countdown has run out and the server's grace window
            has not. A pick sent from here still lands, so the panel stays live
            and says which state it is in.
            EXPIRED: the grace window is gone too. Now the panel stops
            pretending it can take an action — the sweep is committing the
            fallback and a command would come back `stale_state_version`. */}
        {expired || lastCall ? (
          <p
            className="tmw-overlay-expired"
            data-testid="tmw-overlay-expired"
            data-phase={expired ? "expired" : "last-call"}
            role="status"
          >
            <span className="tmw-overlay-expired-dot" aria-hidden="true" />
            {expired ? TMW_TIMEOUT_RESOLVING : TMW_LAST_CALL}
          </p>
        ) : null}

        <div className="tmw-overlay-body" aria-busy={expired || busy}>
          {/* LEFT: the pool. */}
          <div className="tmw-overlay-pool">
            <label className="tmw-overlay-search">
              <span className="sr-only">Search eligible players</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                disabled={expired}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${candidates.length} eligible players`}
                data-testid="tmw-pick-search"
                autoComplete="off"
              />
            </label>

            <div className="tmw-overlay-filters" role="group" aria-label="Filter by position">
              {TMW_SLOT_TYPES.map((option) => {
                const active = filters.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={active}
                    disabled={expired}
                    data-testid={`tmw-filter-${option}`}
                    className="tmw-filter-chip"
                    onClick={() =>
                      setFilters((current) =>
                        current.includes(option)
                          ? current.filter((value) => value !== option)
                          : [...current, option],
                      )
                    }
                  >
                    <span aria-hidden="true">{slotAbbrev(option)}</span>
                    <span className="sr-only">{TMW_SLOT_LABELS[option]}</span>
                  </button>
                );
              })}
              {filters.length > 0 && (
                <button
                  type="button"
                  className="tmw-filter-clear"
                  onClick={() => setFilters([])}
                  data-testid="tmw-filter-clear"
                  /* The last control in this panel that did not lock at zero.
                     It submits nothing, so it could not have changed an
                     outcome -- but a panel that is "locked" while one button
                     still responds is telling the player two things at once. */
                  disabled={expired}
                >
                  Clear
                </button>
              )}
            </div>

            <p className="tmw-overlay-count pk-numeral" data-testid="tmw-pool-count">
              {/* A FILTER NARROWS THE VIEW AND SAYS SO. Without this line a
                  filtered list is indistinguishable from a thin roll. */}
              Showing {shown.length} of {candidates.length} eligible
              {hiddenByFilter > 0 ? ` · ${hiddenByFilter} hidden by filters` : ""}
            </p>

            <ul className="tmw-overlay-list" data-testid="tmw-candidate-list">
              {shown.map((candidate) => {
                const disabled = expired || !candidate.selectable;
                const isSelected = selected === candidate.player_slug;
                return (
                  <li key={candidate.player_slug}>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={isSelected}
                      data-testid={`tmw-candidate-${candidate.player_slug}`}
                      data-fit={candidate.fit.state}
                      data-selected={isSelected ? "true" : "false"}
                      /* NO `.pk-lift`, NO `.pk-press`, AND THAT IS THE FIX.
                         Those two classes translate and scale the row, and the
                         element they move is the element receiving the pointer,
                         which on a 44px row in a dense list oscillates hover at
                         ~19Hz and drops clicks. The row's feedback is now
                         paint-only; see `.tmw-candidate` in three-man-weave.css
                         for the measurements. No `.pk-reveal` either: this list
                         re-filters on every keystroke in the search box, and a
                         staggered re-entry on each one would be strobing, not
                         choreography. */
                      className="tmw-candidate"
                      /* STAGING LANDS ON THE PRESS, NOT ON THE CLICK.
                         A `click` is only delivered when `mousedown` and
                         `mouseup` resolve to the same element, so any movement
                         under the cursor between them — a re-render, a
                         scroll, a neighbour resizing — silently swallows the
                         choice, and the player is left clicking a name that
                         will not highlight while the clock runs down. Pressing
                         is unambiguous and this action is purely local and
                         reversible: it stages a selection, it commits nothing.
                         `onClick` stays for keyboard and assistive technology
                         (which fire click with no pointer event), and `select`
                         is idempotent, so the pair cannot double-apply. */
                      onPointerDown={(event) => {
                        // `> 0` rather than `!== 0`: it excludes the secondary,
                        // middle and back buttons without also excluding the
                        // `-1` a pen/touch contact reports.
                        if (event.button > 0) return;
                        select(candidate);
                      }}
                      onClick={() => select(candidate)}
                    >
                      <PlayerAvatar
                        name={candidate.player_name}
                        imageUrl={candidate.headshot_url}
                        size={34}
                      />
                      <span className="tmw-candidate-body">
                        <span className="tmw-candidate-name">{candidate.player_name}</span>
                        <span className="tmw-candidate-meta">
                          {eligibilityLine(candidate)}
                        </span>
                        <span className="tmw-candidate-tags">
                          <span className="tmw-candidate-positions">
                            {positionsLine(candidate)}
                          </span>
                          <span className="tmw-candidate-fit" data-fit={candidate.fit.state}>
                            {fitLabel(candidate)}
                          </span>
                        </span>
                        {!candidate.selectable && candidate.fit.reason ? (
                          <span className="tmw-candidate-reason">
                            {candidate.fit.reason}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
              {shown.length === 0 && (
                <li className="tmw-overlay-empty" data-testid="tmw-pool-empty">
                  <EmptyPool
                    poolSize={candidates.length}
                    hiddenByFilter={hiddenByFilter}
                    query={query}
                    locked={locked}
                    seats={seats}
                    yourSeatIndex={yourSeatIndex}
                    roll={roll}
                    onClearFilters={() => setFilters([])}
                  />
                </li>
              )}
            </ul>
          </div>

          {/* RIGHT: your roster, and it is the control. */}
          <div className="tmw-overlay-place">
            <div className="tmw-overlay-place-head">
              <h3 className="tmw-overlay-subhead">Your roster</h3>
              <p className="tmw-place-instruction" data-testid="tmw-place-instruction">
                {mode === "placing"
                  ? `Click a highlighted slot to place ${chosen?.player_name ?? "this player"}.`
                  : mode === "moving"
                    ? `Click where ${movingPick?.player_name ?? "this card"} should go.`
                    : "Choose a player on the left, or click one of your own cards to move it."}
              </p>
            </div>

            <PlacementBoard
              roster={roster}
              mode={mode}
              legalSlots={legalSlots}
              stagedSlot={stagedSlot}
              incomingName={mode === "placing" ? (chosen?.player_name ?? null) : null}
              movingFrom={activeMoveFrom}
              vacating={vacating}
              pendingSlots={pendingSlots}
              onSelectSlot={mode === "placing" ? selectPlacementSlot : setSlot}
              onStartMove={(from) => {
                setSelected(null);
                setMovingFrom(from);
                setSlot(null);
              }}
            />

            {mode === "idle" ? (
              <p className="tmw-place-hint" data-testid="tmw-place-hint">
                Nothing staged yet. Choosing a player on the left lights up every
                slot they could legally take.
              </p>
            ) : null}

            {/* THE REARRANGEMENT, SPELLED OUT. Each line names a real player and
                two real slots, and the same information is already drawn on the
                board above — this is the readable receipt of it, not the only
                place it appears. */}
            {mode === "placing" &&
            chosen?.fit.state === TMW_FITS_AFTER_REARRANGEMENT &&
            moveSummary.length > 0 ? (
              <div className="tmw-place-rearrange" data-testid="tmw-rearrange-note">
                <p className="tmw-place-rearrange-head">
                  This pick rearranges your roster. Both happen together:
                </p>
                <ol className="tmw-place-rearrange-list">
                  <li>
                    {chosen.player_name} → {TMW_SLOT_LABELS[slot ?? placementSlots[0]]}
                  </li>
                  {moveSummary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              </div>
            ) : null}

            {mode === "placing" && placementSlots.length > 1 ? (
              // THE ACCESSIBLE FALLBACK, and explicitly labelled as one. A
              // compact select may exist; it must not be the principal
              // interaction. Every option here is a slot the board above
              // already offers as a button.
              <label className="tmw-place-choice">
                <span>Or choose a slot from a list</span>
                <select
                  value={slot ?? ""}
                  disabled={expired}
                  data-testid="tmw-place-select"
                  onChange={(event) => {
                    const nextSlot = event.target.value as TmwSlotType;
                    setSlot(nextSlot);
                    if (chosen && !expired) onStage(chosen, nextSlot);
                  }}
                >
                  <option value="" disabled>
                    Select a slot…
                  </option>
                  {placementSlots.map((option) => (
                    <option key={option} value={option}>
                      {TMW_SLOT_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="tmw-place-actions">
              {mode === "moving" ? (
                <>
                  <GameActionButton
                    data-testid="tmw-move-confirm"
                    disabled={!canCommitMove || busy}
                    pending={pendingKind === "rearrange"}
                    pendingLabel="Moving…"
                    onAction={commitMove}
                  >
                    {/* THE LABEL NAMES WHAT IS MISSING, not just the verb. */}
                    {canCommitMove && slot
                      ? `Move ${movingPick?.player_name ?? "this card"} to ${TMW_SLOT_LABELS[slot]}`
                      : `Choose where ${movingPick?.player_name ?? "this card"} goes`}
                  </GameActionButton>
                  <PeakV2SecondaryAction
                    type="button"
                    data-testid="tmw-move-cancel"
                    onClick={() => {
                      setMovingFrom(null);
                      setSlot(null);
                    }}
                  >
                    Cancel move
                  </PeakV2SecondaryAction>
                </>
              ) : mode === "placing" ? (
                <>
                  {/* ONE PRESS, ONE DRAFT. `GameActionButton` acknowledges the
                      press on pointer-down, shows "Drafting…" for exactly as
                      long as the command is in flight, refuses a second
                      press meanwhile, and locks on acceptance. The command
                      itself is queued behind any in-flight stage request by
                      the room's lane rather than dropped -- the root cause of
                      "the first click does nothing". */}
                  <GameActionButton
                    data-testid="tmw-confirm-pick"
                    disabled={!canCommitPlacement || busy}
                    pending={pendingKind === "pick"}
                    pendingLabel="Drafting…"
                    onAction={() =>
                      canCommitPlacement && chosen && slot ? onPick(chosen, slot) : false
                    }
                  >
                    {/* THE BUTTON NAMES THE WHOLE DECISION — who, and where. */}
                    {slot
                      ? `Draft ${chosen?.player_name ?? "this player"} at ${TMW_SLOT_LABELS[slot]}`
                      : `Choose a slot for ${chosen?.player_name ?? "this player"}`}
                  </GameActionButton>
                  <PeakV2SecondaryAction
                    type="button"
                    data-testid="tmw-cancel-pick"
                    onClick={() => {
                      // CHANGE SELECTION: clears the server's staged choice
                      // too, not just local state — otherwise a player who
                      // visibly cancelled could still time out into the
                      // player they just backed away from.
                      onStage(null, null);
                      setSelected(null);
                      setSlot(null);
                    }}
                  >
                    Cancel selection
                  </PeakV2SecondaryAction>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * WHY THE LIST IS EMPTY — three genuinely different facts, three answers.
 *
 * See this module's docstring for the Dennis Rodman report this exists for.
 */
function EmptyPool({
  poolSize,
  hiddenByFilter,
  query,
  locked,
  seats,
  yourSeatIndex,
  roll,
  onClearFilters,
}: {
  poolSize: number;
  hiddenByFilter: number;
  query: string;
  locked: TmwLockEntry[];
  seats: ArenaSeatPublic[];
  yourSeatIndex: number | null;
  roll: TmwRoll | null;
  onClearFilters: () => void;
}) {
  const reason = emptyPoolReason({ poolSize, hiddenByFilter, query, locked });

  if (reason.kind === "locked") {
    return (
      <span data-testid="tmw-pool-empty-locked" className="tmw-overlay-empty-body">
        <strong>Already off the board.</strong>{" "}
        {reason.entries.map((entry, index) => (
          <span key={entry.playerSlug}>
            {index > 0 ? " " : ""}
            {entry.playerName} was drafted by{" "}
            {entry.seatIndex === yourSeatIndex
              ? "you"
              : seatLabel(seats, entry.seatIndex)}{" "}
            in round {entry.roundNumber}.
          </span>
        ))}{" "}
        A name taken by any seat is gone for every seat, in every franchise and
        decade.
      </span>
    );
  }

  if (reason.kind === "filtered") {
    return (
      <span data-testid="tmw-pool-empty-filtered" className="tmw-overlay-empty-body">
        <strong>Hidden by your position filter.</strong> {reason.hidden}{" "}
        {reason.hidden === 1 ? "player matches" : "players match"} your search but
        none play the positions you selected.{" "}
        <PeakV2SecondaryAction type="button" size="sm" onClick={onClearFilters}>
          Clear filters
        </PeakV2SecondaryAction>
      </span>
    );
  }

  if (reason.kind === "not_eligible" && reason.query) {
    return (
      <span data-testid="tmw-pool-empty-ineligible" className="tmw-overlay-empty-body">
        <strong>Not eligible for this roll.</strong> No undrafted player matching “
        {reason.query}” recorded a season for{" "}
        {rollScopeLine(roll)}.
      </span>
    );
  }

  return (
    <span data-testid="tmw-pool-empty-none" className="tmw-overlay-empty-body">
      <strong>Nothing left on this roll.</strong> Every eligible name has already
      been drafted.
    </span>
  );
}

/** Every slot this candidate could legally land on, in canonical order.
 *
 * For a direct fit that is the open slots they play. For a rearrangement it is
 * the ONE slot the server's plan puts them in — a client that offered other
 * slots would be offering arrangements the server never validated. */
function placementOptionsFor(candidate: TmwCandidate): TmwSlotType[] {
  if (candidate.fit.direct_slots.length) {
    return TMW_SLOT_TYPES.filter((slot) => candidate.fit.direct_slots.includes(slot));
  }
  const landing = landingSlot(candidate);
  return landing ? [landing] : [];
}
