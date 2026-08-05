"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  rearrangementSummary,
  searchCandidates,
  slotAbbrev,
} from "@/lib/three-man-weave-state";

/**
 * The selection surface, opened when the human is on the clock.
 *
 * A DIALOG ABOVE THE BOARD, NOT INSTEAD OF IT. The three-roster board stays
 * mounted and visible behind this panel on desktop, because the pick is a
 * decision ABOUT those rosters. The previous layout put the candidate list
 * first and the rosters below the fold, which inverted that.
 *
 * WHAT IT SHOWS BEFORE A PICK, and what it deliberately does not:
 *
 *   name, franchise seasons in the rolled decade, natural positions, the fit
 *   verdict for this seat, and -- when a rearrangement is needed -- exactly
 *   which of your own players would move and where.
 *
 * NO SCORE. Not the exact one, not a band, not an ordering that encodes it. The
 * list arrives in the server's own alphabetical order and search reorders it
 * only by what was typed. This is the mode's whole game: you are meant to know
 * who these players were, not to read down a leaderboard.
 *
 * NOTHING IS HIDDEN EITHER. Every eligible undrafted identity is present,
 * including the ones this seat cannot use -- marked, disabled, and carrying the
 * server's reason. A player needs to see that the roll offered someone good and
 * that their own roster shape is why they cannot take them. Position filters
 * narrow the VIEW and say how many they removed; they never become the pool.
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
  secondsRemaining,
  busy,
  onPick,
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
  secondsRemaining: number | null;
  busy: boolean;
  onPick: (candidate: TmwCandidate, slot: TmwSlotType) => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<TmwSlotType[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [slot, setSlot] = useState<TmwSlotType | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // A fresh turn is a fresh decision. Resetting on the roll AND the pick number
  // means a player never returns to the clock with the previous round's search
  // still narrowing a different pool.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setFilters([]);
    setSelected(null);
    setSlot(null);
    // Focus the search rather than the dialog: the first thing a drafter does
    // is look for a name, and landing on the input skips a tab for everyone
    // while still putting focus inside the dialog for a screen reader.
    const timer = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open, roll?.roll_id, pickNumber]);

  // Escape closes only when closing is legal -- the parent decides that by
  // passing `onClose`. A turn you must resolve has no cancel.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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

  const searched = useMemo(
    () => searchCandidates(candidates, query),
    [candidates, query],
  );
  const shown = useMemo(
    () => filterCandidatesByPosition(searched, filters),
    [searched, filters],
  );
  const hiddenByFilter = searched.length - shown.length;

  const chosen = candidates.find((c) => c.player_slug === selected) ?? null;
  const placement = chosen ? (slot ?? landingSlot(chosen)) : null;
  const slotOptions = chosen ? placementOptionsFor(chosen) : [];
  const moves = chosen ? rearrangementSummary(chosen, nameOf) : null;

  if (!open) return null;

  return (
    <div className="tmw-overlay-scrim" data-testid="tmw-pick-overlay-scrim">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="tmw-pick-overlay"
        className="tmw-overlay"
      >
        <header className="tmw-overlay-head">
          <div>
            <p className="tmw-overlay-round">
              Round {roundNumber ?? "—"} of {totalRounds} · pick {pickNumber}
            </p>
            <h2 id={headingId} className="tmw-overlay-title">
              {roll ? `${roll.franchise_display_name} · ${roll.decade}` : "Your pick"}
            </h2>
            <p className="tmw-overlay-seat">
              You are seat{" "}
              {yourSeatIndex === null
                ? "—"
                : String.fromCharCode(65 + yourSeatIndex)}
              {" · "}
              {orderHint(seats.length)}
            </p>
          </div>
          <div className="tmw-overlay-clock" data-testid="tmw-overlay-clock">
            <span className="tmw-overlay-clock-value">
              {secondsRemaining === null
                ? "—"
                : Math.max(0, Math.ceil(secondsRemaining))}
            </span>
            <span className="tmw-overlay-clock-unit">sec</span>
          </div>
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
                return (
                  <li key={candidate.player_slug}>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected === candidate.player_slug}
                      data-testid={`tmw-candidate-${candidate.player_slug}`}
                      data-fit={candidate.fit.state}
                      className="tmw-candidate"
                      onClick={() => {
                        setSelected(candidate.player_slug);
                        setSlot(null);
                      }}
                    >
                      <span className="tmw-candidate-name">
                        {candidate.player_name}
                      </span>
                      <span className="tmw-candidate-meta">
                        {eligibilityLine(candidate)}
                      </span>
                      <span className="tmw-candidate-tags">
                        <span className="tmw-candidate-positions">
                          {candidate.positions.join(" / ") || "—"}
                        </span>
                        <span
                          className="tmw-candidate-fit"
                          data-fit={candidate.fit.state}
                        >
                          {fitLabel(candidate)}
                        </span>
                      </span>
                      {disabled && candidate.fit.reason && (
                        <span className="tmw-candidate-reason">
                          {candidate.fit.reason}
                        </span>
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

          {/* RIGHT: your roster and the placement this pick would make. */}
          <div className="tmw-overlay-place">
            <h3 className="tmw-overlay-subhead">Your roster</h3>
            <ul className="tmw-place-slots" data-testid="tmw-place-slots">
              {TMW_SLOT_TYPES.map((slotType) => {
                const occupant = roster?.slots[slotType] ?? null;
                const incoming = placement === slotType;
                const moved = chosen?.fit.moves?.find(
                  (move) => move.from_slot === slotType,
                );
                return (
                  <li
                    key={slotType}
                    data-testid={`tmw-place-${slotType}`}
                    data-incoming={incoming ? "true" : "false"}
                    data-vacating={moved ? "true" : "false"}
                    className="tmw-place-slot"
                  >
                    <span className="tmw-place-tag">{slotAbbrev(slotType)}</span>
                    <span className="tmw-place-body">
                      {incoming && chosen ? (
                        <strong className="tmw-place-incoming">
                          {chosen.player_name}
                        </strong>
                      ) : occupant ? (
                        <span>{occupant.player_name}</span>
                      ) : (
                        <span className="tmw-place-open">Open</span>
                      )}
                      {moved && (
                        <span className="tmw-place-move">
                          → {slotAbbrev(moved.to_slot)}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>

            {chosen ? (
              <div className="tmw-place-confirm">
                {slotOptions.length > 1 && (
                  <label className="tmw-place-choice">
                    <span>Place at</span>
                    <select
                      value={placement ?? ""}
                      data-testid="tmw-place-select"
                      onChange={(event) =>
                        setSlot(event.target.value as TmwSlotType)
                      }
                    >
                      {slotOptions.map((option) => (
                        <option key={option} value={option}>
                          {TMW_SLOT_LABELS[option]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {chosen.fit.state === TMW_FITS_AFTER_REARRANGEMENT && moves && (
                  <p className="tmw-place-rearrange" data-testid="tmw-rearrange-note">
                    Needs a rearrangement: {moves}. Both happen together.
                  </p>
                )}

                <div className="tmw-place-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    data-testid="tmw-confirm-pick"
                    disabled={busy || !placement}
                    onClick={() => placement && onPick(chosen, placement)}
                  >
                    {busy ? "Drafting…" : `Draft ${chosen.player_name}`}
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
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <p className="tmw-place-hint" data-testid="tmw-place-hint">
                Choose a player to see where they would go.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Every slot this candidate could legally land on, in canonical order.
 *
 * For a direct fit that is the open slots they play. For a rearrangement it is
 * the ONE slot the server's plan puts them in -- a client that offered other
 * slots would be offering arrangements the server never validated. */
function placementOptionsFor(candidate: TmwCandidate): TmwSlotType[] {
  if (candidate.fit.direct_slots.length) {
    return TMW_SLOT_TYPES.filter((slot) =>
      candidate.fit.direct_slots.includes(slot),
    );
  }
  const landing = landingSlot(candidate);
  return landing ? [landing] : [];
}

function orderHint(seatCount: number): string {
  return seatCount === 3 ? "snake order A-B-C, then C-B-A" : "snake order";
}
