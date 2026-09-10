/**
 * PeakV2Shell — the outer page-level container every V2 screen mounts into.
 *
 * Sets `data-ui-version="v2"` on itself (not just relying on `<html>`'s
 * attribute) so the token layer in `styles/v2/tokens.css` resolves even
 * when a Shell instance is rendered in isolation — a Vitest render, the
 * primitive gallery route, or (later) a V2 screen mounted inside a legacy
 * page shell that has not itself flipped the attribute. Harmless to set
 * redundantly when `<html>` already carries it.
 *
 * `width` picks the page-width token: `"live"` (the default — compact but
 * breathable working width), `"live-wide"` (Pass 2.5 — a deliberate wider
 * ceiling for the rare LIVE screen that genuinely needs three simultaneous
 * regions at once, e.g. RTT's run-map + decision area + roster/lane rail;
 * NOT a default, and not every LIVE screen should reach for it), or
 * `"cinematic"` (the narrower editorial measure a serif headline actually
 * wants). Server-safe: no hooks, no client-only state, so this can wrap a
 * Server Component's fetched data.
 */

import type { ReactNode } from "react";

export interface PeakV2ShellProps {
  children: ReactNode;
  width?: "live" | "live-wide" | "cinematic" | "shell";
  className?: string;
}

const WIDTH_VAR: Record<NonNullable<PeakV2ShellProps["width"]>, string> = {
  live: "var(--v2-width-live)",
  "live-wide": "var(--v2-width-live-wide)",
  cinematic: "var(--v2-width-cinematic)",
  shell: "var(--v2-width-shell)",
};

export default function PeakV2Shell({ children, width = "live", className }: PeakV2ShellProps) {
  return (
    <div
      data-ui-version="v2"
      data-testid="peak-v2-shell"
      className={className}
      style={{
        /* TRANSPARENT, NOT `--v2-bg-page`.
         *
         * It used to paint `--v2-bg-page`, which was always redundant —
         * `body` in globals.css sets `background-color: var(--bg-page)`, the
         * same resolved value, and every one of this component's 47 call
         * sites renders inside that body. So the fill changed nothing that
         * was visible.
         *
         * It stopped being harmless when the arena backdrop arrived. The
         * room (`PeakV2ArenaBackdrop`, mounted once in `(main)/layout.tsx`)
         * paints the court and the floodlight BEHIND the page content; an
         * opaque full-width plane in front of it hid the environment on
         * every V2 screen and left the court visible only in the margins
         * outside the shell. Verified by DOM probe: one 1368x612 rect at
         * rgb(10,11,13) directly over the court.
         *
         * Transparent means the body's own fill still provides the page
         * colour and the room shows through it. Nothing else about this
         * component changes.
         */
        background: "transparent",
        color: "var(--v2-text-primary)",
        fontFamily: "var(--v2-font-ui)",
      }}
    >
      <div
        className="mx-auto"
        style={{
          maxWidth: WIDTH_VAR[width],
          paddingLeft: "var(--v2-gutter)",
          paddingRight: "var(--v2-gutter)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
