"use client";

/**
 * Daily Grid rules panel.
 *
 * ONE VARIANT NOW. This used to be two: a `gate` that blocked the board on a
 * first visit and a `panel` reopened later. The gate moved to `StartGate.tsx`,
 * where it belongs — the gate is a decision surface (start / tour / skip), and
 * this is reference material a player comes back to mid-board.
 *
 * REBUILT ON `components/ui/Dialog`. The previous implementation hand-rolled
 * its own Escape listener with no focus trap, no layer stack, no body scroll
 * lock and no focus restoration, and its backdrop was an unportalled `fixed`
 * div inside the game tree — so Tab walked straight out of it into the board
 * behind, the page scrolled underneath it, and closing it stranded focus on
 * `<body>`. `Dialog` wires all five `lib/a11y` primitives (and shares ONE
 * layer registration between the trap and the Escape handler, which is the
 * contract at a11y.ts:114-121), so none of that is this component's problem
 * any more.
 *
 * Kept to four short cards plus a rules list rather than a wall of prose: the
 * objective has to survive being skimmed.
 */
import { useRef } from "react";
import { Lock, Search, Target, Trophy } from "lucide-react";

import { Dialog } from "@/components/ui/Dialog";

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
    body: "Search tells you whether a season qualifies, but scores reveal only after a pick locks. A valid pick is final — spend your best players carefully.",
  },
  {
    icon: Trophy,
    title: "Beat the maximum",
    body: "Every square pays its PEAK3 score, times a bonus for how small its answer pool is. When the board is full, compare your grid to today’s PEAK3 maximum.",
  },
];

const RULES: string[] = [
  "One player per board — nine squares, nine different players.",
  "Picks are final. There is no reset and no swapping.",
  "Search helps confirm eligibility; scores reveal only after lock.",
  "Wrong answers are rejected and counted — they cost you nothing but pride.",
  "Your time is tracked for you. It does not affect your score.",
  "A new grid every day, the same one for everyone.",
];

interface Props {
  open: boolean;
  date: string;
  difficulty: string;
  /** The board's theme, e.g. "Ring Chasers". Optional so the panel still
   *  renders against an older board payload. */
  theme?: string;
  onClose: () => void;
  /** Opens the seven-step walkthrough. Omitted where there is no tour to open
   *  (nothing today, but the panel does not need to know). */
  onTakeTour?: () => void;
}

export default function HowToPlay({
  open,
  date,
  difficulty,
  theme,
  onClose,
  onTakeTour,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      labelledBy="how-to-play-heading"
      initialFocusRef={closeRef}
      data-testid="how-to-play-panel"
      className="p-5 sm:p-7"
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
            Fill the grid with exact NBA player-seasons. Your goal:{" "}
            <strong style={{ color: "var(--text-primary)" }}>
              maximize your PEAK3 total with nine different players
            </strong>
            . The rows and columns are basketball facts — teams, awards, eras, playoff runs. PEAK3 only
            decides what each pick was worth.
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          data-testid="how-to-play-close"
          onClick={onClose}
          className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
        >
          Close
        </button>
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
        <p data-testid="how-to-play-board-line" className="text-xs" style={{ color: "var(--text-muted)" }}>
          Today&apos;s board &middot; {date}
          {theme ? ` · ${theme}` : ""} &middot; {difficulty} difficulty
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {onTakeTour && (
            <button
              type="button"
              data-testid="how-to-play-take-tour"
              onClick={onTakeTour}
              className="rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              style={{ borderColor: "var(--border-emphasis)", color: "var(--text-primary)" }}
            >
              Take the walkthrough
            </button>
          )}
          <button
            type="button"
            data-testid="how-to-play-dismiss"
            onClick={onClose}
            className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
          >
            Back to the grid
          </button>
        </div>
      </div>
    </Dialog>
  );
}
