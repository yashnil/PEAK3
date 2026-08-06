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
import type { TmwCandidate } from "@/lib/three-man-weave-state";
import {
  eligibilityLine,
  filterCandidatesByPosition,
  fitLabel,
  landingSlot,
  searchCandidates,
  slotAbbrev,
} from "@/lib/three-man-weave-state";
import ArenaTimer from "@/components/shared/ArenaTimer";
import PlacementBoard, { type PlacementMode } from "./PlacementBoard";

/**
 * The draft room: choose a player, then click where they go.
 *
 * WHAT THIS SURFACE USED TO BE, AND WHY EVERY PART OF IT CHANGED
 * ---------------------------------------------------------------
 * Manual acceptance found a dialog that technically contained every required
 * concept and implemented each one in its least usable form. Selecting a player
 * opened a list; placement happened through a small `<select>`; the confirm and
 * cancel actions rendered as plain text (`btn-primary` and `btn-secondary` were
 * used by four surfaces and defined in NO stylesheet); the roster was a
 * non-interactive list; "Fits after rearrangement" was a sentence rather than
 * something you could act on; and the right-hand half of the dialog — the half
 * where the most important interaction should have lived — was usually empty.
 *
 * The rewrite is one idea: THE ROSTER IS THE CONTROL.
 *
 *   1. Pick a candidate on the left. It highlights.
 *   2. Every legal slot on the right lights up; illegal ones dim.
 *   3. Click a slot. The card stages there, and any player the arrangement
 *      would move shows its destination ON ITS OWN SLOT.
 *   4. A real primary button commits: "Draft Kevin Garnett at PF".
 *
 * A `<select>` survives as an explicitly-labelled accessible fallback, which
 * PART 3 permits — "a compact destination select may exist as an accessible
 * fallback, but must not be the principal interaction". It is rendered after
 * the board, is not the default path, and every option it offers is a slot the
 * board already offers as a button.
 *
 * MOVES ARE PART OF THE SAME SURFACE. Clicking one of your own placed cards
 * with nothing selected starts a move; its legal destinations light up the same
 * way. Previously a move required closing the overlay, finding the card on the
 * board behind it, and opening a second dialog — a flow no player discovered.
 *
 * WHAT IS STILL NOT SHOWN BEFORE A PICK: any score, any band, any ordering that
 * encodes one. The list arrives in the server's own alphabetical order and
 * search reorders it only by what was typed. Knowing who these players were is
 * the mode.
 *
 * NOTHING HERE DECIDES LEGALITY. Every legal-slot set comes from the server's
 * own `candidate_fits` verdict, and a rearrangement commits the server's own
 * `plan` verbatim. A client re-derivation could differ, and would then be
 * refused at the exact moment a player expected a pick to land.
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
  // still narrowing a different pool.
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

  const chosen = useMemo(
    () => candidates.find((c) => c.player_slug === selected) ?? null,
    [candidates, selected],
  );

  // -- what is legal right now ----------------------------------------------

  const movingPick = movingFrom ? (roster?.slots[movingFrom] ?? null) : null;

  const moveDestinations = useMemo<TmwSlotType[]>(() => {
    if (!movingPick || !movingFrom) return [];
    // The bench accepts anyone with a recognised position; a starter slot
    // accepts a player who plays it. `positions` is the model's own answer and
    // is on every pick payload, so no rule is re-derived here — and the server
    // re-validates the whole final assignment regardless.
    const plays = new Set(movingPick.positions ?? []);
    return TMW_SLOT_TYPES.filter(
      (candidate) =>
        candidate !== movingFrom && (candidate === "bench_1" || plays.has(candidate)),
    );
  }, [movingPick, movingFrom]);

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
    const placements: Record<string, string> = {};
    for (const slotType of TMW_SLOT_TYPES) {
      const occupant = roster.slots[slotType];
      if (occupant) placements[slotType] = occupant.player_slug;
    }
    const displaced = roster.slots[slot];
    placements[slot] = movingPick.player_slug;
    if (displaced) placements[movingFrom] = displaced.player_slug;
    else delete placements[movingFrom];
    onMove(placements);
    setMovingFrom(null);
    setSlot(null);
  }, [movingFrom, slot, roster, movingPick, onMove]);

  if (!open) return null;

  const canCommitPlacement = mode === "placing" && !!chosen && !!slot;
  const canCommitMove = mode === "moving" && !!movingPick && !!slot;

  return (
    <div className="tmw-overlay-scrim" data-testid="tmw-pick-overlay-scrim">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="tmw-pick-overlay"
        data-mode={mode}
        className="tmw-overlay"
      >
        {/* DESKTOP TOP BAR (PART 6): round, pick, the rolled constraint, whose
            turn it is, and a large timer — all in one strip so a player never
            has to hunt for the state of their own turn. */}
        <header className="tmw-overlay-head">
          <div className="tmw-overlay-head-meta">
            <p className="tmw-overlay-round">
              Round {roundNumber ?? "—"} of {totalRounds} · pick {pickNumber} of{" "}
              {totalRounds * seats.length}
            </p>
            <h2 id={headingId} className="tmw-overlay-title">
              {roll ? `${roll.franchise_display_name} · ${roll.decade}` : "Your pick"}
            </h2>
            <p className="tmw-overlay-seat">
              You are seat{" "}
              {yourSeatIndex === null ? "—" : String.fromCharCode(65 + yourSeatIndex)}
              {" · "}
              {orderHint(seats.length)}
            </p>
          </div>
          <ArenaTimer
            deadlineAt={deadlineAt}
            totalSeconds={turnSeconds}
            label="YOUR PICK"
            consequence="Timeout drafts the best available player for you."
            yours
            testId="tmw-overlay-clock"
          />
        </header>

        <div className="tmw-overlay-body">
          {/* LEFT: the pool. */}
          <div className="tmw-overlay-pool">
            <label className="tmw-overlay-search">
              <span className="sr-only">Search eligible players</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
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
                >
                  Clear
                </button>
              )}
            </div>

            <p className="tmw-overlay-count" data-testid="tmw-pool-count">
              {/* A FILTER NARROWS THE VIEW AND SAYS SO. Without this line a
                  filtered list is indistinguishable from a thin roll. */}
              Showing {shown.length} of {candidates.length} eligible
              {hiddenByFilter > 0 ? ` · ${hiddenByFilter} hidden by filters` : ""}
            </p>

            <ul className="tmw-overlay-list" data-testid="tmw-candidate-list">
              {shown.map((candidate) => {
                const disabled = candidate.fit.state === TMW_NO_LEGAL_ARRANGEMENT;
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
                      className="tmw-candidate"
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
                      <span className="tmw-candidate-name">{candidate.player_name}</span>
                      <span className="tmw-candidate-meta">{eligibilityLine(candidate)}</span>
                      <span className="tmw-candidate-tags">
                        <span className="tmw-candidate-positions">
                          {candidate.positions.join(" / ") || "—"}
                        </span>
                        <span className="tmw-candidate-fit" data-fit={candidate.fit.state}>
                          {fitLabel(candidate)}
                        </span>
                      </span>
                      {disabled && candidate.fit.reason && (
                        <span className="tmw-candidate-reason">{candidate.fit.reason}</span>
                      )}
                    </button>
                  </li>
                );
              })}
              {shown.length === 0 && (
                <li className="tmw-overlay-empty" data-testid="tmw-pool-empty">
                  No eligible player matches that search.
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

            {/* THE IDLE STATE SITS UNDER THE SLOTS, NOT AT THE FLOOR OF THE
                PANEL. The action row is `margin-top: auto` so a live decision's
                buttons pin to the bottom -- correct while there IS one, and the
                reason the review capture showed a column of dead space between
                six empty slots and a single line of guidance. With nothing
                selected there is no action to pin, so the guidance follows the
                thing it is about. */}
            {mode === "idle" ? (
              <p className="tmw-place-hint" data-testid="tmw-place-hint">
                Nothing staged yet. Choosing a player on the left lights up
                every slot they could legally take.
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
              // THE ACCESSIBLE FALLBACK, and explicitly labelled as one. PART 3
              // permits a compact select to exist; it forbids it being the
              // principal interaction. Every option here is a slot the board
              // above already offers as a button.
              <label className="tmw-place-choice">
                <span>Or choose a slot from a list</span>
                <select
                  value={slot ?? ""}
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
                    {/* THE LABEL NAMES WHAT IS MISSING, not just the verb. A
                        disabled primary reading "Move Aaron Wiggins" says
                        nothing about why it is disabled -- and a 45%-opacity
                        yellow fill reads as a murky colour rather than as an
                        inert control. Matches the placement branch, which
                        already said "Choose a slot for X". */}
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
                    {/* THE BUTTON NAMES THE WHOLE DECISION — who, and where.
                        "Draft Kevin Garnett" left the slot implicit at exactly
                        the moment the slot was the thing being chosen. */}
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

function orderHint(seatCount: number): string {
  return seatCount === 3 ? "snake order A-B-C, then C-B-A" : "snake order";
}
