"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import {
  CONTACT_CATEGORY_LABELS,
  CONTACT_RELEVANT_AREA_LABELS,
  ContactAPIError,
  ContactCategory,
  ContactRelevantArea,
  submitContact,
} from "@/lib/contact-api";

const CATEGORIES = Object.keys(CONTACT_CATEGORY_LABELS) as ContactCategory[];
const RELEVANT_AREAS = Object.keys(CONTACT_RELEVANT_AREA_LABELS) as ContactRelevantArea[];

type Phase = "idle" | "submitting" | "submitted" | "error";

const inputStyle = {
  background: "var(--bg-surface)",
  borderColor: "var(--border-default)",
  color: "var(--text-primary)",
} as const;

/**
 * The real contact/feedback form (launch-polish IMPLEMENTATION_CONTRACT.md
 * §9), replacing the static mailto-to-a-placeholder that used to be here.
 *
 * HONEST COPY ONLY. The confirmation state says "Feedback received" and
 * nothing more -- never "we emailed you" or "you'll hear back by X", because
 * there is no delivery service behind this and no response-time commitment.
 * See the confirmation block below; this is the one piece of copy in this
 * component that a future edit must not casually strengthen.
 */
export default function ContactForm() {
  const { user } = useAuth();
  const [category, setCategory] = useState<ContactCategory>("bug");
  const [relevantArea, setRelevantArea] = useState<ContactRelevantArea | "">("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot -- see the hidden field below
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPhase("submitting");
    try {
      const token = user ? await getAccessToken() : null;
      await submitContact(
        {
          category,
          relevantArea: relevantArea || undefined,
          subject,
          message,
          replyEmail: replyEmail || undefined,
          website,
        },
        token ?? undefined,
      );
      setPhase("submitted");
    } catch (err) {
      setPhase("error");
      setError(err instanceof ContactAPIError ? err.message : "Could not send. Please try again.");
    }
  }

  if (phase === "submitted") {
    return (
      <div
        role="status"
        data-testid="contact-form-confirmation"
        className="rounded-lg border px-4 py-4 text-sm"
        style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
      >
        <p className="font-semibold" style={{ color: "var(--peak-accent-text, #f5c842)" }}>
          Feedback received.
        </p>
        <p className="mt-2">
          {/* Honest copy only -- no delivery service exists behind this, so
              this never claims one does. */}
          There is no automated confirmation email and no guaranteed response time. If you
          left a reply address, a human may follow up, but that is not promised.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="contact-form">
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
          What is this about?
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ContactCategory)}
          className="w-full rounded-lg px-3 py-2 text-sm border"
          style={inputStyle}
          data-testid="contact-category"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CONTACT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
          Which part of the product? <span style={{ color: "var(--text-muted)" }}>(optional)</span>
        </label>
        <select
          value={relevantArea}
          onChange={(e) => setRelevantArea(e.target.value as ContactRelevantArea | "")}
          className="w-full rounded-lg px-3 py-2 text-sm border"
          style={inputStyle}
          data-testid="contact-relevant-area"
        >
          <option value="">Not sure / not applicable</option>
          {RELEVANT_AREAS.map((a) => (
            <option key={a} value={a}>
              {CONTACT_RELEVANT_AREA_LABELS[a]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
          Subject
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          required
          className="w-full rounded-lg px-3 py-2 text-sm border"
          style={inputStyle}
          data-testid="contact-subject"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
          Message
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
          required
          rows={6}
          className="w-full rounded-lg px-3 py-2 text-sm border resize-y"
          style={inputStyle}
          data-testid="contact-message"
        />
        <p className="mt-1 text-xs text-right" style={{ color: "var(--text-muted)" }}>
          {message.length}/4000
        </p>
      </div>

      {!user && (
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
            Your email <span style={{ color: "var(--text-muted)" }}>(optional, only if you want a reply)</span>
          </label>
          <input
            type="email"
            value={replyEmail}
            onChange={(e) => setReplyEmail(e.target.value)}
            maxLength={320}
            className="w-full rounded-lg px-3 py-2 text-sm border"
            style={inputStyle}
            data-testid="contact-reply-email"
          />
        </div>
      )}

      {user && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Sent as your signed-in account. Your account email is not shared automatically --
          add one above only if you want a reply somewhere else.
        </p>
      )}

      {/* Honeypot: visually hidden from a real user (not display:none, which
          some scrapers skip), never focusable via keyboard, and its label
          says exactly what it's for so any assistive tech that does expose
          it doesn't confuse a real visitor into filling it. */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}
      >
        <label htmlFor="contact-website">Leave this field blank</label>
        <input
          id="contact-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        By submitting, you agree PEAK3 may store this message (and your account association, if
        signed in) to respond. See the{" "}
        <a href="/privacy" className="underline" style={{ color: "var(--peak-accent-text)" }}>
          privacy notice
        </a>
        .
      </p>

      {phase === "error" && error && (
        <p
          role="alert"
          data-testid="contact-form-error"
          className="text-sm rounded-lg px-3 py-2"
          style={{ background: "var(--incorrect-bg)", color: "var(--incorrect)" }}
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={phase === "submitting"}
        data-testid="contact-form-submit"
        className="w-full py-2.5 rounded-lg text-sm font-semibold disabled:opacity-60"
        style={{ background: "var(--peak-accent, #f5c842)", color: "var(--text-inverse)" }}
      >
        {phase === "submitting" ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
