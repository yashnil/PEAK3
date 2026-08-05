"use client";

/**
 * "That failed" — the shared error surface, alongside `EmptyState` (nothing
 * here) and `Skeleton` (still loading). Existing surfaces mostly hand-roll
 * this (e.g. `RunTheTableGame.tsx`'s own `error`/retry block); this exists
 * so a NEW surface (homepage sections, leaderboard reads, account panels)
 * has one to reach for instead of inventing a fourth error box.
 *
 * `role="alert"` — an unmounted-then-mounted alert region is announced by
 * every major screen reader without needing a separate `LiveRegion`
 * wrapper, exactly as `rankings/page.tsx`'s existing error box already
 * does (`role="alert"`, `data-testid="rankings-error"`); this generalizes
 * that pattern rather than replacing it.
 *
 * The server's own message is rendered verbatim wherever the caller has
 * one — this component never invents "Something went wrong" over a real
 * error string it was given; a caller with no message may pass its own
 * generic copy, or none, in which case a neutral fallback renders.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  /** The error, stated plainly. Falls back to a neutral sentence if omitted. */
  message?: ReactNode;
  /** A single retry action, when the failure is retryable. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Tighter padding, for an error box inside a rail or a card. */
  compact?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = "Try again",
  compact = false,
  className,
  "data-testid": testId,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn("flex flex-col items-center gap-2 text-center", className)}
      style={{
        padding: compact ? "var(--pk-space-4, 16px)" : "var(--pk-space-6, 24px) var(--pk-space-4, 16px)",
        background: "var(--pk-surface-inset, var(--bg-elevated))",
        border: "1px solid var(--incorrect-dim, var(--border-default))",
        borderRadius: "var(--pk-r-lg, 14px)",
      }}
    >
      <p className="text-sm font-medium" style={{ color: "var(--incorrect)" }}>
        {message ?? "Something went wrong. Your progress is safe."}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-md border px-4 text-sm font-semibold transition-colors"
          style={{
            minHeight: "var(--pk-tap-min, 44px)",
            borderColor: "var(--border-default)",
            color: "var(--text-primary)",
            background: "var(--pk-surface-raised, var(--bg-surface))",
          }}
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export default ErrorState;
