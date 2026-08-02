"use client";

/**
 * Tooltip / Explainer.
 *
 * WCAG 2.2 §1.4.13 ("Content on Hover or Focus") is the whole design brief
 * here, so the trigger is a real `<button type="button">` rather than a
 * `<span>` with pointer handlers:
 *
 *   - hover      → `pointerenter` (mouse only, so a tap does not double-fire)
 *   - keyboard   → `focus` / `blur`, reachable because the trigger is a button
 *   - tap        → `click` toggles, which is the only reliable touch gesture
 *   - dismissible→ Escape closes without moving the pointer
 *   - hoverable  → the panel itself keeps the tooltip open, so a user can move
 *                  onto it to read or select text (a 120ms grace period covers
 *                  the gap between the two elements)
 *   - persistent → it never auto-hides on a timer
 *
 * Positioning is hand-rolled: `getBoundingClientRect()` on the trigger, then a
 * viewport clamp. `floating-ui` was explicitly rejected (plan §2) — the only
 * positioned surfaces in this app are small and edge-clamped, and a positioning
 * engine is not worth a tenth runtime dependency.
 *
 * The panel is portalled so it can never be clipped by an ancestor's
 * `overflow: hidden` (the RUN THE TABLE rails and the reel window both clip).
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { useEscapeKey } from "@/lib/a11y";
import { Portal } from "./Portal";

export type TooltipPlacement = "top" | "bottom";

/** Gap between trigger and panel, and the minimum margin to the viewport edge. */
const OFFSET = 8;
const VIEWPORT_MARGIN = 8;
const MAX_WIDTH = 288;
/** Grace period so the pointer can travel from trigger to panel. */
const CLOSE_DELAY_MS = 120;

export interface TooltipProps {
  /** The explanatory content. Plain text or a small fragment — never a form. */
  content: ReactNode;
  /**
   * Visible trigger content. Must be non-interactive (it is rendered inside a
   * `<button>`). Omit to get the default info glyph.
   */
  children?: ReactNode;
  /**
   * Accessible name for the trigger. Required when `children` is absent or
   * purely decorative — a bare "ⓘ" is not a name.
   */
  label?: string;
  placement?: TooltipPlacement;
  /** Class for the trigger button. */
  className?: string;
  /** Class for the portalled panel. */
  panelClassName?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

interface PanelPosition {
  top: number;
  left: number;
  placement: TooltipPlacement;
}

export function Tooltip({
  content,
  children,
  label,
  placement = "top",
  className,
  panelClassName,
  disabled = false,
  "data-testid": testId,
}: TooltipProps) {
  const reactId = useId();
  const tooltipId = `pk-tooltip-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition>({
    top: 0,
    left: 0,
    placement,
  });

  /**
   * Which interaction currently owns the open state.
   *
   * Needed because a mouse click is preceded by `pointerenter`: without this,
   * "hover opens" and "click toggles" would fight and a plain mouse click would
   * open then immediately close the tooltip. A click that arrives while hover
   * or focus already opened it PROMOTES ownership to `click` (so the next click
   * closes) rather than dismissing what the user just asked to see.
   */
  const openedBy = useRef<"none" | "pointer" | "focus" | "click">("none");

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const show = useCallback(
    (reason: "pointer" | "focus" | "click") => {
      if (disabled) return;
      cancelClose();
      openedBy.current = reason;
      setOpen(true);
    },
    [disabled, cancelClose],
  );

  const hide = useCallback(() => {
    cancelClose();
    openedBy.current = "none";
    setOpen(false);
  }, [cancelClose]);

  const hideSoon = useCallback(() => {
    // A click-owned tooltip is explicitly pinned: it must survive the pointer
    // leaving, and is dismissed by another click, Escape or an outside click.
    if (openedBy.current === "click") return;
    cancelClose();
    closeTimer.current = setTimeout(() => {
      openedBy.current = "none";
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  useEscapeKey(open, hide);

  /* ---- Positioning ---------------------------------------------------- */

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const t = trigger.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const vw = typeof window !== "undefined" ? window.innerWidth : 0;
    const vh = typeof window !== "undefined" ? window.innerHeight : 0;

    // Flip if the preferred side does not fit.
    let resolved: TooltipPlacement = placement;
    if (placement === "top" && t.top - p.height - OFFSET < VIEWPORT_MARGIN) {
      resolved = "bottom";
    } else if (placement === "bottom" && t.bottom + p.height + OFFSET > vh - VIEWPORT_MARGIN) {
      resolved = "top";
    }

    const top = resolved === "top" ? t.top - p.height - OFFSET : t.bottom + OFFSET;

    // Centre on the trigger, then clamp to the viewport. `Math.max` runs last
    // so a panel wider than the viewport pins to the left margin rather than
    // going negative on the right.
    const centred = t.left + t.width / 2 - p.width / 2;
    const clamped = Math.max(
      VIEWPORT_MARGIN,
      Math.min(centred, vw - p.width - VIEWPORT_MARGIN),
    );

    setPosition({ top, left: clamped, placement: resolved });
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onChange = () => reposition();
    window.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    return () => {
      window.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
    };
  }, [open, reposition]);

  /* ---- Outside dismissal (tap-opened tooltips) ------------------------- */

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      hide();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, hide]);

  /* ---- Handlers -------------------------------------------------------- */

  // Only a MOUSE pointer opens on enter. A touch fires pointerenter and then
  // click, which would open-then-close; letting click own touch keeps tap a
  // clean toggle.
  const onPointerEnter = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") return;
    show("pointer");
  };

  const onPointerLeave = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") return;
    hideSoon();
  };

  const onClick = () => {
    if (!open) {
      show("click");
      return;
    }
    if (openedBy.current === "click") {
      hide();
      return;
    }
    // Opened a moment ago by the hover/focus that preceded this click — pin it
    // instead of dismissing it.
    openedBy.current = "click";
  };

  const panelStyle: CSSProperties = {
    position: "fixed",
    top: position.top,
    left: position.left,
    zIndex: "var(--pk-z-tooltip, 120)",
    maxWidth: MAX_WIDTH,
    background: "var(--pk-surface-decision, var(--bg-elevated))",
    border: "1px solid var(--pk-surface-decision-border, var(--border-emphasis))",
    borderRadius: "var(--pk-r-md, 10px)",
    boxShadow: "var(--pk-elev-3, 0 8px 28px -8px rgba(0, 0, 0, 0.55))",
    color: "var(--text-primary)",
    padding: "var(--pk-space-2, 8px) var(--pk-space-3, 12px)",
    fontSize: 12,
    lineHeight: 1.5,
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        data-testid={testId}
        data-pk-tooltip-trigger=""
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center align-middle",
          disabled && "cursor-default opacity-60",
          className,
        )}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={() => show("focus")}
        onBlur={hide}
        onClick={onClick}
      >
        {children ?? (
          <span
            aria-hidden="true"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold leading-none"
            style={{
              border: "1px solid var(--border-emphasis)",
              color: "var(--text-secondary)",
            }}
          >
            i
          </span>
        )}
      </button>

      {open && (
        <Portal>
          <div
            ref={panelRef}
            id={tooltipId}
            role="tooltip"
            data-placement={position.placement}
            data-pk-tooltip-panel=""
            className={cn(panelClassName)}
            style={panelStyle}
            onPointerEnter={cancelClose}
            onPointerLeave={hideSoon}
          >
            {content}
          </div>
        </Portal>
      )}
    </>
  );
}

export interface ExplainerProps {
  /**
   * Accessible name for the info affordance. Write it as a question the user
   * would ask — "What is Playoff Rate Impact?" — never just "info".
   */
  label: string;
  /** The explanation itself. */
  term: ReactNode;
  placement?: TooltipPlacement;
  className?: string;
  "data-testid"?: string;
}

/**
 * The small "ⓘ" affordance used next to a term that needs one line of
 * explanation. A thin convenience over `Tooltip` so the app cannot end up with
 * five slightly different info buttons.
 */
export function Explainer({
  label,
  term,
  placement = "top",
  className,
  "data-testid": testId,
}: ExplainerProps) {
  return (
    <Tooltip
      content={term}
      label={label}
      placement={placement}
      data-testid={testId}
      className={cn("h-6 w-6 rounded-full", className)}
    />
  );
}

export default Tooltip;
