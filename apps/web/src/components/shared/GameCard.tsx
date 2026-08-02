import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Surface tier. Three visibly different treatments so a grid of modes is not
 * one dark rectangle repeated with an identical border — which was the single
 * most common note in the visual review.
 *
 * `featured` still overrides all of them: exactly one card per screen may be
 * gold, or the word stops meaning anything.
 */
export type GameCardTone = "inset" | "raised" | "quiet";

export interface GameCardProps {
  href: string;
  /** Short mode name — "Daily Grid", "82-0 PEAK Season". */
  title: string;
  /** One line on what the mode actually is. */
  description: string;
  /** Small uppercase category above the title. */
  eyebrow?: string;
  icon?: ReactNode;
  /** Right-hand status: a streak, "Played today", a rank. Optional by design —
   *  a card with nothing to say shows nothing rather than a placeholder. */
  status?: ReactNode;
  /** Up to three compact facts under the description. */
  meta?: string[];
  /** The flagship treatment: accent border, glow, larger type. Exactly one card
   *  per screen should use it, or it stops meaning anything. */
  featured?: boolean;
  cta?: string;
  testId?: string;
  /** Surface tier. Defaults to `inset`, the pre-existing appearance. */
  tone?: GameCardTone;
  /** Tighter padding for dense catalog grids. */
  compact?: boolean;
}

/**
 * The shared card for "here is a game you can play".
 *
 * Phase 12A introduced this because the homepage, the arena hub and the daily
 * hub had each grown their own hand-rolled card with slightly different
 * padding, border and hover behaviour — three near-identical components that
 * drifted apart. One component means the product's modes look like they belong
 * to the same product.
 *
 * WHAT THE UX PASS CHANGED (W2). The card kept its whole props API — its three
 * consumers (homepage, /arena, DailyHub) compile unchanged — and gained:
 *
 *  - `tone`, so a page can build a hierarchy out of SURFACES instead of out of
 *    repeated identical borders.
 *  - A hover/focus state that explains where a click goes rather than just
 *    tinting: a gold rail measures across the top of the card, the action row
 *    underlines and its arrow travels. Three signals, none of them colour
 *    alone, so the state survives greyscale and forced-colours.
 *  - `data-tone` alongside the pre-existing `data-featured`, so the state is
 *    inspectable in tests without reading computed styles.
 *
 * All motion is CSS transition only (rules live in `styles/home.css`), so the
 * global prefers-reduced-motion rule in globals.css neutralises it; there is
 * no JS-driven animation and this stays a server component.
 */
export default function GameCard({
  href,
  title,
  description,
  eyebrow,
  icon,
  status,
  meta,
  featured,
  cta,
  testId,
  tone = "inset",
  compact,
}: GameCardProps) {
  const pad = compact ? "p-4" : "p-4 sm:p-5";

  return (
    <Link
      href={href}
      data-testid={testId}
      data-featured={featured ? "true" : "false"}
      data-tone={featured ? "featured" : tone}
      className={`pk-game-card group ${pad} ${featured && !compact ? "sm:p-6" : ""}`}
    >
      {/* The hover/focus rail. Decorative: the action row carries the words. */}
      <span className="pk-game-card-rail" aria-hidden="true" />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: featured ? "var(--peak-accent-bg)" : "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                color: featured ? "var(--peak-accent)" : "var(--text-secondary)",
              }}
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <p
                className="text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{ color: featured ? "var(--peak-accent)" : "var(--text-muted)" }}
              >
                {eyebrow}
              </p>
            )}
            <h3
              className={`font-display mt-0.5 font-bold ${featured ? "text-xl sm:text-2xl" : "text-base"}`}
              style={{
                color: featured
                  ? "color-mix(in srgb, var(--text-primary) 92%, var(--peak-accent) 8%)"
                  : "var(--text-primary)",
              }}
            >
              {title}
            </h3>
          </div>
        </div>
        {status && <div className="shrink-0 text-right">{status}</div>}
      </div>

      <p
        className={`mt-2 leading-relaxed ${featured ? "text-sm" : "text-xs"}`}
        style={{ color: "var(--text-secondary)" }}
      >
        {description}
      </p>

      {meta && meta.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-2 gap-y-1.5">
          {meta.map((item) => (
            <li
              key={item}
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                color: "var(--text-muted)",
                background: "var(--pk-surface-inset, var(--bg-elevated))",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {item}
            </li>
          ))}
        </ul>
      )}

      <span className="pk-game-card-action">
        <span className="pk-game-card-action-text">{cta ?? "Play"}</span>
        <span className="pk-game-card-arrow" aria-hidden="true">
          →
        </span>
      </span>
    </Link>
  );
}
