"use client";

/**
 * The Daily Grid start gate.
 *
 * WHAT IT REPLACED, AND WHY. The previous gate was the full `HowToPlay` panel
 * with a single "Start today's grid" button, and dismissing it started the
 * clock. That conflated three different decisions into one press: "I have read
 * the rules", "I want the walkthrough" and "start timing me". A player who
 * wanted to read anything paid for it in their own recorded time.
 *
 * THREE ACTIONS, THREE DECISIONS:
 *   - **How to Play** opens the seven-step walkthrough. The gate stays up and
 *     the clock does not start, so the tour is genuinely untimed.
 *   - **Start Timed Grid** is the only thing that starts the clock.
 *   - **Skip Tour and Start** does the same, and additionally records the
 *     walkthrough as deliberately skipped rather than merely unseen.
 *
 * THE BOARD IS NOT BEHIND THIS. The spec allows a non-interactive preview, and
 * this deliberately does not render one: the only search surface in the mode
 * (`CellPanel`) mounts solely when a square is selected, so "no board" is the
 * simplest possible proof that a player cannot inspect candidates before
 * starting — there is no overlay to leak through and no `pointer-events` rule
 * to get wrong. The walkthrough's targets are therefore absent while the gate
 * is up, which `GuidedTour` handles by centring each step with no spotlight
 * (its documented degradation, and exactly what the RUN THE TABLE start gate
 * does too).
 */

import { useEffect, useRef } from "react";
import { Clock, HelpCircle, Play } from "lucide-react";

interface Props {
  date: string;
  difficulty: string;
  /** The board's theme, e.g. "Ring Chasers". Optional so the gate still
   *  renders against an older board payload. */
  theme?: string;
  /** Open the untimed walkthrough. Must not start the clock. */
  onHowToPlay: () => void;
  /** Start the timed attempt. */
  onStart: () => void;
  /** Start the timed attempt AND record the walkthrough as skipped. */
  onSkipTourAndStart: () => void;
  /** True while the start request is in flight. Disables both start actions so
   *  a double-click cannot fire two attempts — the server is idempotent, but
   *  the button should not look like it did nothing either. */
  starting?: boolean;
  /** Honour `prefers-reduced-motion`: no entrance transition at all, rather
   *  than a faster one. */
  reducedMotion?: boolean;
}

export default function StartGate({
  date,
  difficulty,
  theme,
  onHowToPlay,
  onStart,
  onSkipTourAndStart,
  starting = false,
  reducedMotion = false,
}: Props) {
  const startRef = useRef<HTMLButtonElement>(null);

  // The primary action takes focus, so a keyboard player can press Enter
  // immediately and a screen-reader user lands on the thing the screen is for.
  useEffect(() => {
    startRef.current?.focus();
  }, []);

  return (
    <section
      data-testid="daily-grid-start-gate"
      data-motion={reducedMotion ? "none" : "auto"}
      aria-labelledby="daily-grid-start-gate-heading"
      className="card-elevated mx-auto w-full max-w-2xl p-6 sm:p-8"
      style={{
        transition: reducedMotion ? "none" : "opacity 200ms ease",
      }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: "var(--peak-accent)" }}
      >
        Daily Grid
      </p>

      {/* The four briefed lines, verbatim and in order. */}
      <h1
        id="daily-grid-start-gate-heading"
        className="font-display mt-1 text-2xl font-bold sm:text-3xl"
      >
        Today&rsquo;s Daily Grid
      </h1>

      <p
        data-testid="daily-grid-gate-shape"
        className="mt-3 text-sm font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        9 squares &middot; 9 different exact player-seasons
      </p>
      <p
        data-testid="daily-grid-gate-objective"
        className="mt-1 text-sm leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        Build the highest-scoring valid grid you can.
      </p>
      <p
        data-testid="daily-grid-gate-timer-note"
        className="mt-1 flex items-center gap-1.5 text-sm leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        <Clock size={13} aria-hidden="true" style={{ color: "var(--peak-accent)" }} />
        The timer starts only when you press Start.
      </p>

      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <button
          ref={startRef}
          type="button"
          data-testid="start-daily-grid"
          onClick={onStart}
          disabled={starting}
          className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-60"
          style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
        >
          <Play size={14} aria-hidden="true" />
          Start Timed Grid
        </button>

        <button
          type="button"
          data-testid="daily-grid-gate-how-to-play"
          onClick={onHowToPlay}
          className="inline-flex items-center justify-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          style={{ borderColor: "var(--border-emphasis)", color: "var(--text-primary)" }}
        >
          <HelpCircle size={14} aria-hidden="true" />
          How to Play
        </button>

        <button
          type="button"
          data-testid="daily-grid-gate-skip-tour"
          onClick={onSkipTourAndStart}
          disabled={starting}
          className="rounded-lg px-3 py-2.5 text-sm font-medium underline underline-offset-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-60"
          style={{ color: "var(--text-muted)" }}
        >
          Skip Tour and Start
        </button>
      </div>

      <p
        data-testid="daily-grid-gate-board-line"
        className="mt-5 text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        Today&rsquo;s board &middot; {date}
        {theme ? ` · ${theme}` : ""} &middot; {difficulty} difficulty
      </p>
    </section>
  );
}
