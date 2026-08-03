"use client";

/**
 * `/auth/auth-code-error` — where every failed sign-in round trip lands.
 *
 * WHAT IT REPLACES. Nothing. That is the point: the previous callback rendered a
 * spinner labelled "Completing sign-in…" and, on any failure that was not a
 * thrown exception, span forever. Supabase reports the two most common outcomes
 * — a cancelled consent screen and an expired magic link — as `?error=` query
 * parameters with no `code`, so the most likely failures were exactly the ones
 * with no surface at all.
 *
 * WHY IT SHOWS THE PROVIDER'S OWN MESSAGE. "Email link is invalid or has
 * expired" tells a user to request a new link; "Something went wrong" tells them
 * to file a bug. Neither `error` nor `error_description` carries a secret — they
 * are already in the URL the browser was redirected to — so displaying them
 * costs nothing and saves the round trip through support.
 *
 * Owner: Track B (auth surface).
 */

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import type { CallbackErrorReason } from "@/lib/supabase/callback-contract";
import { safeNext, signInHref } from "@/lib/supabase/safe-next";

/** Plain-language copy per machine reason, with the action that resolves it. */
const REASON_COPY: Record<CallbackErrorReason, { headline: string; body: string }> = {
  provider_error: {
    headline: "Sign-in didn't finish",
    body: "The sign-in was cancelled or refused before it completed. Nothing was changed on your account.",
  },
  missing_grant: {
    headline: "That link is incomplete",
    body: "This page was opened without a sign-in code. Sign-in links can only be used once, and copying one out of an email sometimes drops part of it.",
  },
  unsupported_otp_type: {
    headline: "That link isn't one we recognise",
    body: "The link's type doesn't match any sign-in method PEAK3 Arena uses. Request a fresh one.",
  },
  exchange_failed: {
    headline: "That link has expired",
    body: "Sign-in links are single-use and short-lived. Requesting a new one takes a few seconds.",
  },
  not_configured: {
    headline: "Sign-in isn't available here",
    body: "This deployment is running without an authentication provider. Every game mode still works without an account.",
  },
};

const FALLBACK = REASON_COPY.exchange_failed;

function isReason(value: string | null): value is CallbackErrorReason {
  return value !== null && value in REASON_COPY;
}

function AuthErrorContent() {
  const params = useSearchParams();
  const reasonParam = params.get("reason");
  const reason: CallbackErrorReason | null = isReason(reasonParam) ? reasonParam : null;
  const copy = reason ? REASON_COPY[reason] : FALLBACK;
  const description = params.get("description");
  const providerCode = params.get("code");
  const next = safeNext(params.get("next"));

  return (
    <AuthShell
      title={copy.headline}
      subtitle={copy.body}
      testId="auth-error"
      footer={
        <>
          You can keep playing every mode without an account —{" "}
          <Link href="/" className="underline" style={{ color: "var(--peak-accent-text)" }}>
            back to PEAK3 Arena
          </Link>
        </>
      }
    >
      {(description || providerCode) && (
        <p
          data-testid="auth-error-detail"
          className="text-xs rounded-lg px-3 py-2 font-mono break-words"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-muted)",
          }}
        >
          {description ?? providerCode}
        </p>
      )}

      <Link
        href={signInHref(next)}
        data-testid="auth-error-retry"
        className="block w-full py-2.5 rounded-lg text-sm font-semibold text-center transition-all hover:opacity-90"
        style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
      >
        Try signing in again
      </Link>
    </AuthShell>
  );
}

export default function AuthCodeErrorPage() {
  return (
    <Suspense fallback={null}>
      <AuthErrorContent />
    </Suspense>
  );
}
