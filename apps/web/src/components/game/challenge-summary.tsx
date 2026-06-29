"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import Link from "next/link";
import type { GameState } from "@/types";
import { buildShareText } from "@/lib/progress";
import { getAccuracy, photoFinishCount } from "@/lib/game-state";
import { cn } from "@/lib/utils";

interface ChallengeSummaryProps {
  state: GameState;
  date?: string;
}

export function ChallengeSummary({ state, date }: ChallengeSummaryProps) {
  const [shared, setShared] = useState(false);
  const correct = state.results.filter((r) => r.correct).length;
  const accuracy = Math.round(getAccuracy(state) * 100);
  const pfCount = photoFinishCount(state);

  const handleShare = async () => {
    const text = buildShareText(date ?? new Date().toISOString().split("T")[0], state.results);
    if (navigator.share) {
      try {
        await navigator.share({ text });
        setShared(true);
      } catch {}
    } else {
      await navigator.clipboard.writeText(text);
      setShared(true);
    }
    setTimeout(() => setShared(false), 2000);
  };

  return (
    <div className="mx-auto max-w-xl space-y-6 py-8">
      {/* Score header */}
      <div className="text-center">
        <p className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-widest mb-2">
          Challenge Complete
        </p>
        <h2 className="font-display text-5xl font-extrabold text-[var(--peak-accent)] score-number">
          {state.total_arena_points.toLocaleString()}
        </h2>
        <p className="text-[var(--text-secondary)] mt-1">Arena Points</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Correct", value: `${correct}/10` },
          { label: "Accuracy", value: `${accuracy}%` },
          { label: "Best streak", value: String(state.best_streak) },
          { label: "Photo Finish", value: String(pfCount) },
        ].map((s) => (
          <div key={s.label} className="card-surface p-4 text-center">
            <p className="text-2xl font-bold score-number text-[var(--text-primary)]">
              {s.value}
            </p>
            <p className="mt-1 text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {/* Duel results grid */}
      <div>
        <p className="text-xs text-[var(--text-muted)] mb-3 uppercase tracking-wider">
          Your results
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {state.results.map((r, i) => (
            <div
              key={i}
              title={`Duel ${i + 1}: ${r.correct ? "Correct" : "Incorrect"} · ${r.difficulty}`}
              className={cn(
                "h-8 w-8 rounded flex items-center justify-center text-sm font-bold",
                r.correct
                  ? "bg-[var(--correct-bg)] text-[var(--correct)]"
                  : "bg-[var(--incorrect-bg)] text-[var(--incorrect)]"
              )}
              aria-label={`Duel ${i + 1}: ${r.correct ? "Correct" : "Incorrect"}, ${r.difficulty}`}
            >
              {r.correct ? "✓" : "✗"}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-[var(--text-muted)]">
          {state.results.filter((r) => r.difficulty === "Photo Finish").length > 0 &&
            `${state.results.filter((r) => r.difficulty === "Photo Finish").length} Photo Finish${state.results.filter((r) => r.difficulty === "Photo Finish").length > 1 ? "es" : ""}`}
        </p>
      </div>

      {/* Share */}
      <button
        type="button"
        onClick={handleShare}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] py-3 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        {shared ? (
          <><Check size={14} className="text-[var(--correct)]" /> Copied!</>
        ) : (
          <><Share2 size={14} /> Share result</>
        )}
      </button>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/play/endless"
          className="flex-1 text-center rounded-lg bg-[var(--peak-accent)] py-3 text-sm font-semibold text-[var(--text-inverse)] hover:bg-[var(--peak-accent-dim)] transition-colors"
        >
          Play Endless Mode
        </Link>
        <Link
          href="/rankings"
          className="flex-1 text-center rounded-lg border border-[var(--border-default)] py-3 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
        >
          See all rankings
        </Link>
      </div>

      <p className="text-center text-xs text-[var(--text-muted)]">
        Scores are saved locally. Come back tomorrow for a new challenge.
      </p>
    </div>
  );
}
