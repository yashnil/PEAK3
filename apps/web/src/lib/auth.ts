/**
 * Supabase Auth client for PEAK3 Arena.
 *
 * Used only when NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * are set.  When they are absent (local dev without Supabase), auth features
 * are disabled and the app runs in anonymous-only mode.
 */

import {
  createClient as _createSupabaseClient,
  type AuthChangeEvent,
  type Session,
} from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

function createClient(url: string, key: string) {
  return _createSupabaseClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

// Lazy singleton — only created when Supabase is configured.
let _client: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (!supabaseConfigured) return null;
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email?: string;
  isAnonymous: boolean;
}

// ---------------------------------------------------------------------------
// E2E test-only session override.
//
// Real Supabase auth requires a live project (NEXT_PUBLIC_SUPABASE_URL/
// ANON_KEY) which does not exist in this environment — the same documented
// gap as the backend's Supabase integration-test job. To still exercise the
// REAL ranked matchmaking/board/settlement code paths through a real
// browser via Playwright, a test can inject a session signed with the same
// PEAK3_SUPABASE_JWT_SECRET the API verifies against (see
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
  return {
    id: session.user.id,
    email: session.user.email,
    isAnonymous: session.user.is_anonymous ?? false,
  };
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  const client = getSupabaseClient();
  if (!client) return { error: "Auth not configured" };
  const { error } = await client.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

export async function signUpWithEmail(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  const client = getSupabaseClient();
  if (!client) return { error: "Auth not configured" };
  const { error } = await client.auth.signUp({ email, password });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
}

export async function sendPasswordReset(email: string): Promise<{ error: string | null }> {
  const client = getSupabaseClient();
  if (!client) return { error: "Auth not configured" };
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/reset-password`,
  });
  return { error: error?.message ?? null };
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

export function onAuthStateChange(
  callback: (user: AuthUser | null) => void,
): () => void {
  const client = getSupabaseClient();
  if (!client) return () => {};
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
    if (!session) {
      callback(null);
    } else {
      callback({
        id: session.user.id,
        email: session.user.email,
        isAnonymous: session.user.is_anonymous ?? false,
      });
    }
  });
  return () => subscription.unsubscribe();
}
