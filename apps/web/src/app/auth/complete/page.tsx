"use client";

/**
 * `/auth/complete` — the one hop between a successful grant and the destination.
 *
 * WHY IT EXISTS AT ALL. Two things have to happen after the session cookie is
 * written, and neither can happen inside the callback route handler:
 *
 *   1. The guest claim (plan §2.5) is authenticated by the httponly `peak3_anon`
 *      cookie, which is scoped to the API origin. Only the browser can attach
 *      it, and only with `credentials: "include"`.
 *   2. A user who has just imported eight guest results deserves to be told so.
 *      A silent transfer is indistinguishable from a lost one, and "where did my
 *      runs go" is the support question this screen prevents.
 *
 * WHY IT IS NOT A WALL. When there is nothing to import — the overwhelmingly
 * common case for a returning user — this screen never renders a decision: it
 * redirects as soon as the call settles. The summary only appears when there is
 * a summary worth reading, and even then it auto-continues.
 *
 * FAILURE IS NON-FATAL AND NON-SILENT. The claim endpoint is idempotent, so a
 * failed attempt costs nothing and can be retried later. The user is signed in
 * regardless. What this must not do — and what the previous `catch {}` did — is
 * pretend it succeeded.
 *
 * Owner: Track B (auth surface).
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { getAccessToken, authSurfaceEnabled } from "@/lib/auth";
import { claimGuestActivity, describeClaim, type ClaimSummary } from "@/lib/supabase/claim";
import { safeNext } from "@/lib/supabase/safe-next";

/** How long the summary stays up before continuing on its own. */
const AUTO_CONTINUE_MS = 6000;

type Phase = "working" | "summary" | "failed";

function AuthCompleteContent() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [phase, setPhase] = useState<Phase>("working");
  const [summary, setSummary] = useState<ClaimSummary | null>(null);
  // Strict Mode double-invokes effects in development; the claim is idempotent
  // server-side, but firing it twice would also fire the redirect twice.
  const started = useRef(false);

  const goNext = useCallback(() => {
    router.replace(next);
  }, [router, next]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      if (!authSurfaceEnabled) {
        goNext();
        return;
      }
      const token = await getAccessToken();
      if (!token) {
        // The cookie exchange succeeded but this tab cannot see a session —
        // continue rather than trap the user on an interstitial.
        goNext();
        return;
      }

      const result = await claimGuestActivity(token);
      if (result === null) {
        setPhase("failed");
        return;
      }
      if (result.total === 0) {
        goNext();
        return;
      }
      setSummary(result);
      setPhase("summary");
    })();
  }, [goNext]);

  useEffect(() => {
    if (phase !== "summary") return;
    const timer = window.setTimeout(goNext, AUTO_CONTINUE_MS);
    return () => window.clearTimeout(timer);
  }, [phase, goNext]);

  if (phase === "working") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-4" data-testid="auth-complete-working">
          <div
            className="animate-spin rounded-full h-8 w-8 border-2 mx-auto"
            style={{
              borderColor: "var(--border-default)",
              borderTopColor: "var(--peak-accent)",
            }}
          />
          <p className="text-sm" role="status" style={{ color: "var(--text-muted)" }}>
            Signing you in…
          </p>
        </div>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <AuthShell
        title="You're signed in"
        subtitle="We couldn't import your guest results just now."
        testId="auth-complete-claim-failed"
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Your account is ready, but the results you played before signing in are
          still sitting with your guest session. Nothing has been lost — importing
          is safe to retry, and it happens automatically the next time you sign in
          on this device.
        </p>
        <button
          type="button"
          onClick={goNext}
          data-testid="auth-complete-continue"
          className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
          style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
        >
          Continue
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="We moved your guest results onto your account."
      testId="auth-complete-summary"
      footer={
        <>
          Continuing automatically —{" "}
          <Link href={next} className="underline" style={{ color: "var(--peak-accent-text)" }}>
            go now
          </Link>
        </>
      }
    >
      <ul className="space-y-2" data-testid="claim-summary-list">
        {(summary?.lines ?? []).map((line) => (
          <li
            key={line.key}
            className="flex items-baseline justify-between gap-4 rounded-lg px-3 py-2"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
          >
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {line.label}
            </span>
            <span
              className="text-lg font-bold tabular-nums"
              style={{ color: "var(--peak-accent-text)" }}
            >
              {line.count}
            </span>
          </li>
        ))}
      </ul>

      <p className="sr-only" role="status">
        Imported {describeClaim(summary ?? { claimed: true, reason: null, lines: [], total: 0 })}.
      </p>

      <button
        type="button"
        onClick={goNext}
        data-testid="auth-complete-continue"
        className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
        style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
      >
        Continue
      </button>
    </AuthShell>
  );
}

export default function AuthCompletePage() {
  return (
    <Suspense fallback={null}>
      <AuthCompleteContent />
    </Suspense>
  );
}
