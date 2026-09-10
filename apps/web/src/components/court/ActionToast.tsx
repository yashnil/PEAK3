"use client";

import Portal from "@/components/ui/Portal";

interface Props {
  message: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
}

/**
 * Launch-polish §5 gap 2 / LP2-2: neither `handlePlace` nor `performSwap`
 * left any trace behind once they succeeded -- no confirmation the move
 * happened, and no way back short of repeating the whole two-click flow by
 * hand. This is that trace: a compact, auto-dismissing strip naming what
 * just happened, with one action that REVERSES it for real
 * (state.py::action_undo_last_placement) -- LP2-2 replaced the original
 * "Move" label, which honestly described a shortcut into rearrange mode
 * rather than an actual reversal, once the backend gained a real inverse.
 *
 * `role="status"` (not `alert`) -- this reports something that already
 * succeeded, not an error demanding attention. `position: fixed` at the
 * bottom, matching the Daily Grid's `CompletionTrigger` so a floating
 * "something changed, here's what to do about it" strip reads the same way
 * across both games in this app.
 */
export default function ActionToast({
  message,
  actionLabel,
  onAction,
  onDismiss,
}: Props) {
  return (
    /* RENDERED AT `document.body`, NOT WHERE IT IS DECLARED.
     *
     * This is a viewport-anchored layer (`position: fixed`) that has to
     * outrank the chooser sheet, and the chooser sheet goes through
     * `Dialog`, which portals to `document.body`. A z-index only orders
     * elements WITHIN one stacking context, so the two have to be in the
     * same one for `z-[120]` vs `--pk-z-dialog` (110) to mean anything.
     *
     * They stopped being in the same one when the arena room arrived:
     * `(main)/layout.tsx` now wraps the whole page in `.pk-arena-room`,
     * which carries `isolation: isolate` so the backdrop's `z-index: -1`
     * paints behind the content instead of behind the page. That isolation
     * is correct and load-bearing for the room — but it also sealed every
     * fixed layer declared inside the page tree into a stacking context
     * that sits BELOW the body-level dialog portal, whatever z-index it
     * asks for. The toast stayed visible and enabled, and a real finger on
     * it hit the sheet: `@mobile Undo is reachable and activatable by a
     * real tap` failed on two clean CI runners with Playwright reporting
     * the dialog root's subtree intercepting the touch, and passed again
     * the moment `isolation` was removed as a probe.
     *
     * Portaling is the fix rather than raising the number (nothing to
     * raise it above from in there) or dropping the isolation (the room
     * needs it): `Portal` exists precisely so a layer that must escape a
     * stacking/overflow context can, and every other such layer in the app
     * already uses it. This one predates the room and was missed.
     */
    <Portal>
      <div
        data-testid="court-action-toast"
        role="status"
        /* ABOVE both the legacy selection overlay (z-60) AND V2's docked
         chooser panel, which reuses the shared `Dialog` primitive's
         `--pk-z-dialog` (110). The toast's Undo applies to the card just
         placed, and the next round's sheet opens immediately — on a phone
         it is full-screen, so a toast underneath it would make Undo
         unreachable for exactly as long as it is valid (the original E1
         regression the mobile tap test caught; V2's cutover reused a
         higher-z-index dialog primitive for the chooser without re-checking
         this, reproducing the same defect).

         THE NUMBER ONLY WINS INSIDE THE SAME STACKING CONTEXT — hence the
         `Portal` above. See its comment for the third recurrence of this
         same defect and why escaping the page tree, not a bigger z-index,
         is what actually fixes it. */
        className="fixed bottom-4 left-1/2 z-[120] flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2.5 text-xs font-semibold shadow-lg"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-emphasis)",
          color: "var(--text-primary)",
          boxShadow: "var(--pk-elev-3, 0 12px 28px -12px rgba(0, 0, 0, 0.55))",
        }}
      >
        <span>{message}</span>
        {/* Launch-polish LP2-1: the floating toast has no card-height
          constraint the way a roster slot does, so the 44x44 floor is met
          by growing the real buttons directly. */}
        <button
          type="button"
          data-testid="court-action-toast-action"
          onClick={() => {
            onAction();
            onDismiss();
          }}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full px-3 font-bold uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          /* OUTLINE, NOT FILL. A solid gold pill floating over the court was
           the single brightest object on the screen during placement — for
           UNDO, which is housekeeping, while the player's actual selection and
           its best destination were competing for the same colour underneath
           it. It keeps its full 44x44 target, its label and its focus ring;
           only the fill goes. */
          style={{
            background: "transparent",
            color: "var(--peak-accent-text, #f5c842)",
            border: "1px solid var(--peak-accent)",
          }}
        >
          {actionLabel}
        </button>
        <button
          type="button"
          data-testid="court-action-toast-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-sm leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          style={{ color: "var(--text-muted)" }}
        >
          ×
        </button>
      </div>
    </Portal>
  );
}
