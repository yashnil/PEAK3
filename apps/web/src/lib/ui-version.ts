"use client";

/**
 * PEAK3 V2 UI-version switch: the CLIENT half. See `ui-version-script.ts`'s
 * module docstring for why the constants and the blocking pre-paint script
 * live in a separate, non-`"use client"` file, and for the precedence rule
 * (`?ui=` > stored preference > `"legacy"`).
 *
 * Built on `useSyncExternalStore`, the same pattern `useTheme`/
 * `usePrefersReducedMotion` already use: the resolved value is correct on
 * the very first client render, before paint, because `data-ui-version` is
 * already set on `<html>` by the blocking script before React ever mounts —
 * this hook only needs to read what is already there and stay in sync with
 * later local changes (the dev switch).
 *
 * THIS IS A DEVELOPMENT/LOCAL-TESTING MECHANISM, not a user-facing setting —
 * per the brief, there is no visible production toggle. `setUiVersion` exists
 * for `<UiVersionDevSwitch>` (a small, unlinked control) and for tests.
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
  if (typeof document === "undefined") return "legacy";
  const attr = document.documentElement.getAttribute(UI_VERSION_ATTR);
  return isUiVersion(attr) ? attr : "legacy";
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
  return current ?? "legacy";
}

/** Never used for anything visual-critical: the blocking script has already
 *  set the real attribute by the time of first client paint, same as
 *  `getResolvedServerSnapshot` in `theme.ts`. */
function getServerSnapshot(): UiVersion {
  return "legacy";
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
 *  module docstring). Every V2-aware component branches on this. */
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
