"use client";

/**
 * EventMoment — a compact, centred notice for something that just happened.
 *
 * Swaps, steals, a leader change, a round winner, "Dwyane Wade → SG". It
 * is a Level-2 event (180-450ms in, a short hold, out) and it never blocks
 * anything: the state it announces has ALREADY been applied by the same
 * render, and the moment is derived from that state by the caller. It
 * auto-dismisses; a new `moment.id` restarts it.
 */

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";

export type EventMomentTone = "neutral" | "accent" | "positive" | "negative";

export interface EventMomentData {
  /** Changes per event. The same id twice is the same moment. */
  id: string;
  kind: string;
  title: string;
  detail?: string;
  tone?: EventMomentTone;
  /** Override the hold. Rare events may hold longer than routine ones. */
  durationMs?: number;
}

export interface EventMomentProps {
  moment: EventMomentData | null;
  /** Default hold for a routine event. */
  durationMs?: number;
  onDone?: (id: string) => void;
  testId?: string;
  className?: string;
}

const HOLD_MS = 1400;

export default function EventMoment({ moment, durationMs = HOLD_MS, onDone, testId = "event-moment", className }: EventMomentProps) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState<EventMomentData | null>(moment);

  useEffect(() => {
    setShown(moment);
    if (!moment) return;
    const id = window.setTimeout(() => {
      setShown((current) => (current?.id === moment.id ? null : current));
      onDone?.(moment.id);
    }, moment.durationMs ?? durationMs);
    return () => window.clearTimeout(id);
    // `onDone` is deliberately not a dependency: a caller re-creating it must
    // not restart the hold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment?.id, durationMs]);

  if (!shown) return null;
  return (
    <div
      key={shown.id}
      className={`gf-moment ${className ?? ""}`}
      data-testid={testId}
      data-kind={shown.kind}
      data-tone={shown.tone ?? "neutral"}
      data-reduced-motion={reduced ? "true" : "false"}
      role="status"
      aria-live="polite"
    >
      <span className="gf-moment-title">{shown.title}</span>
      {shown.detail ? <span className="gf-moment-detail">{shown.detail}</span> : null}
    </div>
  );
}
