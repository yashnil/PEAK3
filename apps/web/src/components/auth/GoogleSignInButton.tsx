"use client";

/**
 * "Continue with Google".
 *
 * NO GOOGLE "G" MARK. The multicolour G is a trademark with its own brand
 * guidelines, and PEAK3 ships no third-party logos (the same rule that keeps NBA
 * team marks off every other surface). A word mark is compliant, is legible in
 * the dark arena palette without a white plate behind it, and does not need an
 * embedded SVG to be maintained.
 *
 * NOT ENABLED YET. The development project reports `external: ["email"]`, so
 * pressing this raises "Unsupported provider". That error is rendered, not
 * swallowed — a dead button with no explanation is the single worst outcome
 * here, and the operator steps to fix it are in `AUTH_CONFIGURATION.md`.
 *
 * Owner: Track B (auth surface).
 */

import { useState } from "react";
import { signInWithGoogle } from "@/lib/auth";

export interface GoogleSignInButtonProps {
  /** Where to land after the provider round trip. Validated by `safeNext`. */
  next?: string | null;
  label?: string;
  onError?: (message: string) => void;
}

export function GoogleSignInButton({
  next,
  label = "Continue with Google",
  onError,
}: GoogleSignInButtonProps) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    const { error } = await signInWithGoogle(next);
    if (error) {
      // Only reached when the redirect did NOT happen — on success this
      // component is already being torn down by a full navigation.
      setPending(false);
      onError?.(error);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      data-testid="google-signin"
      className="w-full py-2.5 rounded-lg text-sm font-semibold border transition-opacity hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border-default)",
        color: "var(--text-primary)",
      }}
    >
      {pending ? "Opening Google…" : label}
    </button>
  );
}

export default GoogleSignInButton;
