import Link from "next/link";
import type { ReactNode } from "react";

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
 * `featured` is the only visual variant, and it exists to keep the hierarchy
 * the product needs: 82-0 is the flagship and the daily games are secondary,
 * which has to be legible at a glance rather than stated in copy.
 *
 * All motion here is CSS transition only, so the global prefers-reduced-motion
 * rule in globals.css neutralises it; there is no JS-driven animation.
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
}: GameCardProps) {
  return (
    <Link
      href={href}
      data-testid={testId}
      data-featured={featured ? "true" : "false"}
      className={`group relative flex flex-col overflow-hidden rounded-xl p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:p-5 ${
        featured ? "sm:p-6" : ""
      }`}
      style={{
        background: featured
          ? "linear-gradient(160deg, rgba(245,200,66,0.07), rgba(245,200,66,0.015) 55%, transparent)"
          : "var(--bg-elevated)",
        border: `1px solid ${
          featured
            ? "color-mix(in srgb, var(--peak-accent) 38%, var(--border-subtle))"
            : "var(--border-subtle)"
        }`,
      }}
    >
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
              style={{ color: "var(--text-primary)" }}
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
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
          {meta.map((item) => (
            <li
              key={item}
              className="text-[11px]"
              style={{ color: "var(--text-muted)" }}
            >
              {item}
            </li>
          ))}
        </ul>
      )}

      <span
        className="mt-4 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.1em] transition-transform group-hover:translate-x-0.5"
        style={{ color: featured ? "var(--peak-accent)" : "var(--text-secondary)" }}
      >
        {cta ?? "Play"}
        <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}
