/**
 * HomeV2Feedback — the homepage feedback section.
 *
 * Covers: it stays compact (six real kinds, one note, one optional email, one
 * action); a submission sends the chosen stored category with a derived
 * subject; the success state is honest; each failure (server validation, 429,
 * 503, network) keeps the note and never shows success; a 403
 * `contact_disabled` gets a calm "not switched on" state rather than an alarm
 * or a fake success; the button is disabled while pending and a second
 * submit never sends a second request; the honeypot is present but visually
 * hidden and actually wired; and the section sits after the FAQ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const SIGNED_OUT = { user: null, loading: false, supabaseEnabled: false, signOut: async () => {} };

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

import HomeV2Feedback, {
  HOME_FEEDBACK_DISABLED_MESSAGE,
  HOME_FEEDBACK_NETWORK_MESSAGE,
  deriveFeedbackSubject,
} from "@/components/v2/HomeV2Feedback";
import HomePageV2 from "@/components/v2/HomePageV2";
import { CONTACT_RATE_LIMITED_MESSAGE, ContactAPIError, HOME_FEEDBACK_KINDS } from "@/lib/contact-api";

/** Copy the feedback UI must never contain: a claim that someone read it, a
 * reply promise, or an email that was sent. */
const DISHONEST_COPY =
  /we('ve| have)? (emailed|read|reviewed)|an email (has been|was) sent|you will (receive|hear)|we('ll| will) (reply|respond|get back)|within \d+|(someone|a human) (has )?read/i;

beforeEach(() => {
  mockUseAuth.mockReset().mockReturnValue(SIGNED_OUT);
  mockGetAccessToken.mockReset().mockResolvedValue("fake-token");
  mockSubmitContact.mockReset();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const note = () => screen.getByTestId("home-feedback-message") as HTMLTextAreaElement;
const submitButton = () => screen.getByTestId("home-feedback-submit") as HTMLButtonElement;

async function typeNote(text = "The draft timer felt too short.") {
  await userEvent.type(note(), text);
}

describe("HomeV2Feedback — layout", () => {
  it("renders compactly: six real kinds, one note, one optional email, one action", () => {
    render(<HomeV2Feedback />);
    const section = screen.getByTestId("home-feedback");
    expect(within(section).getByRole("heading", { level: 2 })).toBeInTheDocument();

    const group = screen.getByRole("group", { name: "What kind of note?" });
    const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual([
      "game_idea",
      "bug",
      "dislike",
      "weakness",
      "question",
      "general_feedback",
    ]);
    for (const { label } of HOME_FEEDBACK_KINDS) {
      expect(within(group).getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "General" })).toBeChecked();

    // Compact: no subject line, no product-area dropdown, a single action.
    // (The honeypot is aria-hidden, so it is not among these textboxes.)
    expect(within(section).getAllByRole("textbox")).toHaveLength(2);
    expect(within(section).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(section).getAllByRole("button")).toHaveLength(1);
    expect(screen.getByLabelText("Your note")).toBe(note());
    expect(screen.getByLabelText(/Reply email/)).not.toBeRequired();
  });

  it("renders the honeypot present and empty, but off-screen, untabbable and hidden from assistive tech", () => {
    render(<HomeV2Feedback />);
    const honeypot = document.getElementById("home-feedback-website") as HTMLInputElement;
    expect(honeypot).toBeTruthy();
    expect(honeypot.value).toBe("");
    expect(honeypot.tabIndex).toBe(-1);

    const trap = screen.getByTestId("home-feedback-trap");
    expect(trap).toHaveAttribute("aria-hidden", "true");
    // Off-screen rather than display:none, which some scrapers skip.
    expect(trap.style.position).toBe("absolute");
    expect(trap.style.left).toBe("-9999px");
    expect(trap.style.display).not.toBe("none");
    expect(screen.queryByRole("textbox", { name: /leave this field blank/i })).not.toBeInTheDocument();
  });
});

describe("HomeV2Feedback — submitting", () => {
  it("sends the chosen kind, the note, a derived subject and an empty honeypot, then shows an honest received state", async () => {
    mockSubmitContact.mockResolvedValue({ request_id: "r1", accepted: true });
    render(<HomeV2Feedback />);
    await userEvent.click(screen.getByRole("radio", { name: "Game idea" }));
    await typeNote("A mode where you draft a starting five blind.\nMore detail here.");
    await userEvent.click(submitButton());

    const sent = await screen.findByTestId("home-feedback-sent");
    expect(mockSubmitContact).toHaveBeenCalledTimes(1);
    const [input, token] = mockSubmitContact.mock.calls[0];
    expect(input).toEqual({
      category: "game_idea",
      subject: "A mode where you draft a starting five blind.",
      message: "A mode where you draft a starting five blind.\nMore detail here.",
      replyEmail: undefined,
      website: "",
    });
    expect(token).toBeUndefined();

    expect(sent).toHaveTextContent(/received/i);
    expect(sent).toHaveTextContent(/no confirmation email and no set reply time/i);
    expect(sent.textContent).not.toMatch(DISHONEST_COPY);
    expect(screen.queryByTestId("home-feedback-form")).not.toBeInTheDocument();
    // The focused button unmounted, so focus moves to the confirmation.
    expect(document.activeElement).toHaveTextContent("Received. Thank you.");
  });

  it("forwards a trimmed reply email and a signed-in sender's token", async () => {
    mockUseAuth.mockReturnValue({ ...SIGNED_OUT, user: { id: "u1", isAnonymous: false } });
    mockSubmitContact.mockResolvedValue({ request_id: "r1", accepted: true });
    render(<HomeV2Feedback />);
    await userEvent.click(screen.getByRole("radio", { name: "Bug" }));
    await typeNote("Grid cell stays highlighted.");
    await userEvent.type(screen.getByTestId("home-feedback-email"), "  me@example.com ");
    await userEvent.click(submitButton());

    await screen.findByTestId("home-feedback-sent");
    const [input, token] = mockSubmitContact.mock.calls[0];
    expect(input.category).toBe("bug");
    expect(input.replyEmail).toBe("me@example.com");
    expect(token).toBe("fake-token");
  });

  it("'Send another note' returns to an empty form with focus on the note", async () => {
    mockSubmitContact.mockResolvedValue({ request_id: "r1", accepted: true });
    render(<HomeV2Feedback />);
    await userEvent.click(screen.getByRole("radio", { name: "Question" }));
    await typeNote("Why five lanes?");
    await userEvent.click(submitButton());
    await userEvent.click(await screen.findByRole("button", { name: "Send another note" }));

    expect(note()).toHaveValue("");
    expect(screen.getByRole("radio", { name: "General" })).toBeChecked();
    expect(document.activeElement).toBe(note());
  });

  it("does not send a blank note, and says why", async () => {
    render(<HomeV2Feedback />);
    await typeNote("   ");
    await userEvent.click(submitButton());

    expect(mockSubmitContact).not.toHaveBeenCalled();
    expect(screen.getByTestId("home-feedback-blank")).toHaveTextContent(/write a sentence/i);
    expect(note()).toHaveAttribute("aria-invalid", "true");
  });

  it("forwards a filled honeypot so the server can drop it -- the trap is wired, not decorative", async () => {
    mockSubmitContact.mockResolvedValue({ request_id: "r1", accepted: true });
    render(<HomeV2Feedback />);
    await typeNote();
    fireEvent.change(document.getElementById("home-feedback-website") as HTMLInputElement, {
      target: { value: "http://spam.example" },
    });
    await userEvent.click(submitButton());

    await waitFor(() => expect(mockSubmitContact).toHaveBeenCalledTimes(1));
    expect(mockSubmitContact.mock.calls[0][0].website).toBe("http://spam.example");
  });

  it("disables the button while pending and never double-submits", async () => {
    let resolve!: (value: unknown) => void;
    mockSubmitContact.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    render(<HomeV2Feedback />);
    await typeNote();
    const form = screen.getByTestId("home-feedback-form");

    // Two submits in the same tick, before React can re-render the button.
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(mockSubmitContact).toHaveBeenCalledTimes(1);
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveTextContent("Sending…");
    expect(form).toHaveAttribute("aria-busy", "true");
    // Pending state never fades the label (axe contrast).
    expect(submitButton().style.opacity).toBe("");

    // And again after the re-render.
    fireEvent.submit(form);
    expect(mockSubmitContact).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ request_id: "r1", accepted: true });
    });
    expect(await screen.findByTestId("home-feedback-sent")).toBeInTheDocument();
    expect(mockSubmitContact).toHaveBeenCalledTimes(1);
  });
});

describe("HomeV2Feedback — error and disabled states", () => {
  it.each([
    [
      "server validation (422)",
      new ContactAPIError(422, "That doesn't look like a valid email address."),
      "That doesn't look like a valid email address.",
    ],
    [
      "rate limit (429)",
      new ContactAPIError(429, CONTACT_RATE_LIMITED_MESSAGE, "rate_limited"),
      CONTACT_RATE_LIMITED_MESSAGE,
    ],
    [
      "storage outage (503)",
      new ContactAPIError(
        503,
        "Could not store your message right now. Please try again in a moment.",
        "storage_unavailable",
      ),
      "Could not store your message right now. Please try again in a moment.",
    ],
    ["network failure", new TypeError("Failed to fetch"), HOME_FEEDBACK_NETWORK_MESSAGE],
  ])("%s: shows the error, keeps the note and never shows success", async (_name, error, expected) => {
    mockSubmitContact.mockRejectedValue(error);
    render(<HomeV2Feedback />);
    await typeNote("Keep me");
    await userEvent.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(expected);
    expect(screen.getByTestId("home-feedback-error")).toBe(alert);
    expect(screen.queryByTestId("home-feedback-sent")).not.toBeInTheDocument();
    expect(note()).toHaveValue("Keep me");
    expect(submitButton()).not.toBeDisabled();
    expect(submitButton()).toHaveTextContent("Send feedback");
  });

  it("403 contact_disabled: a calm 'not switched on' state -- not success, not an alarm", async () => {
    mockSubmitContact.mockRejectedValue(
      new ContactAPIError(403, "Contact submission is not enabled on this deployment.", "contact_disabled"),
    );
    render(<HomeV2Feedback />);
    await typeNote("Keep me too");
    await userEvent.click(submitButton());

    const notice = await screen.findByTestId("home-feedback-disabled");
    expect(notice).toHaveTextContent(HOME_FEEDBACK_DISABLED_MESSAGE);
    expect(notice).toHaveTextContent(/isn't switched on for this deployment yet/i);
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-feedback-sent")).not.toBeInTheDocument();
    expect(note()).toHaveValue("Keep me too");
  });

  it("a later successful send clears an earlier error", async () => {
    mockSubmitContact
      .mockRejectedValueOnce(new ContactAPIError(503, "Could not store your message right now."))
      .mockResolvedValueOnce({ request_id: "r2", accepted: true });
    render(<HomeV2Feedback />);
    await typeNote();
    await userEvent.click(submitButton());
    await screen.findByTestId("home-feedback-error");
    await userEvent.click(submitButton());

    expect(await screen.findByTestId("home-feedback-sent")).toBeInTheDocument();
    expect(screen.queryByTestId("home-feedback-error")).not.toBeInTheDocument();
  });
});

describe("deriveFeedbackSubject", () => {
  it("uses the note's first non-empty line, whitespace collapsed", () => {
    expect(deriveFeedbackSubject("\n\n   Bug   in the  grid  \nsecond line")).toBe("Bug in the grid");
  });

  it("cuts a long first line to a short preview, well inside the API's 200-character subject cap", () => {
    const subject = deriveFeedbackSubject("x".repeat(500));
    expect(subject.length).toBe(120);
    expect(subject.endsWith("…")).toBe(true);
  });
});

describe("HomePageV2 — feedback placement", () => {
  it("renders the feedback section after the FAQ, well below the hero", () => {
    render(
      <HomePageV2
        topWindow={null}
        componentWeights={[]}
        rankingsPreview={[]}
        methodology={null}
        proof={{
          modelLabel: null,
          modelVersion: null,
          isDefaultModel: true,
          startSeason: null,
          endSeason: null,
          playersEvaluated: null,
          rankedWindows: null,
          generatedAt: null,
        }}
        runTheTable={{ href: "/arena/run-the-table", title: "RUN THE TABLE", description: "Flagship mode" }}
        dailyModes={[]}
        peakSeason={null}
        multiplayerModes={[]}
        nbaFact={null}
      />,
    );
    const feedback = screen.getByTestId("home-feedback");
    const hero = screen.getByRole("heading", { level: 1 });
    const faq = screen.getByRole("heading", { name: "Questions, answered plainly." });
    expect(hero.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(faq.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
