"use client";
import { useState } from "react";

/**
 * Player headshot-or-initials shell (Phase 6E Part B: fallback rendering
 * hook for the asset-manifest strategy in data/game/assets/player_assets.v1.json).
 *
 * Renders a real `<img>` ONLY when `imageUrl` is a non-empty, safe URL
 * (i.e. the caller already resolved a license_status the runtime is allowed
 * to render -- this component does not itself check licensing, callers must
 * only ever pass a URL for entries with a renderable license_status).
 * Falls back to the initials/color shell -- unchanged from the pre-Phase-6E
 * behavior -- if `imageUrl` is absent OR the image fails to load
 * (`onError`), so a missing/broken image can never break layout or show a
 * broken-image icon. No image URLs are populated anywhere in this codebase
 * yet (CLAUDE.md / every prior phase: no scraped headshots) -- this is
 * schema/rendering readiness, not an active image source.
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
  /** Optional safe, already-license-checked headshot URL. Absent in every
   * current caller -- see module docstring. */
  imageUrl?: string | null;
}

export default function PlayerAvatar({ name, size = 36, imageUrl }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const tint = PALETTE[hashString(name) % PALETTE.length];

  if (imageUrl && !imageFailed) {
    // Headshot providers are not known/configured yet (no image_source_url
    // is populated anywhere in this codebase today, see module docstring),
    // so next/image's static remote-domain allowlist can't be set up yet.
    // Revisit once a licensed provider is approved and wired in.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        data-testid="player-avatar"
        src={imageUrl}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: "999px",
          objectFit: "cover",
          border: `1.5px solid color-mix(in srgb, ${tint} 55%, transparent)`,
          flexShrink: 0,
        }}
        onError={() => setImageFailed(true)}
      />
    );
  }

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
