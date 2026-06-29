"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/play/daily", label: "Daily" },
  { href: "/play/endless", label: "Endless" },
  { href: "/arena", label: "Arena" },
  { href: "/rankings", label: "Rankings" },
  { href: "/methodology", label: "Methodology" },
  { href: "/about", label: "About" },
];

export function Nav() {
  const pathname = usePathname();

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

        <nav aria-label="Main navigation">
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
        </nav>
      </div>
    </header>
  );
}
