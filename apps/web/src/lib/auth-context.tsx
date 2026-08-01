"use client";

/**
 * Auth context — provides current user to the component tree.
 *
 * Wrap the app root with <AuthProvider> to enable auth-dependent components.
 * When Supabase is not configured, user is always null (anonymous-only mode).
 *
 * WHAT THIS PASS ADDED. `signOut` on the context. The only sign-out control in
 * the product used to be a button on `/profile`, so leaving required navigating
 * to a settings page first; the header now offers it directly, and routing that
 * through the context means the one place that knows how to *also* invalidate
 * the server's view of the session (`router.refresh()`) is the one place it is
 * done. Cookie sessions make that step load-bearing: without it, Server
 * Components keep rendering the previous user until something else forces a
 * re-render.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  AuthUser,
  getSession,
  onAuthStateChange,
  setE2ETestSession,
  signOut as signOutRequest,
  supabaseConfigured,
} from "./auth";

declare global {
  interface Window {
    __peak3TestAuth?: {
      setSession: (token: string, user: AuthUser) => void;
    };
  }
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  supabaseEnabled: boolean;
  /** Ends the session and drops the server's cached view of it. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  supabaseEnabled: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(supabaseConfigured);
  const router = useRouter();

  // Test-only session injection bridge — see auth.ts's setE2ETestSession
  // docstring. Dead-code-eliminated from production builds. A previously
  // injected session (persisted to sessionStorage by setE2ETestSession)
  // must also be restored here on mount — a Playwright page.goto() is a
  // full reload, and getSession() below already checks the persisted test
  // session first, so this runs even when supabaseConfigured is false.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__peak3TestAuth = {
      setSession: (token, testUser) => {
        setE2ETestSession(token, testUser);
        setUser(testUser);
        setLoading(false);
      },
    };
    getSession().then((u) => {
      if (u) setUser(u);
    });
    return () => {
      delete window.__peak3TestAuth;
    };
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }

    // Load initial session
    getSession()
      .then((u) => {
        setUser(u);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Subscribe to auth state changes
    const unsub = onAuthStateChange((u) => {
      setUser(u);
    });

    return unsub;
  }, []);

  const signOut = useCallback(async () => {
    await signOutRequest();
    setUser(null);
    // The session cookie is gone; anything the server rendered while it existed
    // is now wrong. `refresh()` re-fetches Server Components in place without
    // losing client state or scroll position.
    router.refresh();
  }, [router]);

  return (
    <AuthContext.Provider
      value={{ user, loading, supabaseEnabled: supabaseConfigured, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
