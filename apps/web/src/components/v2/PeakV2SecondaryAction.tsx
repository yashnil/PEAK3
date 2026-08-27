/**
 * PeakV2SecondaryAction — a quiet alternative beside a `PeakV2PrimaryAction`:
 * cancel, change selection, skip, back, or a secondary navigation link.
 * Outlined, not filled — gold stays scarce, and this must never compete
 * with it. Polymorphic on `href`, same contract as `PeakV2PrimaryAction`.
 */

import Link from "next/link";
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";
import { v2ActionBaseStyle, type V2ActionSize } from "./v2-action-base";

type SharedProps = { size?: V2ActionSize };

export type PeakV2SecondaryActionProps =
  | (SharedProps & { href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">)
  | (SharedProps & { href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>);

const FOCUS_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--v2-bg-page)]";

const PeakV2SecondaryAction = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  PeakV2SecondaryActionProps
>(function PeakV2SecondaryAction({ size = "md", style, className, ...rest }, ref) {
  const outlineStyle = {
    ...v2ActionBaseStyle(size),
    background: "transparent",
    color: "var(--v2-text-secondary)",
    border: "1px solid var(--v2-border)",
    ...style,
  };

  if (rest.href !== undefined) {
    const { href, ...anchorRest } = rest;
    return (
      <Link
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        className={`inline-flex items-center justify-center gap-1.5 ${FOCUS_CLASS} ${className ?? ""}`}
        style={outlineStyle}
        {...anchorRest}
      />
    );
  }

  const { disabled, ...buttonRest } = rest;
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 ${FOCUS_CLASS} ${className ?? ""}`}
      style={{ ...outlineStyle, opacity: disabled ? 0.55 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
      {...buttonRest}
    />
  );
});

export default PeakV2SecondaryAction;
