"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";

const NAV_LINKS = [
  { href: "/arena/daily", label: "Play" },
  { href: "/rankings", label: "Rankings" },
  { href: "/methodology", label: "Methodology" },
  { href: "/about", label: "About" },
];

export function Nav() {
  const pathname = usePathname();
  const { user, supabaseEnabled } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handle(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  // Close on Escape
  useEffect(() => {
    if (!menuOpen) return;
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--bg-page)]/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link
          href="/"
          className="font-display text-lg font-bold tracking-tight hover:text-[var(--peak-accent)] transition-colors"
          aria-label="PEAK3 Arena home"
        >
          <span className="text-[var(--peak-accent)]">PEAK</span>
          <span className="text-[var(--text-secondary)]">3</span>
          <span className="ml-1.5 text-xs font-medium text-[var(--text-muted)] tracking-widest uppercase">
            Arena
          </span>
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Main navigation" className="hidden sm:flex items-center gap-1">
          <ul className="flex items-center gap-1" role="list">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                    pathname === link.href || pathname.startsWith(link.href + "/")
                      ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          {supabaseEnabled && (
            <Link
              href={user ? "/profile" : "/signin"}
              className={cn(
                "ml-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                "text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]"
              )}
            >
              {user ? "Profile" : "Sign In"}
            </Link>
          )}
        </nav>

        {/* Mobile hamburger */}
        <button
          ref={triggerRef}
          className="sm:hidden flex flex-col justify-center items-center w-9 h-9 rounded-md gap-1.5 hover:bg-[var(--bg-elevated)] transition-colors"
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav-menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {/* Three-bar icon that morphs to X */}
          <span
            className={cn(
              "block h-0.5 w-5 bg-current transition-all duration-200",
              menuOpen ? "translate-y-2 rotate-45" : ""
            )}
          />
          <span
            className={cn(
              "block h-0.5 w-5 bg-current transition-all duration-200",
              menuOpen ? "opacity-0" : ""
            )}
          />
          <span
            className={cn(
              "block h-0.5 w-5 bg-current transition-all duration-200",
              menuOpen ? "-translate-y-2 -rotate-45" : ""
            )}
          />
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div
          id="mobile-nav-menu"
          ref={menuRef}
          role="dialog"
          aria-label="Navigation menu"
          className="sm:hidden border-t border-[var(--border-subtle)] bg-[var(--bg-page)]"
        >
          <nav aria-label="Mobile navigation">
            <ul className="flex flex-col py-2 px-4" role="list">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={cn(
                      "block py-2.5 px-3 rounded-md text-sm font-medium transition-colors",
                      pathname === link.href || pathname.startsWith(link.href + "/")
                        ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              {supabaseEnabled && (
                <li>
                  <Link
                    href={user ? "/profile" : "/signin"}
                    className={cn(
                      "block py-2.5 px-3 rounded-md text-sm font-medium transition-colors",
                      "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                    )}
                  >
                    {user ? "Profile" : "Sign In"}
                  </Link>
                </li>
              )}
            </ul>
          </nav>
        </div>
      )}
    </header>
  );
}
