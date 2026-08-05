"use client";

/**
 * The rules, as a compact disclosure.
 *
 * A NATIVE `<details>`, deliberately. It is keyboard-operable, screen-reader
 * announced and open-by-URL-fragment for free, it needs no focus trap because
 * it traps nothing, and it degrades to plain visible text with JavaScript off.
 * A hand-rolled modal here would be more code for strictly less behaviour.
 *
 * WHY THE RULES ARE NOT ON THE PAGE. The brief is explicit: both games need a
 * concise "How to play" control, and neither main surface may be filled with
 * rule paragraphs. A player mid-auction needs the board, not a manual; a player
 * deciding whether to start needs the manual on request.
 *
 * The copy comes from `ARENA_MODES[].rules`, so the lobby card, the game room
 * and any future surface all read the SAME sentences. Rules written twice are
 * rules that end up describing two different games.
 */
export default function HowToPlay({
  title,
  rules,
  testId,
  summary = "How to play",
}: {
  title: string;
  rules: readonly string[];
  testId?: string;
  summary?: string;
}) {
  return (
    <details className="ar-rules" data-testid={testId}>
      <summary className="ar-rules-summary">{summary}</summary>
      <div className="ar-rules-body">
        <p className="ar-rules-title">{title}</p>
        <ol className="ar-rules-list">
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
        <p className="ar-rules-foot">
          Every score is the published PEAK3 rating for a real player-season. The
          model rates peaks; it does not simulate a box score.
        </p>
      </div>
    </details>
  );
}
