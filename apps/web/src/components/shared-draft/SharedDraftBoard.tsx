"use client";

/**
 * The shared pool, as five position columns, and the two rosters.
 *
 * A card has exactly one of four states and says which in WORDS as well as
 * styling: open to you, open but your slot there is filled, drafted by you, or
 * taken by the opponent. A taken card stays on the board, locked, so the
 * denial is visible rather than the card simply vanishing.
 *
 * NO SCORE IS READ HERE while the draft is live -- the view has none to read.
 */

import { Check, Lock } from "lucide-react";

import type {
  SharedDraftCard,
  SharedDraftSeatPublic,
  SharedDraftSlot,
} from "@/types/shared-draft";

export type CardState = "open" | "filled" | "mine" | "theirs";

export function cardState(card: SharedDraftCard, you: number | null, openPositions: readonly string[]): CardState {
  if (card.drafted_by !== null) return card.drafted_by === you ? "mine" : "theirs";
  return openPositions.includes(card.position) ? "open" : "filled";
}

export function SharedDraftPool({
  cards,
  slots,
  you,
  openPositions,
  legal,
  selected,
  onSelect,
  opponentName,
}: {
  cards: SharedDraftCard[];
  slots: readonly SharedDraftSlot[];
  you: number | null;
  openPositions: readonly string[];
  /** Cards you may draft this instant; empty when it is not your pick. */
  legal: readonly number[];
  selected: number | null;
  onSelect: (cardIndex: number) => void;
  opponentName: string;
}) {
  const remaining = cards.filter((c) => c.drafted_by === null).length;
  return (
    <section className="sdraft-pool" aria-label="The shared pool" data-testid="sdraft-pool">
      <header className="sdraft-pool-head">
        <h2 className="sdraft-side-title">Shared pool</h2>
        <p className="sdraft-pool-count" data-testid="sdraft-pool-count">
          <span className="pk-numeral">{remaining}</span> of {cards.length} left
        </p>
      </header>
      <div className="sdraft-columns">
        {slots.map((slot) => {
          const column = cards.filter((c) => c.position === slot);
          return (
            <div key={slot} className="sdraft-column" role="group" aria-label={`${slot} cards`} data-slot={slot}>
              <p className="sdraft-column-label">{slot}</p>
              <ul className="sdraft-column-cards">
                {column.map((card) => {
                  const state = cardState(card, you, openPositions);
                  const pickable = legal.includes(card.card_index);
                  const isSelected = selected === card.card_index;
                  const status =
                    state === "mine"
                      ? `Yours · pick ${card.pick_number}`
                      : state === "theirs"
                        ? `${opponentName} · pick ${card.pick_number}`
                        : state === "filled"
                          ? `Your ${slot} is set`
                          : null;
                  return (
                    <li key={card.card_index}>
                      <button
                        type="button"
                        className="sdraft-card"
                        data-state={state}
                        data-selected={isSelected ? "true" : undefined}
                        aria-pressed={pickable ? isSelected : undefined}
                        aria-disabled={!pickable}
                        onClick={() => (pickable ? onSelect(card.card_index) : undefined)}
                        data-testid={`sdraft-card-${card.card_index}`}
                        aria-label={`${card.player_name}, ${slot}, ${card.peak_season} peak season${status ? `. ${status}` : pickable ? ". Available" : ""}`}
                      >
                        <span className="sdraft-card-name">{card.player_name}</span>
                        <span className="sdraft-card-meta">
                          <span className="pk-numeral">{card.peak_season}</span>
                          {card.team ? <span> · {card.team}</span> : null}
                        </span>
                        {status ? (
                          <span className="sdraft-card-status">
                            {state === "mine" ? <Check size={12} aria-hidden="true" /> : null}
                            {state === "theirs" ? <Lock size={12} aria-hidden="true" /> : null}
                            <span className="sdraft-card-status-text">{status}</span>
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SharedDraftRoster({
  seat,
  cards,
  slots,
  label,
  isYou,
  onClock,
  testId,
}: {
  seat: SharedDraftSeatPublic;
  cards: SharedDraftCard[];
  slots: readonly SharedDraftSlot[];
  label: string;
  isYou: boolean;
  onClock: boolean;
  testId: string;
}) {
  return (
    <section
      className="sdraft-roster"
      data-you={isYou ? "true" : undefined}
      data-on-clock={onClock ? "true" : undefined}
      aria-label={`${label}'s roster`}
      data-testid={testId}
    >
      <header className="sdraft-roster-head">
        <h2 className="sdraft-side-title">{label}</h2>
        <p className="sdraft-roster-count">
          {onClock ? <span className="sdraft-onclock">On the clock</span> : null}
          <span className="pk-numeral">{seat.picks_made}</span>/5
        </p>
      </header>
      <ol className="sdraft-slots">
        {slots.map((slot) => {
          const index = seat.roster[slot];
          const card = index === null ? null : cards[index];
          return (
            <li key={slot} className="sdraft-slot" data-filled={card ? "true" : undefined}>
              <span className="sdraft-slot-pos">{slot}</span>
              {card ? (
                <span className="sdraft-slot-player">
                  <span className="sdraft-slot-name">{card.player_name}</span>
                  <span className="sdraft-slot-season pk-numeral">{card.peak_season}</span>
                </span>
              ) : (
                <span className="sdraft-slot-open">Open</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The ten picks of the snake, as a compact rail: whose each pick is, which
 *  is live, and what each finished pick took. */
export function SharedDraftOrder({
  order,
  pickIndex,
  you,
  opponentName,
  live,
}: {
  order: number[];
  pickIndex: number;
  you: number | null;
  opponentName: string;
  live: boolean;
}) {
  return (
    <ol className="sdraft-order" aria-label="Pick order" data-testid="sdraft-order">
      {order.map((seat, index) => {
        const state = index < pickIndex ? "done" : index === pickIndex && live ? "live" : "next";
        const who = seat === you ? "You" : opponentName;
        return (
          <li
            key={index}
            className="sdraft-order-pip"
            data-state={state}
            data-you={seat === you ? "true" : undefined}
            aria-current={state === "live" ? "step" : undefined}
            aria-label={`Pick ${index + 1}: ${who}${state === "done" ? ", made" : state === "live" ? ", on the clock" : ""}`}
          >
            <span className="pk-numeral">{index + 1}</span>
            <span className="sdraft-order-who">{seat === you ? "You" : "Opp"}</span>
          </li>
        );
      })}
    </ol>
  );
}
