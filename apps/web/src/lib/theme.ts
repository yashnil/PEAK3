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

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { getAccessToken } from "./auth";
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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function readStoredPreference(): ThemePreference {
  // Launch-polish IMPLEMENTATION_CONTRACT.md §2: new and signed-out users
  // default to Dark, not System. `isThemePreference` still accepts an
  // EXPLICITLY stored "system" (a user who chose it keeps following the
  // OS) -- only the no-preference-at-all fallback changed, here and in
  // `theme-script.ts`'s inline script, which must agree or the blocking
  // pre-paint script and this resolver would disagree and flash.
  if (typeof window === "undefined") return "dark";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : "dark";
  } catch {
    // Storage blocked (private mode, disabled cookies) — behave as if no
    // preference was ever stored, exactly like `run-the-table-state.ts`.
    return "dark";
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
  return currentPreference ?? "dark";
}

function getPreferenceServerSnapshot(): ThemePreference {
  return "dark";
}

function getResolvedSnapshot(): ResolvedTheme {
  return resolveTheme(getPreferenceSnapshot());
}

/** Never used for anything color-critical — see the module docstring. */
function getResolvedServerSnapshot(): ResolvedTheme {
  return "dark";
}

/* ------------------------------------------------------------------ */
/* Account sync (launch-polish IMPLEMENTATION_CONTRACT.md §2)          */
/* ------------------------------------------------------------------ */
//
// "Apply to documentElement synchronously, persist locally immediately,
// save to the account asynchronously in the background, and a failed
// account save must never revert the visible theme." The first three
// already happen, synchronously, in `setThemePreference` below, before
// this is ever called — this function ONLY talks to the network, never
// touches the DOM or localStorage, so there is nothing for a failure here
// to revert.
//
// `theme_preference` is not a field `PUT /api/v1/profiles/me/settings`
// accepts yet — that endpoint is `apps/api/**`, identity-community's
// file, not this pass's to add. Until it exists server-side this call is
// a harmless no-op (FastAPI/pydantic silently drops unknown request
// fields by default; a 4xx/5xx or a network failure is swallowed the same
// way) — ready to start actually persisting the moment the field ships,
// with no client-side change required.

/** Fire-and-forget. Never throws, never touches the visible theme. */
function saveThemePreferenceToAccount(preference: ThemePreference): void {
  if (typeof window === "undefined") return;
  void (async () => {
    try {
      const token = await getAccessToken();
      if (!token) return; // signed out / no Supabase project configured
      await fetch(`${API_BASE}/api/v1/profiles/me/settings`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ theme_preference: preference }),
      });
    } catch {
      // Network error, expired session mid-flight, endpoint not deployed
      // yet -- all silently ignored, by design (see banner above).
    }
  })();
}

/**
 * Reads the signed-in user's saved preference back, for reconciling a new
 * device/browser against the account rather than the account against a
 * fresh device's empty localStorage. Returns `null` on ANY failure
 * (including "the field does not exist in the response yet"), which
 * callers treat identically to "the account has no saved preference".
 */
async function fetchAccountThemePreference(): Promise<ThemePreference | null> {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const res = await fetch(`${API_BASE}/api/v1/profiles/me/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const value = (body as { theme_preference?: unknown } | null)?.theme_preference;
    return isThemePreference(value) ? value : null;
  } catch {
    return null;
  }
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
  // Everything visible/persisted-locally is already done by this point --
  // the account save is genuinely a fire-and-forget afterthought, per the
  // contract's "never revert the visible theme" rule.
  saveThemePreferenceToAccount(preference);
}

/**
 * Mount once for a signed-in session (the account menu does this) to pull
 * the account's saved preference onto a fresh device/browser. A no-op
 * while signed out, and a no-op if the account has never saved one (the
 * common case until identity-community ships the field — see the banner
 * above `saveThemePreferenceToAccount`). Runs once per sign-in, not on
 * every render.
 */
export function useAccountThemeSync(signedIn: boolean): void {
  const syncedForThisSession = useRef(false);
  useEffect(() => {
    if (!signedIn) {
      syncedForThisSession.current = false;
      return;
    }
    if (syncedForThisSession.current) return;
    syncedForThisSession.current = true;
    let cancelled = false;
    fetchAccountThemePreference().then((accountPreference) => {
      if (cancelled || accountPreference === null) return;
      setThemePreference(accountPreference);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);
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
 * What the header toggle sets on its next click: THE OPPOSITE OF WHAT IS
 * CURRENTLY ON SCREEN, always, as an explicit preference.
 *
 * THE DEFECT THIS REPLACES, and why it was asymmetric. This function used to
 * cycle System → Dark → Light → System — three preferences over a binary
 * appearance. From `"light"` the next preference was `"system"`, and on a
 * machine whose OS is itself in light mode `resolveTheme("system") === "light"`,
 * so the click changed the stored preference and changed NOTHING the user could
 * see. The second click reached `"dark"`. That is exactly the reported
 * behaviour: Dark → Light in one click (dark → light genuinely flips), Light →
 * Dark in two. It was not a hydration race, a replaced node or a competing
 * provider; it was a three-state cycle driving a two-state surface, and it was
 * deterministic on any light-mode OS.
 *
 * The contract now: a click on the header toggle is an EXPLICIT choice of the
 * theme you are not currently in. `resolved` — not `current` — is the input,
 * because the visible theme is the thing the user is toggling, and it is the
 * only value that is well defined when the preference is `"system"`. An
 * explicit choice overrides the system preference by construction, since
 * `"light"`/`"dark"` are never re-resolved against `matchMedia`.
 *
 * `"system"` is still a first-class preference and is still reachable — the
 * account menu's `variant="menu"` offers all three explicitly, which is the
 * surface where "what are my choices" is the question. It is simply no longer
 * an invisible stop on the way between the two visible ones.
 */
export function nextThemePreference(resolved: ResolvedTheme): ThemePreference {
  return resolved === "dark" ? "light" : "dark";
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
