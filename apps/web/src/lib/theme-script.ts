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
 * The blocking inline script's body, as a string, for `app/layout.tsx`.
 *
 * Deliberately minimal and defensive (`try/catch` around every browser API):
 * this runs before React, before the app's own error boundaries exist, and
 * before anything has painted — a throw here would blank the page.
 *
 * `dangerouslySetInnerHTML` receives exactly this string; no template
 * interpolation of anything dynamic (only these fixed constants,
 * JSON-stringified), so it is safe to inline unescaped.
 */
export function themeInitScript(): string {
  return `(function(){try{
var KEY=${JSON.stringify(THEME_STORAGE_KEY)};
var stored=null;
try{stored=window.localStorage.getItem(KEY);}catch(e){}
var pref=(stored==="light"||stored==="dark"||stored==="system")?stored:"dark";
var resolved=pref==="system"
  ?(window.matchMedia&&window.matchMedia(${JSON.stringify(LIGHT_QUERY)}).matches?"light":"dark")
  :pref;
var root=document.documentElement;
root.setAttribute(${JSON.stringify(THEME_ATTR)},resolved);
root.style.colorScheme=resolved;
var meta=document.querySelector('meta[name="theme-color"]');
if(meta){meta.content=resolved==="light"?${JSON.stringify(THEME_COLOR.light)}:${JSON.stringify(THEME_COLOR.dark)};}
}catch(e){}})();`;
}
