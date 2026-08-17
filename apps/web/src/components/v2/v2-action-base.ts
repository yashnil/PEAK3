/**
 * Shared sizing/typography for `PeakV2PrimaryAction`/`PeakV2SecondaryAction`
 * — one button skeleton, two fills, so the two primitives cannot drift on
 * tap target, radius or motion timing.
 */
import type { CSSProperties } from "react";

export type V2ActionSize = "md" | "sm";

export function v2ActionBaseStyle(size: V2ActionSize): CSSProperties {
  return {
    fontFamily: "var(--v2-font-ui)",
    fontWeight: 600,
    fontSize: size === "sm" ? "0.8125rem" : "0.9375rem",
    letterSpacing: "-0.006em",
    borderRadius: "var(--v2-radius-control)",
    minHeight: size === "sm" ? undefined : "var(--pk-tap-min)",
    padding: size === "sm" ? "0.5rem 0.875rem" : "0.75rem 1.25rem",
    transition:
      "background var(--v2-dur-control) var(--v2-ease-standard), border-color var(--v2-dur-control) var(--v2-ease-standard), opacity var(--v2-dur-control) var(--v2-ease-standard), transform var(--v2-dur-ack) var(--v2-ease-out)",
  };
}
