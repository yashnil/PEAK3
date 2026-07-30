"use client";

/**
 * Daily Grid onboarding (Phase 11B).
 *
 * The Phase 11A page dropped a 3x3 board on screen with no statement of what
 * winning meant. Playtesters could not tell whether they were meant to find
 * any valid answer, the rarest one, or the best one -- and the mode is an
 * OPTIMISATION puzzle, which is unguessable from a grid of empty squares.
 *
 * Two modes, one component:
 *   - `variant="gate"` blocks the board until the player starts (first visit).
 *   - `variant="panel"` is the same content reopened later from "How to play",
 *     rendered as a dismissible dialog.
 *
 * Kept to four short cards plus a rules list rather than a wall of prose: the
 * objective has to survive being skimmed.
 */
import { useEffect, useRef } from "react";
import { Lock, Search, Target, Trophy } from "lucide-react";

const STEPS: { icon: typeof Target; title: string; body: string }[] = [
  {
    icon: Search,
    title: "Pick a square",
    body: "Choose any square, then search for an exact NBA player-season — “1999-00 Shaquille O’Neal”, not just “Shaquille O’Neal”.",
  },
  {
    icon: Target,
    title: "Match both sides",
    body: "The season has to satisfy its row constraint and its column constraint. Each player identity can be used only once on the board.",
  },
  {
    icon: Lock,
    title: "Lock it in",
    body: "Scores stay hidden until you lock a pick. A valid pick is final — you cannot swap it out, so spend your best players carefully.",
  },
  {
    icon: Trophy,
    title: "Beat the maximum",
    body: "Every square pays its PEAK3 score, times a bonus for how few seasons qualify. When the board is full, see how close you got to today’s maximum.",
  },
];

const RULES: string[] = [
  "Nine squares, nine different players.",
  "Wrong answers are rejected and counted — they cost you nothing but pride.",
  "There is no reset. The board is the board.",
  "A new grid every day, the same one for everyone.",
];

interface Props {
  variant: "gate" | "panel";
  date: string;
  difficulty: string;
  onStart: () => void;
  onClose?: () => void;
}

export default function HowToPlay({ variant, date, difficulty, onStart, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);

  // Move focus into the dialog so a keyboard user is not left behind on the
  // trigger, and let Escape dismiss it. Gate variant is not dismissible --
  // there is nothing behind it yet.
  useEffect(() => {
    if (variant === "panel") {
      closeRef.current?.focus();
      const handle = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose?.();
      };
      document.addEventListener("keydown", handle);
      return () => document.removeEventListener("keydown", handle);
    }
    startRef.current?.focus();
  }, [variant, onClose]);

  const isPanel = variant === "panel";

  return (
    <section
      data-testid={isPanel ? "how-to-play-panel" : "how-to-play-gate"}
      role={isPanel ? "dialog" : undefined}
      aria-modal={isPanel ? true : undefined}
      aria-labelledby="how-to-play-heading"
      className="card-elevated mx-auto w-full max-w-3xl p-5 sm:p-7"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--peak-accent)" }}
          >
            How to play
          </p>
          <h2 id="how-to-play-heading" className="font-display mt-1 text-2xl font-bold sm:text-3xl">
            Build the highest-scoring grid
          </h2>
          {/* The objective, stated once, in the words the rest of the page
              repeats. Everything else on this panel is mechanics. */}
          <p
            data-testid="how-to-play-objective"
            className="mt-2 max-w-xl text-sm leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            Fill all nine squares with valid NBA player-seasons and score the{" "}
            <strong style={{ color: "var(--text-primary)" }}>highest total PEAK3 score</strong> you
            can. Any valid answer fills a square — only the best ones win the day.
          </p>
        </div>
        {isPanel && (
          <button
            ref={closeRef}
            type="button"
            data-testid="how-to-play-close"
            onClick={onClose}
            className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            Close
          </button>
        )}
      </div>

      <ol className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <li
              key={step.title}
              className="card-surface flex gap-3 p-4"
              data-testid="how-to-play-step"
            >
              <div
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--peak-accent)",
                }}
              >
                <Icon size={15} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  Step {i + 1}
                </p>
                <h3 className="font-display mt-0.5 text-sm font-bold">{step.title}</h3>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {step.body}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <ul className="mt-5 space-y-1.5">
        {RULES.map((rule) => (
          <li
            key={rule}
            className="flex gap-2 text-xs leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            <span aria-hidden="true" style={{ color: "var(--peak-accent)" }}>
              &middot;
            </span>
            {rule}
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Today&apos;s board · {date} · {difficulty} difficulty
        </p>
        <button
          ref={startRef}
          type="button"
          data-testid={isPanel ? "how-to-play-dismiss" : "start-daily-grid"}
          onClick={isPanel ? onClose : onStart}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
        >
          {isPanel ? "Back to the grid" : "Start today's grid"}
        </button>
      </div>
    </section>
  );
}
