"use client";

/**
 * The shared pre-game briefing shell.
 *
 * Before this pass, "how do I explain this mode before it starts" was solved
 * five different ways: a full-page numbered gate (`PeakSeasonStartGate`,
 * `RunStartGate`), a three-button gate plus a separate rules modal (Daily
 * Grid's `StartGate` + `HowToPlay`), a server-timed intro turn rendered
 * client-side (`MatchIntro`, $20 Showdown), a brief auto-advancing card
 * (`WeaveSpinner`'s round-1 intro), or nothing at all (Peak Duel). Where one
 * of those already does its job well, it stays — this component is not a
 * mandate to replace a tested, working gate. It exists for modes that had no
 * entrance at all, and as the visual vocabulary future gates should reach for.
 *
 * Built on `Dialog` rather than a sixth hand-rolled overlay, so focus-trap,
 * Escape, backdrop-dismiss, scroll-lock and the reduced-motion opt-out are
 * inherited rather than re-implemented. Escape/backdrop close is treated as
 * Skip — dismissing the briefing is not a null action, it's the same
 * "get me into the game" intent as pressing Skip.
 *
 * Contract: nothing the caller renders behind this component may perform a
 * game action (a spin, a draft pick, a clock start) until `onStart` or
 * `onSkip` fires. The mode owns enforcing that; this component only owns the
 * gate's own presentation.
 */

import { useRef, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";

export interface GameIntroRule {
  /** A short label, e.g. "Snake draft" — not a sentence. */
  label: string;
  /** One clause of detail. Keep it under ~12 words. */
  detail: string;
}

export interface GameIntroProps {
  open: boolean;
  /** Enter gameplay having read the briefing. */
  onStart: () => void;
  /** Enter gameplay without reading it. Also fired by Escape/backdrop. */
  onSkip: () => void;
  /** Small uppercase category, e.g. "Full season", "Multiplayer draft". */
  eyebrow: string;
  /** The mode's name, e.g. "82-0 PEAK Season". */
  title: string;
  /** One sentence: what the player is trying to do. */
  objective: string;
  /** The most important rule(s). Two or three, not a manual. */
  rules: GameIntroRule[];
  /** One visually interesting representation of the mechanic — a mini
   *  diagram, a static preview of the reel, a sample matchup card. Optional:
   *  a mode with nothing worth illustrating should not invent filler. */
  visual?: ReactNode;
  /** CSS custom-property value for the accent, e.g. "var(--peak-accent)" or
   *  "var(--comp-po)". Defaults to the house gold. */
  accent?: string;
  startLabel?: string;
  skipLabel?: string;
  /** Disables Start while a create/start request is in flight. */
  starting?: boolean;
  testId?: string;
}

export default function GameIntro({
  open,
  onStart,
  onSkip,
  eyebrow,
  title,
  objective,
  rules,
  visual,
  accent = "var(--peak-accent)",
  startLabel = "Start",
  skipLabel = "Skip",
  starting = false,
  testId = "game-intro",
}: GameIntroProps) {
  const startRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onClose={onSkip}
      label={`${title} — how to play`}
      size="md"
      initialFocusRef={startRef}
      data-testid={testId}
      className="game-intro-panel"
    >
      <div
        className="game-intro-accent-rail"
        aria-hidden="true"
        style={{ background: accent }}
      />
      <div className="flex flex-col gap-5 p-6 sm:p-8">
        <div>
          <p
            className="text-[11px] font-black uppercase tracking-[0.2em]"
            style={{ color: accent }}
          >
            {eyebrow}
          </p>
          <h2 className="font-display mt-1 text-2xl font-bold sm:text-3xl" style={{ color: "var(--text-primary)" }}>
            {title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {objective}
          </p>
        </div>

        {visual && (
          <div className="game-intro-visual" data-testid="game-intro-visual" style={{ borderColor: `color-mix(in srgb, ${accent} 35%, var(--border-subtle))` }}>
            {visual}
          </div>
        )}

        {rules.length > 0 && (
          <ul className="flex flex-col gap-2.5">
            {rules.map((rule) => (
              <li key={rule.label} className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: accent, marginTop: "0.4rem" }}
                />
                <span className="text-sm leading-snug">
                  <strong style={{ color: "var(--text-primary)" }}>{rule.label}</strong>
                  <span style={{ color: "var(--text-secondary)" }}> — {rule.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-1 flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <button
            ref={startRef}
            type="button"
            data-testid="game-intro-start"
            onClick={onStart}
            disabled={starting}
            className="pk-lift pk-press inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-bold uppercase tracking-wide disabled:opacity-60"
            style={{ background: accent, color: "var(--text-inverse)" }}
          >
            {startLabel}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="game-intro-skip"
            onClick={onSkip}
            className="rounded-lg px-4 py-3 text-sm font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ color: "var(--text-muted)" }}
          >
            {skipLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
