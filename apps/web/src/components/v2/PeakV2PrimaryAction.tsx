/**
 * PeakV2PrimaryAction — the gold call-to-action. Committing a choice,
 * submitting a bid, drafting a player, starting a run — OR navigating to
 * the single most important place a screen can send you (e.g. the
 * homepage's "Run the Table" CTA). Gold is "primary action / current
 * focus / selected state" (brief §Color), which only means something if
 * it is scarce: one per decision.
 *
 * Polymorphic on `href`: with it, renders a real `next/link` styled
 * identically (a link must never render as a `<button>` — invalid HTML,
 * broken middle-click/open-in-new-tab); without it, a real `<button>`.
 * Same visual contract either way.
 */

import Link from "next/link";
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";
import { v2ActionBaseStyle, type V2ActionSize } from "./v2-action-base";

type SharedProps = { size?: V2ActionSize; busy?: boolean };

export type PeakV2PrimaryActionProps =
  | (SharedProps & { href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">)
  | (SharedProps & { href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>);

const FOCUS_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--v2-bg-page)]";

const PeakV2PrimaryAction = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  PeakV2PrimaryActionProps
>(function PeakV2PrimaryAction({ size = "md", busy = false, style, className, ...rest }, ref) {
  const fillStyle = {
    ...v2ActionBaseStyle(size),
    background: "var(--v2-color-accent)",
    color: "var(--text-inverse)",
    border: "1px solid transparent",
    ...style,
  };

  if (rest.href !== undefined) {
    const { href, ...anchorRest } = rest;
    return (
      <Link
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        className={`inline-flex items-center justify-center gap-1.5 ${FOCUS_CLASS} ${className ?? ""}`}
        style={fillStyle}
        {...anchorRest}
      />
    );
  }

  const { disabled, ...buttonRest } = rest;
  const inactive = disabled || busy;
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      disabled={inactive}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-1.5 ${FOCUS_CLASS} ${className ?? ""}`}
      style={{ ...fillStyle, opacity: inactive ? 0.55 : 1, cursor: inactive ? "not-allowed" : "pointer" }}
      {...buttonRest}
    />
  );
});

export default PeakV2PrimaryAction;
