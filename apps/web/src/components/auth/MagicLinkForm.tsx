"use client";

/**
 * Email magic link — one field, no password.
 *
 * WHY THIS IS THE PRIMARY EMAIL PATH. A PEAK3 account stores game history and
 * nothing else; a password is a credential the user has to invent, remember and
 * eventually reset, in exchange for protecting a list of basketball scores. The
 * link is strictly less to go wrong. Email + password is kept below it for
 * anyone who already made one.
 *
 * THE SUCCESS STATE NAMES THE ADDRESS. "Check your email" with no address is
 * unactionable when the user typed a typo, which is the most common reason the
 * link never arrives.
 *
 * Owner: Track B (auth surface).
 */

import { useId, useState } from "react";
import { sendMagicLink } from "@/lib/auth";

export interface MagicLinkFormProps {
  next?: string | null;
  /** Copy on the submit control. */
  label?: string;
}

export function MagicLinkForm({ next, label = "Email me a sign-in link" }: MagicLinkFormProps) {
  const fieldId = useId();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const { error: err } = await sendMagicLink(email, next);
    setPending(false);
    if (err) {
      setError(err);
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div
        data-testid="magic-link-sent"
        role="status"
        className="rounded-lg px-3 py-3 text-sm space-y-1"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-secondary)",
        }}
      >
        <p style={{ color: "var(--text-primary)" }}>Check your email</p>
        <p>
          A sign-in link is on its way to{" "}
          <strong style={{ color: "var(--text-primary)" }}>{sentTo}</strong>. It works once and
          expires shortly.
        </p>
        <button
          type="button"
          onClick={() => setSentTo(null)}
          className="underline text-xs"
          style={{ color: "var(--peak-accent)" }}
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" data-testid="magic-link-form">
      <div>
        <label
          htmlFor={fieldId}
          className="block text-sm font-medium mb-1"
          style={{ color: "var(--text-secondary)" }}
        >
          Email
        </label>
        <input
          id={fieldId}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
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
          data-testid="magic-link-error"
          className="text-sm rounded-lg px-3 py-2"
          style={{ background: "#ef444420", color: "#ef4444" }}
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        data-testid="magic-link-submit"
        className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-60"
        style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
      >
        {pending ? "Sending…" : label}
      </button>
    </form>
  );
}

export default MagicLinkForm;
