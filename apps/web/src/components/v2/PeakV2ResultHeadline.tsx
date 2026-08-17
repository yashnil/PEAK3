/**
 * PeakV2ResultHeadline — the big editorial statement inside a
 * `PeakV2CinematicStage`: "The Wall", "Utah Jazz · 2010s", "Victory over
 * The Wall", "7 / 10". DISPLAY/MOMENT typography at its largest, most
 * confident scale. Never used for routine controls or labels — see the
 * brief's explicit "NOT routine controls" under Typography.
 */

import type { CSSProperties, ReactNode } from "react";

export interface PeakV2ResultHeadlineProps {
  children: ReactNode;
  /** `"hero"` — the single biggest statement on a screen (homepage, final
   *  daily result). `"moment"` — a boss name, a franchise · decade line.
   *  `"line"` — a supporting cinematic line beneath a bigger headline. */
  scale?: "hero" | "moment" | "line";
  tone?: "primary" | "accent";
  as?: "h1" | "h2" | "p";
  className?: string;
  style?: CSSProperties;
}

const SIZE_VAR: Record<NonNullable<PeakV2ResultHeadlineProps["scale"]>, string> = {
  hero: "var(--v2-display-size-hero)",
  moment: "var(--v2-display-size-moment)",
  line: "var(--v2-display-size-line)",
};

export default function PeakV2ResultHeadline({
  children,
  scale = "moment",
  tone = "primary",
  as = "h2",
  className,
  style,
}: PeakV2ResultHeadlineProps) {
  const Tag = as;
  return (
    <Tag
      className={className}
      style={{
        fontFamily: "var(--v2-font-display)",
        fontSize: SIZE_VAR[scale],
        lineHeight: "var(--v2-display-leading)",
        letterSpacing: "var(--v2-display-track)",
        color: tone === "accent" ? "var(--v2-color-accent)" : "var(--v2-text-primary)",
        margin: "0 auto",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
