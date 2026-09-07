"use client";

/**
 * PeakV2RTTCoach — one line, once, beside the thing it explains.
 *
 * The in-run replacement for the seven-step tour: a small chip that states
 * the rule that matters on THIS screen the first time the player meets it.
 * Not modal, not a spotlight, never in front of a control. Dismissed by its
 * own close button or by the player simply acting; `useCoach` remembers it.
 */

import { X } from "lucide-react";
import { COACH_COPY, useCoach, type CoachKey } from "@/lib/run-the-table-coach";

export interface PeakV2RTTCoachProps {
  coach: CoachKey;
  /** Whether this concept matters on the current screen. */
  active?: boolean;
  tone?: "neutral" | "accent" | "negative";
  className?: string;
}

export default function PeakV2RTTCoach({ coach, active = true, tone = "accent", className }: PeakV2RTTCoachProps) {
  const { show, dismiss } = useCoach(coach, active);
  if (!show) return null;
  const copy = COACH_COPY[coach];
  return (
    <div className={`rtt-coach ${className ?? ""}`} data-testid={`rtt-coach-${coach}`} data-tone={tone} role="note">
      <span className="rtt-coach-text">
        <strong>{copy.title}</strong> <span>{copy.body}</span>
      </span>
      <button type="button" className="rtt-coach-close" onClick={dismiss} aria-label="Got it" data-testid={`rtt-coach-dismiss-${coach}`}>
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
