"use client";

/**
 * The global header.
 *
 * WHAT CHANGED IN THIS PASS. "Play" was a single link to `/arena`, so the
 * product's eleven doors were represented in the chrome by one word. It is now
 * a disclosure button opening `PlayMenu`, which lists every finished mode
 * grouped by what it is, with `/arena` still present as the menu's final
 * "View all games" entry. The mobile dropdown — an in-flow div that pushed the
 * page down and trapped no focus — is now `MobileNavDrawer`, built on the
 * shared `Dialog`.
 *
 * WHAT DID NOT CHANGE, AND MUST NOT:
 *   - `aria-label="Main navigation"` on the desktop `<nav>`: six specs find the
 *     navigation landmark by that exact name.
 *   - The active class string `bg-[var(--bg-surface)]`, asserted literally by
 *     `play-routing.spec.ts`.
 *   - The wordmark link to `/`, and the Profile/Sign In link gated on
 *     `supabaseEnabled`.
 *
 * WHY NOT `useSearchParams`. Two nav rows share a path and differ only by query
 * (`/arena/run-the-table` and `?mode=daily`), so the highlight wants the query.
 * `useSearchParams` would opt the entire header into a Suspense boundary and
 * remove the navigation landmark from the server-rendered HTML — a real
 * accessibility and first-paint cost for a cosmetic distinction that is only
 * visible inside an already-client-only menu panel. `useLocationSearch` reads
 * it after mount instead: identical on the server and on the first client
 * render, so there is no hydration mismatch and no layout shift.
 *
 * ROUTES WITHOUT THIS HEADER. `/c/[token]` (a shared challenge) and
 * `/auth/callback` live outside the `(main)` route group and render no header
 * at all. That is deliberate isolation, not an oversight: a challenge link is a
 * single-purpose surface opened from someone else's message, and the auth
 * callback is a redirect target that exists for milliseconds. Neither is
 * touched here.
 *
 * Owner: W1 (UX / Organization / Polish pass).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { isActive, topLevelLinks } from "@/lib/nav-model";
import { PlayMenu } from "./PlayMenu";
import { MobileNavDrawer } from "./MobileNavDrawer";

/** The current query string, without the leading `?`. Empty until mounted. */
function useLocationSearch(pathname: string): string {
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSearch(window.location.search.replace(/^\?/, ""));
  }, [pathname]);
  return search;
}

export function Nav() {
  const pathname = usePathname();
  const search = useLocationSearch(pathname);
  const { user, supabaseEnabled } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Arriving somewhere closes the menu that took you there.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <header className="pk-nav-header sticky top-0 z-40">
      <div className="pk-nav-bar mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link
          href="/"
          className="pk-nav-wordmark font-display text-lg font-bold tracking-tight"
          aria-label="PEAK3 Arena home"
        >
          <span className="text-[var(--peak-accent)]">PEAK</span>
          <span className="text-[var(--text-secondary)]">3</span>
          <span className="ml-1.5 text-xs font-medium text-[var(--text-muted)] tracking-widest uppercase">
            Arena
          </span>
        </Link>

        {/* Desktop nav. The landmark name is frozen. */}
        <nav aria-label="Main navigation" className="hidden sm:flex items-center gap-1">
          <PlayMenu pathname={pathname} search={search} />
          <ul className="flex items-center gap-1" role="list">
            {topLevelLinks.map((link) => {
              const current = isActive(pathname, link, search);
              return (
                <li key={link.id}>
                  <Link
                    href={link.href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "pk-nav-link px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                      current
                        ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]",
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          {supabaseEnabled && (
            <Link
              href={user ? "/profile" : "/signin"}
              className={cn(
                "pk-nav-account ml-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                "text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]",
              )}
            >
              {user ? "Profile" : "Sign In"}
            </Link>
          )}
        </nav>

        {/* Mobile trigger. No `aria-controls`: the drawer is portalled and only
            exists while open, and an `aria-controls` pointing at an absent id
            is worse than none — `aria-expanded` already carries the state. */}
        <button
          type="button"
          className="pk-nav-burger sm:hidden"
          aria-label={drawerOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={drawerOpen}
          data-testid="mobile-nav-trigger"
          onClick={() => setDrawerOpen((v) => !v)}
        >
          {drawerOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </div>

      <MobileNavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        pathname={pathname}
        search={search}
        supabaseEnabled={supabaseEnabled}
        signedIn={Boolean(user)}
      />
    </header>
  );
}

export default Nav;
