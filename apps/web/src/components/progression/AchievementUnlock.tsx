"use client";

import { useEffect, useRef } from "react";

interface Props {
  achievementKeys: string[];
  allAchievements: Array<{ key: string; title: string; category: string }>;
  onDismiss: () => void;
}

// Theme-aware — see `--achievement-*` in globals.css for why these are not
// literal hex (P3-G2: measured contrast failure as text on Arena Day).
const CATEGORY_COLORS: Record<string, string> = {
  onboarding:   "var(--achievement-onboarding)",
  challenge:    "var(--achievement-challenge)",
  construction: "var(--achievement-construction)",
  habit:        "var(--achievement-habit)",
};

export function AchievementUnlock({ achievementKeys, allAchievements, onDismiss }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const byKey = Object.fromEntries(allAchievements.map((a) => [a.key, a]));
  const achievements = achievementKeys
    .map((k) => byKey[k])
    .filter(Boolean);

  // Focus management
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onDismiss]);

  if (achievements.length === 0) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Achievement unlocked"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onDismiss}
    >
      {/* THE reward moment of the whole progression system, and it used to be
          a plain bordered box. `.pk-spotlight` is the one effect it gets — the
          "this is where the game is right now" ring, which is exactly what an
          unlock is — over `.pk-grad-decision`'s warmer fill. NOT stacked with
          `.pk-depth`: `.pk-depth` is declared later in globals.css and would
          simply overwrite the spotlight's `box-shadow`, so the two are a
          choice, never a combination. */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="pk-spotlight pk-crown pk-crown-accent rounded-2xl border p-5 max-w-sm w-full space-y-3 outline-none"
        style={{
          background: "var(--pk-grad-decision)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* The banner reads at the scale of the news it is announcing. */}
        <p
          className="pk-reveal font-display text-base font-extrabold tracking-widest uppercase text-center"
          style={{ color: "var(--peak-accent-text)", "--pk-reveal-index": 0 } as React.CSSProperties}
          aria-live="assertive"
        >
          Achievement Unlocked
        </p>

        {achievements.map((a, i) => {
          const color = CATEGORY_COLORS[a.category] ?? "var(--text-secondary)";
          return (
            <div
              key={a.key}
              className="pk-reveal flex items-center gap-3"
              style={{ "--pk-reveal-index": i + 1 } as React.CSSProperties}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                // `color-mix`, not a hex-alpha suffix -- `color` is now a
                // `var(--achievement-*)` reference (P3-G2), and appending a
                // hex pair to a var() reference is invalid CSS.
                style={{ background: `color-mix(in srgb, ${color} 20%, transparent)`, color }}
                aria-hidden="true"
              >
                ✓
              </div>
              <div>
                <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                  {a.title}
                </div>
                <div className="text-xs capitalize" style={{ color }}>
                  {a.category}
                </div>
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={onDismiss}
          className="pk-lift pk-press w-full py-2 rounded-lg text-sm font-semibold mt-1 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border-default)",
            color: "var(--text-primary)",
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
