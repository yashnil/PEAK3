/**
 * The blocking UI-version-init script's source, plus the constants both it
 * and `lib/ui-version.ts` share.
 *
 * Mirrors `theme-script.ts` exactly, for the same reason: `app/layout.tsx`
 * is a Server Component, and a function exported from a `"use client"`
 * module cannot be called from one — see that file's docstring for the full
 * explanation. This file carries no directive, so it is plain and
 * server-safe; `ui-version.ts` (the client store) imports these same
 * constants so the two halves can never disagree about the storage key or
 * the attribute name.
 *
 * PASS 3 (product-direction): V2 reached full parity with legacy across
 * every real user-facing route and game mode, and every legacy JSX branch
 * has now been deleted at its call site — V2 is the only presentation this
 * app ships. `data-ui-version="v2"` is also load-bearing for CSS (several
 * stylesheets scope V2-only rules under `[data-ui-version="v2"]`, e.g.
 * `styles/v2/rtt-result.css`, `styles/three-man-weave.css`), so this script
 * unconditionally sets the attribute to `"v2"` — it no longer reads `?ui=`
 * or any stored preference at all. That also means a stray
 * `peak3-ui-version: "legacy"` value left in a visitor's localStorage from
 * pre-cutover testing can never cause a real visit to lose V2 styling
 * again. The local dev switch (`UiVersionDevSwitch`, still gated behind
 * `NEXT_PUBLIC_PEAK3_UI_VERSION_SWITCH`, unset in every real deployment)
 * can still flip the DOM attribute client-side for local inspection, but
 * that choice never survives a fresh navigation: this script always
 * re-resolves to `"v2"`.
 */

export type UiVersion = "legacy" | "v2";

/** `peak3-` prefix matches the app's other persisted keys (`peak3-theme`,
 *  `peak3-anon`) — see `theme-script.ts`. Retained only for the local dev
 *  switch (`setUiVersion` in `lib/ui-version.ts`); the blocking script no
 *  longer reads or writes it. */
export const UI_VERSION_STORAGE_KEY = "peak3-ui-version";

export const UI_VERSION_ATTR = "data-ui-version";

/** Formerly the query param a link could carry to force a version for one
 *  load (`?ui=v2` / `?ui=legacy`). No longer read by the blocking script —
 *  there is no production path to `"legacy"` any more. */
export const UI_VERSION_QUERY_PARAM = "ui";

export function isUiVersion(value: unknown): value is UiVersion {
  return value === "legacy" || value === "v2";
}

/**
 * The blocking inline script's body, as a string, for `app/layout.tsx`.
 *
 * Deliberately minimal and defensive (`try/catch` around every browser API,
 * same as `themeInitScript`): this runs before React, before any error
 * boundary exists, and before anything has painted.
 *
 * Always resolves to `"v2"` — see module docstring.
 *
 * `dangerouslySetInnerHTML` receives exactly this string; no template
 * interpolation of anything dynamic (only this fixed constant,
 * JSON-stringified), so it is safe to inline unescaped.
 */
export function uiVersionInitScript(): string {
  return `(function(){try{
var ATTR=${JSON.stringify(UI_VERSION_ATTR)};
document.documentElement.setAttribute(ATTR,"v2");
}catch(e){}})();`;
}
