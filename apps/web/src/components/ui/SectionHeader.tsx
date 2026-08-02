"use client";

/**
 * One consistent section heading: optional eyebrow, a real heading element,
 * optional one-line description, optional trailing actions.
 *
 * `as` is required to be chosen deliberately — heading level is document
 * structure, not styling, and the app has a strict "exactly one `<h1>` per
 * page" invariant (plan §3.4). Visual size is controlled by `size`, never by
 * picking a smaller tag.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SectionHeaderLevel = "h1" | "h2" | "h3" | "h4";
export type SectionHeaderSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<SectionHeaderSize, string> = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl",
};

export interface SectionHeaderProps {
  title: ReactNode;
  /** Small uppercase kicker above the title. */
  eyebrow?: ReactNode;
  /** One line of orientation. Keep it to a sentence. */
  description?: ReactNode;
  /** Right-aligned controls (filters, links). */
  actions?: ReactNode;
  as?: SectionHeaderLevel;
  size?: SectionHeaderSize;
  /** Id applied to the heading, for `aria-labelledby` on the owning region. */
  id?: string;
  className?: string;
  "data-testid"?: string;
}

export function SectionHeader({
  title,
  eyebrow,
  description,
  actions,
  as: Heading = "h2",
  size = "md",
  id,
  className,
  "data-testid": testId,
}: SectionHeaderProps) {
  return (
    <div
      data-testid={testId}
      className={cn("flex flex-wrap items-end justify-between", className)}
      style={{ gap: "var(--pk-space-3, 12px)" }}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p
            className="font-bold uppercase leading-none tracking-[0.14em]"
            style={{
              color: "var(--text-muted)",
              fontSize: 10,
              marginBottom: "var(--pk-space-2, 8px)",
            }}
          >
            {eyebrow}
          </p>
        ) : null}
        <Heading
          id={id}
          className={cn("font-display font-bold", SIZE_CLASS[size])}
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </Heading>
        {description ? (
          <p
            className="text-xs"
            style={{
              color: "var(--text-secondary)",
              marginTop: "var(--pk-space-2, 8px)",
              maxWidth: "68ch",
            }}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          className="flex shrink-0 flex-wrap items-center"
          style={{ gap: "var(--pk-space-2, 8px)" }}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export default SectionHeader;
