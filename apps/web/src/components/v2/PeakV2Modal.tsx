/**
 * PeakV2Modal — a genuine modal/cinematic container: the one V2 surface
 * that always earns its elevation, because it has real independent
 * interaction and real independent state (it is either open or it is not,
 * and it captures focus while it is).
 *
 * Deliberately a thin V2-styled wrapper around the app's ONE shared
 * `Dialog` (`components/ui/Dialog.tsx`) rather than a second
 * implementation: focus trap, restore-focus, body-scroll-lock, Escape,
 * portal and the reduced-motion-aware entrance are all shared logic this
 * primitive reuses exactly, per the brief's "extract only the minimum
 * shared logic necessary" — a modal's a11y correctness is exactly the kind
 * of thing that must never fork between two presentations.
 */

import type { ComponentProps } from "react";
import { Dialog } from "@/components/ui/Dialog";

/** Plain `Omit` collapses `Dialog`'s `label`/`labelledBy` discriminated
 *  union into one shape and loses the "exactly one is required" contract —
 *  distribute over the union FIRST, then omit each branch. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type PeakV2ModalProps = DistributiveOmit<
  ComponentProps<typeof Dialog>,
  "panelStyle" | "backdropStyle"
>;

export default function PeakV2Modal({ className, size = "md", ...rest }: PeakV2ModalProps) {
  return (
    <Dialog
      {...rest}
      size={size}
      className={className}
      panelStyle={{
        fontFamily: "var(--v2-font-ui)",
        background: "var(--v2-bg-plane)",
        border: "1px solid var(--v2-border-emphasis)",
        borderRadius: "var(--v2-radius-modal)",
        boxShadow: "var(--v2-elev-modal)",
        color: "var(--v2-text-primary)",
        padding: "var(--v2-space-6)",
      }}
    />
  );
}
