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
 * breathable working width) or `"cinematic"` (the narrower editorial
 * measure a serif headline actually wants). Server-safe: no hooks, no
 * client-only state, so this can wrap a Server Component's fetched data.
 */

import type { ReactNode } from "react";

export interface PeakV2ShellProps {
  children: ReactNode;
  width?: "live" | "cinematic" | "shell";
  className?: string;
}

const WIDTH_VAR: Record<NonNullable<PeakV2ShellProps["width"]>, string> = {
  live: "var(--v2-width-live)",
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
        background: "var(--v2-bg-page)",
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
