/**
 * The blocking theme-init script's source, plus the constants both it and
 * `lib/theme.ts` share.
 *
 * DELIBERATELY NOT `"use client"`. `app/layout.tsx` is a Server Component
 * (it renders `<html>`/`<head>`, which must be server-rendered), and Next.js
 * treats every function exported from a `"use client"` module as a client
 * reference — even a plain string builder with no hooks and no browser API
 * — so calling `themeInitScript()` from a server component while it lived
 * in `theme.ts` failed the build with "Attempted to call ... from the
 * server". This file has no directive, so it is a plain server-safe module;
 * `theme.ts` (the client-side hook/store half of the system) imports the
 * same constants from here so the two halves can never disagree about the
 * storage key or the attribute name.
 */

export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

/** localStorage key. `peak3-` prefix matches the app's other persisted keys
 *  (`peak3-anon`, the RTT/daily-grid storage keys) — see `run-the-table-state.ts`. */
export const THEME_STORAGE_KEY = "peak3-theme";

export const THEME_ATTR = "data-theme";
export const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** Matches `--bg-page` for each theme (globals.css) — the browser-chrome
 *  color should read as "the page," not an arbitrary brand color. */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: "#0a0b0d",
  light: "#ece7dc",
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "dark" || value === "light";
}

/**
 * The attribute the mounted `<ThemeToggle>` sets on itself, and the flag it
 * sets on `window`, so the pre-hydration handler below knows to stand down.
 *
 * A string constant rather than a literal in two files: the inline script and
 * the React component have to agree exactly, and they are written in different
 * languages a linter cannot cross-check.
 */
export const THEME_TOGGLE_TESTID = "theme-toggle";
export const THEME_HYDRATED_FLAG = "__peak3ThemeHydrated";

/**
 * The blocking inline script's body, as a string, for `app/layout.tsx`.
 *
 * Deliberately minimal and defensive (`try/catch` around every browser API):
 * this runs before React, before the app's own error boundaries exist, and
 * before anything has painted — a throw here would blank the page.
 *
 * `dangerouslySetInnerHTML` receives exactly this string; no template
 * interpolation of anything dynamic (only these fixed constants,
 * JSON-stringified), so it is safe to inline unescaped.
 *
 * IT DOES TWO THINGS, AND THE SECOND IS THE LESS OBVIOUS ONE.
 *
 * 1. APPLY THE STORED PREFERENCE BEFORE FIRST PAINT, so there is no flash.
 *
 * 2. HANDLE A CLICK ON THE THEME TOGGLE THAT ARRIVES BEFORE REACT HYDRATES.
 *    The server renders a real `<button>`; React attaches its listener when the
 *    client bundle finishes hydrating. In the window between those two moments
 *    the control is fully visible, fully focusable, and completely inert — a
 *    click moves focus to it and does nothing else. A browser test caught
 *    exactly that: the button took focus, `data-theme` never changed, and its
 *    own label still read "Switch to Arena Day".
 *
 *    That is a FIRST-CLICK DEAD STATE, and it is the same class of defect as
 *    the three-state cycle this pass removed: a click that the user has every
 *    reason to believe worked, and did not. It is invisible in development,
 *    where hydration is fast, and worst on a slow connection — which is when a
 *    dark page is most likely to be the thing somebody wants to change.
 *
 *    So a capture-phase listener sits on the document from before first paint,
 *    flips the theme itself, and disarms the instant React tells it the real
 *    control is live (`window.__peak3ThemeHydrated`). The two never both run:
 *    the flag is set in the toggle's own mount effect, which is the same
 *    moment its React listener becomes real. Both write the SAME localStorage
 *    key and the SAME root attribute, so whichever handled the click, the
 *    component's `useSyncExternalStore` reads the result on its first render
 *    and the two views cannot disagree.
 */
export function themeInitScript(): string {
  return `(function(){try{
var KEY=${JSON.stringify(THEME_STORAGE_KEY)};
var ATTR=${JSON.stringify(THEME_ATTR)};
var LIGHT=${JSON.stringify(THEME_COLOR.light)};
var DARK=${JSON.stringify(THEME_COLOR.dark)};
function resolveStored(){
  var stored=null;
  try{stored=window.localStorage.getItem(KEY);}catch(e){}
  var pref=(stored==="light"||stored==="dark"||stored==="system")?stored:"dark";
  return pref==="system"
    ?(window.matchMedia&&window.matchMedia(${JSON.stringify(LIGHT_QUERY)}).matches?"light":"dark")
    :pref;
}
function apply(resolved){
  var root=document.documentElement;
  root.setAttribute(ATTR,resolved);
  root.style.colorScheme=resolved;
  var meta=document.querySelector('meta[name="theme-color"]');
  if(meta){meta.content=resolved==="light"?LIGHT:DARK;}
}
apply(resolveStored());
document.addEventListener("click",function(event){
  try{
    if(window.${THEME_HYDRATED_FLAG})return;
    var target=event.target;
    if(!target||!target.closest)return;
    if(!target.closest('[data-testid="${THEME_TOGGLE_TESTID}"]'))return;
    var next=document.documentElement.getAttribute(ATTR)==="light"?"dark":"light";
    try{window.localStorage.setItem(KEY,next);}catch(e){}
    apply(next);
  }catch(e){}
},true);
}catch(e){}})();`;
}
