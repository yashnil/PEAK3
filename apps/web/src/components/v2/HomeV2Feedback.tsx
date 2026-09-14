"use client";

/**
 * HomeV2Feedback — the homepage's compact feedback section, placed after the
 * FAQ, near the end of the page and deliberately not a hero.
 *
 * A REAL SUBMISSION PATH. Posts to `POST /api/v1/contact` through the same
 * `submitContact` client the /contact page uses. Each of the six kinds is its
 * own stored category (`HOME_FEEDBACK_KINDS`, added by
 * supabase/migrations/20260914100000_contact_feedback_categories.sql), so a
 * "question" is never filed as "other".
 *
 * COMPACT ON PURPOSE. It asks for one choice, one note and an optional email.
 * There is no subject field and no product-area dropdown (/contact keeps
 * both for longer reports). The API still requires a subject, so the first
 * line of the note is sent as one (`deriveFeedbackSubject`).
 *
 * HONEST STATES ONLY. On success it says the note was received and stored.
 * It never says a person has read it, never promises a reply time and never
 * says an email was sent, because none of that is true. On failure the note
 * stays in the form. When the deployment has `PEAK3_CONTACT_ENABLED` off, the
 * API answers 403 `contact_disabled` and this says so calmly instead of
 * showing success.
 *
 * SPAM. The server handles the rate limit (429) and the honeypot, so this
 * component only renders the hidden `website` field and a client-side guard
 * against double submission.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import {
  ContactAPIError,
  HOME_FEEDBACK_KINDS,
  submitContact,
  type ContactCategory,
} from "@/lib/contact-api";

/** Mirrors app/models/contact.py's MAX_MESSAGE_LENGTH. */
export const HOME_FEEDBACK_MAX_MESSAGE = 4000;
/** Mirrors ContactSubmissionIn.reply_email's max_length. */
const MAX_REPLY_EMAIL = 320;
/** Well inside the API's 200-character subject cap. */
const SUBJECT_PREVIEW_LENGTH = 120;

export const HOME_FEEDBACK_DISABLED_MESSAGE =
  "Feedback isn't switched on for this deployment yet, so nothing was sent. Your note is still here.";
export const HOME_FEEDBACK_NETWORK_MESSAGE =
  "Couldn't reach PEAK3 just now. Your note is still here, so try again in a moment.";
const FALLBACK_MESSAGE = "That didn't go through. Your note is still here, so try again in a moment.";
const BLANK_MESSAGE = "Write a sentence or two first.";

/** The first non-empty line of the note, whitespace collapsed, cut to a
 * short preview. The API's subject is required; this form doesn't ask for
 * one separately. */
export function deriveFeedbackSubject(message: string): string {
  const firstLine =
    message
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .find((line) => line.length > 0) ?? "";
  if (firstLine.length <= SUBJECT_PREVIEW_LENGTH) return firstLine;
  return `${firstLine.slice(0, SUBJECT_PREVIEW_LENGTH - 1).trimEnd()}…`;
}

type Phase = "idle" | "submitting" | "sent";
type Notice = { tone: "error" | "calm"; text: string };

function noticeFor(err: unknown): Notice {
  if (err instanceof ContactAPIError) {
    if (err.status === 403 && err.code === "contact_disabled") {
      return { tone: "calm", text: HOME_FEEDBACK_DISABLED_MESSAGE };
    }
    // 429 already carries contact-api's vague rate-limit copy; 422 and 503
    // carry the server's own plain-language message.
    if (err.status === 429 || err.status === 422 || err.status === 503) {
      return { tone: "error", text: err.message };
    }
    return { tone: "error", text: FALLBACK_MESSAGE };
  }
  return { tone: "error", text: HOME_FEEDBACK_NETWORK_MESSAGE };
}

/** The anchor every "send feedback" link on the site points at (`/#feedback`). */
export const HOME_FEEDBACK_ANCHOR = "feedback";
const OPEN_EVENT = "peak3:open-feedback";

function isFeedbackKind(value: string | null | undefined): value is ContactCategory {
  return !!value && HOME_FEEDBACK_KINDS.some((kind) => kind.category === value);
}

/**
 * Brings the form into view with `category` chosen and the cursor in the note.
 *
 * For callers ON the homepage (`HomeV2FeedbackPrompt`). From any other page,
 * link to `/?feedback=<category>#feedback`, which this component reads on
 * mount -- a query change on the homepage itself would re-request the page.
 */
export function openHomeFeedback(category?: ContactCategory) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { category } }));
}

export default function HomeV2Feedback() {
  const { user } = useAuth();
  const uid = useId();
  const messageId = `${uid}-message`;
  const countId = `${uid}-count`;
  const blankId = `${uid}-blank`;
  const emailId = `${uid}-email`;
  const fineprintId = `${uid}-fineprint`;

  const [category, setCategory] = useState<ContactCategory>("general_feedback");
  const [message, setMessage] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot, see the hidden field below
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [blank, setBlank] = useState(false);

  // Synchronous guard: `disabled` only applies after a re-render, so a fast
  // double click or double Enter could otherwise send two requests.
  const inFlight = useRef(false);
  const focusNoteNext = useRef(false);
  const sentTitleRef = useRef<HTMLParagraphElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // The focused submit button unmounts on success, so focus moves to the
    // confirmation. After "Send another note", focus returns to the note.
    if (phase === "sent") {
      sentTitleRef.current?.focus();
    } else if (phase === "idle" && focusNoteNext.current) {
      focusNoteNext.current = false;
      messageRef.current?.focus();
    }
  }, [phase]);

  // THE WAYS IN. The homepage's prompt band dispatches an event (same page, no
  // navigation); a link from anywhere else arrives as `?feedback=<kind>` plus
  // `#feedback`. Either way the form comes into view with that kind chosen and
  // the cursor in the note -- the only field that has to be filled.
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const focusNote = (scroll: boolean) => {
      if (scroll) sectionRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      messageRef.current?.focus({ preventScroll: scroll });
    };
    const onOpen = (event: Event) => {
      const wanted = (event as CustomEvent<{ category?: string }>).detail?.category;
      setCategory(isFeedbackKind(wanted) ? wanted : "general_feedback");
      setNotice(null);
      // A note already sent: open a fresh form rather than the receipt.
      if (phase === "sent") {
        focusNoteNext.current = true;
        setPhase("idle");
        sectionRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
        return;
      }
      focusNote(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [phase]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("feedback");
    if (isFeedbackKind(wanted)) setCategory(wanted);
    if (window.location.hash === `#${HOME_FEEDBACK_ANCHOR}` && params.has("feedback")) {
      messageRef.current?.focus({ preventScroll: true });
    }
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    if (!message.trim()) {
      setNotice(null);
      setBlank(true);
      messageRef.current?.focus();
      return;
    }

    inFlight.current = true;
    setBlank(false);
    setNotice(null);
    setPhase("submitting");
    try {
      const token = user ? await getAccessToken() : null;
      await submitContact(
        {
          category,
          subject: deriveFeedbackSubject(message),
          message,
          replyEmail: replyEmail.trim() || undefined,
          website,
        },
        token ?? undefined,
      );
      setMessage("");
      setReplyEmail("");
      setWebsite("");
      setPhase("sent");
    } catch (err) {
      setNotice(noticeFor(err));
      setPhase("idle");
    } finally {
      inFlight.current = false;
    }
  }

  function startAnother() {
    focusNoteNext.current = true;
    setCategory("general_feedback");
    setNotice(null);
    setPhase("idle");
  }

  const submitting = phase === "submitting";

  return (
    <section
      ref={sectionRef}
      id={HOME_FEEDBACK_ANCHOR}
      aria-labelledby="v2-feedback-heading"
      className="v2-feedback"
      data-testid="home-feedback"
    >
      <div className="v2-feedback-intro">
        <h2 id="v2-feedback-heading" className="v2-feedback-heading">
          Tell us what&apos;s off.
        </h2>
        <p className="v2-feedback-lede">
          PEAK3 is early. Game ideas, bugs, things you didn&apos;t like, weak spots, questions: send
          any of it. No account needed, and a reply email is optional.
        </p>
        <p className="v2-feedback-aside">
          <Link href="/contact" className="v2-hero-object-link">
            Need more room? Use the contact page →
          </Link>
        </p>
      </div>

      {phase === "sent" ? (
        <div className="v2-feedback-sent" role="status" data-testid="home-feedback-sent">
          <p ref={sentTitleRef} tabIndex={-1} className="v2-feedback-sent-title">
            Received. Thank you.
          </p>
          <p className="v2-feedback-sent-body">
            Your note is stored privately with the rest of the early-access feedback. There&apos;s
            no confirmation email and no set reply time.
          </p>
          <button type="button" className="v2-feedback-again" onClick={startAnother}>
            Send another note
          </button>
        </div>
      ) : (
        <form
          className="v2-feedback-form"
          onSubmit={handleSubmit}
          noValidate
          aria-busy={submitting || undefined}
          data-testid="home-feedback-form"
        >
          <fieldset className="v2-feedback-kinds">
            <legend className="v2-feedback-label">What kind of note?</legend>
            <div className="v2-feedback-chips">
              {HOME_FEEDBACK_KINDS.map(({ category: value, label }) => (
                <label key={value} className="v2-feedback-chip">
                  <input
                    type="radio"
                    name={`${uid}-kind`}
                    value={value}
                    checked={category === value}
                    onChange={() => setCategory(value)}
                    className="v2-feedback-chip-input"
                    data-testid={`home-feedback-kind-${value}`}
                  />
                  <span className="v2-feedback-chip-label">{label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={messageId} className="v2-feedback-label">
              Your note
            </label>
            <textarea
              ref={messageRef}
              id={messageId}
              rows={4}
              maxLength={HOME_FEEDBACK_MAX_MESSAGE}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (blank) setBlank(false);
              }}
              aria-invalid={blank || undefined}
              aria-describedby={blank ? `${blankId} ${countId}` : countId}
              className="v2-feedback-input v2-feedback-textarea"
              data-testid="home-feedback-message"
            />
            <div className="v2-feedback-meta">
              {blank ? (
                <p id={blankId} role="alert" className="v2-feedback-field-error" data-testid="home-feedback-blank">
                  {BLANK_MESSAGE}
                </p>
              ) : null}
              <span id={countId} className="v2-feedback-count">
                {message.length.toLocaleString("en-US")} / {HOME_FEEDBACK_MAX_MESSAGE.toLocaleString("en-US")}
                <span className="sr-only"> characters</span>
              </span>
            </div>
          </div>

          <div className="v2-feedback-row">
            <div className="v2-feedback-email">
              <label htmlFor={emailId} className="v2-feedback-label">
                Reply email <span className="v2-feedback-optional">(optional)</span>
              </label>
              <input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={MAX_REPLY_EMAIL}
                value={replyEmail}
                onChange={(e) => setReplyEmail(e.target.value)}
                aria-describedby={fineprintId}
                className="v2-feedback-input"
                data-testid="home-feedback-email"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="v2-feedback-submit"
              data-testid="home-feedback-submit"
            >
              {submitting ? "Sending…" : "Send feedback"}
            </button>
          </div>

          {notice ? (
            <p
              className="v2-feedback-notice"
              data-tone={notice.tone}
              role={notice.tone === "error" ? "alert" : "status"}
              data-testid={notice.tone === "error" ? "home-feedback-error" : "home-feedback-disabled"}
            >
              {notice.text}
            </p>
          ) : null}

          {/* Honeypot: off-screen rather than display:none (some scrapers skip
              display:none fields), out of the tab order, hidden from
              assistive tech, and labelled for what it is. Same pattern as
              ContactForm. */}
          <div
            aria-hidden="true"
            data-testid="home-feedback-trap"
            style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}
          >
            <label htmlFor="home-feedback-website">Leave this field blank</label>
            <input
              id="home-feedback-website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          <p id={fineprintId} className="v2-feedback-fineprint">
            Stored privately and never shown publicly. Add an email only if you&apos;d like the
            option of a reply. <Link href="/privacy">Privacy notice</Link>
          </p>
        </form>
      )}
    </section>
  );
}
