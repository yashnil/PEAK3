/**
 * PeakV2Rule — a thin dividing line, standing in for a bordered container.
 *
 * The brief's central anti-pattern is "everything in cards." Most of the
 * time what a screen actually needs is semantic separation, which a rule
 * plus whitespace expresses without adding a nested surface, a border on
 * four sides, and a border-radius decision nobody asked for. Use this
 * between sections; reach for `PeakV2Modal` only when the content truly has
 * independent interaction or state.
 */

export interface PeakV2RuleProps {
  /** `"hairline"` (the default — quiet section separator) or `"accent"`
   *  (a rare emphasis rule, e.g. under a cinematic result headline). */
  tone?: "hairline" | "accent";
  /** Vertical breathing room around the rule. */
  spacing?: "sm" | "md" | "lg";
  className?: string;
}

const SPACING: Record<NonNullable<PeakV2RuleProps["spacing"]>, string> = {
  sm: "var(--v2-space-3)",
  md: "var(--v2-space-6)",
  lg: "var(--v2-space-10)",
};

export default function PeakV2Rule({ tone = "hairline", spacing = "md", className }: PeakV2RuleProps) {
  return (
    <hr
      className={className}
      style={{
        border: "none",
        borderTop: `1px solid ${tone === "accent" ? "var(--v2-color-accent)" : "var(--v2-border-subtle)"}`,
        opacity: tone === "accent" ? 0.55 : 1,
        margin: `${SPACING[spacing]} 0`,
      }}
    />
  );
}
