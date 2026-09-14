/**
 * The way INTO homepage feedback.
 *
 * The form (`HomeV2Feedback`) sat at the very end of the homepage, so a visitor
 * with a game idea had to know to scroll past the FAQ for it. These pin the
 * affordances that make it findable: a slim prompt band high on the page whose
 * quick picks open the ONE form with that kind of note chosen and the cursor in
 * the note, an anchor other pages link to, and a `?feedback=` preselect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: null, loading: false, supabaseEnabled: false, signOut: async () => {} }),
}));
vi.mock("@/lib/auth", () => ({ getAccessToken: async () => null }));
vi.mock("@/lib/contact-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contact-api")>("@/lib/contact-api");
  return { ...actual, submitContact: vi.fn() };
});

import HomeV2Feedback, { HOME_FEEDBACK_ANCHOR } from "@/components/v2/HomeV2Feedback";
import HomeV2FeedbackPrompt, { HOME_FEEDBACK_PROMPTS } from "@/components/v2/HomeV2FeedbackPrompt";
import HomePageV2 from "@/components/v2/HomePageV2";
import { HOME_FEEDBACK_KINDS } from "@/lib/contact-api";

beforeEach(() => {
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
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

function checkedKind(): string | undefined {
  const group = screen.getByRole("group", { name: "What kind of note?" });
  return (within(group).getAllByRole("radio") as HTMLInputElement[]).find((r) => r.checked)?.value;
}

describe("HomeV2FeedbackPrompt", () => {
  it("offers a few quick picks, each a real stored feedback kind", () => {
    render(<HomeV2FeedbackPrompt />);
    const band = screen.getByTestId("home-feedback-prompt");
    expect(within(band).getByRole("heading", { level: 2 })).toHaveTextContent(/help shape/i);
    const kinds = HOME_FEEDBACK_KINDS.map((k) => k.category);
    expect(within(band).getAllByRole("button")).toHaveLength(HOME_FEEDBACK_PROMPTS.length);
    for (const prompt of HOME_FEEDBACK_PROMPTS) expect(kinds).toContain(prompt.category);
    expect(screen.getByTestId("home-feedback-prompt-game_idea")).toHaveTextContent(/suggest a game mode/i);
  });

  it("opens the one form with that kind chosen and the cursor in the note", async () => {
    const user = userEvent.setup();
    render(
      <>
        <HomeV2FeedbackPrompt />
        <HomeV2Feedback />
      </>,
    );
    expect(checkedKind()).toBe("general_feedback");

    await user.click(screen.getByTestId("home-feedback-prompt-game_idea"));
    expect(checkedKind()).toBe("game_idea");
    expect(screen.getByTestId("home-feedback-message")).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    await user.click(screen.getByTestId("home-feedback-prompt-question"));
    expect(checkedKind()).toBe("question");
    // Still exactly one form on the page.
    expect(screen.getAllByTestId("home-feedback-form")).toHaveLength(1);
  });
});

describe("HomeV2Feedback — ways in from elsewhere", () => {
  it("carries the anchor every 'send feedback' link points at", () => {
    render(<HomeV2Feedback />);
    expect(screen.getByTestId("home-feedback")).toHaveAttribute("id", HOME_FEEDBACK_ANCHOR);
  });

  it("preselects the kind named by `?feedback=` and focuses the note", () => {
    window.history.replaceState(null, "", "/?feedback=game_idea#feedback");
    render(<HomeV2Feedback />);
    expect(checkedKind()).toBe("game_idea");
    expect(screen.getByTestId("home-feedback-message")).toHaveFocus();
  });

  it("ignores a `?feedback=` value that is not a real kind", () => {
    window.history.replaceState(null, "", "/?feedback=pizza#feedback");
    render(<HomeV2Feedback />);
    expect(checkedKind()).toBe("general_feedback");
  });
});

describe("HomePageV2 — the prompt's placement", () => {
  it("puts the prompt well above the form it opens", () => {
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
    const prompt = screen.getByTestId("home-feedback-prompt");
    const form = screen.getByTestId("home-feedback");
    const faq = screen.getByRole("heading", { name: "Questions, answered plainly." });
    expect(prompt.compareDocumentPosition(faq) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(prompt.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
