"use client";

import { forwardRef, useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { DailyGridProgress, GridResultResponse } from "@/types/daily-grid";
import { resultGrade, totalArenaPoints } from "@/lib/daily-grid-state";

interface Props {
  progress: DailyGridProgress;
  result: GridResultResponse | null;
  onOpen: () => void;
}

/**
 * True once the page's global `<footer>` has scrolled into view.
 *
 * FIX (final RC audit, deferred from Batch 9): this trigger is `position:
 * fixed` at a constant distance from the viewport's bottom edge, and the
 * footer is ordinary in-flow content at the true end of the page — so
 * scrolling all the way down necessarily brings the footer to that same
 * screen coordinate. There is no scroll position, at any viewport width,
 * where the footer is visible and the pill does not sit on top of it; it
 * is worst at 390px (a taller, stacked footer) but reproduces everywhere.
 * `IntersectionObserver` is the smallest fix: hide the pill exactly when
 * the footer it would otherwise cover is on screen, and restore it the
 * moment the player scrolls back up to the board. `rootMargin`'s negative
 * bottom value starts hiding the pill slightly before the footer's own top
 * edge reaches the viewport, so the two never overlap even mid-transition.
 */
function useFooterVisible(): boolean {
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

/**
 * The compact floating trigger that replaces a permanently-compressed
 * board (launch-polish §4). Once the board is complete the FULL recap lives
 * in `CompletionModal`, not here -- this is only ever a one-line summary
 * (`"Near Perfect · 746 / 766"`, the contract's own example) that reopens it.
 *
 * `position: fixed` and centred at the bottom of the viewport, ABOVE the
 * board rather than beside it, so it never claims any of the grid's own
 * width -- the whole point is that the grid stays full-width and centred
 * even after the board is finished. It renders whenever `progress` is
 * complete, independent of whether the modal is open or closed; the modal
 * itself sits at a higher `z-index` (`Dialog`'s `--pk-z-dialog`) so there is
 * no double-surface visible at once. It hides itself, rather than the grid
 * scrolling past it, once the footer scrolls into view (see
 * `useFooterVisible` above) — the completion recap is one tap away again
 * as soon as the player scrolls back up.
 *
 * Degrades the same way `CompletionPanel` does: `result` (today's maximum)
 * is a second network round trip that can still be in flight or have failed
 * when the board first locks its ninth square, so the trigger falls back to
 * the player's own total rather than waiting on a number that must not be
 * required to show completion at all.
 */
const CompletionTrigger = forwardRef<HTMLButtonElement, Props>(function CompletionTrigger(
  { progress, result, onOpen },
  ref,
) {
  const grade = result ? resultGrade(result.percent_of_best) : null;
  const summary = result
    ? `${grade!.headline} · ${result.user_total} / ${result.optimal_total}`
    : `Grid complete · ${totalArenaPoints(progress)} pts`;
  const footerVisible = useFooterVisible();

  return (
    <button
      ref={ref}
      type="button"
      data-testid="daily-grid-completion-trigger"
      data-footer-visible={footerVisible ? "true" : "false"}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-hidden={footerVisible || undefined}
      tabIndex={footerVisible ? -1 : undefined}
      /* `.pk-press` only. `.pk-lift` is deliberately NOT used here: this
         button is horizontally centred with `-translate-x-1/2`, and
         `.pk-lift`'s hover rule sets `transform: translateY(-2px)` outright,
         which would drop the centring and snap the pill to the left edge on
         hover. The hand-rolled `hover:-translate-y-0.5` below composes with
         the centring instead, and `.pk-press`'s `scale()` composes with
         both — so the press half of the pairing is real, and the lift half
         stays as the class that already worked. */
      className="pk-press fixed bottom-4 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold shadow-lg transition-[transform,opacity] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      style={{
        background: "var(--peak-accent)",
        color: "var(--text-inverse)",
        boxShadow: "var(--pk-elev-3, 0 12px 28px -12px rgba(0, 0, 0, 0.55))",
        opacity: footerVisible ? 0 : 1,
        pointerEvents: footerVisible ? "none" : "auto",
      }}
    >
      <Trophy size={15} aria-hidden="true" />
      {summary}
    </button>
  );
});

export default CompletionTrigger;
