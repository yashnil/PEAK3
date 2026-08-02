"use client";

/**
 * The sign-in / sign-up card: Google, magic link, and password behind a toggle.
 *
 * ORDER IS A PRODUCT STATEMENT. Google first (one tap, no inbox round trip),
 * magic link second (works for everyone, no password to invent), password last
 * and collapsed (it exists for accounts that already have one). A user who
 * expands the password form has said what they want; nobody else is asked.
 *
 * IT IS NEVER A WALL. Every mode in PEAK3 Arena is playable signed out, so this
 * card always ends with the line that says so. Sign-in buys durability — history,
 * streaks, personal bests — not access.
 *
 * Owner: Track B (auth surface).
 */

import { useState } from "react";
import Link from "next/link";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { MagicLinkForm } from "./MagicLinkForm";
import { PasswordForm } from "./PasswordForm";

export interface SignInPanelProps {
  mode: "signin" | "signup";
  /** Already validated by the caller with `safeNext`. */
  next: string;
}

export function SignInPanel({ mode, next }: SignInPanelProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);

  const otherHref =
    mode === "signin"
      ? `/signup${next === "/" ? "" : `?returnTo=${encodeURIComponent(next)}`}`
      : `/signin${next === "/" ? "" : `?returnTo=${encodeURIComponent(next)}`}`;

  return (
    <div className="space-y-5" data-testid="signin-panel">
      <GoogleSignInButton next={next} onError={setProviderError} />

      {providerError && (
        <p
          role="alert"
          data-testid="google-signin-error"
          className="text-sm rounded-lg px-3 py-2"
          style={{ background: "#ef444420", color: "#ef4444" }}
        >
          {providerError}
        </p>
      )}

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1" style={{ background: "var(--border-subtle)" }} />
        <span className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          or
        </span>
        <span className="h-px flex-1" style={{ background: "var(--border-subtle)" }} />
      </div>

      <MagicLinkForm next={next} />

      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowPassword((open) => !open)}
          aria-expanded={showPassword}
          data-testid="password-toggle"
          className="text-xs underline"
          style={{ color: "var(--text-muted)" }}
        >
          {showPassword ? "Hide password sign-in" : "Use a password instead"}
        </button>
        {showPassword && (
          <div className="mt-3">
            <PasswordForm mode={mode} next={next} />
          </div>
        )}
      </div>

      <div className="space-y-2 text-center">
        <Link
          href={otherHref}
          className="text-sm underline block"
          style={{ color: "var(--text-secondary)" }}
        >
          {mode === "signin"
            ? "Don't have an account? Create one"
            : "Already have an account? Sign in"}
        </Link>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          You can play every mode without an account — signing in only saves your runs and
          progress.
        </p>
      </div>
    </div>
  );
}

export default SignInPanel;
