"use client";

/**
 * A visually-hidden ARIA live region.
 *
 * Used for the things this app changes without a navigation: a spin landing on
 * its final team/season pair, a trade being confirmed, a run advancing a node.
 * Sighted users see the animation; everyone else gets this.
 *
 * The region must be MOUNTED BEFORE the message changes for assistive tech to
 * notice the change, so render it unconditionally and drive it with `message`
 * (empty string when there is nothing to say) — do not conditionally render the
 * whole component.
 *
 * `politeness="assertive"` interrupts the user. Reserve it for errors and for a
 * result the user is actively waiting on.
 */

import { cn } from "@/lib/utils";

export type LiveRegionPoliteness = "polite" | "assertive" | "off";

export interface LiveRegionProps {
  /** Current announcement. Empty string = nothing to announce. */
  message: string;
  politeness?: LiveRegionPoliteness;
  /** Announce the whole region, not just the changed part. Default true. */
  atomic?: boolean;
  /** Render visibly instead of `sr-only` (debugging, or a visible status line). */
  visible?: boolean;
  id?: string;
  className?: string;
  "data-testid"?: string;
}

export function LiveRegion({
  message,
  politeness = "polite",
  atomic = true,
  visible = false,
  id,
  className,
  "data-testid": testId,
}: LiveRegionProps) {
  return (
    <div
      id={id}
      data-testid={testId}
      // role reinforces aria-live for older AT pairings; "off" gets neither.
      role={politeness === "assertive" ? "alert" : politeness === "polite" ? "status" : undefined}
      aria-live={politeness}
      aria-atomic={atomic}
      className={cn(visible ? undefined : "sr-only", className)}
    >
      {message}
    </div>
  );
}

export default LiveRegion;
