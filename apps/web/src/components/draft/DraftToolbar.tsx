"use client";
import { DraftGameState } from "@/types/draft";

interface Props {
  gameState: DraftGameState;
  onHold: () => void;
  onReframe: () => void;
  disabled: boolean;
}

export default function DraftToolbar({ gameState, onHold, onReframe, disabled }: Props) {
  const { hold_available, reframe_available, hold_used, reframe_used, held_card } = gameState;

  return (
    <div className="flex gap-2">
      {/* HOLD */}
      <button
        onClick={onHold}
        disabled={disabled || !hold_available || hold_used}
        title={
          hold_used
            ? "Hold already used"
            : held_card
            ? `Holding: ${held_card.player_name}`
            : "Save a card for the next round"
        }
        className={[
          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
          "border border-transparent",
          hold_used || !hold_available || disabled
            ? "opacity-40 cursor-not-allowed"
            : "hover:border-[var(--peak-accent)] hover:bg-[var(--peak-accent)] hover:text-black cursor-pointer",
          held_card && !hold_used
            ? "border-[var(--peak-accent)] text-[var(--peak-accent)]"
            : "text-[var(--text-secondary)]",
        ].join(" ")}
        style={{ background: "var(--bg-elevated)" }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M6 1v10M1 6h10"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </svg>
        {held_card ? "Holding" : "Hold"}
      </button>

      {/* REFRAME */}
      <button
        onClick={onReframe}
        disabled={disabled || !reframe_available || reframe_used}
        title={
          reframe_used
            ? "Reframe already used"
            : "Replace this round's offers with alternates"
        }
        className={[
          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
          "border border-transparent",
          reframe_used || !reframe_available || disabled
            ? "opacity-40 cursor-not-allowed"
            : "hover:border-[#a78bfa] hover:bg-[#a78bfa20] cursor-pointer",
          "text-[var(--text-secondary)]",
        ].join(" ")}
        style={{ background: "var(--bg-elevated)" }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2 6a4 4 0 0 1 7.5-2M10 6a4 4 0 0 1-7.5 2"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          <path d="M9.5 2.5 10 4l-1.5.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2.5 9.5 2 8l1.5-.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Reframe
      </button>
    </div>
  );
}
