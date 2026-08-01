"use client";

/**
 * Supabase Auth — the client-side surface the rest of the app imports.
 *
 * WHAT CHANGED IN THIS PASS. The client underneath is now
 * `@supabase/ssr`'s `createBrowserClient` (see `lib/supabase/client.ts`), so the
 * session and the PKCE verifier live in cookies rather than `localStorage`. That
 * one substitution is what makes `middleware.ts`, `app/auth/callback/route.ts`
 * and any future Server Component read of the session possible; nothing else in
 * this module's *shape* moved, because a dozen components import `useAuth`,
 * `getAccessToken` and `getSession` and none of them should have had to care.
 *
 * WHAT WAS ADDED. `signInWithGoogle` and `sendMagicLink` — the two flows the
 * product asked for and neither of which existed anywhere in the codebase
 * before. Email + password is untouched and still works.
 *
 * WHAT IS DELIBERATELY UNCHANGED. The E2E test-session backdoor below. It is
 * how `ranked.spec.ts` establishes two authenticated identities in a browser
 * without a live provider, and it is dead-code-eliminated from production
 * builds. Removing it would take 40-odd end-to-end assertions with it.
 *
 * BEARER TOKENS ARE STILL THE API CREDENTIAL. Cookies authenticate *Next*; the
 * FastAPI backend on a separate origin continues to verify an `Authorization:
 * Bearer` JWT (now via JWKS — see the lead's backend work). `getAccessToken()`
 * remains the single source of that token, which is why it did not move.
 */

import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getBrowserSupabaseClient } from "./supabase/client";
import { supabaseConfigured } from "./supabase/config";
import { safeNext } from "./supabase/safe-next";

export { supabaseConfigured };

/**
 * The browser Supabase client, or `null` when auth is not configured.
 *
 * Kept under its original name because six modules import it. It now returns the
 * cookie-backed SSR client.
 */
export function getSupabaseClient() {
  return getBrowserSupabaseClient();
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email?: string;
  isAnonymous: boolean;
  /**
   * Display name, when the identity provider supplied one.
   *
   * Optional and frequently absent: a magic-link signup has only an email, and
   * Google only sends a name when the profile scope was granted. Present so the
   * initials avatar can do better than the email local-part when it can, and so
   * it degrades to the email when it cannot.
   */
  name?: string;
}

/** Pulls whatever human-readable name the provider attached to the session. */
function nameFromSession(session: Session): string | undefined {
  const meta = session.user.user_metadata as Record<string, unknown> | null;
  for (const key of ["full_name", "name", "preferred_username", "user_name"]) {
    const value = meta?.[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function userFromSession(session: Session): AuthUser {
  return {
    id: session.user.id,
    email: session.user.email,
    isAnonymous: session.user.is_anonymous ?? false,
    name: nameFromSession(session),
  };
}

// ---------------------------------------------------------------------------
// E2E test-only session override.
//
// Real Supabase auth requires a live project (NEXT_PUBLIC_SUPABASE_URL/
// ANON_KEY). Even with one linked, Google is not enabled on the development
// project (`external: ["email"]`) and magic-link mail is not reachable from
// CI, so a real provider round trip cannot be performed in an automated run.
// To still exercise the REAL ranked matchmaking/board/settlement code paths
// through a real browser via Playwright, a test can inject a session signed
// with the same secret the API verifies against (see
// tests/e2e/helpers/test-jwt.ts) — this proves the JWT-verification and
// authenticated-request path work end to end, but is NOT a substitute for
// testing real sign-up/sign-in/session-restoration against a live Supabase
// project.
//
// `process.env.NODE_ENV !== "production"` is a build-time constant Next.js
// inlines and dead-code-eliminates, so this entire branch — and the
// `__peak3TestAuth` global it's wired to in auth-context.tsx — does not
// exist in a production bundle.
// ---------------------------------------------------------------------------
const TEST_SESSION_STORAGE_KEY = "__peak3_e2e_test_session";

function readPersistedTestSession(): { token: string; user: AuthUser } | null {
  // Gated on the SAME build-time constant as the writer.
  //
  // Previously only `setE2ETestSession` was gated, so the read path — this
  // function plus the `_testSession` checks in getSession/getAccessToken/
  // onAuthStateChange — shipped in production and ran at module evaluation.
  // That turned any ability to write one sessionStorage key (an XSS, a
  // paste-this-in-devtools social-engineering flow, a shared machine) into
  // persistent control of the app's identity AND of the bearer token attached
  // to every outbound API call, outranking the real Supabase session. Not a
  // server bypass — the API still verifies the JWT — but a script-execution
  // primitive should not also be an identity primitive.
  //
  // Gating both halves makes the comment above this block true rather than
  // aspirational: with `NODE_ENV === "production"` inlined, the whole branch
  // is dead code and the key is inert.
  if (process.env.NODE_ENV === "production") return null;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(TEST_SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Real Playwright navigations (page.goto) are full page reloads, which wipe
// any plain in-memory module variable — sessionStorage is what makes the
// injected session survive navigation within one isolated browser context,
// the same way a real Supabase session persists via its own storage.
let _testSession: { token: string; user: AuthUser } | null = readPersistedTestSession();

export function setE2ETestSession(token: string, user: AuthUser): void {
  if (process.env.NODE_ENV === "production") return;
  _testSession = { token, user };
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(TEST_SESSION_STORAGE_KEY, JSON.stringify(_testSession));
  }
}

export function clearE2ETestSession(): void {
  _testSession = null;
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(TEST_SESSION_STORAGE_KEY);
  }
}

export async function getSession(): Promise<AuthUser | null> {
  if (_testSession) return _testSession.user;
  const client = getSupabaseClient();
  if (!client) return null;
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) return null;
  return userFromSession(session);
}

export async function getAccessToken(): Promise<string | null> {
  if (_testSession) return _testSession.token;
  const client = getSupabaseClient();
  if (!client) return null;
  const {
    data: { session },
  } = await client.auth.getSession();
  return session?.access_token ?? null;
}

// ---------------------------------------------------------------------------
// Redirect targets
// ---------------------------------------------------------------------------

/**
 * The absolute `redirectTo` handed to Supabase for OAuth and magic links.
 *
 * Supabase requires an absolute URL and matches it against the project's
 * allow-list, so it is built from `window.location.origin` rather than an
 * environment variable — that way preview deployments work without a per-branch
 * config change, provided the wildcard is on the allow-list (see
 * `AUTH_CONFIGURATION.md`).
 *
 * `next` is passed through `safeNext` *here*, before it ever leaves the app, so
 * a hostile value cannot be laundered through the provider round trip and
 * arrive at the callback looking like something Supabase vouched for.
 */
export function authCallbackUrl(next?: string | null): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const target = safeNext(next);
  const search = target === "/" ? "" : `?next=${encodeURIComponent(target)}`;
  return `${origin}/auth/callback${search}`;
}

// ---------------------------------------------------------------------------
// Sign-in flows
// ---------------------------------------------------------------------------

export interface AuthResult {
  error: string | null;
}

const NOT_CONFIGURED: AuthResult = { error: "Auth not configured" };

/**
 * Google OAuth, PKCE.
 *
 * On success the browser is navigated away by the SDK, so a caller that gets
 * `{ error: null }` should expect its component to unmount rather than continue.
 *
 * NOT YET ENABLED ON THE DEVELOPMENT PROJECT — it reports `external: ["email"]`.
 * The call will fail with "Unsupported provider" until an operator completes the
 * dashboard steps in `docs/implementation/AUTH_CONFIGURATION.md`. The error is
 * surfaced verbatim rather than hidden, because "nothing happened when I pressed
 * the button" is the worst possible presentation of a configuration gap.
 */
export async function signInWithGoogle(next?: string | null): Promise<AuthResult> {
  const client = getSupabaseClient();
  if (!client) return NOT_CONFIGURED;
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: authCallbackUrl(next),
      queryParams: {
        // Ask for a refresh token on first consent and let returning users
        // through without re-consenting.
        access_type: "offline",
        prompt: "consent",
      },
    },
  });
  return { error: error?.message ?? null };
}

/**
 * Email magic link (`signInWithOtp`).
 *
 * `shouldCreateUser` is left at its default (true): the product's position is
 * that an email address is the whole account, so "sign in" and "sign up" are the
 * same act and asking a user which one they meant is a question with no
 * user-facing answer.
 */
export async function sendMagicLink(
  email: string,
  next?: string | null,
): Promise<AuthResult> {
  const client = getSupabaseClient();
  if (!client) return NOT_CONFIGURED;
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authCallbackUrl(next) },
  });
  return { error: error?.message ?? null };
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<AuthResult> {
  const client = getSupabaseClient();
  if (!client) return NOT_CONFIGURED;
  const { error } = await client.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

export async function signUpWithEmail(
  email: string,
  password: string,
  next?: string | null,
): Promise<AuthResult> {
  const client = getSupabaseClient();
  if (!client) return NOT_CONFIGURED;
  const { error } = await client.auth.signUp({
    email,
    password,
    // Without this the confirmation email lands on the project's Site URL and
    // the user's intended destination is lost between the form and the inbox.
    options: { emailRedirectTo: authCallbackUrl(next) },
  });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  clearE2ETestSession();
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.auth.signOut();
  } catch {
    // A network failure must not leave the user stuck in a signed-in-looking UI
    // they cannot leave. The local session (cookie + in-memory) is cleared by
    // the SDK before the network call, so the practical outcome is the same.
  }
}

/**
 * Password reset.
 *
 * Still unreferenced by any UI — there is no `/forgot-password` form, and the
 * magic link makes one largely redundant. It previously pointed at
 * `/auth/reset-password`, a route that has never existed, so following the email
 * produced a 404. It now lands on the real callback, which handles the
 * `type=recovery` grant, and continues to `/profile`.
 */
export async function sendPasswordReset(email: string): Promise<AuthResult> {
  const client = getSupabaseClient();
  if (!client) return NOT_CONFIGURED;
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: authCallbackUrl("/profile"),
  });
  return { error: error?.message ?? null };
}

export function onAuthStateChange(
  callback: (user: AuthUser | null) => void,
): () => void {
  const client = getSupabaseClient();
  if (!client) return () => {};
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
    // An injected E2E session outranks the real client's view. Now that a
    // Supabase project IS linked in development, the SDK emits an
    // `INITIAL_SESSION` with `session: null` shortly after mount — which would
    // otherwise wipe the identity a Playwright test had just established, and
    // do it asynchronously enough to be an intermittent failure.
    if (_testSession) {
      callback(_testSession.user);
      return;
    }
    callback(session ? userFromSession(session) : null);
  });
  return () => subscription.unsubscribe();
}
