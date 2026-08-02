"use client";

/**
 * Shared accessibility primitives.
 *
 * Every hook here is SSR-safe (no `window`/`document` access during render)
 * and jsdom-safe (no reliance on layout APIs jsdom does not implement, such as
 * `offsetParent`, which is always `null` there).
 *
 * Owner: W7. Consumed by `src/components/ui/*` and by any workstream that
 * needs a modal, menu, drawer or popover. Nothing in here reads or writes game
 * state — these are pure interaction utilities.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";

/**
 * The focusable-element selector.
 *
 * Copied VERBATIM from `components/rankings/ScoreExplainModal.tsx` (its inline
 * focus trap), so the shared trap and the three hand-rolled dialogs that
 * predate it agree on exactly which elements are reachable. Do not "improve"
 * it without re-checking those dialogs.
 */
export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Focusable descendants of `container`, in DOM order.
 *
 * Deliberately does NOT filter on rendered visibility: jsdom reports
 * `offsetParent === null` and zero-size rects for everything, so a
 * visibility filter would return an empty list under test and silently
 * disable every trap. Attribute-level hiding (`disabled`, `hidden`,
 * `aria-hidden="true"`, `inert`) is honoured because it is observable in
 * both environments.
 */
export function getFocusableElements(container: HTMLElement | null | undefined): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.getAttribute("aria-hidden") !== "true" &&
      !el.closest("[hidden]") &&
      !el.closest("[inert]"),
  );
}

/* ------------------------------------------------------------------ */
/* Layer stack                                                         */
/* ------------------------------------------------------------------ */

/**
 * Module-level stack of active overlay layers, innermost last.
 *
 * A dialog opened on top of another dialog must be the only one that reacts to
 * Tab and Escape; without this, both would handle the same keystroke and the
 * outer one would steal focus back. Every hook below that installs a
 * document-level key listener checks `isTopLayer` first.
 */
const layerStack: symbol[] = [];

/**
 * Registers an overlay layer while `active`, and returns a stable predicate
 * that reports whether this layer is currently the innermost one.
 *
 * The predicate is a function rather than a boolean on purpose: it must be
 * evaluated at event time, not at render time.
 */
export function useLayerStack(active: boolean): () => boolean {
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) idRef.current = Symbol("pk-layer");

  useEffect(() => {
    if (!active) return;
    const id = idRef.current;
    if (!id) return;
    layerStack.push(id);
    return () => {
      const index = layerStack.lastIndexOf(id);
      if (index !== -1) layerStack.splice(index, 1);
    };
  }, [active]);

  return useCallback(() => {
    const id = idRef.current;
    if (!id) return false;
    if (layerStack.length === 0) return true;
    return layerStack[layerStack.length - 1] === id;
  }, []);
}

/* ------------------------------------------------------------------ */
/* Focus trap                                                          */
/* ------------------------------------------------------------------ */

/**
 * Cycles Tab / Shift-Tab inside `ref` while `active`.
 *
 * Listens in the capture phase on `document` (not on the container) so it also
 * catches the case where focus has escaped the container entirely — pulling it
 * back in rather than letting the browser walk into the page behind the modal.
 *
 * Nested overlays: only the innermost registered layer acts.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean = true,
  /**
   * Share one layer registration with the other hooks on the same surface.
   * A component that calls both `useFocusTrap` and `useEscapeKey` MUST pass the
   * same predicate to both — otherwise each hook pushes its own layer and the
   * one registered first is permanently not-topmost, silently disabling it.
   */
  sharedIsTopLayer?: () => boolean,
): void {
  const ownIsTopLayer = useLayerStack(active && sharedIsTopLayer === undefined);
  const isTopLayer = sharedIsTopLayer ?? ownIsTopLayer;

  useEffect(() => {
    if (!active || typeof document === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      if (!isTopLayer()) return;
      const container = ref.current;
      if (!container) return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        // Nothing to move to — keep focus on the container itself rather than
        // letting Tab leak to the page behind a modal surface.
        event.preventDefault();
        container.focus?.();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement;
      const inside = container.contains(activeEl);

      if (event.shiftKey && (activeEl === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeEl === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [ref, active, isTopLayer]);
}

/* ------------------------------------------------------------------ */
/* Focus restoration                                                   */
/* ------------------------------------------------------------------ */

/**
 * Remembers `document.activeElement` when `active` becomes true and restores
 * focus to it when `active` becomes false (or the component unmounts).
 *
 * Guards on `document.contains` because the element that opened the overlay may
 * itself have been unmounted while the overlay was open — focusing a detached
 * node silently sends focus to `<body>` and strands keyboard users.
 *
 * `fallback` covers the case where there was no invoking control at all. An
 * overlay that opens from an effect rather than a click — the first-run guided
 * tour is exactly this — captures `<body>` as "the previously focused element",
 * and `<body>` passes both guards above: it is in the document and it has a
 * `focus` method. Restoring to it is therefore a silent no-op that leaves focus
 * at the top of the document, which is the same stranding this hook exists to
 * prevent. Pass the control the user should land on instead (for the tour, its
 * own Help/Tour button).
 */
export function useRestoreFocus(
  active: boolean,
  fallback?: RefObject<HTMLElement | null>,
): void {
  const previous = useRef<HTMLElement | null>(null);
  // Read through a ref so a changing fallback never re-runs the effect and
  // re-captures `previous` mid-overlay.
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const captured = document.activeElement as HTMLElement | null;
    // `<body>` (or null) means nothing meaningful had focus — treat it as "no
    // origin" rather than as a restoration target.
    previous.current = captured && captured !== document.body ? captured : null;
    return () => {
      const el = previous.current ?? fallbackRef.current?.current ?? null;
      previous.current = null;
      if (el && typeof el.focus === "function" && document.contains(el)) {
        el.focus();
      }
    };
  }, [active]);
}

/* ------------------------------------------------------------------ */
/* Reduced motion                                                      */
/* ------------------------------------------------------------------ */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function matchMediaSupported(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function subscribeReducedMotion(onChange: () => void): () => void {
  if (!matchMediaSupported()) return () => {};
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }
  // Safari < 14 / older jsdom shims.
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

function getReducedMotionSnapshot(): boolean {
  if (!matchMediaSupported()) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

/**
 * `true` when the user asked for reduced motion.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` so the value is
 * already correct on the FIRST client render: an animation must never get one
 * frame of movement in before the preference is noticed. Returns `false` during
 * SSR (the server cannot know), and `false` where `matchMedia` is unavailable.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
}

/* ------------------------------------------------------------------ */
/* Body scroll lock                                                    */
/* ------------------------------------------------------------------ */

let scrollLockCount = 0;
let scrollLockPrevious = "";

/**
 * Freezes background scrolling while `active`.
 *
 * Reference-counted: a dialog opened from inside another dialog must not
 * restore the page's scrolling when only the inner one closes.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    if (scrollLockCount === 0) {
      scrollLockPrevious = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    scrollLockCount += 1;
    return () => {
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) {
        document.body.style.overflow = scrollLockPrevious;
      }
    };
  }, [active]);
}

/* ------------------------------------------------------------------ */
/* Escape                                                              */
/* ------------------------------------------------------------------ */

/**
 * Calls `handler` on Escape while `active`, for the innermost layer only.
 *
 * Shared so every dismissible surface in the app (dialog, tooltip, menu,
 * drawer, tour) dismisses the same way and a nested surface never closes its
 * parent along with itself.
 */
export function useEscapeKey(
  active: boolean,
  handler: () => void,
  /** See `useFocusTrap`'s `sharedIsTopLayer`. */
  sharedIsTopLayer?: () => boolean,
): void {
  const ownIsTopLayer = useLayerStack(active && sharedIsTopLayer === undefined);
  const isTopLayer = sharedIsTopLayer ?? ownIsTopLayer;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!isTopLayer()) return;
      event.stopPropagation();
      handlerRef.current();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, isTopLayer]);
}

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

/** Prefix used by every generated id in the primitives, for easy grepping. */
export const PK_ID_PREFIX = "pk";
