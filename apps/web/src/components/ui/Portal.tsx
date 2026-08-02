"use client";

/**
 * Renders children into `document.body` (or an explicit container).
 *
 * SSR-safe by construction: returns `null` until after the first client effect,
 * so the server render and the first client render agree and React never
 * reports a hydration mismatch. `createPortal` appeared zero times in this app
 * before this pass — everything that needs to escape a stacking/overflow
 * context (dialog, tooltip, drawer, tour spotlight) goes through here.
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface PortalProps {
  children: ReactNode;
  /** Defaults to `document.body`. */
  container?: Element | null;
}

export function Portal({ children, container }: PortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const target = container ?? (typeof document !== "undefined" ? document.body : null);
  if (!target) return null;

  return createPortal(children, target);
}

export default Portal;
