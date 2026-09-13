"use client";

/**
 * CUT and KEEP. Hard-edged, and never colour alone: each carries an icon, a
 * word, its remaining count, and a distinct border treatment. A spent quota
 * disables its button AND says why in text. `K` and `C` work from anywhere on
 * the page (wired in the room).
 */

import { Check, Scissors } from "lucide-react";

import { PRIME_CUT_COMMAND_CUT, PRIME_CUT_COMMAND_KEEP, type PrimeCutDecisionRecord } from "@/types/prime-cut";

export default function PrimeCutControls({
  keepsLeft,
  cutsLeft,
  legal,
  decision,
  pending,
  waitingOn,
  onKeep,
  onCut,
}: {
  keepsLeft: number;
  cutsLeft: number;
  legal: string[];
  decision: PrimeCutDecisionRecord | null;
  pending: string | null;
  waitingOn: number;
  onKeep: () => void;
  onCut: () => void;
}) {
  const canKeep = legal.includes(PRIME_CUT_COMMAND_KEEP);
  const canCut = legal.includes(PRIME_CUT_COMMAND_CUT);
  const sending = pending === PRIME_CUT_COMMAND_KEEP || pending === PRIME_CUT_COMMAND_CUT;
  const locked = decision !== null;

  let status: string;
  if (locked) {
    status = waitingOn > 0 ? `Locked. Waiting on ${waitingOn} player${waitingOn === 1 ? "" : "s"}.` : "Locked.";
  } else if (!canKeep && canCut) {
    status = "Your four keeps are used — this card can only be cut.";
  } else if (!canCut && canKeep) {
    status = "Your four cuts are used — this card can only be kept.";
  } else {
    status = "Calls are final. K to keep, C to cut.";
  }

  return (
    <div className="pcut-controls" data-testid="pcut-controls">
      <div className="pcut-controls-row" role="group" aria-label="Your call on this card">
        <button
          type="button"
          className="pcut-action"
          data-action="cut"
          data-testid="pcut-cut"
          aria-keyshortcuts="C"
          disabled={!canCut || locked || sending}
          aria-busy={pending === PRIME_CUT_COMMAND_CUT}
          onClick={onCut}
        >
          <Scissors size={20} aria-hidden="true" />
          <span className="pcut-action-word">{pending === PRIME_CUT_COMMAND_CUT ? "Cutting…" : "Cut"}</span>
          <span className="pcut-action-count pk-numeral">{cutsLeft} left</span>
        </button>
        <button
          type="button"
          className="pcut-action"
          data-action="keep"
          data-testid="pcut-keep"
          aria-keyshortcuts="K"
          disabled={!canKeep || locked || sending}
          aria-busy={pending === PRIME_CUT_COMMAND_KEEP}
          onClick={onKeep}
        >
          <Check size={20} aria-hidden="true" />
          <span className="pcut-action-word">{pending === PRIME_CUT_COMMAND_KEEP ? "Keeping…" : "Keep"}</span>
          <span className="pcut-action-count pk-numeral">{keepsLeft} left</span>
        </button>
      </div>
      <p className="pcut-controls-status" data-testid="pcut-controls-status">
        {status}
      </p>
    </div>
  );
}
