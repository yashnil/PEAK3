"use client";

/**
 * "There is nothing here yet" / "that returned no rows".
 *
 * Deliberately opinionated: a title that says what is missing, an optional
 * sentence that says why, and an optional single action that resolves it. An
 * empty state without a next step is a dead end.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** What is missing, stated plainly. */
  title: ReactNode;
  /** Why it is missing and what would change it. One or two sentences. */
  description?: ReactNode;
  /** Decorative glyph. Rendered `aria-hidden`. */
  icon?: ReactNode;
  /** A single primary action. */
  action?: ReactNode;
  /** Tighter padding, for empty states inside a rail or a card. */
  compact?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
  className,
  "data-testid": testId,
}: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className={cn("flex flex-col items-center text-center", className)}
      style={{
        gap: "var(--pk-space-2, 8px)",
        padding: compact ? "var(--pk-space-4, 16px)" : "var(--pk-space-8, 32px) var(--pk-space-4, 16px)",
        background: "var(--pk-surface-inset, var(--bg-elevated))",
        border: "1px dashed var(--pk-surface-raised-border, var(--border-default))",
        borderRadius: "var(--pk-r-lg, 14px)",
        // A recessed well, not a raised card. An empty state is a HOLE in the
        // layout — something is missing here — and the depth vocabulary should
        // say so rather than presenting absence as an object.
        boxShadow: "var(--pk-well)",
      }}
    >
      {icon ? (
        <span aria-hidden="true" style={{ color: "var(--text-secondary)" }}>
          {icon}
        </span>
      ) : null}
      <p
        className="font-display font-bold"
        style={{
          color: "var(--text-primary)",
          fontSize: compact ? 14 : 16,
          letterSpacing: "var(--pk-track-heading, -0.014em)",
        }}
      >
        {title}
      </p>
      {description ? (
        <p
          style={{
            color: "var(--text-secondary)",
            // 13px, not `text-xs`. This line is usually the only thing telling
            // someone HOW to leave the empty state.
            fontSize: 13,
            lineHeight: 1.5,
            maxWidth: "48ch",
          }}
        >
          {description}
        </p>
      ) : null}
      {action ? <div style={{ marginTop: "var(--pk-space-2, 8px)" }}>{action}</div> : null}
    </div>
  );
}

export default EmptyState;
