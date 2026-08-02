"use client";

/**
 * Loading placeholder that RESERVES its box.
 *
 * `width` / `height` / `radius` are applied as inline styles rather than
 * classes precisely so the placeholder occupies exactly the space the real
 * content will: a skeleton that collapses when it is replaced has caused the
 * layout shift it was supposed to prevent.
 *
 * Always `aria-hidden`. A skeleton is not information; announce loading with a
 * `LiveRegion` instead.
 */

import { cn } from "@/lib/utils";

function toCssSize(value: number | string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  return typeof value === "number" ? `${value}px` : value;
}

export interface SkeletonProps {
  /** Number → px. Defaults to `100%`. */
  width?: number | string;
  /** Number → px. Defaults to `12px`. */
  height?: number | string;
  /** Number → px. Defaults to `--pk-r-sm`. Ignored when `circle`. */
  radius?: number | string;
  /** Force a perfect circle (avatar placeholders). */
  circle?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function Skeleton({
  width = "100%",
  height = 12,
  radius,
  circle = false,
  className,
  "data-testid": testId,
}: SkeletonProps) {
  const w = toCssSize(width, "100%");
  const h = toCssSize(height, "12px");

  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className={cn("pk-skeleton", className)}
      style={{
        width: circle ? h : w,
        height: h,
        minWidth: circle ? h : undefined,
        borderRadius: circle ? "var(--pk-r-pill, 999px)" : toCssSize(radius, "var(--pk-r-sm, 6px)"),
      }}
    />
  );
}

/**
 * `lines` stacked text-line skeletons, the last one short — the standard
 * paragraph placeholder, so callers stop hand-rolling it.
 */
export function SkeletonText({
  lines = 3,
  lineHeight = 12,
  gap = 8,
  className,
  "data-testid": testId,
}: {
  lines?: number;
  lineHeight?: number | string;
  gap?: number | string;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className={cn("flex flex-col", className)}
      style={{ gap: toCssSize(gap, "8px") }}
    >
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <Skeleton
          key={i}
          height={lineHeight}
          width={i === lines - 1 && lines > 1 ? "62%" : "100%"}
        />
      ))}
    </span>
  );
}

export default Skeleton;
