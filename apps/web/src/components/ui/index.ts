/**
 * Shared UI primitives (W7, UX / Organization / Polish pass).
 *
 * Import from `@/components/ui` rather than from the individual files, so the
 * public surface stays one list. Every export here is additive — nothing in
 * this directory replaces or wraps an existing component.
 *
 * Related shared modules (imported directly, not re-exported here):
 *   `@/lib/a11y`   — FOCUSABLE_SELECTOR, useFocusTrap, useRestoreFocus,
 *                    usePrefersReducedMotion, useBodyScrollLock, useEscapeKey,
 *                    useLayerStack, getFocusableElements
 *   `@/lib/motion` — MotionProvider, MOTION_DURATION_MS/S, MOTION_EASE,
 *                    motionTransition, cssTransition
 */

export { Portal } from "./Portal";
export type { PortalProps } from "./Portal";

export { Dialog } from "./Dialog";
export type { DialogProps, DialogSize } from "./Dialog";

export { Tooltip, Explainer } from "./Tooltip";
export type { TooltipProps, TooltipPlacement, ExplainerProps } from "./Tooltip";

export { StatusChip } from "./StatusChip";
export type { StatusChipProps, StatusChipTone, StatusChipSize } from "./StatusChip";

export { SectionHeader } from "./SectionHeader";
export type {
  SectionHeaderProps,
  SectionHeaderLevel,
  SectionHeaderSize,
} from "./SectionHeader";

export { ScorePill } from "./ScorePill";
export type { ScorePillProps, ScorePillTone, ScorePillSize } from "./ScorePill";

export { AnimatedNumber } from "./AnimatedNumber";
export type { AnimatedNumberProps } from "./AnimatedNumber";

export { Skeleton, SkeletonText } from "./Skeleton";
export type { SkeletonProps } from "./Skeleton";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

export { ErrorState } from "./ErrorState";
export type { ErrorStateProps } from "./ErrorState";

export { LiveRegion } from "./LiveRegion";
export type { LiveRegionProps, LiveRegionPoliteness } from "./LiveRegion";

export { ThemeToggle } from "./ThemeToggle";
export type { ThemeToggleProps } from "./ThemeToggle";
