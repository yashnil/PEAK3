"use client";

/**
 * "Start New Run" — the secondary escape hatch from an unfinished run.
 *
 * TWO THINGS THIS COMPONENT IS CAREFUL ABOUT.
 *
 * 1. IT IS SECONDARY, AND IT LOOKS IT. Continuing is the primary action, and
 *    on this screen continuing is simply *playing* — the run is already in
 *    front of the player, so there is no "Continue" button to out-rank. That
 *    makes the visual weight of THIS control the only thing standing between a
 *    player and an accidental restart, which is why it is a small, muted,
 *    bordered button rather than a filled one, and why it never sits alone on
 *    a row where it could read as the call to action.
 *
 * 2. IT NEVER RESETS ANYTHING LOCALLY. Confirming calls the server, which
 *    marks the old run `abandoned` and returns its successor. Clearing React
 *    state or localStorage would leave the old run live and resumable from
 *    another tab, which is the defect this flow exists to close.
 *
 * A daily run does not render this at all: `can_restart` is false and the
 * server refuses (409 `daily_not_restartable`), because "the first attempt is
 * the official one" is the daily contract. The daily surface offers a standard
 * run instead — a new board, not a re-roll of today's.
 *
 * Accessibility is delegated to the shared `Dialog`, which supplies
 * `role="dialog"`, `aria-modal`, a required accessible name, a focus trap,
 * focus restoration to the opener, and Escape-to-cancel. Cancel is given
 * initial focus deliberately: the destructive choice should never be the one
 * the keyboard lands on.
 */

import { useId, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";

interface Props {
  /** `state.can_restart` — false for a daily, which is a single attempt. */
  canRestart: boolean;
  /** Disables the trigger while another request is in flight. */
  busy: boolean;
  /** Resolves once the server has abandoned the old run and returned the new
   *  one. Rejecting leaves the dialog open with the message shown. */
  onConfirm: () => Promise<void>;
  /** Compact styling for the HUD row. */
  className?: string;
}

export default function RestartRunControl({
  canRestart,
  busy,
  onConfirm,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const describedBy = useId();

  if (!canRestart) return null;

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That did not go through. Your current run is untouched.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="rtt-start-new-run"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={busy}
        className={
          "rtt-tap inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 " +
          "text-[10px] font-semibold uppercase tracking-wide disabled:opacity-60 " +
          (className ?? "")
        }
        style={{
          background: "transparent",
          color: "var(--text-muted)",
          border: "1px solid var(--border-default)",
        }}
      >
        Start new run
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label="Start a new run?"
        describedBy={describedBy}
        initialFocusRef={cancelRef}
        size="sm"
        data-testid="rtt-restart-dialog"
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle
              size={18}
              aria-hidden="true"
              style={{ color: "var(--incorrect)", flexShrink: 0, marginTop: 2 }}
            />
            <div className="flex flex-col gap-1.5">
              <h2
                className="text-sm font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                Start a new run?
              </h2>
              <p
                id={describedBy}
                className="text-xs leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
                data-testid="rtt-restart-dialog-body"
              >
                Your current run will be abandoned and cannot be resumed. It
                stays in your history marked as abandoned, and it will not count
                towards any result.
              </p>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="text-xs"
              style={{ color: "var(--incorrect)" }}
              data-testid="rtt-restart-error"
            >
              {error}
            </p>
          )}

          {/* Cancel FIRST in the DOM as well as focused first: on a narrow
              screen these stack, and the non-destructive choice should be the
              one a thumb reaches without travelling past the destructive one. */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              ref={cancelRef}
              data-testid="rtt-restart-cancel"
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="rtt-tap rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-wide disabled:opacity-60"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-default)",
              }}
            >
              Keep playing
            </button>
            <button
              type="button"
              data-testid="rtt-restart-confirm"
              onClick={() => void confirm()}
              disabled={submitting}
              className="rtt-tap rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wide disabled:opacity-60"
              style={{ background: "var(--incorrect)", color: "var(--text-inverse)" }}
            >
              {submitting ? "Starting…" : "Abandon & start new"}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
