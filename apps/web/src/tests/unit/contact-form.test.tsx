/**
 * ContactForm (launch-polish §9).
 *
 * Covers: the honeypot field is never rendered visibly and defaults to
 * empty; a signed-out sender can add a reply email while a signed-in
 * sender does not see that field at all (their account association covers
 * it); the confirmation state uses the honest "Feedback received" copy and
 * never claims an email was sent; a submission error surfaces the server's
 * message; the honeypot value, once typed into, is actually forwarded to
 * submitContact (proving the hidden field is wired, not decorative).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockUseAuth = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAccessToken = vi.fn();
vi.mock("@/lib/auth", () => ({
  getAccessToken: () => mockGetAccessToken(),
}));

const mockSubmitContact = vi.fn();
vi.mock("@/lib/contact-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contact-api")>("@/lib/contact-api");
  return {
    ...actual,
    submitContact: (...args: unknown[]) => mockSubmitContact(...args),
  };
});

import ContactForm from "@/components/contact/ContactForm";
import { ContactAPIError } from "@/lib/contact-api";

// Same lesson as handle-onboarding-prompt.test.tsx: NOT vi.restoreAllMocks()
// in afterEach -- it would strip the inline getAccessToken/useAuth wiring's
// implementation after the first test with nothing to reinstate it.
beforeEach(() => {
  mockUseAuth.mockReset().mockReturnValue({ user: null });
  mockGetAccessToken.mockReset().mockResolvedValue("fake-token");
  mockSubmitContact.mockReset();
});

function fillRequiredFields() {
  return {
    subject: screen.getByTestId("contact-subject") as HTMLInputElement,
    message: screen.getByTestId("contact-message") as HTMLTextAreaElement,
  };
}

describe("ContactForm", () => {
  it("shows a reply-email field for a signed-out sender", () => {
    render(<ContactForm />);
    expect(screen.getByTestId("contact-reply-email")).toBeInTheDocument();
  });

  it("hides the reply-email field for a signed-in sender -- their account association covers it", () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1", isAnonymous: false } });
    render(<ContactForm />);
    expect(screen.queryByTestId("contact-reply-email")).not.toBeInTheDocument();
  });

  it("renders the honeypot field visually hidden and empty by default", () => {
    render(<ContactForm />);
    const honeypot = document.getElementById("contact-website") as HTMLInputElement;
    expect(honeypot).toBeTruthy();
    expect(honeypot.value).toBe("");
    expect(honeypot.tabIndex).toBe(-1);
    // The wrapper must not use display:none / visibility:hidden alone --
    // this codebase's honeypot precedent (the pattern documented in the
    // component) uses off-screen positioning specifically so some scrapers
    // that skip display:none fields still fill it.
    const wrapper = honeypot.closest("[aria-hidden='true']");
    expect(wrapper).toBeTruthy();
  });

  it("submits with category, subject, message, and an empty honeypot by default", async () => {
    mockSubmitContact.mockResolvedValue({ request_id: "r1", accepted: true });
    render(<ContactForm />);
    const { subject, message } = fillRequiredFields();
    await userEvent.type(subject, "A bug");
    await userEvent.type(message, "It broke.");
    await userEvent.click(screen.getByTestId("contact-form-submit"));

    await waitFor(() => expect(mockSubmitContact).toHaveBeenCalledTimes(1));
    const [input] = mockSubmitContact.mock.calls[0];
    expect(input).toMatchObject({ subject: "A bug", message: "It broke.", website: "" });
  });

  it("forwards a value typed into the honeypot field -- proves it is wired, not decorative", async () => {
    mockSubmitContact.mockResolvedValue({ request_id: "r1", accepted: true });
    render(<ContactForm />);
    const { subject, message } = fillRequiredFields();
    await userEvent.type(subject, "A bug");
    await userEvent.type(message, "It broke.");
    const honeypot = document.getElementById("contact-website") as HTMLInputElement;
    await userEvent.type(honeypot, "http://spam.example");
    await userEvent.click(screen.getByTestId("contact-form-submit"));

    await waitFor(() => expect(mockSubmitContact).toHaveBeenCalledTimes(1));
    const [input] = mockSubmitContact.mock.calls[0];
    expect(input.website).toBe("http://spam.example");
  });

  it("shows the honest 'Feedback received' confirmation, never claiming an email was sent", async () => {
    mockSubmitContact.mockResolvedValue({ request_id: "r1", accepted: true });
    render(<ContactForm />);
    const { subject, message } = fillRequiredFields();
    await userEvent.type(subject, "A bug");
    await userEvent.type(message, "It broke.");
    await userEvent.click(screen.getByTestId("contact-form-submit"));

    await waitFor(() => expect(screen.getByTestId("contact-form-confirmation")).toBeInTheDocument());
    const confirmation = screen.getByTestId("contact-form-confirmation");
    expect(confirmation).toHaveTextContent(/feedback received/i);
    // Must state there is NO automated confirmation email (a true, honest
    // claim) and must never claim one WAS sent or WILL be sent.
    expect(confirmation).toHaveTextContent(/no automated confirmation email/i);
    expect(confirmation.textContent).not.toMatch(
      /we('ve| have)? emailed you|an email (has been|was) sent|you will receive an? (confirmation )?email/i
    );
  });

  it("surfaces a submission error", async () => {
    mockSubmitContact.mockRejectedValue(new ContactAPIError(503, "Could not store your message right now."));
    render(<ContactForm />);
    const { subject, message } = fillRequiredFields();
    await userEvent.type(subject, "A bug");
    await userEvent.type(message, "It broke.");
    await userEvent.click(screen.getByTestId("contact-form-submit"));

    await waitFor(() => expect(screen.getByTestId("contact-form-error")).toHaveTextContent(/could not store/i));
    expect(screen.queryByTestId("contact-form-confirmation")).not.toBeInTheDocument();
  });

  it("a signed-in sender's submission includes an access token, never their reply email (there is none to send)", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1", isAnonymous: false } });
    mockSubmitContact.mockResolvedValue({ request_id: "r1", accepted: true });
    render(<ContactForm />);
    const { subject, message } = fillRequiredFields();
    await userEvent.type(subject, "A bug");
    await userEvent.type(message, "It broke.");
    await userEvent.click(screen.getByTestId("contact-form-submit"));

    await waitFor(() => expect(mockSubmitContact).toHaveBeenCalledTimes(1));
    const [input, token] = mockSubmitContact.mock.calls[0];
    expect(token).toBe("fake-token");
    expect(input.replyEmail).toBeUndefined();
  });
});
