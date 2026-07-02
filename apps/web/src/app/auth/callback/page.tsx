"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/auth";

/**
 * Auth callback handler for OAuth (Google) and email-confirmation redirects.
 *
 * Supabase redirects to /auth/callback?code=... after OAuth.
 * After session is established we:
 * 1. Try to claim any anonymous results.
 * 2. Redirect the user to their intended destination.
 */
function AuthCallbackContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState("Completing sign-in…");

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      router.push("/");
      return;
    }

    (async () => {
      // Exchange the code for a session
      const { error } = await client.auth.exchangeCodeForSession(
        window.location.href
      );
      if (error) {
        setStatus("Sign-in failed. Redirecting…");
        setTimeout(() => router.push("/signin"), 2000);
        return;
      }

      // Attempt to claim anonymous results after sign-in
      setStatus("Claiming your anonymous results…");
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        if (session) {
          await fetch("/api/v1/auth/claim", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
            credentials: "include",
          });
        }
      } catch {
        // Claim failure is non-fatal
      }

      setStatus("Signed in! Redirecting…");
      const returnTo = params.get("returnTo") ?? "/";
      router.push(returnTo);
    })();
  }, [router, params]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-4">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--border-default)] border-t-[var(--peak-accent)] mx-auto" />
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {status}
        </p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackContent />
    </Suspense>
  );
}
