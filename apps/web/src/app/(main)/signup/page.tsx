"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { signUpWithEmail, supabaseConfigured } from "@/lib/auth";

function SignUpContent() {
  const params = useSearchParams();
  const returnTo = params.get("returnTo") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabaseConfigured) return;
    setError(null);

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    const { error: err } = await signUpWithEmail(email, password);
    setLoading(false);

    if (err) {
      setError(err);
      return;
    }
    setSuccess(true);
  }

  if (!supabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card-elevated max-w-md w-full p-8 text-center space-y-4">
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            Create Account
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Authentication is not configured in this environment.
          </p>
          <Link
            href="/"
            className="inline-block text-sm underline"
            style={{ color: "var(--peak-accent)" }}
          >
            Back to PEAK3 Arena
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card-elevated max-w-md w-full p-8 text-center space-y-4">
          <div className="text-4xl">📬</div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            Check your email
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            We sent a confirmation link to <strong>{email}</strong>. Open it to
            complete your account and claim any anonymous results you&apos;ve
            earned.
          </p>
          <Link
            href={returnTo}
            className="inline-block text-sm underline"
            style={{ color: "var(--peak-accent)" }}
          >
            Return to PEAK3 Arena
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="card-elevated max-w-md w-full p-8 space-y-6">
        <div className="text-center">
          <p
            className="text-xs font-semibold tracking-[0.2em] uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            PEAK3 Arena
          </p>
          <h1
            className="mt-2 text-2xl font-bold"
            style={{ color: "var(--text-primary)" }}
          >
            Create Account
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Save your results and challenge history permanently
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium mb-1"
              style={{ color: "var(--text-secondary)" }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm border"
              style={{
                background: "var(--bg-surface)",
                borderColor: "var(--border-default)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium mb-1"
              style={{ color: "var(--text-secondary)" }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm border"
              style={{
                background: "var(--bg-surface)",
                borderColor: "var(--border-default)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="confirm"
              className="block text-sm font-medium mb-1"
              style={{ color: "var(--text-secondary)" }}
            >
              Confirm Password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm border"
              style={{
                background: "var(--bg-surface)",
                borderColor: "var(--border-default)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="text-sm rounded-lg px-3 py-2"
              style={{ background: "#ef444420", color: "#ef4444" }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-60"
            style={{
              background: "var(--peak-accent)",
              color: "var(--text-inverse)",
            }}
          >
            {loading ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <div className="text-center">
          <Link
            href={`/signin?returnTo=${encodeURIComponent(returnTo)}`}
            className="text-sm underline"
            style={{ color: "var(--text-secondary)" }}
          >
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpContent />
    </Suspense>
  );
}
