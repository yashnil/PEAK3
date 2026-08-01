"use client";

/**
 * The browser Supabase client — cookie-backed, so the server can see the session.
 *
 * WHAT CHANGED IN THIS PASS. `lib/auth.ts` created a plain
 * `@supabase/supabase-js` client whose session lived in `localStorage`. That is
 * invisible to every server runtime: middleware could not refresh it, a route
 * handler could not read it, and a Server Component could not know whether the
 * visitor was signed in. The PKCE `code_verifier` was equally invisible, which
 * is why the OAuth callback had to be a client component that re-read
 * `window.location.href`.
 *
 * `createBrowserClient` from `@supabase/ssr` stores both the session and the
 * PKCE verifier in cookies on this origin instead. The session therefore travels
 * with every request, which is what makes `middleware.ts` and
 * `app/auth/callback/route.ts` possible at all.
 *
 * MIGRATION NOTE. Sessions that existed under the old `localStorage` storage key
 * are not carried over — anyone signed in before this deploy is signed out once
 * and signs in again. There is no user-visible data loss (nothing is keyed to the
 * session itself), and no automatic migration is attempted, because reading a
 * refresh token out of `localStorage` to re-mint a cookie session is exactly the
 * shape of code that should not exist.
 *
 * Owner: Track B (auth surface).
 */

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from "./config";

export type BrowserSupabaseClient = ReturnType<typeof createBrowserClient>;

/**
 * Lazy singleton.
 *
 * `createBrowserClient` is itself memoised per (url, key) inside `@supabase/ssr`,
 * but the null-when-unconfigured contract is ours, and several call sites treat
 * "same object identity across renders" as a given.
 */
let cached: BrowserSupabaseClient | null = null;

/**
 * The browser client, or `null` when Supabase is not configured.
 *
 * Returning `null` rather than throwing is deliberate and long-standing: PEAK3
 * runs in an anonymous-only mode with no Supabase project at all, and every
 * caller already branches on the null.
 */
export function getBrowserSupabaseClient(): BrowserSupabaseClient | null {
  if (!supabaseConfigured) return null;
  if (!cached) {
    cached = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return cached;
}

/** Test seam — drops the memoised client so a suite can re-stub the module. */
export function __resetBrowserSupabaseClient(): void {
  cached = null;
}
