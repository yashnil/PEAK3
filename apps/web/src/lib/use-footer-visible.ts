"use client";

import { useEffect, useState } from "react";

/**
 * True once the page's global `<footer>` has scrolled into view.
 *
 * Extracted from `CompletionTrigger.tsx` (final RC audit) for a second
 * consumer, `HandleOnboardingPrompt.tsx`, which has the identical defect:
 * a `position: fixed` panel pinned near the viewport's bottom-right corner,
 * overlapping whatever in-flow content — a footer nav column, a form field
 * on a short page — happens to sit at that same screen position. Hiding the
 * panel whenever the true end of the page (the footer) is on screen removes
 * the collision at its root for every consumer, rather than special-casing
 * one page's specific content.
 *
 * `rootMargin`'s negative bottom value starts hiding the panel slightly
 * before the footer's own top edge reaches the viewport, so the two never
 * overlap even mid-transition.
 */
export function useFooterVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const footer = document.querySelector("footer");
    if (!footer) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: "0px 0px -60px 0px",
    });
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  return visible;
}
