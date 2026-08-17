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
 * PASS 2 (product-direction): PEAK3 V2 is a parallel presentation system,
 * not a replacement — see `styles/v2/tokens.css`'s module docstring for the
 * full architecture. This is the switch between the two. THE DEFAULT MUST
 * STAY "legacy": a visitor who has never touched `?ui=` or the local dev
 * switch sees production exactly as it already renders. Only an explicit
 * `?ui=v2` or a previously-set local preference activates V2.
 */

export type UiVersion = "legacy" | "v2";

/** `peak3-` prefix matches the app's other persisted keys (`peak3-theme`,
 *  `peak3-anon`) — see `theme-script.ts`. */
export const UI_VERSION_STORAGE_KEY = "peak3-ui-version";

export const UI_VERSION_ATTR = "data-ui-version";

/** The query param a link can carry to force a version for this load —
 *  `?ui=v2` / `?ui=legacy`. Read once on load and, if present and valid,
 *  persisted as the new local preference (so a tester does not have to
 *  repeat it on every navigation — "may persist locally for convenient
 *  testing" per the brief). */
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
 * Precedence, and why: an explicit `?ui=` on THIS load always wins over
 * whatever was stored before (a tester following a `?ui=v2` link expects to
 * see v2 even if they last set `legacy`), and immediately overwrites the
 * stored preference so it persists past this one navigation. No query param
 * at all falls back to the stored preference, and no stored preference
 * falls back to `"legacy"` — never `"v2"` by default, per the brief's
 * explicit safety requirement.
 *
 * `dangerouslySetInnerHTML` receives exactly this string; no template
 * interpolation of anything dynamic (only these fixed constants,
 * JSON-stringified), so it is safe to inline unescaped.
 */
export function uiVersionInitScript(): string {
  return `(function(){try{
var KEY=${JSON.stringify(UI_VERSION_STORAGE_KEY)};
var ATTR=${JSON.stringify(UI_VERSION_ATTR)};
var PARAM=${JSON.stringify(UI_VERSION_QUERY_PARAM)};
var fromQuery=null;
try{
  var params=new URLSearchParams(window.location.search);
  var raw=params.get(PARAM);
  if(raw==="v2"||raw==="legacy")fromQuery=raw;
}catch(e){}
var resolved=fromQuery;
if(!resolved){
  try{
    var stored=window.localStorage.getItem(KEY);
    if(stored==="v2"||stored==="legacy")resolved=stored;
  }catch(e){}
}
if(!resolved)resolved="legacy";
if(fromQuery){
  try{window.localStorage.setItem(KEY,fromQuery);}catch(e){}
}
document.documentElement.setAttribute(ATTR,resolved);
}catch(e){}})();`;
}
