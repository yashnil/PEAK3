"use client";

import { forwardRef } from "react";
import { Trophy } from "lucide-react";
import { DailyGridProgress, GridResultResponse } from "@/types/daily-grid";
import { resultGrade, totalArenaPoints } from "@/lib/daily-grid-state";

interface Props {
  progress: DailyGridProgress;
  result: GridResultResponse | null;
  onOpen: () => void;
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
 * no double-surface visible at once.
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

  return (
    <button
      ref={ref}
      type="button"
      data-testid="daily-grid-completion-trigger"
      onClick={onOpen}
      aria-haspopup="dialog"
      /* `.pk-press` only. `.pk-lift` is deliberately NOT used here: this
         button is horizontally centred with `-translate-x-1/2`, and
         `.pk-lift`'s hover rule sets `transform: translateY(-2px)` outright,
         which would drop the centring and snap the pill to the left edge on
         hover. The hand-rolled `hover:-translate-y-0.5` below composes with
         the centring instead, and `.pk-press`'s `scale()` composes with
         both — so the press half of the pairing is real, and the lift half
         stays as the class that already worked. */
      className="pk-press fixed bottom-4 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold shadow-lg transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      style={{
        background: "var(--peak-accent)",
        color: "var(--text-inverse)",
        boxShadow: "var(--pk-elev-3, 0 12px 28px -12px rgba(0, 0, 0, 0.55))",
      }}
    >
      <Trophy size={15} aria-hidden="true" />
      {summary}
    </button>
  );
});

export default CompletionTrigger;
