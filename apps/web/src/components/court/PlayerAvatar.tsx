"use client";

/**
 * Player initials/silhouette shell -- Phase 6B. Deliberately no image, no
 * headshot, no logo (CLAUDE.md / Phase 6A-6B hard constraint: no scraped
 * imagery). A deterministic background tint (hashed from the player's own
 * name, picked from the existing design-token palette) gives cards visual
 * variety without claiming anything factual about the player -- purely a
 * UI decoration, same discipline already applied to team-color badges
 * (apps/web/src/lib/team-colors.ts is real brand data; this is not).
 */

const PALETTE = [
  "var(--role-lead-creator)",
  "var(--role-guard-wing)",
  "var(--role-wing-forward)",
  "var(--role-forward-big)",
  "var(--role-anchor)",
  "var(--peak-accent)",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface Props {
  name: string;
  size?: number;
}

export default function PlayerAvatar({ name, size = 36 }: Props) {
  const tint = PALETTE[hashString(name) % PALETTE.length];
  return (
    <div
      aria-hidden="true"
      data-testid="player-avatar"
      className="player-avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.36),
        background: `color-mix(in srgb, ${tint} 22%, var(--bg-surface))`,
        color: tint,
        border: `1.5px solid color-mix(in srgb, ${tint} 55%, transparent)`,
      }}
    >
      {initialsFromName(name)}
    </div>
  );
}
