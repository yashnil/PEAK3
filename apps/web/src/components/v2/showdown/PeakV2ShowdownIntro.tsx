"use client";

/**
 * PeakV2ShowdownIntro — the $20 Showdown's CINEMATIC pre-match (Pass 3).
 *
 * Verified against the reference (E2 page 18): "Somebody always *overpays*."
 * italic-gold headline, four numbered steps, then the real per-seat budget
 * mirror. An overlay above the mounted board, same as legacy `MatchIntro` —
 * `onDismiss` is the exact same server-turn-skip callback, so dismissal
 * timing still belongs to `useShowdownPhase`, not this component.
 */

import PeakV2CinematicStage from "../PeakV2CinematicStage";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2DisplayEmphasis from "../PeakV2DisplayEmphasis";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import { formatDollars } from "@/lib/twenty-dollar-api";

const STEPS: { n: string; title: string; body: string }[] = [
  { n: "01", title: "A lot opens", body: "One player, their eligible positions. The PEAK3 score stays sealed." },
  { n: "02", title: "Open or raise", body: "Whole dollars inside the legal range, on a running clock." },
  { n: "03", title: "Or step aside", body: "Market skip, pass on this lot, or concede — never a silent decline." },
  { n: "04", title: "Five beats five", body: "Both rosters full, the seal breaks, and the same five lanes settle the match." },
];

export default function PeakV2ShowdownIntro({
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
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="The $20 Showdown — pre-match"
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ background: "var(--v2-bg-page)" }}
      data-ui-version="v2"
    >
      <PeakV2CinematicStage light={{ y: "-6%" }}>
        <span
          style={{
            fontFamily: "var(--v2-font-mono)",
            fontSize: "0.6875rem",
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--v2-color-accent)",
          }}
        >
          {rated ? "Rated match" : "Practice match"} · vs {opponentName}
        </span>
        <PeakV2ResultHeadline as="h1" scale="hero" className="mt-3">
          Somebody always <PeakV2DisplayEmphasis>overpays.</PeakV2DisplayEmphasis>
        </PeakV2ResultHeadline>
        <p
          className="mt-4 max-w-lg"
          style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.9375rem", color: "var(--v2-text-secondary)" }}
        >
          A peak window&apos;s PEAK3 score stays sealed until its lot sells. You are pricing it yourself, against an
          opponent who needs the same five positions you do.
        </p>

        <div className="mt-10 grid w-full max-w-2xl grid-cols-1 gap-6 text-left sm:grid-cols-2">
          {STEPS.map((step) => (
            <div key={step.n}>
              <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-color-accent)" }}>
                {step.n}
              </span>
              <p style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.9375rem", color: "var(--v2-text-primary)" }}>
                {step.title}
              </p>
              <p className="mt-0.5" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}>
                {step.body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex items-center gap-10">
          <div className="text-center">
            <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "1.5rem", fontWeight: 700, color: "var(--v2-text-primary)" }}>
              {formatDollars(startingBudget)}
            </span>
            <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>each budget</p>
          </div>
          <div className="text-center">
            <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "1.5rem", fontWeight: 700, color: "var(--v2-text-primary)" }}>
              {slots}
            </span>
            <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>roster slots</p>
          </div>
          <div className="text-center">
            <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "1.5rem", fontWeight: 700, color: "var(--v2-text-primary)" }}>
              {marketSkips}
            </span>
            <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>market skips</p>
          </div>
        </div>

        <div className="mt-8">
          <PeakV2PrimaryAction data-testid="td-intro-start" onClick={onDismiss} autoFocus>
            Open lot 1
          </PeakV2PrimaryAction>
        </div>
      </PeakV2CinematicStage>
    </div>
  );
}
