/**
 * PeakV2Score — a numeric result. Credits, bids, a lane rating, a round
 * tally, a lifetime record, a final score.
 *
 * `role` (Pass 2.5, product-direction — the cinematic-numeral correction
 * from the real Claude Design reference) decides the typeface, and is
 * deliberately a named choice rather than a size/weight guess:
 *
 *   "instrument" (default) — INSTRUMENTATION role, tabular mono. Credits,
 *   bids, a round/pick counter, a routine per-lane rating. This is every
 *   existing consumer's unchanged behavior.
 *
 *   "moment" — DISPLAY/MOMENT role, serif. Reserved for a number that IS
 *   the headline, not a supporting stat: a final daily score ("7 / 10"), a
 *   boss act/identity numeral, a projected record when it is the thing a
 *   screen is actually about. The reference uses serif for exactly these
 *   and mono for everything else — never routine clocks, bids, or credits.
 *
 * A screen picks the role per number; `PeakV2Score` never infers it from
 * size or context, so a future call site cannot silently drift into
 * serif-for-everything.
 */

import type { ReactNode } from "react";
import type { V2Tone } from "./v2-tone";
import { v2ToneVar } from "./v2-tone";

export type PeakV2ScoreRole = "instrument" | "moment";

export interface PeakV2ScoreProps {
  /** The number, or a composed node (a transitioning number, a range). */
  value: ReactNode;
  label?: string;
  tone?: V2Tone;
  size?: "sm" | "md" | "lg";
  role?: PeakV2ScoreRole;
  /**
   * Cross-axis alignment of the label over the value. `"start"` (default)
   * keeps every existing caller pixel-identical — a score sitting in a
   * left-aligned row, a stat column or a seat header reads left.
   *
   * `"center"` is for a score that IS the centred cinematic moment: inside
   * `PeakV2CinematicStage` the block itself is centred, but its internals
   * are not, so a short value under a longer label hung visibly left of the
   * axis everything else on the stage is centred on (measured on the
   * Three-Man Weave result: label centred at 570px, "15.3" centred at
   * 513px).
   */
  align?: "start" | "center";
  className?: string;
  /** Optional passthrough for a caller that needs to address this specific
   *  instance (e.g. a game's own HUD test contract) — never set internally.
   *  Lands on the OUTER wrapper, so its text content is `label` + `value`
   *  together; a caller that needs the bare number (e.g. `toHaveText(/^\d+$/)`)
   *  wants `valueTestId` instead. */
  "data-testid"?: string;
  /** Testid for the number itself, excluding `label` — the outer wrapper's
   *  `data-testid` (above) includes both, which breaks an exact-text
   *  assertion against just the value when a `label` is also passed. */
  valueTestId?: string;
}

const SIZE_REM: Record<NonNullable<PeakV2ScoreProps["size"]>, string> = {
  sm: "1rem",
  md: "1.375rem",
  lg: "2.25rem",
};

export default function PeakV2Score({
  value,
  label,
  tone = "neutral",
  size = "md",
  role = "instrument",
  align = "start",
  className,
  "data-testid": dataTestId,
  valueTestId,
}: PeakV2ScoreProps) {
  const color = v2ToneVar(tone) ?? "var(--v2-text-primary)";
  const moment = role === "moment";
  return (
    <div
      className={`inline-flex flex-col ${align === "center" ? "items-center" : "items-start"} ${className ?? ""}`}
      data-testid={dataTestId}
    >
      {label ? (
        <span
          style={{
            fontFamily: "var(--v2-font-ui)",
            fontSize: "0.6875rem",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--v2-text-muted)",
          }}
        >
          {label}
        </span>
      ) : null}
      <span
        data-testid={valueTestId}
        style={{
          fontFamily: moment ? "var(--v2-font-display)" : "var(--v2-font-mono)",
          fontVariantNumeric: moment ? undefined : "tabular-nums",
          fontFeatureSettings: moment ? undefined : "var(--v2-mono-feature)",
          letterSpacing: moment ? "var(--v2-display-track)" : "var(--v2-mono-track)",
          fontWeight: moment ? 600 : 700,
          fontSize: SIZE_REM[size],
          color,
        }}
      >
        {value}
      </span>
    </div>
  );
}
