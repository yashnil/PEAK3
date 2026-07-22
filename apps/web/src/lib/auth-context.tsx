"use client";

/**
 * Auth context — provides current user to the component tree.
 *
 * Wrap the app root with <AuthProvider> to enable auth-dependent components.
 * When Supabase is not configured, user is always null (anonymous-only mode).
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import {
  AuthUser,
  getSession,
  onAuthStateChange,
  setE2ETestSession,
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
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  supabaseEnabled: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(supabaseConfigured);

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

  return (
    <AuthContext.Provider
      value={{ user, loading, supabaseEnabled: supabaseConfigured }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
