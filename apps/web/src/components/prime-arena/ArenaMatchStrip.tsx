"use client";

/**
 * ArenaMatchStrip — the restrained broadcast strip every seat watches.
 *
 * Seat, name, BOT label and tier (in words, never an icon alone), position,
 * cumulative score, and -- while a simultaneous decision is open -- whether
 * each seat has LOCKED. Never what they locked: the strip receives no decision
 * at all, so it cannot leak one.
 *
 * Shared by PRIME CUT and FIND THE PRIME only. Existing rooms keep their own
 * seat surfaces (ADR-006).
 */

import { Check, Hourglass } from "lucide-react";

export interface StripSeat {
  seatIndex: number;
  name: string;
  isBot: boolean;
  botTier: string | null;
  position: number;
  scoreText: string;
  locked?: boolean;
  forfeited?: boolean;
}

export interface ArenaMatchStripProps {
  seats: StripSeat[];
  yourSeat: number | null;
  /** Show lock state (only while a simultaneous decision is open). */
  showLocks: boolean;
  title: string;
  progress: string;
  scoreLabel: string;
  testId?: string;
}

export function ordinal(position: number): string {
  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${position}th`;
  switch (position % 10) {
    case 1:
      return `${position}st`;
    case 2:
      return `${position}nd`;
    case 3:
      return `${position}rd`;
    default:
      return `${position}th`;
  }
}

export default function ArenaMatchStrip({
  seats,
  yourSeat,
  showLocks,
  title,
  progress,
  scoreLabel,
  testId = "parena-strip",
}: ArenaMatchStripProps) {
  const ordered = [...seats].sort((a, b) => a.position - b.position || a.seatIndex - b.seatIndex);
  const lockedCount = seats.filter((s) => s.locked).length;
  return (
    <section className="parena-strip" aria-label={title} data-testid={testId}>
      <header className="parena-strip-head">
        <h2 className="parena-strip-title">{title}</h2>
        <p className="parena-strip-progress pk-numeral">{progress}</p>
      </header>
      <ol className="parena-strip-seats">
        {ordered.map((seat) => {
          const you = seat.seatIndex === yourSeat;
          return (
            <li
              key={seat.seatIndex}
              className="parena-strip-seat"
              data-you={you ? "true" : "false"}
              data-locked={seat.locked ? "true" : "false"}
              data-testid={`parena-seat-${seat.seatIndex}`}
            >
              <span className="parena-strip-pos pk-numeral" aria-label={`Position ${seat.position}`}>
                {ordinal(seat.position)}
              </span>
              <span className="parena-strip-who">
                <span className="parena-strip-name">
                  {seat.name}
                  {you ? <span className="parena-strip-you"> · You</span> : null}
                </span>
                {seat.isBot ? (
                  <span className="parena-strip-bot" data-testid={`parena-seat-${seat.seatIndex}-bot`}>
                    Bot{seat.botTier ? ` · ${seat.botTier}` : ""}
                  </span>
                ) : null}
                {seat.forfeited ? <span className="parena-strip-bot">Conceded</span> : null}
              </span>
              {showLocks ? (
                <span className="parena-strip-lock" data-testid={`parena-seat-${seat.seatIndex}-lock`}>
                  {seat.locked ? <Check size={14} aria-hidden="true" /> : <Hourglass size={14} aria-hidden="true" />}
                  <span>{seat.locked ? "Locked" : "Deciding"}</span>
                </span>
              ) : null}
              <span className="parena-strip-score pk-numeral">
                <span className="sr-only">{scoreLabel}: </span>
                {seat.scoreText}
              </span>
            </li>
          );
        })}
      </ol>
      {showLocks ? (
        <p className="sr-only" aria-live="off">
          {lockedCount} of {seats.length} players locked in.
        </p>
      ) : null}
    </section>
  );
}
