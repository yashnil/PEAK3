/**
 * PeakV2DockedPanel — a temporary interaction surface that must coexist
 * with visible background context (Pass 2.5, product-direction).
 *
 * Primary future use: 82-0's chooser docked over a still-visible
 * basketball court — verified against the reference (page 22): "+10 more
 * eligible · the court stays visible behind this card." NOT a normal
 * modal: a real `Dialog` (`PeakV2Modal`) intentionally dims and blocks the
 * whole screen behind it, because the thing behind it stops mattering the
 * instant the dialog opens. Here the opposite is true — the court behind
 * the panel is exactly what the player is choosing FOR, so it must stay
 * legible while the panel is open.
 *
 * Built as a genuinely thin wrapper over the shared `Dialog`
 * (`align="bottom"`), not a second overlay implementation: focus trap,
 * restore-focus, body-scroll-lock, Escape and the portal are the SAME
 * real machinery `PeakV2Modal` already reuses. Only the alignment (bottom,
 * not centered) and the visual treatment differ:
 *
 *   - `backdropOpacity` defaults to 0.32 — "no generic heavy backdrop,"
 *     not "no backdrop at all." A first version shipped at exactly 0 and
 *     LOOKED broken in a real screenshot despite passing every DOM/a11y
 *     test: `--v2-bg-surface` sits close enough to `--v2-bg-page` that
 *     with zero scrim the panel had no visible edge at all — it read as
 *     more page content, not a surface sitting in front of it. 0.32 keeps
 *     the background clearly legible (nowhere near `Dialog`'s own ~0.72)
 *     while giving the panel enough contrast to actually read as present.
 *     Screenshotting the rendered result caught this; the DOM tests could
 *     not have, which is exactly why the brief asks not to declare success
 *     from DOM assertions alone.
 *   - the panel's own background is `--v2-bg-surface` (a step brighter than
 *     `PeakV2Modal`'s `--v2-bg-plane`) plus a 2px gold top edge — the one
 *     border that visually says "the sheet starts here," on the one edge
 *     that actually meets open background.
 *   - the panel itself is capped at `maxHeightVh` (default 72) so a chunk
 *     of the background stays visible above it even at the panel's
 *     tallest — "mobile can use a bottom-sheet-like composition without
 *     erasing all court context."
 *   - top corners only are rounded (a docked sheet, not a floating card).
 *
 * KNOWN LIMITATION, left for Pass 3 rather than patched with a margin
 * hack now: `Dialog`'s outer wrapper keeps its own fixed 16px inset
 * (`--pk-space-4`) on all four edges, so this panel currently sits ~16px
 * off the true bottom/side edges instead of flush against them like the
 * reference's edge-to-edge sheet. Everything functional (bottom anchor,
 * background visibility, focus trap, max-height) is unaffected — this is
 * a small cosmetic gap, not a capability gap.
 *
 * Does not duplicate gameplay state: like `PeakV2Modal`, this is a pure
 * presentation wrapper around `open`/`onClose`/children the caller already
 * owns.
 */

import type { ComponentProps } from "react";
import { Dialog } from "@/components/ui/Dialog";

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type PeakV2DockedPanelProps = DistributiveOmit<
  ComponentProps<typeof Dialog>,
  "panelStyle" | "backdropStyle" | "align" | "size" | "rootDataUiVersion"
> & {
  /** `"bottom"` is the one fully reference-grounded treatment in this
   *  pass (the actual 82-0 mockup). `"side"` is accepted for a future
   *  right-anchored desktop variant but is not yet visually resolved —
   *  it currently renders identically to `"bottom"`. Do not treat `"side"`
   *  as a finished design; it exists so call sites can express intent
   *  now and pick it up for free once Pass 3 designs it. */
  dock?: "bottom" | "side";
  /** 0-1. Default 0.32 — see the module docstring. */
  backdropOpacity?: number;
  maxHeightVh?: number;
};

export default function PeakV2DockedPanel({
  dock = "bottom",
  backdropOpacity = 0.32,
  maxHeightVh = 72,
  ...rest
}: PeakV2DockedPanelProps) {
  void dock; // reserved for the Pass 3 side-dock treatment — see the type's own doc.
  return (
    <Dialog
      {...rest}
      align="bottom"
      size="full"
      rootDataUiVersion="v2"
      backdropStyle={{
        background: `rgba(6, 7, 9, ${backdropOpacity})`,
        backdropFilter: "none",
      }}
      panelStyle={{
        fontFamily: "var(--v2-font-ui)",
        background: "var(--v2-bg-surface)",
        border: "1px solid var(--v2-border-emphasis)",
        borderTop: "2px solid var(--v2-color-accent)",
        borderRadius: "var(--v2-radius-modal) var(--v2-radius-modal) 0 0",
        boxShadow: "var(--v2-elev-modal)",
        color: "var(--v2-text-primary)",
        padding: "var(--v2-space-5)",
        maxHeight: `${maxHeightVh}vh`,
      }}
    />
  );
}
