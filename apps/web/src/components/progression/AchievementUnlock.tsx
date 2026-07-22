"use client";

import { useEffect, useRef } from "react";

interface Props {
  achievementKeys: string[];
  allAchievements: Array<{ key: string; title: string; category: string }>;
  onDismiss: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  onboarding:   "#60a5fa",
  challenge:    "#fb923c",
  construction: "#a78bfa",
  habit:        "#34d399",
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
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="rounded-2xl border p-5 max-w-sm w-full space-y-3 outline-none"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p
          className="text-xs font-semibold tracking-widest uppercase text-center"
          style={{ color: "var(--peak-accent)" }}
          aria-live="assertive"
        >
          Achievement Unlocked
        </p>

        {achievements.map((a) => {
          const color = CATEGORY_COLORS[a.category] ?? "var(--text-secondary)";
          return (
            <div key={a.key} className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                style={{ background: color + "20", color }}
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
          onClick={onDismiss}
          className="w-full py-2 rounded-lg text-sm font-semibold mt-1"
          style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
