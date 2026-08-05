"use client";

/**
 * `/signin`.
 *
 * `?returnTo=` is the existing convention across the app (`RankedScreen`,
 * `/progress`, `/profile`, `/history` and the 82-0 save panels all build it) and
 * is kept — but it now goes through `safeNext` before it is used, which it did
 * not before. `params.get("returnTo") ?? "/"` straight into `router.push()` is
 * an open redirect on the credential-entry page of the product.
 *
 * Owner: Track B (auth surface).
 */

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignInPanel } from "@/components/auth/SignInPanel";
import { authSurfaceEnabled } from "@/lib/auth";
import { safeNext } from "@/lib/supabase/safe-next";

function SignInContent() {
  const params = useSearchParams();
  const returnTo = safeNext(params.get("returnTo"));

  if (!authSurfaceEnabled) {
    return (
      <AuthShell
        title="Sign in"
        subtitle="Authentication is not configured in this environment."
        testId="signin-unconfigured"
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          You can still play every game mode anonymously — nothing is gated behind an account.
        </p>
        <Link
          href="/"
          className="block text-center text-sm underline"
          style={{ color: "var(--peak-accent-text)" }}
        >
          Back to PEAK3 Arena
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Keep your runs, streaks and personal bests"
      testId="signin-page"
    >
      <SignInPanel mode="signin" next={returnTo} />
    </AuthShell>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInContent />
    </Suspense>
  );
}
