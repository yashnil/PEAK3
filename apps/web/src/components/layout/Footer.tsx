/**
 * The global footer.
 *
 * WHY THIS IS A COMPONENT AND NOT INLINE JSX. Until this pass the footer was two
 * sentences of prose with zero links inside `(main)/layout.tsx`, so the legal,
 * accessibility and provenance pages had nowhere to be reached from — and every
 * game mode was one navbar menu away from being unreachable on a page where the
 * menu was closed. Moving it here gives the link inventory a single home and a
 * unit test.
 *
 * WHY IT DOES NOT READ `lib/nav-model.ts`. That module models the *chrome*: the
 * Play launcher enforces a blurb, an icon key and a `MODE_COPY` mapping on every
 * entry, and `navModelIssues` fails the build when an entry has none of those.
 * A footer link is a bare destination — "Terms of Use" has no icon and no blurb
 * and must never appear in a "which games exist" listing. So the two inventories
 * stay separate, and the footer carries its own literal list, checked by
 * `tests/unit/footer.test.tsx`.
 *
 * Owner: W7 (footer / legal pass).
 */

import Link from "next/link";

interface FooterLink {
  label: string;
  href: string;
}

interface FooterColumn {
  /** Stable id, used for the heading element id the column list points at. */
  id: string;
  title: string;
  links: readonly FooterLink[];
}

/**
 * The footer's link inventory, in render order.
 *
 * Exported so the unit test asserts against the same data the DOM is built from
 * rather than a re-typed copy of it.
 */
export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    id: "play",
    title: "Play",
    links: [
      { label: "Run the Table", href: "/arena/run-the-table" },
      { label: "82-0 Peak Season", href: "/arena/court/daily" },
      { label: "Daily Grid", href: "/daily/grid" },
      { label: "Peak Duel", href: "/play/daily" },
      // Fits the existing column cleanly: one entry, pointing at the lobby,
      // which renders its own closed-alpha state rather than 403ing. A
      // per-game footer row would have been two more links for two games
      // that share one door.
      { label: "Multiplayer", href: "/arena/lobby" },
      { label: "Rankings", href: "/rankings" },
    ],
  },
  {
    id: "learn",
    title: "Learn",
    links: [
      { label: "Methodology", href: "/methodology" },
      { label: "Data Sources", href: "/data-sources" },
      { label: "About", href: "/about" },
      { label: "Accessibility", href: "/accessibility" },
    ],
  },
  {
    id: "legal",
    title: "Legal",
    links: [
      { label: "Terms of Use", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
      { label: "Contact", href: "/contact" },
    ],
  },
] as const;

/**
 * The affiliation disclaimer, verbatim.
 *
 * Exported and asserted character-for-character by the unit test: this is the
 * one string on the page whose wording is not ours to paraphrase.
 */
export const NBA_DISCLAIMER =
  "PEAK3 is an independent basketball analytics project and is not affiliated with or endorsed by the NBA or its teams. Team names, marks, and logos belong to their respective owners.";

export function Footer() {
  // Computed at render, never hardcoded — a pinned year is wrong on 1 January
  // and nobody notices until someone screenshots it.
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[var(--border-subtle)] mt-24">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <nav aria-label="Footer" className="grid gap-8 sm:grid-cols-3">
          {FOOTER_COLUMNS.map((column) => {
            const headingId = `footer-heading-${column.id}`;
            return (
              <div key={column.id}>
                <h2
                  id={headingId}
                  className="font-display text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]"
                >
                  {column.title}
                </h2>
                <ul aria-labelledby={headingId} className="mt-3 space-y-2">
                  {column.links.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="text-sm text-[var(--text-secondary)] hover:text-[var(--peak-accent-text)] focus-visible:text-[var(--peak-accent-text)] transition-colors"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="mt-10 border-t border-[var(--border-subtle)] pt-6 space-y-2 text-xs text-[var(--text-secondary)]">
          <p>
            PEAK3 Arena — open basketball analytics. Data sourced from Basketball Reference.
          </p>
          <p>
            Rankings reflect the PEAK3 formula, not a claim of objective historical truth.
          </p>
          <p>{NBA_DISCLAIMER}</p>
          <p>© {year} PEAK3 Arena</p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
