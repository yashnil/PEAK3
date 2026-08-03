"use client";
import { motion } from "motion/react";
import { MapAct } from "@/types/run-the-table";
import { LadderRow, ladderRows } from "@/lib/run-the-table-state";
import { usePrefersReducedMotion } from "@/lib/a11y";

/**
 * The run ladder: `ACTS` acts, each `STAGES_PER_ACT` stage rows then a heavier
 * boss row.
 *
 * Renders only what `_map_public` sends. An unreached stage shows its SHAPE
 * ("Draft Room or Film Room") and nothing else — no offers, no cards, no
 * boss roster. That restriction is the server's, and this component must
 * never work around it.
 */
interface Props {
  map: MapAct[];
}

function rowStyle(row: LadderRow): {
  background: string;
  borderColor: string;
  color: string;
} {
  const done = row.state === "done" || row.state === "won";
  const lost = row.state === "lost";
  const current = row.state === "current";
  if (current) {
    return {
      background: "var(--peak-accent-bg)",
      borderColor: "var(--peak-accent)",
      color: "var(--text-primary)",
    };
  }
  if (done) {
    return {
      background: "var(--bg-surface)",
      borderColor: "var(--correct-dim)",
      color: "var(--text-primary)",
    };
  }
  if (lost) {
    return {
      background: "var(--bg-surface)",
      borderColor: "var(--incorrect-dim)",
      color: "var(--text-primary)",
    };
  }
  if (row.state === "drawn") {
    return {
      background: "var(--bg-surface)",
      borderColor: "var(--border-emphasis)",
      color: "var(--text-primary)",
    };
  }
  // Locked. Recessed by BACKGROUND and BORDER only — never by a blanket
  // `opacity`, which used to drag every label in the row below AA.
  return {
    background: "var(--bg-elevated)",
    borderColor: "var(--border-subtle)",
    color: "var(--text-muted)",
  };
}

const STATE_WORD: Record<string, string> = {
  done: "Done",
  current: "Now",
  locked: "Locked",
  won: "Won",
  lost: "Lost",
  drawn: "Drawn",
};

/**
 * Foreground colour for the state word — deliberately NOT the row's
 * `borderColor`.
 *
 * Border tokens are chosen to be quiet against the row fill, so reusing them
 * as text produced 1.11:1 (locked), 1.70:1 (drawn), 2.61:1 (lost) and 3.36:1
 * (done/won) — and this word is the only TEXTUAL state indicator in the rail.
 * These are foreground tokens measured against the fill each state actually
 * paints, IN BOTH THEMES (Arena Night / Arena Day — light values added when
 * the theme system landed; `--text-muted`/`--text-secondary`/`--correct`
 * flip between themes, so the same token expression is re-measured, not
 * re-derived):
 *
 *   locked   --text-muted     on --bg-elevated   dark 5.21:1 · light 5.60:1
 *   drawn    --text-secondary on --bg-surface    dark 5.31:1 · light 7.60:1
 *   lost     incorrect@85%+primary on --bg-surface dark 5.17:1 · light 6.51:1
 *   done/won --correct        on --bg-surface    dark 7.40:1 · light 6.25:1
 *   current  see below — NOT a bare `--peak-accent` any more
 *
 * `--incorrect` neat is only 4.48:1 on `--bg-surface`, which is why "lost"
 * mixes it toward `--text-primary` rather than shipping a near-miss.
 *
 * `current` WAS a real, previously-unmeasured light-theme failure. Dark's
 * `--peak-accent` (frozen, #f5c842) on the 8% accent wash over `--bg-page`
 * measures a comfortable 10.95:1 — but the SAME pure accent on Arena Day's
 * 14% wash over its (much lighter) `--bg-page` measures **1.24:1**, nowhere
 * near even the 3:1 large-text floor, because pale gold on near-white paper
 * is a bad pairing regardless of theme intent. `--peak-accent` cannot change
 * (CLAUDE.md, frozen in both themes), so the fix mixes it toward
 * `--text-primary` — which itself flips dark-ink/light-ink per theme, so one
 * expression clears both: `color-mix(in srgb, var(--peak-accent) 40%,
 * var(--text-primary))` measures 13.26:1 on the dark wash (still excellent,
 * up from 10.95) and 4.91:1 on the light wash (clears the 4.5:1 body-text
 * floor this small, non-bold label actually needs — it is 9px, well under
 * the large-text size threshold).
 */
const STATE_TEXT: Record<string, string> = {
  done: "var(--correct)",
  won: "var(--correct)",
  current: "color-mix(in srgb, var(--peak-accent) 40%, var(--text-primary))",
  locked: "var(--text-muted)",
  lost: "color-mix(in srgb, var(--incorrect) 85%, var(--text-primary))",
  drawn: "var(--text-secondary)",
};

export default function RunMap({ map }: Props) {
  const rows = ladderRows(map);
  const reducedMotion = usePrefersReducedMotion();
  return (
    <nav
      aria-label="Run map"
      data-testid="rtt-run-map"
      data-tour-id="rtt-run-map"
      /* `.rtt-map-rail` is the "recedes when not active" treatment: the rail's
         own chrome quiets down so the decision column reads as dominant. The
         CURRENT row is exempt — it keeps full contrast, because that is the one
         row that answers "where am I". No blanket opacity: that dragged every
         label in every row below AA, which is exactly the bug `rowStyle`'s
         locked branch already had to fix once. */
      className="rtt-map-rail flex flex-col gap-1.5"
    >
      <h2
        className="text-[10px] font-bold uppercase tracking-widest"
        style={{ color: "var(--text-muted)" }}
      >
        Run map
      </h2>
      <ol className="flex flex-col gap-1">
        {rows.map((row) => {
          const s = rowStyle(row);
          const isBoss = row.kind === "boss";
          const isCurrent = row.state === "current";
          return (
            <li key={row.key} className="relative">
              {/* Shared-element indicator: ONE element that travels down the
                  ladder as the run advances, rather than a highlight blinking
                  out here and in there. `layoutId` is what makes it the same
                  element to Motion. Skipped entirely under reduced motion. */}
              {isCurrent && !reducedMotion && (
                <motion.span
                  layoutId="rtt-current-node"
                  aria-hidden="true"
                  data-testid="rtt-map-current-indicator"
                  className="rtt-map-current-indicator"
                  transition={{ type: "spring", stiffness: 380, damping: 34 }}
                />
              )}
              <div
                data-testid={`rtt-map-row-${row.key}`}
                data-row-state={row.state}
                data-row-kind={row.kind}
                className={`rtt-map-row ${isBoss ? "rtt-map-row-boss" : ""}${
                  isCurrent ? " rtt-map-row-current" : ""
                }`}
                style={{
                  background: s.background,
                  borderColor: s.borderColor,
                }}
              >
                <span
                  aria-hidden="true"
                  className="rtt-map-dot"
                  style={{ background: s.borderColor }}
                />
                <span className="flex flex-col min-w-0">
                  <span
                    className={`truncate ${isBoss ? "text-[11px] font-bold uppercase tracking-wide" : "text-[11px] font-semibold"}`}
                    style={{ color: s.color }}
                  >
                    {row.label}
                  </span>
                  {/* `row.sublabel` unconditionally. This used to be a ternary
                      whose two branches were the identical expression — dead
                      code that read as if a locked, unscouted stage showed
                      something different, which it never did. What a locked row
                      may show is decided by the SERVER (`_map_public` sends
                      only the stage's shape), and `ladderRows` already resolves
                      it into `sublabel`. */}
                  <span className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {row.sublabel}
                    {row.scouted ? " · scouted" : ""}
                  </span>
                </span>
                <span
                  data-testid={`rtt-map-state-${row.key}`}
                  className="ml-auto shrink-0 text-[9px] font-semibold uppercase tracking-wider"
                  style={{ color: STATE_TEXT[row.state] ?? "var(--text-secondary)" }}
                >
                  {STATE_WORD[row.state] ?? row.state}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
