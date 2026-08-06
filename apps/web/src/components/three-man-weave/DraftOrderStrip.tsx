"use client";
import type { ArenaSeatPublic } from "@/types/three-man-weave";
import type { TmwTurnSlot } from "@/lib/three-man-weave-state";

/**
 * The draft timeline: round groups, names, and where the snake turns around.
 *
 * WHAT THIS REPLACES. The previous strip was eighteen 20×20 pixel squares each
 * containing a seat NUMBER, in a horizontally-scrolling row, with the round
 * label rendered at 9px. Manual acceptance called it "tiny and visually
 * detached from the game", and the substantive part of that is not the size: a
 * numbered square tells you nothing about WHO, so reading the order meant
 * holding a seat-index-to-name mapping in your head while a clock ran. PART 11
 * asks for "round groups, participant name or initial, completed picks,
 * current pick, next pick, upcoming direction reversal, animated active
 * marker".
 *
 * So each round is a labelled group, each turn carries an INITIAL (or "You")
 * rather than an index, the NEXT pick is marked as well as the current one, and
 * a round whose direction differs from the one before it carries a reversal
 * glyph. The snake's deliberate asymmetry — seat C picks last in round 1 and
 * first in round 2 — is a rule a player should see coming rather than discover.
 *
 * THE ORDER IS SHOWN IN FULL, INCLUDING TURNS NOT YET TAKEN, and that is not a
 * hidden-information leak: the A-B-C / C-B-A snake is a published rule, fixed
 * before the match starts and identical in every match. What is hidden is which
 * franchise and decade each future round will roll — and that is not here,
 * because it does not exist yet.
 *
 * THE CLOCK IS NOT HERE ANY MORE. It was a `secondsRemaining` prop, which meant
 * this whole strip reconciled once a second for the life of the match. It lives
 * in `ArenaTimer` beside the controls; this component now re-renders only when
 * the authoritative order does.
 */
export default function DraftOrderStrip({
  order,
  seats,
  yourSeatIndex,
}: {
  order: TmwTurnSlot[];
  seats: ArenaSeatPublic[];
  yourSeatIndex: number | null;
}) {
  const rounds = [...new Set(order.map((slot) => slot.roundNumber))];
  const activeIndex = order.findIndex((slot) => slot.active);
  const nextIndex = activeIndex >= 0 ? activeIndex + 1 : -1;

  function nameOf(seatIndex: number): string {
    return (
      seats.find((seat) => seat.seat_index === seatIndex)?.display_name ??
      `Seat ${seatIndex + 1}`
    );
  }

  /** A short, unambiguous token: "You", or the participant's first initial. */
  function tokenOf(seatIndex: number): string {
    if (seatIndex === yourSeatIndex) return "You";
    const name = nameOf(seatIndex).trim();
    return name.charAt(0).toUpperCase() || String(seatIndex + 1);
  }

  /** Does this round run in the opposite direction to the one before it? */
  function reverses(roundNumber: number): boolean {
    if (roundNumber <= 1) return false;
    const previous = order.filter((slot) => slot.roundNumber === roundNumber - 1);
    const current = order.filter((slot) => slot.roundNumber === roundNumber);
    if (!previous.length || !current.length) return false;
    return previous[0].seatIndex !== current[0].seatIndex;
  }

  return (
    // `min-w-0` is load-bearing, not tidying. This section is a flex item, and
    // a flex item's default `min-width: auto` lets it grow to its content, so
    // the strip pushed the whole document sideways on a 390px phone even though
    // the list itself scrolls. The list clips only if its ancestors agree to be
    // narrower than it.
    <section
      data-testid="tmw-draft-order"
      aria-labelledby="tmw-order-heading"
      className="tmw-order min-w-0 max-w-full"
    >
      <h2 id="tmw-order-heading" className="tmw-order-heading">
        Draft order · snake
      </h2>

      {/* `position: relative` on the list is the fix for a real mobile
          overflow, and the reason is not obvious: each turn chip carries an
          `.sr-only` label, and the house `.sr-only` is `position: absolute`. An
          absolutely-positioned descendant is clipped by its CONTAINING BLOCK,
          not by the nearest scroll container — so with no positioned ancestor,
          the off-screen labels of later rounds escaped this list entirely and
          stretched the document 160px sideways on a 390px phone. The class
          carries it; see `.tmw-order-list`. */}
      <ol className="tmw-order-list" data-testid="tmw-order-list">
        {rounds.map((roundNumber) => (
          <li key={roundNumber} className="tmw-order-round">
            <span className="tmw-order-round-label" aria-hidden="true">
              R{roundNumber}
              {reverses(roundNumber) ? (
                <span
                  className="tmw-order-reverse"
                  data-testid={`tmw-order-reverse-${roundNumber}`}
                  title="The order reverses here"
                >
                  ↻
                </span>
              ) : null}
            </span>
            <span className="tmw-order-turns">
              {order
                .filter((slot) => slot.roundNumber === roundNumber)
                .map((slot) => {
                  const position = order.indexOf(slot);
                  const isNext = position === nextIndex;
                  return (
                    <span
                      key={`${slot.roundNumber}-${slot.seatIndex}`}
                      data-testid={`tmw-order-${slot.roundNumber}-${slot.seatIndex}`}
                      data-active={slot.active ? "true" : "false"}
                      data-next={isNext ? "true" : "false"}
                      data-done={slot.done ? "true" : "false"}
                      data-you={slot.seatIndex === yourSeatIndex ? "true" : "false"}
                      className="tmw-order-turn"
                      title={`Round ${slot.roundNumber}: ${nameOf(slot.seatIndex)}`}
                    >
                      <span aria-hidden="true">{tokenOf(slot.seatIndex)}</span>
                      <span className="sr-only">
                        {`${nameOf(slot.seatIndex)}, round ${slot.roundNumber}${
                          slot.active
                            ? ", picking now"
                            : isNext
                              ? ", next"
                              : slot.done
                                ? ", done"
                                : ", upcoming"
                        }`}
                      </span>
                    </span>
                  );
                })}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
