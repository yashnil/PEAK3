"use client";

import { useEffect, useRef, type CSSProperties } from "react";

import { formatDollars } from "@/lib/twenty-dollar-api";

/**
 * The pre-match competitive intro (S20-01).
 *
 * WHAT IT REPLACED: nothing. Launching from the lobby dropped a player onto a
 * board where a 25-second clock was already running, against an opponent whose
 * name they had not read, under a rule ("market skips") that only announced
 * itself by disabling a button later.
 *
 * IT IS AN OVERLAY, AND THE BOARD IS MOUNTED UNDERNEATH. Two reasons, and the
 * second is the one that matters:
 *
 *   * The auction it is introducing should be the thing it dissolves into, not
 *     a screen that gets replaced by a different screen.
 *   * A gate that unmounts the board would mean the first frame after the
 *     intro is a cold render of the whole room. Mounted-underneath means the
 *     intro ends and the board is simply there.
 *
 * IT NEVER OUTLASTS ITS BUDGET. The dismissal timing belongs to
 * `useShowdownPhase`, which refuses to spend a beat that would push the human's
 * decision window below `MIN_DECISION_SECONDS` — read that module's docstring
 * for why a client cannot simply pause the server's clock and must therefore
 * be explicit about what it is willing to spend. This component renders; it
 * does not decide how long it lives, beyond offering the player a way out.
 *
 * ACCESSIBILITY. `role="dialog"` with a labelled heading, focus moved to the
 * dismiss control on mount, Escape dismisses, and the button is a real button
 * rather than "click anywhere". Nothing here is hover-only and nothing is
 * conveyed by colour.
 */
export default function MatchIntro({
  opponentName,
  startingBudget,
  slots,
  marketSkips,
  rated,
  onDismiss,
}: {
  opponentName: string;
  startingBudget: number;
  slots: number;
  marketSkips: number;
  rated: boolean;
  onDismiss: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      className="td-intro"
      data-testid="td-intro"
      role="dialog"
      aria-modal="true"
      aria-labelledby="td-intro-title"
    >
      {/* THE CARD ASSEMBLES IN READING ORDER: what kind of match, what it is
          called, WHO you are playing, the three rules, the basis, the button.
          `.pk-reveal` takes an index and globals owns the rhythm, so this
          matches the lot reveal and the result screen rather than inventing a
          third cadence. `.td-enter` on the card itself is unchanged.

          NOTHING WAITS ON THIS. The dismiss button is focused on mount and is
          pressable from the first frame; the stagger is decoration over a
          fully-formed dialog, and it disappears under `prefers-reduced-motion`
          without changing what the intro says or how long it lives (which is
          `useShowdownPhase`'s decision, not this file's). */}
      <div className="td-intro-card td-enter">
        <p
          className="td-intro-eyebrow pk-reveal"
          style={{ "--pk-reveal-index": 0 } as CSSProperties}
        >
          {rated ? "Rated match" : "Practice match"}
        </p>
        <h2
          className="td-intro-title pk-reveal"
          id="td-intro-title"
          style={{ "--pk-reveal-index": 1 } as CSSProperties}
        >
          The $20 Showdown
        </h2>

        <div
          className="td-intro-versus pk-reveal"
          style={{ "--pk-reveal-index": 2 } as CSSProperties}
        >
          <span className="td-intro-side" data-seat="a">
            You
          </span>
          <span className="td-intro-vs" aria-hidden="true">
            vs
          </span>
          <span className="td-intro-side" data-seat="b">
            {opponentName}
          </span>
        </div>

        <ol
          className="td-intro-rules pk-reveal"
          style={{ "--pk-reveal-index": 3 } as CSSProperties}
        >
          <li>
            <span className="td-intro-rule-value pk-numeral">
              {formatDollars(startingBudget)}
            </span>
            <span className="td-intro-rule-text">each, for the whole auction</span>
          </li>
          <li>
            <span className="td-intro-rule-value pk-numeral">{slots}</span>
            <span className="td-intro-rule-text">
              roster slots to fill — a legal starting five
            </span>
          </li>
          <li>
            <span className="td-intro-rule-value pk-numeral">{marketSkips}</span>
            <span className="td-intro-rule-text">
              market skips: taking a player you could use off the board costs one.
              Answering a decline, or conceding a live auction, is free.
            </span>
          </li>
        </ol>

        <p
          className="td-intro-basis pk-reveal"
          style={{ "--pk-reveal-index": 4 } as CSSProperties}
        >
          Highest total across five career-best PEAK3 seasons wins.
        </p>

        <button
          type="button"
          ref={buttonRef}
          className="btn-primary td-intro-go pk-reveal pk-lift pk-press"
          data-testid="td-intro-start"
          style={{ "--pk-reveal-index": 5 } as CSSProperties}
          onClick={onDismiss}
        >
          Open lot 1
        </button>
      </div>
    </div>
  );
}
