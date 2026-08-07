"use client";
import type { ArenaSeatPublic } from "@/types/three-man-weave";
import type { TmwLockEntry } from "@/lib/three-man-weave-state";
import { seatAccent, seatLabel } from "@/lib/three-man-weave-state";

/**
 * THE RECENT-PICKS RAIL, and the full draft history behind a disclosure.
 *
 * TMW-12: "the giant growing text ledger consumes space". It did -- it was an
 * unbounded scrolling list of every drafted name, up to eighteen rows, sitting
 * permanently between the board and the pick surface and growing all match. Its
 * job was to teach ONE rule (the identity lock is global: once any seat takes a
 * name it is gone for everyone, in every franchise and every decade) and to
 * show what just happened. Four rows do both.
 *
 * So: a compact rail of the most recent picks, with clear seat attribution, and
 * a "View draft history" disclosure holding the complete ledger for anyone who
 * wants to audit the board. The lock rule is stated once, on the panel, rather
 * than being something a player discovers by having a pick refused.
 *
 * THE SAME DATA FEEDS THE PICK SURFACE'S EMPTY STATE. When a search finds
 * nothing, the overlay reads these entries to say "Dennis Rodman was drafted by
 * The Closer in round 2" instead of implying the pool is missing him.
 */

/** How many picks the rail shows before the rest moves into the disclosure. */
const RAIL_LIMIT = 4;

export default function IdentityLockPanel({
  entries,
  seats,
}: {
  entries: TmwLockEntry[];
  seats: ArenaSeatPublic[];
}) {
  const recent = entries.slice(0, RAIL_LIMIT);
  const rest = entries.slice(RAIL_LIMIT);

  return (
    <section
      data-testid="tmw-identity-lock"
      aria-labelledby="tmw-lock-heading"
      className="tmw-ledger"
    >
      <header className="tmw-ledger-head">
        <h2 id="tmw-lock-heading" className="tmw-ledger-title">
          Recent picks
        </h2>
        <span data-testid="tmw-lock-count" className="tmw-ledger-count pk-numeral">
          {entries.length} off the board
        </span>
      </header>

      {entries.length === 0 ? (
        <p className="tmw-ledger-empty">
          Nobody has drafted yet. A name taken by any seat is gone for every seat,
          in every franchise and decade.
        </p>
      ) : (
        <ol data-testid="tmw-lock-list" className="tmw-ledger-rail" aria-live="polite">
          {recent.map((entry) => (
            <li
              key={entry.playerSlug}
              data-testid={`tmw-lock-${entry.playerSlug}`}
              data-seat-accent={seatAccent(entry.seatIndex)}
              className="tmw-ledger-chip"
            >
              <span className="tmw-ledger-chip-name">{entry.playerName}</span>
              <span className="tmw-ledger-chip-meta">
                {seatLabel(seats, entry.seatIndex)}
                <span className="pk-numeral"> · R{entry.roundNumber}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {rest.length > 0 && (
        <details className="tmw-ledger-more">
          <summary data-testid="tmw-lock-history-toggle">
            View draft history ({entries.length})
          </summary>
          <ol className="tmw-ledger-history" data-testid="tmw-lock-history">
            {entries.map((entry) => (
              <li key={entry.playerSlug} data-seat-accent={seatAccent(entry.seatIndex)}>
                <span className="tmw-ledger-history-name">{entry.playerName}</span>
                <span className="tmw-ledger-history-meta">
                  {seatLabel(seats, entry.seatIndex)}
                  <span className="pk-numeral"> · round {entry.roundNumber}</span>
                  {" · "}
                  {entry.franchiseDisplayName} {entry.decade}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
