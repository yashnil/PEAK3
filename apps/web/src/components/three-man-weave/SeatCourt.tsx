"use client";
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
  slotAbbrev,
} from "@/lib/three-man-weave-state";
import SeatClock from "./SeatClock";

/**
 * One participant's roster court. Rendered for ALL THREE seats, always.
 *
 * Every roster is public the whole way through -- a draft is open information,
 * and reading what your opponents still need is the entire strategy. These
 * three panels are the CENTRE of the screen rather than a footer below the
 * candidate list, which is what the previous layout made them: a player had to
 * scroll past the thing they were choosing from to see the thing they were
 * choosing for.
 *
 * REUSES CourtBuilder's court, not a new one. The `.court-panel-wrapper` /
 * `.roster-board*` classes in `globals.css` are the shipped visual system: PG
 * at the point, SG and SF on the wings, PF and C inside, with the paint, arc
 * and rim drawn behind. The CSS is reused rather than the `CourtLayout`
 * component itself, deliberately: `CourtLayout` is typed against
 * `CourtSlotPublic` from `@/types/perfect-season`, so importing it would mean
 * either casting a Three-Man Weave pick into another game's shape or editing a
 * component the 82-0 surface depends on.
 *
 * WHAT THE HEADER CARRIES, and why each part earns its space: the participant
 * name, the seat LETTER (the snake is positional -- seat A opens, seat C takes
 * the turn at every round boundary -- so which seat you are is a rule and not a
 * label), whether the occupant is a person or a bot, the roster count, this
 * seat's own clock, and the ordinal edge band.
 *
 * NO EXACT TOTAL APPEARS HERE MID-DRAFT. The edge band is an ordinal reading of
 * an unfinished roster and is marked live; a partial total would be a number on
 * a different scale from the final one that players would reasonably compare.
 */
export default function SeatCourt({
  roster,
  seat,
  isYou,
  isOnTurn,
  justPickedSlug,
  edge,
  secondsRemaining,
  onMoveRequest,
}: {
  roster: TmwRoster;
  seat: ArenaSeatPublic | undefined;
  isYou: boolean;
  isOnTurn: boolean;
  justPickedSlug?: string | null;
  edge?: TmwEdgeBand | null;
  /** Only meaningful for the seat on the clock; null otherwise. */
  secondsRemaining?: number | null;
  /** Opens the rearrangement control for one placed player. Absent for a seat
   * that is not yours, because you may only move your own roster. */
  onMoveRequest?: (slot: TmwSlotType) => void;
}) {
  const name = seat?.display_name ?? `Seat ${roster.seat_index + 1}`;
  const filled = filledCount(roster);
  const seatLetter = String.fromCharCode(65 + roster.seat_index);

  return (
    <section
      data-testid={`tmw-seat-court-${roster.seat_index}`}
      data-on-turn={isOnTurn ? "true" : "false"}
      data-is-you={isYou ? "true" : "false"}
      data-edge={edge ?? "none"}
      aria-labelledby={`tmw-seat-heading-${roster.seat_index}`}
      className="tmw-seat"
    >
      <header className="tmw-seat-head">
        <div className="tmw-seat-identity">
          <span className="tmw-seat-letter" aria-hidden="true">
            {seatLetter}
          </span>
          <h3 id={`tmw-seat-heading-${roster.seat_index}`} className="tmw-seat-name">
            {name}
            <span className="sr-only">
              {`, seat ${roster.seat_index + 1} of 3, ${
                seat?.is_bot ? "bot" : "human"
              }${isYou ? ", you" : ""}`}
            </span>
          </h3>
          <span className="tmw-seat-kind" aria-hidden="true">
            {isYou ? "You" : seat?.is_bot ? "Bot" : "Human"}
          </span>
        </div>

        <div className="tmw-seat-meters">
          <SeatClock
            seatIndex={roster.seat_index}
            isOnTurn={isOnTurn}
            isBot={!!seat?.is_bot}
            secondsRemaining={secondsRemaining ?? null}
          />
          <span
            data-testid={`tmw-seat-progress-${roster.seat_index}`}
            className="tmw-seat-count"
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

      <div
        className="court-panel-wrapper"
        style={{
          // The turn spotlight is a ring on the court itself, layered over the
          // wrapper's own border so a seat that is both yours and on-turn still
          // reads as on-turn first.
          boxShadow: isOnTurn ? "inset 0 0 0 2px var(--peak-accent)" : undefined,
        }}
      >
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
                <SlotCard
                  slotType={slotType}
                  pick={roster.slots[slotType] ?? null}
                  highlight={roster.slots[slotType]?.player_slug === justPickedSlug}
                  onMoveRequest={onMoveRequest}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="roster-board-bench-row">
          <div className="roster-board-bench-label">Bench</div>
          <div className="roster-board-bench">
            {benchSlots(roster).map(({ slotType, pick }) => (
              <SlotCard
                key={slotType}
                slotType={slotType}
                pick={pick}
                highlight={pick?.player_slug === justPickedSlug}
                onMoveRequest={onMoveRequest}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SlotCard({
  slotType,
  pick,
  highlight,
  onMoveRequest,
}: {
  slotType: TmwSlotType;
  pick: TmwPick | null;
  highlight: boolean;
  onMoveRequest?: (slot: TmwSlotType) => void;
}) {
  const movable = !!pick && !!onMoveRequest;
  const body = (
    <>
      <span className="tmw-slot-tag">
        <span aria-hidden="true">{slotAbbrev(slotType)}</span>
        <span className="sr-only">{TMW_SLOT_LABELS[slotType]}</span>
      </span>
      {pick ? (
        <>
          <span className="tmw-slot-name">{pick.player_name}</span>
          <span data-testid={`tmw-slot-season-${slotType}`} className="tmw-slot-meta">
            {/* THE SCORING SEASON AND ITS TEAM. Both, always: without them a
                2000s-roll Shaq showing 2000-01 rather than his better 1999-00
                looks like a bug. There is no "via trade" chip -- the team and
                the season already say where the card comes from, and the chip
                appeared beside most stars, which made it noise rather than
                disclosure. The traded-SCORE note survives, on the receipt,
                because that one is a claim about the number. */}
            <span className="tmw-slot-season">
              {pick.scoring_card
                ? `${pick.scoring_card.season} ${pick.scoring_card.team_id}`
                : "—"}
            </span>
            <span className="tmw-slot-score">
              {pick.scoring_card ? pick.scoring_card.prime_score.toFixed(1) : "—"}
            </span>
          </span>
        </>
      ) : (
        <span className="tmw-slot-open">Open</span>
      )}
    </>
  );

  if (movable && pick) {
    return (
      <button
        type="button"
        data-testid={`tmw-slot-${slotType}`}
        data-filled="true"
        data-just-picked={highlight ? "true" : "false"}
        className="tmw-slot tmw-slot--movable"
        onClick={() => onMoveRequest?.(slotType)}
        aria-label={`Move ${pick.player_name} out of ${TMW_SLOT_LABELS[slotType]}`}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      data-testid={`tmw-slot-${slotType}`}
      data-filled={pick ? "true" : "false"}
      data-just-picked={highlight ? "true" : "false"}
      className="tmw-slot"
    >
      {body}
    </div>
  );
}
