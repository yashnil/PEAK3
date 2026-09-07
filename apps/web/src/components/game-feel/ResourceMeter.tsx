"use client";

/**
 * ResourceMeter — a resource that visibly changes, never a label.
 *
 * Budget, credits, lives, picks: every game has a number the player is
 * spending, and every room used to print it as text that changed in place.
 * This is the one shape for all of them: the value (tweened to the server's
 * number with `ScoreTransition`), a bar that depletes against `max`, and an
 * optional PROJECTION — what the value would be after the action the player
 * is lining up — drawn as a lighter segment so the cost is visible before it
 * is committed. A `reserve` marks the floor the rules will not let the
 * player spend below.
 *
 * Decoration over state: value, projection and reserve are all carried in
 * attributes and copy; the bar is drawn from CSS custom properties.
 */

import type { ReactNode } from "react";
import ScoreTransition from "./ScoreTransition";

export interface ResourceMeterProps {
  /** The authoritative value. */
  value: number;
  max: number;
  /** What the value would become if the pending action lands. */
  projected?: number | null;
  /** The floor the rules reserve; drawn as a marker. */
  reserve?: number;
  label: ReactNode;
  format?: (value: number) => string;
  /** A second, short fact beside the value, e.g. "3 spots". */
  aside?: ReactNode;
  tone?: "accent" | "neutral";
  size?: "sm" | "md";
  testId?: string;
  valueTestId?: string;
  className?: string;
}

export default function ResourceMeter({
  value,
  max,
  projected = null,
  reserve = 0,
  label,
  format = (n) => String(Math.round(n)),
  aside,
  tone = "accent",
  size = "md",
  testId = "resource-meter",
  valueTestId,
  className,
}: ResourceMeterProps) {
  const safeMax = Math.max(1, max);
  const fraction = Math.max(0, Math.min(1, value / safeMax));
  const projectedFraction =
    projected === null ? fraction : Math.max(0, Math.min(1, projected / safeMax));
  const reserveFraction = Math.max(0, Math.min(1, reserve / safeMax));
  const projecting = projected !== null && projected !== value;

  return (
    <div
      className={`gf-meter ${className ?? ""}`}
      data-testid={testId}
      data-tone={tone}
      data-size={size}
      data-projecting={projecting ? "true" : "false"}
      data-value={value}
      data-projected={projected ?? undefined}
      style={
        {
          ["--gf-meter-fraction" as string]: fraction.toFixed(3),
          ["--gf-meter-projected" as string]: projectedFraction.toFixed(3),
          ["--gf-meter-reserve" as string]: reserveFraction.toFixed(3),
        } as React.CSSProperties
      }
    >
      <div className="gf-meter-head">
        <span className="gf-meter-label">{label}</span>
        <span className="gf-meter-value">
          <ScoreTransition value={value} format={format} testId={valueTestId} />
          {projecting ? (
            <span className="gf-meter-projection" data-testid={valueTestId ? `${valueTestId}-projected` : undefined}>
              → {format(projected as number)}
            </span>
          ) : null}
        </span>
      </div>
      <span className="gf-meter-track" aria-hidden="true">
        <span className="gf-meter-fill" />
        <span className="gf-meter-projected" />
        {reserve > 0 ? <span className="gf-meter-reserve" /> : null}
      </span>
      {aside ? <span className="gf-meter-aside">{aside}</span> : null}
    </div>
  );
}
