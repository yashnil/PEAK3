"use client";

/**
 * Theme system: System / Dark / Light — "Arena Night" / "Arena Day."
 *
 * SYNTHESIS_CONTRACT.md §3 / PRODUCT_EXPERIENCE_CONTRACT.md §9. The
 * blocking inline script (`themeInitScript()`, run before React ever
 * mounts) and its shared constants live in `lib/theme-script.ts` — a
 * plain, non-`"use client"` module, because `app/layout.tsx` is a Server
 * Component and Next.js cannot call a function imported from a `"use
 * client"` module directly (only render it as a component). This file is
 * the CLIENT half: everything that needs `useSyncExternalStore`, DOM
 * access after mount, or `matchMedia` change events.
 *
 * Two things this module is responsible for:
 *
 * 1. `useThemePreference()` / `useResolvedTheme()` / `setThemePreference()`
 *    — the React-facing API `<ThemeToggle>` and the account-menu setting
 *    read and call. Built on `useSyncExternalStore`, the same pattern
 *    `usePrefersReducedMotion` in `lib/a11y.ts` already uses: the resolved
 *    value is correct on the very first client render, before paint —
 *    there is no flash even for the toggle's own icon, let alone the page
 *    (which is already correct by the time React mounts, courtesy of the
 *    blocking script).
 *
 * 2. Live system-preference tracking while `preference === "system"`, via
 *    `matchMedia`'s `change` event — a user who never touched the toggle
 *    still sees the app follow their OS across the moment they flip it.
 *
 * SSR-safe: every DOM/`window`/`localStorage` access is guarded, and the
 * server snapshot is a fixed default (see `getResolvedServerSnapshot`) that
 * is never used for anything color-critical — by the time of first client
 * paint, `data-theme` already reflects the real preference from the
 * blocking script.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  isThemePreference,
  LIGHT_QUERY,
  THEME_ATTR,
  THEME_COLOR,
  THEME_STORAGE_KEY,
  themeInitScript,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme-script";

export type { ResolvedTheme, ThemePreference };
export { THEME_STORAGE_KEY, themeInitScript };

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : "system";
  } catch {
    // Storage blocked (private mode, disabled cookies) — behave as if no
    // preference was ever stored, exactly like `run-the-table-state.ts`.
    return "system";
  }
}

function systemPrefersLight(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(LIGHT_QUERY).matches;
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return systemPrefersLight() ? "light" : "dark";
  return preference;
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute(THEME_ATTR, resolved);
  // Tells the browser's own UI (form controls, scrollbars) which palette to
  // render natively, independent of the meta tag below.
  root.style.colorScheme = resolved;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLOR[resolved];
}

/* ------------------------------------------------------------------ */
/* React-facing store                                                  */
/* ------------------------------------------------------------------ */

type Listener = () => void;
const listeners = new Set<Listener>();

/** Lazily hydrated from storage on first client use — never read at module
 *  load time, which would run during SSR where there is no `window`. */
let currentPreference: ThemePreference | null = null;
let systemListenerInstalled = false;

function notify(): void {
  listeners.forEach((listener) => listener());
}

function ensureInitialized(): void {
  if (typeof window === "undefined") return;
  if (currentPreference === null) {
    currentPreference = readStoredPreference();
  }
  if (systemListenerInstalled || typeof window.matchMedia !== "function") return;
  systemListenerInstalled = true;
  const mql = window.matchMedia(LIGHT_QUERY);
  const onSystemChange = () => {
    // Only matters while following the system — an explicit dark/light
    // choice must never be silently overridden by an OS-level change.
    if (currentPreference === "system") {
      applyResolvedTheme(resolveTheme("system"));
      notify();
    }
  };
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onSystemChange);
  } else {
    // Safari < 14 / older jsdom shims — same fallback `usePrefersReducedMotion` uses.
    mql.addListener(onSystemChange);
  }
}

function subscribe(listener: Listener): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getPreferenceSnapshot(): ThemePreference {
  ensureInitialized();
  return currentPreference ?? "system";
}

function getPreferenceServerSnapshot(): ThemePreference {
  return "system";
}

function getResolvedSnapshot(): ResolvedTheme {
  return resolveTheme(getPreferenceSnapshot());
}

/** Never used for anything color-critical — see the module docstring. */
function getResolvedServerSnapshot(): ResolvedTheme {
  return "dark";
}

/**
 * Sets the theme preference: persists it, applies it to the DOM immediately,
 * and notifies every subscribed component. `"system"` re-arms live
 * OS-preference tracking (see `ensureInitialized`'s `onSystemChange`).
 */
export function setThemePreference(preference: ThemePreference): void {
  if (typeof window === "undefined") return;
  ensureInitialized();
  currentPreference = preference;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Quota exceeded or storage blocked — the theme still applies for this
    // session, it just will not survive a refresh. Never break the toggle.
  }
  applyResolvedTheme(resolveTheme(preference));
  notify();
}

/** `"system"` | `"dark"` | `"light"` — the stored/explicit preference. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getPreferenceSnapshot, getPreferenceServerSnapshot);
}

/** `"dark"` | `"light"` — the preference resolved against system state.
 *  Correct on the very first client render (see module docstring). */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, getResolvedSnapshot, getResolvedServerSnapshot);
}

/**
 * Convenience hook combining both reads plus a setter, for components (the
 * header toggle, the account-menu row) that need all three.
 */
export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
} {
  const preference = useThemePreference();
  const resolved = useResolvedTheme();
  const setPreference = useCallback((next: ThemePreference) => setThemePreference(next), []);
  return { preference, resolved, setPreference };
}

/**
 * Cycles System → Dark → Light → System. The header toggle's single-click
 * behaviour; the account-menu setting instead offers all three explicitly.
 */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  if (current === "system") return "dark";
  if (current === "dark") return "light";
  return "system";
}

/**
 * Test/SSR-only escape hatch: forces the next `ensureInitialized()` call to
 * re-read storage. Vitest's jsdom environment persists module state across
 * tests in the same file otherwise.
 */
export function __resetThemeStoreForTests(): void {
  currentPreference = null;
  systemListenerInstalled = false;
  listeners.clear();
}

// Re-exported for `app/layout.tsx` without a second import path.
export { applyResolvedTheme as __applyResolvedThemeForTests, resolveTheme as __resolveThemeForTests };
