"use client";
import type { ArenaSeatPublic } from "@/types/three-man-weave";
import type { TmwTurnSlot } from "@/lib/three-man-weave-state";

/**
 * The draft order, and whose turn it is.
 *
 * THE ORDER IS SHOWN IN FULL, INCLUDING TURNS NOT YET TAKEN. That is not a
 * hidden-information leak: the A-B-C / C-B-A snake is a published RULE, fixed
 * before the match starts and identical in every match. What is hidden is
 * which franchise and decade each future round will roll — and that is not
 * here, because it does not exist yet.
 *
 * Showing the whole order is also what makes the snake's deliberate asymmetry
 * honest. Seat C picks last in round 1 and first in round 2; a player should
 * be able to see that coming rather than discover it.
 */
export default function DraftOrderStrip({
  order,
  seats,
  yourSeatIndex,
  secondsRemaining,
}: {
  order: TmwTurnSlot[];
  seats: ArenaSeatPublic[];
  yourSeatIndex: number | null;
  secondsRemaining: number | null;
}) {
  const active = order.find((slot) => slot.active) ?? null;
  const rounds = [...new Set(order.map((slot) => slot.roundNumber))];

  function nameOf(seatIndex: number): string {
    return seats.find((seat) => seat.seat_index === seatIndex)?.display_name ?? `Seat ${seatIndex + 1}`;
  }

  return (
    // `min-w-0` is load-bearing, not tidying. This section is a flex item, and
    // a flex item's default `min-width: auto` lets it grow to its content --
    // so the eighteen-turn strip below pushed the whole document sideways on a
    // 390px phone even though the list itself scrolls. The list clips only if
    // its ancestors agree to be narrower than it.
    <section
      data-testid="tmw-draft-order"
      aria-labelledby="tmw-order-heading"
      className="flex min-w-0 max-w-full flex-col gap-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id="tmw-order-heading"
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          Draft order · snake
        </h2>
        {active && (
          <p
            data-testid="tmw-turn-spotlight"
            aria-live="polite"
            className="text-xs font-semibold"
            style={{ color: "var(--peak-accent-text)" }}
          >
            {active.seatIndex === yourSeatIndex ? "Your pick" : `${nameOf(active.seatIndex)} is picking`}
            {typeof secondsRemaining === "number" && (
              <span
                data-testid="tmw-turn-clock"
                className="ml-2 tabular-nums font-normal"
                style={{ color: "var(--text-secondary)" }}
              >
                {Math.max(0, Math.ceil(secondsRemaining))}s
              </span>
            )}
          </p>
        )}
      </div>

      {/* `relative` is the fix for a real mobile overflow, and the reason is
          not obvious: each turn chip carries an `.sr-only` label, and the
          house `.sr-only` is `position: absolute`. An absolutely-positioned
          descendant is clipped by its CONTAINING BLOCK, not by the nearest
          scroll container -- so with no positioned ancestor here, the
          off-screen labels of the later rounds escaped this list entirely and
          stretched the document 160px sideways on a 390px phone. Making the
          scroll container the containing block brings them back inside it. */}
      <ol
        className="relative flex min-w-0 max-w-full gap-1 overflow-x-auto pb-1"
        data-testid="tmw-order-list"
      >
        {rounds.map((roundNumber) => (
          <li key={roundNumber} className="flex shrink-0 items-center gap-1">
            <span
              className="px-1 text-[9px] font-bold tabular-nums"
              style={{ color: "var(--text-muted)" }}
              aria-hidden="true"
            >
              R{roundNumber}
            </span>
            <span className="flex gap-0.5">
              {order
                .filter((slot) => slot.roundNumber === roundNumber)
                .map((slot, position) => (
                  <span
                    key={`${slot.roundNumber}-${position}`}
                    data-testid={`tmw-order-${slot.roundNumber}-${slot.seatIndex}`}
                    data-active={slot.active ? "true" : "false"}
                    data-done={slot.done ? "true" : "false"}
                    title={`Round ${slot.roundNumber}: ${nameOf(slot.seatIndex)}`}
                    className="grid h-5 w-5 place-items-center rounded text-[10px] font-bold tabular-nums"
                    style={{
                      // Recessed by fill rather than opacity, so a completed
                      // turn's label stays readable at AA.
                      background: slot.active
                        ? "var(--peak-accent)"
                        : slot.done
                          ? "var(--bg-elevated)"
                          : "var(--bg-page)",
                      color: slot.active ? "var(--peak-accent-on)" : "var(--text-secondary)",
                      border: `1px solid ${
                        slot.seatIndex === yourSeatIndex
                          ? "var(--peak-accent)"
                          : "var(--border-subtle)"
                      }`,
                    }}
                  >
                    {slot.seatIndex + 1}
                    <span className="sr-only">
                      {` ${nameOf(slot.seatIndex)}, round ${slot.roundNumber}${
                        slot.active ? ", picking now" : slot.done ? ", done" : ", upcoming"
                      }`}
                    </span>
                  </span>
                ))}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
