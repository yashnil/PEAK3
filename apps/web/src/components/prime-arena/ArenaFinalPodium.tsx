"use client";

/**
 * ArenaFinalPodium — 1st to 4th, as the server placed them.
 *
 * Standard competition ranking comes from the server (a shared 2nd is two 2nds
 * and then a 4th); this component never re-sorts by score or breaks a tie.
 */

import { ordinal } from "./ArenaMatchStrip";

export interface PodiumRow {
  seatIndex: number;
  name: string;
  isBot: boolean;
  botTier: string | null;
  placement: number;
  outcome: "win" | "loss" | "draw";
  scoreText: string;
  detailText?: string;
}

export default function ArenaFinalPodium({
  rows,
  yourSeat,
  scoreLabel,
  testId = "parena-podium",
}: {
  rows: PodiumRow[];
  yourSeat: number | null;
  scoreLabel: string;
  testId?: string;
}) {
  const ordered = [...rows].sort((a, b) => a.placement - b.placement || a.seatIndex - b.seatIndex);
  return (
    <ol className="parena-podium" data-testid={testId} aria-label="Final standings">
      {ordered.map((row) => (
        <li
          key={row.seatIndex}
          className="parena-podium-row"
          data-placement={row.placement}
          data-you={row.seatIndex === yourSeat ? "true" : "false"}
          data-testid={`parena-podium-${row.seatIndex}`}
        >
          <span className="parena-podium-place pk-numeral">{ordinal(row.placement)}</span>
          <span className="parena-podium-who">
            <span className="parena-podium-name">
              {row.name}
              {row.seatIndex === yourSeat ? <span className="parena-strip-you"> · You</span> : null}
            </span>
            <span className="parena-podium-meta">
              {row.isBot ? `Bot${row.botTier ? ` · ${row.botTier}` : ""}` : "Player"}
              {row.outcome === "draw" && row.placement === 1 ? " · Shared first" : ""}
              {row.detailText ? ` · ${row.detailText}` : ""}
            </span>
          </span>
          <span className="parena-podium-score pk-numeral">
            <span className="sr-only">{scoreLabel}: </span>
            {row.scoreText}
          </span>
        </li>
      ))}
    </ol>
  );
}
