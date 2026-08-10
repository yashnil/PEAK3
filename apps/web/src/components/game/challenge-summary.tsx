"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import Link from "next/link";
import type { GameState } from "@/types";
import { buildShareText } from "@/lib/progress";
import { getAccuracy, photoFinishCount } from "@/lib/game-state";
import { cn } from "@/lib/utils";
import { ResultNumber } from "./result-number";

interface ChallengeSummaryProps {
  state: GameState;
  date?: string;
}

/**
 * The end of a daily challenge.
 *
 * Restructured the same way `reveal-panel.tsx` was, for the same reason: this
 * screen had a big gold number at the top and then five flat blocks that all
 * arrived together, several of them captioned in 10px muted grey. The numbers
 * now COUNT to themselves (this is the only screen in the mode where the
 * session total is final, which is exactly when a count-up means something),
 * the bands arrive in reading order, and the captions that name a number were
 * promoted out of the muted tier — a label that tells you what a figure IS is
 * not tertiary metadata.
 *
 * Nothing is gated: every band is in the DOM from the first paint and
 * `.pk-reveal` only fades and rises it.
 */
export function ChallengeSummary({ state, date }: ChallengeSummaryProps) {
  const [shared, setShared] = useState(false);
  const correct = state.results.filter((r) => r.correct).length;
  const accuracy = Math.round(getAccuracy(state) * 100);
  const pfCount = photoFinishCount(state);
  const photoFinishes = state.results.filter((r) => r.difficulty === "Photo Finish").length;

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
      {/* Band 1 — the score. */}
      <div
        className="pk-reveal text-center"
        style={{ "--pk-reveal-index": 0 } as React.CSSProperties}
      >
        <p className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-widest mb-2">
          Challenge Complete
        </p>
        <h2 className="font-display text-5xl font-extrabold text-[var(--peak-accent-text)]">
          <ResultNumber
            value={state.total_arena_points}
            format={(n) => Math.round(n).toLocaleString()}
          />
        </h2>
        {/* WAS `--text-secondary` already, and stays there: this is the label
            that names the 48px number above it. */}
        <p className="text-[var(--text-secondary)] mt-1">Arena Points</p>
      </div>

      {/* Band 2 — the four numbers behind the score. Each tile is a raised
          object rather than a flat rectangle; the counting figure inside is
          the one that resolved at the end of the run. */}
      <div
        className="pk-reveal grid grid-cols-2 gap-3 sm:grid-cols-4"
        style={{ "--pk-reveal-index": 1 } as React.CSSProperties}
      >
        {[
          { label: "Correct", value: correct, suffix: `/${state.results.length}` },
          { label: "Accuracy", value: accuracy, suffix: "%" },
          { label: "Best streak", value: state.best_streak, suffix: "" },
          { label: "Photo Finish", value: pfCount, suffix: "" },
        ].map((s) => (
          <div key={s.label} className="card-surface pk-depth pk-crown p-4 text-center">
            <p className="font-display text-2xl font-bold text-[var(--text-primary)]">
              <ResultNumber value={s.value} suffix={s.suffix} />
            </p>
            {/* WAS 10px `--text-muted`. These four words are the only thing
                that says which number is which; at 10px muted they were the
                weakest text on the screen and the most necessary. */}
            <p className="mt-1 text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {/* Band 3 — the ten duels, one square each. */}
      <div
        className="pk-reveal"
        style={{ "--pk-reveal-index": 2 } as React.CSSProperties}
      >
        {/* WAS `--text-muted`. It is a section heading, not metadata. */}
        <p className="text-xs font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
          Your results
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {state.results.map((r, i) => (
            <div
              key={i}
              title={`Duel ${i + 1}: ${r.correct ? "Correct" : "Incorrect"} · ${r.difficulty}`}
              className={cn(
                "pk-reveal h-8 w-8 rounded flex items-center justify-center text-sm font-bold",
                r.correct
                  ? "bg-[var(--correct-bg)] text-[var(--correct)]"
                  : "bg-[var(--incorrect-bg)] text-[var(--incorrect)]"
              )}
              /* Offset by the band's own index so the squares continue the
                 page's rhythm instead of restarting it. `.pk-reveal` caps the
                 index at 8, so a longer results list cannot trail off. */
              style={{ "--pk-reveal-index": 2 + i } as React.CSSProperties}
              aria-label={`Duel ${i + 1}: ${r.correct ? "Correct" : "Incorrect"}, ${r.difficulty}`}
            >
              {r.correct ? "✓" : "✗"}
            </div>
          ))}
        </div>
        {photoFinishes > 0 && (
          /* WAS 10px `--text-muted`. It is the one line that explains why the
             Photo Finish tile above says what it says. */
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            {photoFinishes} Photo Finish{photoFinishes > 1 ? "es" : ""}
          </p>
        )}
      </div>

      {/* Band 4 — the actions. */}
      <div
        className="pk-reveal space-y-6"
        style={{ "--pk-reveal-index": 3 } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={handleShare}
          className="pk-lift pk-press w-full flex items-center justify-center gap-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] py-3 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          {shared ? (
            <><Check size={14} className="text-[var(--correct)]" /> Copied!</>
          ) : (
            <><Share2 size={14} /> Share result</>
          )}
        </button>

        <div className="flex flex-col sm:flex-row gap-3">
          {/* The primary next step, and the only `.pk-sheen` on this screen. */}
          <Link
            href="/play/endless"
            className="pk-lift pk-press pk-sheen flex-1 text-center rounded-lg bg-[var(--peak-accent)] py-3 text-sm font-semibold text-[var(--text-inverse)] hover:bg-[var(--peak-accent-dim)]"
          >
            Play Endless Mode
          </Link>
          <Link
            href="/rankings"
            className="pk-lift pk-press flex-1 text-center rounded-lg border border-[var(--border-default)] py-3 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            See all rankings
          </Link>
        </div>

        {/* Genuinely tertiary: a standing disclaimer about storage, not a
            result. Stays muted. */}
        <p className="text-center text-xs text-[var(--text-muted)]">
          Scores are saved locally. Come back tomorrow for a new challenge.
        </p>
      </div>
    </div>
  );
}
