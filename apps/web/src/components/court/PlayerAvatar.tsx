"use client";
import { useState } from "react";

/**
 * Player photograph-or-initials shell (Phase 6E Part B: fallback rendering
 * hook for the asset-manifest strategy in data/game/assets/player_assets.v3.json).
 *
 * Renders a real `<img>` ONLY when `imageUrl` is a non-empty, safe URL
 * (i.e. the caller already resolved a license_status the runtime is allowed
 * to render -- this component does not itself check licensing, callers must
 * only ever pass a URL for entries with a renderable license_status).
 * Falls back to the initials/color shell if `imageUrl` is absent OR the
 * image fails to load (`onError`), so a missing/broken image can never
 * break layout or show a broken-image icon. Real ESPN/NBA_CDN URLs ARE
 * populated (Phase 6F/7A) but only ever reach this component when a human
 * has explicitly opted in locally via PEAK3_ENABLE_EXTERNAL_ASSET_URLS
 * (default off) -- see nba_peak/perfect_season/assets.py and
 * scripts/build_espn_asset_manifests.py.
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
  /** Optional safe, already-license-checked photograph URL. Populated only when
   * the API is running with PEAK3_ENABLE_EXTERNAL_ASSET_URLS -- see the module
   * docstring. */
  imageUrl?: string | null;
  /**
   * Alternative text, for the callers where this avatar is the ONLY thing
   * naming the player.
   *
   * The default is deliberately empty + `aria-hidden`: in every roster,
   * candidate row and result card the avatar sits directly beside the player's
   * name in text, and announcing the name twice is worse for a screen-reader
   * user than not announcing the image at all. Pass a string only when there
   * is no adjacent text to carry it.
   */
  alt?: string;
}

/**
 * THE ONE PLAYER-IMAGE PRIMITIVE. Three-Man Weave, the $20 Showdown and the
 * Daily Grid result board all render players, and each of them wanting its own
 * `<img>` with its own fallback is how a product ends up with four different
 * broken-image behaviours. They import this.
 *
 * WHAT A READER SHOULD EXPECT TO SEE. The committed manifest resolves a real
 * photograph for a MINORITY of each surface's identities, because resolution
 * needs a current ESPN/NBA roster entry:
 *
 *   * $20 Showdown, qualified pool ....... 125 / 500   (25.0%)
 *   * Three-Man Weave, draftable ......... 283 / 1,379 (20.5%)
 *   * Daily Grid, distinct identities .... 283 / 1,384 (20.4%)
 *
 * So Jokic resolves and Jordan, Magic, Bird, Kareem, Kobe, Duncan and Hakeem do
 * not, and Wilt, Russell and Shaq are absent from the manifest entirely. On top
 * of that every resolved entry carries `license_status: "unknown_do_not_cache"`
 * and the API gate (`PEAK3_ENABLE_EXTERNAL_ASSET_URLS`) defaults OFF pending a
 * licensing review nobody has done -- so with the shipped default this
 * component draws the medallion for everyone. That is why the medallion is
 * designed rather than a grey placeholder: for most identities, on most
 * screens, it IS the product.
 *
 * NO NETWORK OF ITS OWN. This component never fetches, never probes and never
 * falls back to a second provider. It renders the URL its caller was given by
 * the API, or it renders the medallion. One image request per avatar, at most.
 */
export default function PlayerAvatar({ name, size = 36, imageUrl, alt }: Props) {
  // THE URL THAT FAILED, not a boolean. A boolean is sticky across a prop
  // change, and these avatars are reused in place: a roster slot re-fills, a
  // lot advances, a grid square swaps identity, all under a stable React key.
  // With a flag, one 404 anywhere in a list would suppress every later
  // photograph in that same position for the rest of the session.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const tint = PALETTE[hashString(name) % PALETTE.length];

  if (imageUrl && failedUrl !== imageUrl) {
    // A RAW `<img>`, NOT `next/image`. The manifest's providers are external
    // hosts behind a licensing gate that may yet be revoked, and next/image
    // needs a static remote-domain allowlist plus an optimiser round trip per
    // URL. Revisit if and when a licensed provider is approved and pinned.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        data-testid="player-avatar"
        src={imageUrl}
        alt={alt ?? ""}
        aria-hidden={alt ? undefined : "true"}
        width={size}
        height={size}
        // NO LAYOUT SHIFT, EITHER WAY ROUND. `width`/`height` reserve the box
        // before the bytes arrive, the inline `width`/`height` styles pin it
        // against a stylesheet that might otherwise stretch it, and the
        // medallion fallback occupies exactly the same square -- so an image
        // that 404s swaps one circle for another rather than resizing the row
        // it sits in.
        loading="lazy"
        decoding="async"
        // SEND NO REFERRER. These are third-party hosts; the path a PEAK3
        // player is on (a match id, a board date) is not theirs to log, and
        // nothing about the request needs it.
        referrerPolicy="no-referrer"
        style={{
          width: size,
          height: size,
          borderRadius: "999px",
          objectFit: "cover",
          border: `1.5px solid color-mix(in srgb, ${tint} 55%, transparent)`,
          flexShrink: 0,
        }}
        // A 404, a DNS failure, a blocked host and a revoked URL all land
        // here, and all of them mean the same thing: draw the medallion. The
        // URL is recorded so a LATER, different URL in this same slot still
        // gets its chance.
        onError={() => setFailedUrl(imageUrl)}
      />
    );
  }

  // Phase 8D: replaces the flat color-mix disc with a glossy "medallion"
  // treatment -- a two-stop radial gradient (reads as a lit sphere rather
  // than a flat tint), an inset highlight/shade pair (top-left glint, bottom
  // shadow) for real depth, and an outer halo glow matching the same ring
  // treatment already used for team badges (SpinStage.tsx) and portrait
  // medallions (PeakCardCourt.tsx) -- one consistent "premium," not a
  // placeholder-looking flat circle, everywhere a portrait can't be shown.
  return (
    <div
      aria-hidden="true"
      data-testid="player-avatar"
      className="player-avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.34),
        color: "var(--text-primary)",
        textShadow: "0 1px 2px rgba(0,0,0,0.45)",
        background: `radial-gradient(circle at 32% 28%, color-mix(in srgb, ${tint} 60%, white 8%) 0%, color-mix(in srgb, ${tint} 40%, var(--bg-surface)) 55%, color-mix(in srgb, ${tint} 22%, var(--bg-elevated)) 100%)`,
        boxShadow: [
          "inset 0 1px 1.5px rgba(255,255,255,0.35)",
          "inset 0 -2px 3px rgba(0,0,0,0.3)",
          `0 0 0 3px color-mix(in srgb, ${tint} 22%, transparent)`,
        ].join(", "),
        border: `1px solid color-mix(in srgb, ${tint} 65%, transparent)`,
      }}
    >
      {initialsFromName(name)}
    </div>
  );
}
