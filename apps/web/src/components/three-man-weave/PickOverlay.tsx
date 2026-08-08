"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  ArenaSeatPublic,
  TmwRoll,
  TmwRoster,
  TmwSlotType,
} from "@/types/three-man-weave";
import {
  TMW_FITS_AFTER_REARRANGEMENT,
  TMW_NO_LEGAL_ARRANGEMENT,
  TMW_SLOT_LABELS,
  TMW_SLOT_TYPES,
} from "@/types/three-man-weave";
import type { TmwCandidate, TmwLockEntry } from "@/lib/three-man-weave-state";
import {
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
  seatLabel,
  slotAbbrev,
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
 * expired turn drafts.
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
  deadlineAt,
  turnSeconds,
  busy,
  onPick,
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
  /** Local monotonic deadline; see `ArenaTimer`. */
  deadlineAt: number | null;
  turnSeconds: number;
  busy: boolean;
  onPick: (candidate: TmwCandidate, slot: TmwSlotType) => void;
  /** Commit a rearrangement of the existing roster. The COMPLETE final
   *  assignment, slot -> player_slug, which is the only shape the server takes. */
  onMove: (placements: Record<string, string>) => void;
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
  const expired = deadlineAt !== null && expiredDeadline === deadlineAt;
  const searchRef = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(() => {
    setQuery("");
    setFilters([]);
    setSelected(null);
    setSlot(null);
    setMovingFrom(null);
  }, []);

  // A fresh turn is a fresh decision. Resetting on the roll AND the pick number
  // means a player never returns to the clock with the previous round's search
  // still narrowing a different pool -- and never inherits a stale expiry.
  useEffect(() => {
    if (!open) return;
    reset();
    // Focus the search rather than the dialog: the first thing a drafter does
    // is look for a name, and landing on the input skips a tab for everyone
    // while still putting focus inside the dialog for a screen reader.
    const timer = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open, roll?.roll_id, pickNumber, reset]);

  // Escape backs out of the current selection before it closes the dialog: a
  // player who staged the wrong slot should not have to leave the room to undo
  // it. A turn you must resolve still has no cancel, which is why the last
  // Escape returns to the board rather than dismissing the clock.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (movingFrom !== null || selected !== null) {
        event.stopPropagation();
        setSelected(null);
        setSlot(null);
        setMovingFrom(null);
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, movingFrom, selected]);

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

  const chosen = useMemo(
    () => candidates.find((c) => c.player_slug === selected) ?? null,
    [candidates, selected],
  );

  // -- what is legal right now ----------------------------------------------

  const movingPick = movingFrom ? (roster?.slots[movingFrom] ?? null) : null;

  // BOTH HALVES OF A SWAP ARE CHECKED. This used to filter on the moving
  // player's own positions only, so a destination whose occupant could not play
  // the source slot was offered as legal and refused by the server on commit.
  // `legalMoveTargets` validates the whole resulting assignment.
  const moveDestinations = useMemo<TmwSlotType[]>(
    () => (movingFrom ? legalMoveTargets(roster, movingFrom) : []),
    [roster, movingFrom],
  );

  const placementSlots = useMemo<TmwSlotType[]>(
    () => (chosen ? placementOptionsFor(chosen) : []),
    [chosen],
  );

  const mode: PlacementMode =
    movingFrom !== null ? "moving" : chosen !== null ? "placing" : "idle";
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
    if (mode === "moving" && movingFrom && slot) {
      const displaced = roster?.slots[slot] ?? null;
      return displaced ? { [slot]: movingFrom, [movingFrom]: slot } : { [movingFrom]: slot };
    }
    if (mode === "placing" && chosen && slot) {
      const out: Record<string, TmwSlotType> = {};
      for (const move of chosen.fit.moves ?? []) {
        out[move.from_slot] = move.to_slot;
      }
      return out;
    }
    return {};
  }, [mode, movingFrom, slot, roster, chosen]);

  const moveSummary = useMemo(() => {
    if (mode !== "placing" || !chosen) return [] as string[];
    return (chosen.fit.moves ?? []).map(
      (move) =>
        `${nameOf(move.player_slug)}: ${TMW_SLOT_LABELS[move.from_slot]} → ${TMW_SLOT_LABELS[move.to_slot]}`,
    );
  }, [mode, chosen, nameOf]);

  const commitMove = useCallback(() => {
    if (!movingFrom || !slot || !roster || !movingPick) return;
    onMove(placementsAfterMove(roster, movingFrom, slot));
    setMovingFrom(null);
    setSlot(null);
  }, [movingFrom, slot, roster, movingPick, onMove]);

  if (!open) return null;

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
            <p className="tmw-overlay-seat">
              Everyone drafts from this roll · once a name is taken it is gone for
              every seat
            </p>
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

        {/* THE LOCKED RESOLUTION STATE (TMW-11). At zero the panel stops
            pretending it can still take an action: the server's sweep is
            already committing the fallback, and a click landing here would come
            back as `stale_state_version`. */}
        {expired ? (
          <p className="tmw-overlay-expired" data-testid="tmw-overlay-expired" role="status">
            <span className="tmw-overlay-expired-dot" aria-hidden="true" />
            {TMW_TIMEOUT_RESOLVING}
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
                const disabled =
                  expired || candidate.fit.state === TMW_NO_LEGAL_ARRANGEMENT;
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
                      /* A candidate row is a card you are choosing between
                         under a clock, so it responds to the pointer AND to
                         the press. No `.pk-reveal` here on purpose: this list
                         re-filters on every keystroke in the search box, and a
                         staggered re-entry on each one would be strobing, not
                         choreography. */
                      className="tmw-candidate pk-lift pk-press"
                      onClick={() => {
                        // Selecting a candidate always cancels a move in
                        // progress: the two are different intentions and the
                        // board can only stage one of them.
                        setMovingFrom(null);
                        setSelected(candidate.player_slug);
                        // Stage the obvious destination immediately, so a
                        // single-slot candidate is one click from committed.
                        const options = placementOptionsFor(candidate);
                        setSlot(options.length === 1 ? options[0] : null);
                      }}
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
                        {candidate.fit.state === TMW_NO_LEGAL_ARRANGEMENT &&
                        candidate.fit.reason ? (
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
                  ? `Click a highlighted slot to place ${chosen!.player_name}.`
                  : mode === "moving"
                    ? `Click where ${movingPick!.player_name} should go.`
                    : "Choose a player on the left, or click one of your own cards to move it."}
              </p>
            </div>

            <PlacementBoard
              roster={roster}
              mode={mode}
              legalSlots={legalSlots}
              stagedSlot={stagedSlot}
              incomingName={mode === "placing" ? (chosen?.player_name ?? null) : null}
              movingFrom={movingFrom}
              vacating={vacating}
              onSelectSlot={setSlot}
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
                  onChange={(event) => setSlot(event.target.value as TmwSlotType)}
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
                  <button
                    type="button"
                    className="btn-primary"
                    data-testid="tmw-move-confirm"
                    disabled={!canCommitMove || busy}
                    data-loading={busy ? "true" : "false"}
                    onClick={commitMove}
                  >
                    {/* THE LABEL NAMES WHAT IS MISSING, not just the verb. */}
                    {busy
                      ? "Moving…"
                      : canCommitMove
                        ? `Move ${movingPick!.player_name} to ${TMW_SLOT_LABELS[slot!]}`
                        : `Choose where ${movingPick!.player_name} goes`}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    data-testid="tmw-move-cancel"
                    onClick={() => {
                      setMovingFrom(null);
                      setSlot(null);
                    }}
                  >
                    Cancel move
                  </button>
                </>
              ) : mode === "placing" ? (
                <>
                  <button
                    type="button"
                    className="btn-primary"
                    data-testid="tmw-confirm-pick"
                    disabled={!canCommitPlacement || busy}
                    data-loading={busy ? "true" : "false"}
                    onClick={() => canCommitPlacement && onPick(chosen!, slot!)}
                  >
                    {/* THE BUTTON NAMES THE WHOLE DECISION — who, and where. */}
                    {busy
                      ? "Drafting…"
                      : slot
                        ? `Draft ${chosen!.player_name} at ${TMW_SLOT_LABELS[slot]}`
                        : `Choose a slot for ${chosen!.player_name}`}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    data-testid="tmw-cancel-pick"
                    onClick={() => {
                      setSelected(null);
                      setSlot(null);
                    }}
                  >
                    Cancel selection
                  </button>
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
        <button type="button" className="btn-secondary" onClick={onClearFilters}>
          Clear filters
        </button>
      </span>
    );
  }

  if (reason.kind === "not_eligible" && reason.query) {
    return (
      <span data-testid="tmw-pool-empty-ineligible" className="tmw-overlay-empty-body">
        <strong>Not eligible for this roll.</strong> No undrafted player matching “
        {reason.query}” recorded a season for{" "}
        {roll ? `the ${roll.franchise_display_name} in the ${roll.decade}` : "this roll"}.
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
