/**
 * The three environment values every Supabase surface reads, in one place.
 *
 * WHY A SEPARATE MODULE. Before this pass the URL/key pair was read inline in
 * `lib/auth.ts`, which is a `"use client"`-adjacent module that also carries the
 * E2E session backdoor. Middleware and route handlers need the same pair on the
 * server, and importing `auth.ts` from an Edge middleware would drag the whole
 * browser client (and the test backdoor) into the Edge bundle. This module has
 * no imports at all, so every runtime — browser, Node route handler, Edge
 * middleware — can read the config without pulling in anything else.
 *
 * NAMES ARE FROZEN. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * and `NEXT_PUBLIC_API_URL` are the only names used anywhere in the app; do not
 * introduce a competing spelling. `process.env.X` is written out literally
 * rather than indexed, because Next.js inlines these at build time only when
 * the property access is statically analysable.
 *
 * Owner: Track B (auth surface).
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * The PEAK3 API origin.
 *
 * Every authenticated call in the app already goes through this value; the auth
 * callback used to be the one exception (it POSTed a relative
 * `/api/v1/auth/claim`, which 404s the moment the API is not co-hosted with the
 * web app — and the surrounding `catch {}` swallowed it silently).
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** True when both Supabase values are present. Auth is optional by design. */
export const supabaseConfigured =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
