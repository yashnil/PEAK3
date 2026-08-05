"use client";
import type { ArenaSeatPublic } from "@/types/three-man-weave";
import type { TmwLockEntry } from "@/lib/three-man-weave-state";

/**
 * The global identity lock, made visible.
 *
 * The rule is easy to state and easy to be surprised by: once ANY seat drafts
 * a player, that player is gone for everyone, in every franchise and every
 * decade, for the rest of the match. A Cavaliers-2000s LeBron blocks a
 * Heat-2010s LeBron — the lock is on the person, not the card.
 *
 * A player who only meets that rule by having a pick refused has been taught
 * it badly. So the taken list is on screen the whole time, with who took each
 * name and off which roll, which also doubles as the shared draft feed.
 */
export default function IdentityLockPanel({
  entries,
  seats,
}: {
  entries: TmwLockEntry[];
  seats: ArenaSeatPublic[];
}) {
  function nameOf(seatIndex: number): string {
    return (
      seats.find((seat) => seat.seat_index === seatIndex)?.display_name ?? `Seat ${seatIndex + 1}`
    );
  }

  return (
    <section
      data-testid="tmw-identity-lock"
      aria-labelledby="tmw-lock-heading"
      className="flex flex-col gap-2 rounded-lg border p-3"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)" }}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2
          id="tmw-lock-heading"
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          Off the board
        </h2>
        <span
          data-testid="tmw-lock-count"
          className="text-[10px] tabular-nums"
          style={{ color: "var(--text-muted)" }}
        >
          {entries.length}
        </span>
      </header>

      <p className="text-[10px] leading-snug" style={{ color: "var(--text-muted)" }}>
        Drafted players are gone for every seat, in every franchise and decade.
      </p>

      {entries.length === 0 ? (
        <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>
          Nobody drafted yet.
        </p>
      ) : (
        <ol
          data-testid="tmw-lock-list"
          className="flex max-h-64 flex-col gap-1 overflow-y-auto"
          aria-live="polite"
        >
          {entries.map((entry) => (
            <li
              key={entry.playerSlug}
              data-testid={`tmw-lock-${entry.playerSlug}`}
              className="flex min-w-0 items-baseline justify-between gap-2 text-xs"
            >
              <span className="min-w-0 truncate" style={{ color: "var(--text-primary)" }}>
                {entry.playerName}
              </span>
              <span className="shrink-0 text-[10px]" style={{ color: "var(--text-muted)" }}>
                {nameOf(entry.seatIndex)} · R{entry.roundNumber}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
