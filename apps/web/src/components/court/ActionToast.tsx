"use client";

interface Props {
  message: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
}

/**
 * Launch-polish §5, gap 2: neither `handlePlace` nor `handleSwap` left any
 * trace behind once they succeeded -- no confirmation the move happened, and
 * no way back short of repeating the whole two-click flow by hand. This is
 * that trace: a compact, auto-dismissing strip naming what just happened,
 * with one action that reverses or redirects it.
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
      <button
        type="button"
        data-testid="court-action-toast-action"
        onClick={() => {
          onAction();
          onDismiss();
        }}
        className="rounded-full px-3 py-1.5 font-bold uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
      >
        {actionLabel}
      </button>
      <button
        type="button"
        data-testid="court-action-toast-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="px-1 text-sm leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        style={{ color: "var(--text-muted)" }}
      >
        ×
      </button>
    </div>
  );
}
