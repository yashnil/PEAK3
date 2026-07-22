"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signInWithEmail, supabaseConfigured } from "@/lib/auth";

function SignInContent() {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = params.get("returnTo") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabaseConfigured) return;
    setError(null);
    setLoading(true);
    const { error: err } = await signInWithEmail(email, password);
    setLoading(false);
    if (err) {
      setError(err);
      return;
    }
    router.push(returnTo);
  }

  if (!supabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card-elevated max-w-md w-full p-8 text-center space-y-4">
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            Sign In
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Authentication is not configured in this environment. You can still
            play all game modes anonymously.
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
            Sign In
          </h1>
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
              autoComplete="current-password"
              required
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
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="flex flex-col gap-2 text-center text-sm">
          <Link
            href={`/signup?returnTo=${encodeURIComponent(returnTo)}`}
            className="text-sm underline"
            style={{ color: "var(--text-secondary)" }}
          >
            Don&apos;t have an account? Create one
          </Link>
          <Link
            href="/forgot-password"
            className="text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInContent />
    </Suspense>
  );
}
