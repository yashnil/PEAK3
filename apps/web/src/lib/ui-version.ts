"use client";

/**
 * PEAK3 V2 UI-version switch: the CLIENT half. See `ui-version-script.ts`'s
 * module docstring for why the constants and the blocking pre-paint script
 * live in a separate, non-`"use client"` file, and for why the blocking
 * script now unconditionally resolves `"v2"`.
 *
 * Built on `useSyncExternalStore`, the same pattern `useTheme`/
 * `usePrefersReducedMotion` already use: the resolved value is correct on
 * the very first client render, before paint, because `data-ui-version` is
 * already set on `<html>` by the blocking script before React ever mounts —
 * this hook only needs to read what is already there and stay in sync with
 * later local changes (the dev switch).
 *
 * V2 is the only presentation this app ships. `setUiVersion` exists only
 * for `<UiVersionDevSwitch>` (a small, unlinked, env-gated control never
 * reachable in production — see that file) and for tests; it is not a
 * user-facing setting.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  isUiVersion,
  UI_VERSION_ATTR,
  UI_VERSION_STORAGE_KEY,
  uiVersionInitScript,
  type UiVersion,
} from "./ui-version-script";

export type { UiVersion };
export { UI_VERSION_STORAGE_KEY, uiVersionInitScript };

function readAttrVersion(): UiVersion {
  if (typeof document === "undefined") return "v2";
  const attr = document.documentElement.getAttribute(UI_VERSION_ATTR);
  return isUiVersion(attr) ? attr : "v2";
}

function applyVersion(version: UiVersion): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(UI_VERSION_ATTR, version);
}

const listeners = new Set<() => void>();

/** Lazily hydrated from the DOM (already set by the blocking script) on
 *  first client use — never read at module load time, which would run
 *  during SSR where there is no `document`. */
let current: UiVersion | null = null;

function notify(): void {
  listeners.forEach((listener) => listener());
}

function ensureInitialized(): void {
  if (typeof document === "undefined") return;
  if (current === null) {
    current = readAttrVersion();
  }
}

function subscribe(listener: () => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): UiVersion {
  ensureInitialized();
  return current ?? "v2";
}

/** Never used for anything visual-critical: the blocking script has already
 *  set the real attribute by the time of first client paint, same as
 *  `getResolvedServerSnapshot` in `theme.ts`. V2 is the only shipped
 *  presentation, so this is `"v2"`, not `"legacy"`. */
function getServerSnapshot(): UiVersion {
  return "v2";
}

/**
 * Explicitly sets the local UI-version preference: persists it, applies it
 * to `<html data-ui-version>` immediately, and notifies every subscribed
 * component. Used by the dev-only switch and by tests — never called from
 * any production-facing control.
 */
export function setUiVersion(version: UiVersion): void {
  if (typeof window === "undefined") return;
  ensureInitialized();
  current = version;
  try {
    window.localStorage.setItem(UI_VERSION_STORAGE_KEY, version);
  } catch {
    // Quota exceeded or storage blocked — still applies for this session,
    // just will not survive a refresh. Never break the switch.
  }
  applyVersion(version);
  notify();
}

/** `"legacy"` | `"v2"` — correct on the very first client render (see
 *  module docstring), and always `"v2"` in production. Used by the dev-only
 *  switch and by tests; no page or game component branches on this any
 *  more. */
export function useUiVersion(): UiVersion {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Convenience hook combining the read plus a memoized setter, for the dev
 *  switch. */
export function useUiVersionControl(): {
  version: UiVersion;
  setVersion: (version: UiVersion) => void;
} {
  const version = useUiVersion();
  const setVersion = useCallback((next: UiVersion) => setUiVersion(next), []);
  return { version, setVersion };
}

/**
 * Test-only escape hatch: forces the next `ensureInitialized()` call to
 * re-read the DOM. Vitest's jsdom environment persists module state across
 * tests in the same file otherwise — mirrors
 * `__resetThemeStoreForTests`.
 */
export function __resetUiVersionStoreForTests(): void {
  current = null;
  listeners.clear();
}
