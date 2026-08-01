"use client";

/**
 * `/signup`.
 *
 * Kept as its own route because eight places link to it, but it renders the same
 * panel as `/signin` in `signup` mode. With Google and magic link as the primary
 * paths, "sign in" and "sign up" are the same act for most visitors — only the
 * password form still distinguishes them, and that is the one this page defaults
 * toward.
 *
 * Owner: Track B (auth surface).
 */

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignInPanel } from "@/components/auth/SignInPanel";
import { supabaseConfigured } from "@/lib/auth";
import { safeNext } from "@/lib/supabase/safe-next";

function SignUpContent() {
  const params = useSearchParams();
  const returnTo = safeNext(params.get("returnTo"));

  if (!supabaseConfigured) {
    return (
      <AuthShell
        title="Create account"
        subtitle="Authentication is not configured in this environment."
        testId="signup-unconfigured"
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          You can still play every game mode anonymously — nothing is gated behind an account.
        </p>
        <Link
          href="/"
          className="block text-center text-sm underline"
          style={{ color: "var(--peak-accent)" }}
        >
          Back to PEAK3 Arena
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create account"
      subtitle="Save your results and challenge history permanently"
      testId="signup-page"
    >
      <SignInPanel mode="signup" next={returnTo} />
    </AuthShell>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpContent />
    </Suspense>
  );
}
