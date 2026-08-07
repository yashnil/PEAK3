"use client";
import type { DragEvent } from "react";

import type {
  ArenaSeatPublic,
  TmwEdgeBand,
  TmwPick,
  TmwRoster,
  TmwSlotType,
} from "@/types/three-man-weave";
import { TMW_SLOT_LABELS, TMW_STARTER_SLOTS } from "@/types/three-man-weave";
import {
  TMW_EDGE_LABELS,
  benchSlots,
  filledCount,
  positionsLine,
  seatAccent,
  slotAbbrev,
} from "@/lib/three-man-weave-state";
import PlayerAvatar from "@/components/court/PlayerAvatar";

/**
 * ONE PARTICIPANT'S TEAM. Rendered for ALL THREE seats, always.
 *
 * Every roster is public the whole way through -- a draft is open information,
 * and reading what your opponents still need is the entire strategy. These
 * three panels are the CENTRE of the screen rather than a footer below a
 * candidate list.
 *
 * WHAT TMW-09 CHANGED. Three near-identical gold-outlined forms became three
 * teams: each seat carries its OWN accent (`--seat-1/2/3-*`, gold / blue /
 * emerald, defined once in globals.css with per-theme inks) rather than the
 * single brand gold plus a letter glyph, `data-is-you` finally has styling
 * attached to it, the surface is layered instead of outlined, the court art
 * sits behind the text as texture, the bench is attached to the court, and each
 * card is a headshot + name + position + score unit rather than a text row.
 *
 * THE HEADSHOT IS THE SHARED PRIMITIVE (SHARED-03). `PlayerAvatar` is the one
 * player-image component in the product and it is imported, not reimplemented.
 * In production it renders its designed medallion for essentially every
 * historical player, because the ESPN manifest resolves ~15% of identities and
 * the external-asset gate defaults off -- so the medallion is the shipping path
 * and these cards are laid out for it rather than around it.
 *
 * MOVES HAPPEN HERE NOW (TMW-10). Rearranging your own roster used to be
 * possible only inside the draft modal, i.e. only during your own turn. Your
 * own court is interactive between turns: drag a card onto another slot, or
 * click/tap it and then a highlighted destination, or do the same from the
 * keyboard. Only your own court is interactive; the other two are read-only,
 * because a control that does nothing when pressed is worse than no control.
 *
 * NOTHING HERE DECIDES LEGALITY ON ITS OWN TERMS. `legalTargets` is computed by
 * the caller from `moveRejection`, which reads the model's own per-player
 * position list, and the server re-validates the complete final assignment. A
 * "someone else can move, therefore this player can go anywhere" rule exists
 * nowhere in this path.
 */
export default function SeatCourt({
  roster,
  seat,
  isYou,
  isOnTurn,
  justPickedSlug,
  edge,
  interactive = false,
  selectedSlot = null,
  legalTargets = [],
  busy = false,
  onPickUp,
  onDropOn,
}: {
  roster: TmwRoster;
  seat: ArenaSeatPublic | undefined;
  isYou: boolean;
  isOnTurn: boolean;
  justPickedSlug?: string | null;
  edge?: TmwEdgeBand | null;
  /** Your own court, in a live match: cards can be picked up and dropped. */
  interactive?: boolean;
  /** The slot whose occupant is currently picked up, if any. */
  selectedSlot?: TmwSlotType | null;
  /** Slots that occupant may legally land on. */
  legalTargets?: readonly TmwSlotType[];
  busy?: boolean;
  onPickUp?: (slot: TmwSlotType) => void;
  /** A drop, a click or an Enter on a destination. The caller decides whether
   *  it is legal and says so -- an illegal target is still a real target, so
   *  the rejection can be immediate and specific rather than a dead click. */
  onDropOn?: (slot: TmwSlotType) => void;
}) {
  const name = seat?.display_name ?? `Seat ${roster.seat_index + 1}`;
  const filled = filledCount(roster);
  const accent = seatAccent(roster.seat_index);
  const legal = new Set(legalTargets);

  function cardFor(slotType: TmwSlotType) {
    return (
      <SlotCard
        key={slotType}
        slotType={slotType}
        pick={roster.slots[slotType] ?? null}
        highlight={roster.slots[slotType]?.player_slug === justPickedSlug}
        interactive={interactive && !busy}
        picked={selectedSlot === slotType}
        moving={selectedSlot !== null}
        legal={legal.has(slotType)}
        onPickUp={onPickUp}
        onDropOn={onDropOn}
      />
    );
  }

  return (
    <section
      data-testid={`tmw-seat-court-${roster.seat_index}`}
      data-on-turn={isOnTurn ? "true" : "false"}
      data-is-you={isYou ? "true" : "false"}
      data-seat-accent={accent}
      data-interactive={interactive ? "true" : "false"}
      data-edge={edge ?? "none"}
      aria-labelledby={`tmw-seat-heading-${roster.seat_index}`}
      className="tmw-seat"
    >
      <header className="tmw-seat-head">
        <div className="tmw-seat-identity">
          <span className="tmw-seat-crest" aria-hidden="true">
            {name.trim().charAt(0).toUpperCase() || String(roster.seat_index + 1)}
          </span>
          <h3 id={`tmw-seat-heading-${roster.seat_index}`} className="tmw-seat-name">
            {name}
            <span className="sr-only">
              {`, seat ${roster.seat_index + 1} of 3, ${
                seat?.is_bot ? "bot" : "human"
              }${isYou ? ", you" : ""}`}
            </span>
          </h3>
          {/* SEAT IDENTITY IS NEVER COLOUR ALONE. The accent is the fast
              signal; this word is the accessible one. */}
          <span className="tmw-seat-kind" aria-hidden="true">
            {isYou ? "You" : seat?.is_bot ? "Bot" : "Human"}
          </span>
        </div>

        <div className="tmw-seat-meters">
          {isOnTurn ? (
            <span
              className="tmw-seat-onclock"
              data-testid={`tmw-seat-onclock-${roster.seat_index}`}
            >
              On the clock
            </span>
          ) : null}
          <span
            data-testid={`tmw-seat-progress-${roster.seat_index}`}
            className="tmw-seat-count pk-numeral"
          >
            <span aria-hidden="true">{filled}/6</span>
            <span className="sr-only">{`${filled} of 6 slots filled`}</span>
          </span>
        </div>
      </header>

      {edge && (
        <p
          data-testid={`tmw-seat-edge-${roster.seat_index}`}
          data-band={edge}
          className="tmw-seat-edge"
        >
          {TMW_EDGE_LABELS[edge]}
        </p>
      )}

      <div className="court-panel-wrapper" data-on-turn={isOnTurn ? "true" : "false"}>
        <div className="roster-board">
          <div className="roster-board-sideline" aria-hidden="true" />
          <div className="roster-board-court-markings" aria-hidden="true">
            <div className="roster-board-ft-circle" />
            <div className="roster-board-paint" />
            <div className="roster-board-arc" />
            <div className="roster-board-rim" />
          </div>
          <div className="roster-board-starters">
            {TMW_STARTER_SLOTS.map((slotType) => (
              <div key={slotType} className={`roster-board-slot-${slotType}`}>
                {cardFor(slotType)}
              </div>
            ))}
          </div>
        </div>
        {/* THE BENCH IS ATTACHED TO THE COURT, not floating under it. */}
        <div className="roster-board-bench-row">
          <div className="roster-board-bench-label">Bench</div>
          <div className="roster-board-bench">
            {benchSlots(roster).map(({ slotType }) => cardFor(slotType))}
          </div>
        </div>
      </div>

      {interactive ? (
        <p className="tmw-seat-movehint" data-testid={`tmw-seat-movehint-${roster.seat_index}`}>
          {selectedSlot
            ? "Choose a highlighted slot, or press Escape to cancel."
            : "Drag a card, or select one, to rearrange your roster."}
        </p>
      ) : null}
    </section>
  );
}

/**
 * ONE SLOT. A headshot, a name, a position and a score.
 *
 * INTERACTIVE ONLY ON YOUR OWN COURT IN A LIVE MATCH, and then it is a real
 * `<button>` so the keyboard and the accessibility tree agree with what the eye
 * sees. Everywhere else it is a `<div>`: a card that looks pressable on two
 * opponents' boards and does nothing when pressed is offering an interaction it
 * cannot honour.
 */
function SlotCard({
  slotType,
  pick,
  highlight,
  interactive,
  picked,
  moving,
  legal,
  onPickUp,
  onDropOn,
}: {
  slotType: TmwSlotType;
  pick: TmwPick | null;
  highlight: boolean;
  interactive: boolean;
  picked: boolean;
  moving: boolean;
  legal: boolean;
  onPickUp?: (slot: TmwSlotType) => void;
  onDropOn?: (slot: TmwSlotType) => void;
}) {
  const body = (
    <>
      <span className="tmw-slot-tag">
        <span aria-hidden="true">{slotAbbrev(slotType)}</span>
        <span className="sr-only">{TMW_SLOT_LABELS[slotType]}</span>
      </span>
      {pick ? (
        <>
          <PlayerAvatar name={pick.player_name} size={30} />
          <span className="tmw-slot-body">
            <span className="tmw-slot-name">{pick.player_name}</span>
            <span data-testid={`tmw-slot-season-${slotType}`} className="tmw-slot-meta">
              {/* THE SCORING SEASON AND ITS TEAM. Both, always: without them a
                  2000s-roll Shaq showing 2000-01 rather than his better 1999-00
                  looks like a bug. */}
              <span className="tmw-slot-season pk-numeral">
                {pick.scoring_card
                  ? `${pick.scoring_card.season} ${pick.scoring_card.team_id}`
                  : "—"}
              </span>
              <span className="tmw-slot-positions">{positionsLine(pick)}</span>
            </span>
          </span>
          <span className="tmw-slot-score score-number">
            {pick.scoring_card ? pick.scoring_card.prime_score.toFixed(1) : "—"}
          </span>
        </>
      ) : (
        <span className="tmw-slot-open">Open</span>
      )}
    </>
  );

  const shared = {
    "data-testid": `tmw-slot-${slotType}`,
    "data-filled": pick ? "true" : "false",
    "data-just-picked": highlight ? "true" : "false",
    "data-picked-up": picked ? "true" : "false",
    "data-legal": moving && legal ? "true" : "false",
    "data-moving": moving ? "true" : "false",
  };

  if (!interactive || (!pick && !moving)) {
    return (
      <div {...shared} className="tmw-slot">
        {body}
      </div>
    );
  }

  // A drop is permitted on EVERY slot while a card is in hand, including the
  // illegal ones. `dragover` that does not `preventDefault` swallows the drop
  // event entirely, and a drag that simply snaps back teaches nothing -- the
  // handler answers with the specific rule instead.
  function allowDrop(event: DragEvent<HTMLButtonElement>) {
    if (moving) event.preventDefault();
  }

  return (
    <button
      type="button"
      {...shared}
      className="tmw-slot tmw-slot--interactive"
      // Kept `true` for the whole drag rather than flipped off once the card is
      // in hand: mutating `draggable` on the element mid-gesture is exactly the
      // kind of thing browsers disagree about, and picking a DIFFERENT card up
      // mid-move is a legitimate thing to do (`pickUp` simply re-points).
      draggable={!!pick}
      aria-pressed={picked}
      aria-label={
        moving
          ? legal
            ? `Move here: ${TMW_SLOT_LABELS[slotType]}${pick ? `, swapping with ${pick.player_name}` : ", currently open"}`
            : `${TMW_SLOT_LABELS[slotType]}: not a legal destination`
          : `Rearrange ${pick!.player_name}, currently at ${TMW_SLOT_LABELS[slotType]}`
      }
      onDragStart={() => onPickUp?.(slotType)}
      onDragOver={allowDrop}
      onDrop={(event) => {
        event.preventDefault();
        onDropOn?.(slotType);
      }}
      onClick={() => (moving ? onDropOn?.(slotType) : onPickUp?.(slotType))}
    >
      {body}
    </button>
  );
}
