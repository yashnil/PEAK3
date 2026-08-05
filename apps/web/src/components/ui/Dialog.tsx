"use client";

/**
 * The app's one modal dialog.
 *
 * Three divergent hand-rolled dialogs existed before this pass, each with its
 * own partial focus trap. This one is the shared implementation: Portal +
 * `useFocusTrap` + `useRestoreFocus` + `useBodyScrollLock` + `useEscapeKey`,
 * all of which are layer-stack aware, so a dialog opened FROM a dialog behaves
 * correctly — only the innermost one handles Tab and Escape, and the scroll
 * lock is reference-counted so closing the inner one does not unfreeze the
 * page.
 *
 * Accessibility contract:
 *   - `role="dialog"`, `aria-modal="true"`
 *   - exactly one of `label` / `labelledBy` is required (enforced by the type)
 *   - Escape closes; backdrop click closes (opt out with `dismissible={false}`)
 *   - focus moves into the dialog on open and returns to the opener on close
 *   - the entrance transition is skipped entirely under `prefers-reduced-motion`
 */

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import {
  useBodyScrollLock,
  useEscapeKey,
  useFocusTrap,
  useLayerStack,
  useRestoreFocus,
  getFocusableElements,
  usePrefersReducedMotion,
} from "@/lib/a11y";
import { MOTION_DURATION_MS, MOTION_EASE } from "@/lib/motion";
import { Portal } from "./Portal";

export type DialogSize = "sm" | "md" | "lg" | "xl" | "full";

const SIZE_MAX_WIDTH: Record<DialogSize, string> = {
  sm: "24rem",
  md: "32rem",
  lg: "44rem",
  xl: "60rem",
  full: "min(100%, 80rem)",
};

interface DialogBaseProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Element to focus on open. Defaults to the first focusable descendant. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  size?: DialogSize;
  className?: string;
  /** Class applied to the full-screen backdrop layer. */
  backdropClassName?: string;
  /** When false, neither Escape nor a backdrop click closes the dialog. */
  dismissible?: boolean;
  describedBy?: string;
  "data-testid"?: string;
}

/** Exactly one of `label` / `labelledBy` — an unnamed dialog is a defect. */
export type DialogProps = DialogBaseProps &
  ({ label: string; labelledBy?: never } | { labelledBy: string; label?: never });

export function Dialog({
  open,
  onClose,
  children,
  initialFocusRef,
  size = "md",
  className,
  backdropClassName,
  dismissible = true,
  describedBy,
  label,
  labelledBy,
  "data-testid": testId,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Focus is placed from the panel's own ref callback -- see the long note on
  // `setPanelRef` below.
  const openRef = useRef(open);
  openRef.current = open;
  const focusedRef = useRef(false);
  const initialFocusRefRef = useRef(initialFocusRef);
  initialFocusRefRef.current = initialFocusRef;
  const reducedMotion = usePrefersReducedMotion();
  const [entered, setEntered] = useState(false);

  // ONE layer registration shared by the trap and the Escape handler. Two
  // registrations from the same dialog would leave the first one permanently
  // below the second, silently disabling it.
  const isTopLayer = useLayerStack(open);

  useFocusTrap(dialogRef, open, isTopLayer);
  useRestoreFocus(open);
  useBodyScrollLock(open);

  const handleClose = useCallback(() => {
    if (!dismissible) return;
    onClose();
  }, [dismissible, onClose]);

  useEscapeKey(open, handleClose, isTopLayer);

  // The entrance ramp only. Focus is NOT done here -- see below for why.
  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Reset the once-per-open latch when the dialog closes.
  useEffect(() => {
    if (!open) focusedRef.current = false;
  }, [open]);

  /**
   * Move focus in. `initialFocusRef` wins; otherwise the first focusable child;
   * otherwise the dialog itself (it carries tabIndex={-1} for exactly this).
   *
   * DONE FROM THE PANEL'S REF CALLBACK, NOT FROM A FRAME.
   *
   * This used to run inside the same `requestAnimationFrame` as the entrance
   * ramp above, and that was a real accessibility defect rather than a styling
   * detail. `Portal` returns `null` until after its own first effect, so on the
   * render where `open` flips true there is no panel and no children yet:
   * `dialogRef.current` and `initialFocusRef.current` are both null. The frame
   * was therefore racing the portal's mount-commit. If the frame won, every
   * branch below fell through against nulls, focus stayed on `<body>` -- a
   * keyboard user opening a modal and landing nowhere -- and nothing ever
   * retried, because `open` had not changed and the effect never re-ran.
   *
   * A probe that forces that interleaving (run the frame before the portal
   * commits) reproduces it deterministically: `document.activeElement` is
   * `BODY`. jsdom happened to win the race most of the time, which is why it
   * surfaced as an intermittent test failure rather than as a bug report; a
   * loaded browser or a slow device has no such luck.
   *
   * A ref callback fires during the commit in which the node is attached, and
   * refs attach bottom-up -- children first -- so `initialFocusRef.current` is
   * already populated when this runs. That removes the race without adding a
   * render: an earlier fix used state for the node, which forced an extra
   * render pass on every dialog open and changed effect ordering for consumers
   * that drive their own state from a modal (it broke a daily-grid rollover
   * test outright). Placing focus here touches nothing but the DOM.
   */
  const setPanelRef = useCallback((node: HTMLDivElement | null) => {
    dialogRef.current = node;
    if (!node || !openRef.current || focusedRef.current) return;
    focusedRef.current = true;
    const explicit = initialFocusRefRef.current?.current;
    if (explicit && typeof explicit.focus === "function") {
      explicit.focus();
      return;
    }
    const focusable = getFocusableElements(node);
    if (focusable.length > 0) {
      focusable[0].focus();
      return;
    }
    node.focus();
  }, []);

  if (!open) return null;

  // Under reduced motion the surface is simply present — no opacity/transform
  // ramp at all, rather than a "fast" one.
  const visible = reducedMotion || entered;
  const durationMs = reducedMotion ? 0 : MOTION_DURATION_MS.base;
  const [e1, e2, e3, e4] = MOTION_EASE.standard;
  const easing = `cubic-bezier(${e1}, ${e2}, ${e3}, ${e4})`;

  return (
    <Portal>
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ zIndex: "var(--pk-z-dialog, 110)", padding: "var(--pk-space-4, 16px)" }}
        data-pk-dialog-root=""
      >
        {/* Backdrop is its own element so a click on it is unambiguous — a
            click that started inside the panel and ended on the backdrop
            (drag-select) never reaches this node. */}
        <div
          aria-hidden="true"
          data-pk-dialog-backdrop=""
          onClick={handleClose}
          className={cn("absolute inset-0", backdropClassName)}
          style={{
            background: "var(--pk-surface-overlay, rgba(6, 7, 9, 0.72))",
            backdropFilter: "blur(2px)",
            opacity: visible ? 1 : 0,
            transition: `opacity ${durationMs}ms ${easing}`,
          }}
        />
        <div
          ref={setPanelRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={-1}
          data-testid={testId}
          className={cn("relative w-full overflow-y-auto outline-none", className)}
          style={{
            maxWidth: SIZE_MAX_WIDTH[size],
            maxHeight: "calc(100vh - var(--pk-space-8, 32px))",
            background: "var(--pk-surface-decision, var(--bg-elevated))",
            border: "1px solid var(--pk-surface-decision-border, var(--border-emphasis))",
            borderRadius: "var(--pk-r-xl, 20px)",
            boxShadow: "var(--pk-elev-4, 0 24px 48px -24px rgba(0, 0, 0, 0.7))",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0) scale(1)" : "translateY(8px) scale(0.98)",
            transition: `opacity ${durationMs}ms ${easing}, transform ${durationMs}ms ${easing}`,
          }}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}

export default Dialog;
