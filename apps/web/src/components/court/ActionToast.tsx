"use client";

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
export default function ActionToast({ message, actionLabel, onAction, onDismiss }: Props) {
  return (
    <div
      data-testid="court-action-toast"
      role="status"
      className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2.5 text-xs font-semibold shadow-lg"
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
        style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
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
  );
}
