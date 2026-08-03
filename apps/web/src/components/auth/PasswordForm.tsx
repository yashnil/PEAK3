"use client";

/**
 * Email + password, for accounts that already have one.
 *
 * Kept behind a disclosure rather than deleted: existing accounts must keep
 * working, but showing three equally-weighted sign-in methods makes the user
 * choose between things they have no basis to choose between. Google and the
 * magic link are the two recommendations; this is the escape hatch.
 *
 * Owner: Track B (auth surface).
 */

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmail, signUpWithEmail } from "@/lib/auth";

export interface PasswordFormProps {
  mode: "signin" | "signup";
  /** Already validated by the caller with `safeNext`. */
  next: string;
}

export function PasswordForm({ mode, next }: PasswordFormProps) {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (mode === "signup") {
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
    }

    setPending(true);
    const { error: err } =
      mode === "signin"
        ? await signInWithEmail(email, password)
        : await signUpWithEmail(email, password, next);
    setPending(false);

    if (err) {
      setError(err);
      return;
    }
    if (mode === "signup") {
      setSent(true);
      return;
    }
    router.push(next);
  }

  if (sent) {
    return (
      <div
        role="status"
        data-testid="password-signup-sent"
        className="rounded-lg px-3 py-3 text-sm space-y-1"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-secondary)",
        }}
      >
        <p style={{ color: "var(--text-primary)" }}>Check your email</p>
        <p>
          We sent a confirmation link to{" "}
          <strong style={{ color: "var(--text-primary)" }}>{email}</strong>. Opening it finishes
          your account and imports anything you played as a guest.
        </p>
      </div>
    );
  }

  const inputStyle = {
    background: "var(--bg-surface)",
    borderColor: "var(--border-default)",
    color: "var(--text-primary)",
  } as const;

  return (
    <form onSubmit={handleSubmit} className="space-y-3" data-testid="password-form">
      <div>
        <label
          htmlFor={emailId}
          className="block text-sm font-medium mb-1"
          style={{ color: "var(--text-secondary)" }}
        >
          Email
        </label>
        <input
          id={emailId}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm border"
          style={inputStyle}
        />
      </div>

      <div>
        <label
          htmlFor={passwordId}
          className="block text-sm font-medium mb-1"
          style={{ color: "var(--text-secondary)" }}
        >
          Password
        </label>
        <input
          id={passwordId}
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
          minLength={mode === "signup" ? 8 : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm border"
          style={inputStyle}
        />
      </div>

      {mode === "signup" && (
        <div>
          <label
            htmlFor={confirmId}
            className="block text-sm font-medium mb-1"
            style={{ color: "var(--text-secondary)" }}
          >
            Confirm password
          </label>
          <input
            id={confirmId}
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm border"
            style={inputStyle}
          />
        </div>
      )}

      {error && (
        <p
          role="alert"
          data-testid="password-error"
          className="text-sm rounded-lg px-3 py-2"
          style={{ background: "var(--incorrect-bg)", color: "var(--incorrect)" }}
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        data-testid="password-submit"
        className="w-full py-2.5 rounded-lg text-sm font-semibold border transition-all hover:opacity-90 disabled:opacity-60"
        style={{
          background: "var(--bg-elevated)",
          borderColor: "var(--border-default)",
          color: "var(--text-primary)",
        }}
      >
        {pending
          ? mode === "signin"
            ? "Signing in…"
            : "Creating account…"
          : mode === "signin"
            ? "Sign in with password"
            : "Create account"}
      </button>
    </form>
  );
}

export default PasswordForm;
