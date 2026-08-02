"use client";

/**
 * GuidedTour — a portalled, accessible, spotlight walkthrough.
 *
 * Owner: W3 (UX / Organization / Polish pass).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN driver.js
 * ---------------------------------------------------------------------------
 * Plan §2: zero new runtime dependencies. driver.js owns its own DOM overlay
 * outside React, which fights the portal/focus-trap model the rest of this pass
 * standardised on (`@/lib/a11y`), and it cannot be code-split as cleanly as a
 * `next/dynamic({ ssr: false })` import of a component we own. This is ~1 file
 * built on the primitives that already exist.
 *
 * ---------------------------------------------------------------------------
 * THE SPOTLIGHT
 * ---------------------------------------------------------------------------
 * The dim is an SVG rect with a MASK punched out of it, not an opacity wash
 * over the page. That distinction is the accessibility requirement: an
 * `opacity: 0.5` layer above the content would drag the spotlighted text's
 * contrast down with everything else. With a mask, the highlighted region is
 * rendered at full, untouched contrast and only its surroundings are dimmed.
 *
 * ---------------------------------------------------------------------------
 * DEGRADATION
 * ---------------------------------------------------------------------------
 * A step whose targets are all missing (or all zero-sized, which is how a
 * hidden responsive layout looks) is shown CENTRED with no spotlight. It is
 * never skipped silently and never crashes — that is the normal case on the
 * start gate, where the run does not exist yet, and it is what protects the
 * tour from a W4 refactor that moves an attribute.
 *
 * ---------------------------------------------------------------------------
 * SSR / LAZY LOADING
 * ---------------------------------------------------------------------------
 * No DOM access at module scope, so `next/dynamic(() => import(...),
 * { ssr: false })` is safe and so is a plain static import.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { Portal } from "./Portal";
import {
  COACHMARKS,
  RUN_THE_TABLE_TOUR,
  RUN_THE_TABLE_TOUR_ID,
  RUN_THE_TABLE_TOUR_VERSION,
  type CoachmarkId,
  type TourStep,
} from "./tour-steps";
import {
  markCoachmarkSeen,
  markTourSeen,
  shouldAutoStartTour,
  shouldShowCoachmark,
  type TourSeenStatus,
} from "@/lib/tour-state";
import { useEscapeKey, useFocusTrap, useLayerStack, usePrefersReducedMotion, useRestoreFocus } from "@/lib/a11y";

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** Breathing room between the spotlight edge and the highlighted element. */
const SPOTLIGHT_PADDING = 8;
/** Gap between the spotlight and the popover, and the minimum viewport inset. */
const POPOVER_GAP = 12;
const VIEWPORT_MARGIN = 12;
const POPOVER_WIDTH = 320;
/** Assumed popover height before it has been measured, for the flip decision. */
const POPOVER_FALLBACK_HEIGHT = 200;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface PopoverPosition {
  top: number;
  left: number;
  placement: "top" | "bottom" | "center";
}

/**
 * The element a step should spotlight.
 *
 * Targets are tried in order. Within one id, the first element with a non-zero
 * rect wins — that is how a single step covers the desktop rail and the mobile
 * tray, which render the same information twice with one of them
 * `display: none`. If every match is zero-sized (jsdom reports zeros for
 * everything) the first match is still returned, so tests resolve a target and
 * the DOM contract is exercised.
 */
export function findTourTarget(targets: readonly string[]): HTMLElement | null {
  if (typeof document === "undefined") return null;
  for (const id of targets) {
    const escaped = id.replace(/["\\]/g, "\\$&");
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-tour-id="${escaped}"]`),
    );
    if (nodes.length === 0) continue;
    const laidOut = nodes.find((node) => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    return laidOut ?? nodes[0];
  }
  return null;
}

function rectOf(el: HTMLElement | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r || (r.width <= 0 && r.height <= 0)) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function viewport(): { w: number; h: number } {
  if (typeof window === "undefined") return { w: 0, h: 0 };
  return { w: window.innerWidth || 0, h: window.innerHeight || 0 };
}

/**
 * Where the popover goes.
 *
 * Below the spotlight by default; flipped above when there is not enough room
 * below; centred in the viewport when there is no spotlight at all or when
 * neither side fits (a target taller than the screen). Horizontally it is
 * centred on the target and then clamped, so it can never render off-screen —
 * the `Math.max` runs last so a viewport narrower than the popover pins to the
 * left margin instead of going negative.
 */
export function computePopoverPosition(
  spotlight: Rect | null,
  popover: { width: number; height: number },
  view: { w: number; h: number },
): PopoverPosition {
  const width = Math.min(popover.width || POPOVER_WIDTH, Math.max(0, view.w - VIEWPORT_MARGIN * 2));
  const height = popover.height || POPOVER_FALLBACK_HEIGHT;

  if (!spotlight || view.w === 0 || view.h === 0) {
    return {
      top: Math.max(VIEWPORT_MARGIN, (view.h - height) / 2),
      left: Math.max(VIEWPORT_MARGIN, (view.w - width) / 2),
      placement: "center",
    };
  }

  const below = spotlight.top + spotlight.height + SPOTLIGHT_PADDING + POPOVER_GAP;
  const above = spotlight.top - SPOTLIGHT_PADDING - POPOVER_GAP - height;

  let placement: PopoverPosition["placement"];
  let top: number;
  if (below + height <= view.h - VIEWPORT_MARGIN) {
    placement = "bottom";
    top = below;
  } else if (above >= VIEWPORT_MARGIN) {
    placement = "top";
    top = above;
  } else {
    placement = "center";
    top = Math.max(VIEWPORT_MARGIN, (view.h - height) / 2);
  }

  const centred = spotlight.left + spotlight.width / 2 - width / 2;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(centred, view.w - width - VIEWPORT_MARGIN),
  );

  return { top, left, placement };
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export interface UseGuidedTourOptions {
  tourId?: string;
  version?: number;
  /**
   * Suppresses auto-start entirely while true.
   *
   * W4 SUPPLIES THIS. It must be true while a destructive confirmation is open
   * and while a battle reveal is animating: a spotlight that appears over a
   * confirm dialog, or halfway through a lane-by-lane reveal, is worse than no
   * onboarding at all. When it goes back to false the auto-start is
   * re-evaluated, so a first-time player who lands mid-animation still gets the
   * tour — just afterwards.
   */
  blocked?: boolean;
  /** Set false for a launcher that should never open by itself (the start gate). */
  autoStart?: boolean;
}

export interface GuidedTourController {
  open: boolean;
  /** Open it now, regardless of whether it has been seen. */
  start: () => void;
  /** Close it and record why. */
  finish: (status: TourSeenStatus) => void;
  /**
   * Close it WITHOUT recording anything.
   *
   * For a controlled `<GuidedTour>`, which has already persisted the outcome
   * itself — calling `finish` again from the parent's `onOpenChange` would
   * overwrite a "completed" record with "skipped".
   */
  stop: () => void;
}

/**
 * Auto-start + open/close state for a tour, without rendering anything.
 *
 * Exported so a workstream that wants its own trigger UI can drive a
 * `<GuidedTour open=… />` directly.
 */
export function useGuidedTour({
  tourId = RUN_THE_TABLE_TOUR_ID,
  version = RUN_THE_TABLE_TOUR_VERSION,
  blocked = false,
  autoStart = true,
}: UseGuidedTourOptions = {}): GuidedTourController {
  const [open, setOpen] = useState(false);
  /** Auto-start is a once-per-mount decision; a manual replay must not undo it. */
  const decided = useRef(false);

  useEffect(() => {
    if (!autoStart || decided.current) return;
    // Still blocked — do not decide yet. The effect re-runs when it clears.
    if (blocked) return;
    decided.current = true;
    if (shouldAutoStartTour(tourId, version)) setOpen(true);
  }, [autoStart, blocked, tourId, version]);

  const start = useCallback(() => {
    decided.current = true;
    setOpen(true);
  }, []);

  const finish = useCallback(
    (status: TourSeenStatus) => {
      markTourSeen(tourId, version, status);
      setOpen(false);
    },
    [tourId, version],
  );

  const stop = useCallback(() => setOpen(false), []);

  return { open, start, finish, stop };
}

/* ------------------------------------------------------------------ */
/* GuidedTour                                                          */
/* ------------------------------------------------------------------ */

export interface GuidedTourProps {
  steps?: readonly TourStep[];
  tourId?: string;
  version?: number;
  /**
   * Controlled open state. Omit to let the component manage itself (including
   * first-run auto-start via `useGuidedTour`).
   */
  open?: boolean;
  /** Called with `false` whenever the tour closes, in controlled mode. */
  onOpenChange?: (open: boolean) => void;
  /** See `UseGuidedTourOptions.blocked`. Supplied by W4. */
  blocked?: boolean;
  autoStart?: boolean;
  /** Heading above the step title — names what is being explained. */
  eyebrow?: string;
  "data-testid"?: string;
}

export function GuidedTour({
  steps = RUN_THE_TABLE_TOUR,
  tourId = RUN_THE_TABLE_TOUR_ID,
  version = RUN_THE_TABLE_TOUR_VERSION,
  open: openProp,
  onOpenChange,
  blocked = false,
  autoStart = true,
  eyebrow = "How Run the Table works",
  "data-testid": testId = "guided-tour",
}: GuidedTourProps) {
  const controlled = openProp !== undefined;
  const self = useGuidedTour({ tourId, version, blocked, autoStart: autoStart && !controlled });
  const open = controlled ? Boolean(openProp) : self.open;

  const close = useCallback(
    (status: TourSeenStatus) => {
      if (controlled) {
        markTourSeen(tourId, version, status);
        onOpenChange?.(false);
        return;
      }
      self.finish(status);
    },
    [controlled, onOpenChange, self, tourId, version],
  );

  if (steps.length === 0 || !open) return null;

  return (
    <Portal>
      <TourOverlay
        steps={steps}
        eyebrow={eyebrow}
        onClose={close}
        testId={testId}
      />
    </Portal>
  );
}

interface TourOverlayProps {
  steps: readonly TourStep[];
  eyebrow: string;
  onClose: (status: TourSeenStatus) => void;
  testId: string;
}

/**
 * The overlay itself. Split out so every hook below runs only while the tour is
 * actually open — mounting/unmounting it is what drives focus capture and
 * restoration.
 */
function TourOverlay({ steps, eyebrow, onClose, testId }: TourOverlayProps) {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const step = steps[Math.min(index, steps.length - 1)];

  const popoverRef = useRef<HTMLDivElement>(null);
  const [spotlight, setSpotlight] = useState<Rect | null>(null);
  const [position, setPosition] = useState<PopoverPosition>({
    top: VIEWPORT_MARGIN,
    left: VIEWPORT_MARGIN,
    placement: "center",
  });

  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const maskId = `pk-tour-mask-${safeId}`;
  const titleId = `pk-tour-title-${safeId}`;
  const bodyId = `pk-tour-body-${safeId}`;

  /* ---- Focus ---------------------------------------------------------- */

  // ONE layer registration shared by both hooks. Two registrations would leave
  // whichever hook registered first permanently not-topmost — see `useFocusTrap`.
  const isTopLayer = useLayerStack(true);
  useFocusTrap(popoverRef, true, isTopLayer);
  useEscapeKey(true, () => onClose("skipped"), isTopLayer);
  useRestoreFocus(true);

  useEffect(() => {
    popoverRef.current?.focus?.();
  }, []);

  /* ---- Measurement ----------------------------------------------------- */

  const measure = useCallback(() => {
    const target = findTourTarget(step.targets);
    const rect = rectOf(target);
    setSpotlight(rect);
    const popover = popoverRef.current;
    const size = popover
      ? { width: popover.offsetWidth || POPOVER_WIDTH, height: popover.offsetHeight || POPOVER_FALLBACK_HEIGHT }
      : { width: POPOVER_WIDTH, height: POPOVER_FALLBACK_HEIGHT };
    setPosition(computePopoverPosition(rect, size, viewport()));
  }, [step.targets]);

  // Scroll the target into view, then measure. `useLayoutEffect` so the first
  // painted frame is already in the right place rather than jumping.
  useLayoutEffect(() => {
    const target = findTourTarget(step.targets);
    if (target && typeof target.scrollIntoView === "function") {
      try {
        target.scrollIntoView({
          behavior: reduced ? "auto" : "smooth",
          block: "center",
          inline: "center",
        });
      } catch {
        // Older engines only accept the boolean form; a failed scroll must not
        // take the tour down with it.
      }
    }
    measure();
  }, [step.targets, measure, reduced]);

  // Recompute on resize and on scroll, throttled to one rAF. Scroll is captured
  // so an inner scrolling container (the RUN THE TABLE rails both scroll) also
  // triggers it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [measure]);

  /* ---- Navigation ------------------------------------------------------ */

  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const next = useCallback(() => {
    if (isLast) {
      onClose("completed");
      return;
    }
    setIndex((i) => Math.min(steps.length - 1, i + 1));
  }, [isLast, onClose, steps.length]);

  /* ---- Styles ---------------------------------------------------------- */

  const hole = useMemo(() => {
    if (!spotlight) return null;
    return {
      x: Math.max(0, spotlight.left - SPOTLIGHT_PADDING),
      y: Math.max(0, spotlight.top - SPOTLIGHT_PADDING),
      width: spotlight.width + SPOTLIGHT_PADDING * 2,
      height: spotlight.height + SPOTLIGHT_PADDING * 2,
    };
  }, [spotlight]);

  const popoverStyle: CSSProperties = {
    top: position.top,
    left: position.left,
    width: POPOVER_WIDTH,
    maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
  };

  return (
    <div
      className="pk-tour"
      data-testid={testId}
      data-motion={reduced ? "none" : "auto"}
      data-step={step.id}
      data-placement={position.placement}
    >
      {/* The dim. A mask, not an opacity wash — the spotlighted region keeps
          its real contrast (see the module docstring). */}
      <svg className="pk-tour-scrim" aria-hidden="true" focusable="false">
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
            {hole && (
              <rect
                x={hole.x}
                y={hole.y}
                width={hole.width}
                height={hole.height}
                rx="14"
                fill="#000"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" mask={`url(#${maskId})`} />
      </svg>

      {hole && (
        <div
          className="pk-tour-ring"
          data-testid="guided-tour-spotlight"
          aria-hidden="true"
          style={{ top: hole.y, left: hole.x, width: hole.width, height: hole.height }}
        />
      )}

      <div
        ref={popoverRef}
        className="pk-tour-popover"
        data-testid="guided-tour-popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        style={popoverStyle}
      >
        <div className="pk-tour-head">
          <div className="pk-tour-eyebrow">
            <span>{eyebrow}</span>
            <span className="pk-tour-progress" data-testid="guided-tour-progress">
              {index + 1} of {steps.length}
            </span>
          </div>
          <button
            type="button"
            className="pk-tour-close"
            data-testid="guided-tour-close"
            aria-label="Close the tour"
            onClick={() => onClose("skipped")}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <h2 className="pk-tour-title" id={titleId} data-testid="guided-tour-title">
          {step.title}
        </h2>

        <div className="pk-tour-body" id={bodyId} data-testid="guided-tour-body">
          <p>{step.body}</p>
          {step.detail && <p className="pk-tour-detail">{step.detail}</p>}
        </div>

        <div className="pk-tour-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={s.id} className="pk-tour-dot" data-active={i === index ? "true" : "false"} />
          ))}
        </div>

        <div className="pk-tour-actions">
          <button
            type="button"
            className="pk-tour-btn pk-tour-btn-quiet"
            data-testid="guided-tour-skip"
            onClick={() => onClose("skipped")}
          >
            Skip
          </button>
          <div className="pk-tour-actions-right">
            <button
              type="button"
              className="pk-tour-btn pk-tour-btn-quiet"
              data-testid="guided-tour-back"
              onClick={back}
              disabled={isFirst}
            >
              Back
            </button>
            <button
              type="button"
              className="pk-tour-btn pk-tour-btn-primary"
              data-testid="guided-tour-next"
              onClick={next}
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Launcher                                                            */
/* ------------------------------------------------------------------ */

export interface TourLauncherProps {
  label?: string;
  className?: string;
  steps?: readonly TourStep[];
  tourId?: string;
  version?: number;
  /** See `UseGuidedTourOptions.blocked`. Also disables the button. */
  blocked?: boolean;
  autoStart?: boolean;
  eyebrow?: string;
  "data-testid"?: string;
}

/**
 * The visible **Help / Tour** control, with the tour attached.
 *
 * This is the one-line mount for W4:
 *
 * ```tsx
 * <TourLauncher blocked={busy || battleAnimating} />
 * ```
 *
 * Focus returns here on close, because `useRestoreFocus` captured this button
 * as the active element when the overlay mounted.
 */
export function TourLauncher({
  label = "How to play",
  className,
  steps,
  tourId,
  version,
  blocked = false,
  autoStart = true,
  eyebrow,
  "data-testid": testId = "tour-launcher",
}: TourLauncherProps) {
  const tour = useGuidedTour({ tourId, version, blocked, autoStart });

  return (
    <>
      <button
        type="button"
        className={className ?? "pk-tour-launcher"}
        data-testid={testId}
        onClick={tour.start}
        disabled={blocked}
        aria-haspopup="dialog"
      >
        <span aria-hidden="true" className="pk-tour-launcher-glyph">
          ?
        </span>
        <span>{label}</span>
      </button>
      <GuidedTour
        steps={steps}
        tourId={tourId}
        version={version}
        eyebrow={eyebrow}
        open={tour.open}
        onOpenChange={(next) => {
          // `stop`, not `finish`: the controlled GuidedTour already persisted
          // the real outcome before calling this.
          if (!next) tour.stop();
        }}
        autoStart={false}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Coachmark                                                           */
/* ------------------------------------------------------------------ */

export interface CoachmarkProps {
  id: CoachmarkId;
  version?: number;
  /** Extra content under the body — a link, a chip. Rarely needed. */
  children?: ReactNode;
  className?: string;
}

/**
 * A one-time inline hint for the first visit to a node type.
 *
 * DELIBERATELY NOT A TOUR: no portal, no spotlight, no focus trap, no step
 * sequence, no Escape handler. It is a paragraph with a dismiss button that
 * remembers itself, so entering a Draft Room for the first time costs one
 * sentence — not a seven-step replay.
 *
 * MOUNTING HAZARD, for whoever adds these to the remaining surfaces:
 * `e2e/run-the-table.spec.ts` drives the game by clicking the FIRST enabled
 * `<button>` inside a surface's testid. Mount a coachmark AFTER the surface's
 * action controls in DOM order, never before them.
 */
export function Coachmark({
  id,
  version = RUN_THE_TABLE_TOUR_VERSION,
  children,
  className,
}: CoachmarkProps) {
  // Read the flag in an effect, not during render: `shouldShowCoachmark` is a
  // localStorage read, and reading it during render would make the server HTML
  // and the first client render disagree.
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(shouldShowCoachmark(id, version));
  }, [id, version]);

  if (!show) return null;
  const copy = COACHMARKS[id];
  if (!copy) return null;

  return (
    <aside
      className={className ?? "pk-coachmark"}
      data-testid={`coachmark-${id}`}
      aria-label={copy.title}
    >
      <p className="pk-coachmark-title">{copy.title}</p>
      <p className="pk-coachmark-body">{copy.body}</p>
      {children}
      <button
        type="button"
        className="pk-coachmark-dismiss"
        data-testid={`coachmark-dismiss-${id}`}
        onClick={() => {
          markCoachmarkSeen(id, version);
          setShow(false);
        }}
      >
        Got it
      </button>
    </aside>
  );
}

export default GuidedTour;
