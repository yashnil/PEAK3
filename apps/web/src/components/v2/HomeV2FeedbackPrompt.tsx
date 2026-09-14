"use client";

/**
 * HomeV2FeedbackPrompt — the homepage's way INTO feedback, high on the page.
 *
 * WHY IT EXISTS. `HomeV2Feedback` is a real, working form, but it sits at the
 * very end of the homepage after the FAQ, so a visitor with a game idea had to
 * know it was there. This is one slim band just under "Your Arena": a sentence
 * and three quick picks. A pick does not open a second form -- it scrolls to
 * the one form, chooses that kind of note and puts the cursor in the note, so
 * there is exactly one submission path and it is one press away.
 *
 * Deliberately not a modal and not a hero: it must be findable without
 * competing with the games directly above it.
 */

import { openHomeFeedback } from "./HomeV2Feedback";
import type { ContactCategory } from "@/lib/contact-api";

export const HOME_FEEDBACK_PROMPTS: readonly { category: ContactCategory; label: string }[] = [
  { category: "game_idea", label: "Suggest a game mode" },
  { category: "weakness", label: "Flag a weak spot" },
  { category: "question", label: "Ask a question" },
];

export default function HomeV2FeedbackPrompt() {
  return (
    <section
      className="v2-feedback-prompt"
      aria-labelledby="v2-feedback-prompt-title"
      data-testid="home-feedback-prompt"
    >
      <div className="v2-feedback-prompt-copy">
        <h2 id="v2-feedback-prompt-title" className="v2-feedback-prompt-title">
          Help shape PEAK3 Arena
        </h2>
        <p className="v2-feedback-prompt-body">
          An idea for a game, something that felt weak, a question — one note, no account needed.
        </p>
      </div>
      <div className="v2-feedback-prompt-actions">
        {HOME_FEEDBACK_PROMPTS.map(({ category, label }) => (
          <button
            key={category}
            type="button"
            className="v2-feedback-prompt-action"
            data-testid={`home-feedback-prompt-${category}`}
            onClick={() => openHomeFeedback(category)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
