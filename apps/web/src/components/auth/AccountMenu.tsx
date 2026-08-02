"use client";

/**
 * The header's account control.
 *
 * WHAT IT REPLACES. One text link reading `user ? "Profile" : "Sign In"`. Signed
 * in, that meant: no indication of *which* account, no way to reach `/progress`
 * or `/history` from the chrome at all, and no way to sign out without first
 * navigating to `/profile` and finding a button there.
 *
 * SIGNED OUT it stays exactly one link — a "Sign in" that carries the current
 * path as `?returnTo=`, so signing in from the middle of a result screen returns
 * to that result screen rather than the homepage. There is no auth wall anywhere
 * before or after it; the link is an offer.
 *
 * SIGNED IN it becomes a disclosure button with an initials avatar. Same pattern
 * as `PlayMenu` and for the same reasons: `aria-expanded`, `aria-controls` only
 * while the panel exists, Escape closes and restores focus, an outside pointer
 * press closes. No `role="menu"` — the rows are links, and sign-out is the one
 * button among them.
 *
 * NO PHOTOGRAPH. House rule, and `InitialsAvatar` explains the second reason.
 *
 * Owner: Track B (auth surface).
 */

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEscapeKey, useLayerStack } from "@/lib/a11y";
import { useAuth } from "@/lib/auth-context";
import { accountLinks, isActive } from "@/lib/nav-model";
import { signInHref } from "@/lib/supabase/safe-next";
import { InitialsAvatar } from "./InitialsAvatar";

export interface AccountMenuProps {
  pathname: string;
  search?: string;
  /** Where "Sign in" should return to. Defaults to the current location. */
  returnTo?: string;
}

export function AccountMenu({ pathname, search = "", returnTo }: AccountMenuProps) {
  const { user, supabaseEnabled, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isTopLayer = useLayerStack(open);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEscapeKey(open, close, isTopLayer);

  // Outside pointer press. `pointerdown` rather than `click` so the panel is
  // gone before the press lands on whatever is underneath it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Arriving somewhere closes the menu that took you there.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Anonymous-only deployment: the whole control is absent, as before.
  if (!supabaseEnabled) return null;

  if (!user) {
    const target = returnTo ?? `${pathname}${search ? `?${search}` : ""}`;
    return (
      <Link
        href={signInHref(target)}
        data-testid="nav-signin"
        className={cn(
          "pk-nav-account ml-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
          "text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]",
        )}
      >
        Sign in
      </Link>
    );
  }

  const label = user.name ?? user.email ?? "your account";

  return (
    <div ref={rootRef} className="relative ml-2">
      <button
        ref={triggerRef}
        type="button"
        data-testid="nav-account-trigger"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Account menu for ${label}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "pk-nav-account flex items-center gap-1.5 rounded-md border px-1.5 py-1 transition-colors",
          "border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]",
        )}
      >
        <InitialsAvatar email={user.email} name={user.name} />
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={cn(open && "pk-rotated")}
          style={{ color: "var(--text-muted)" }}
        />
      </button>

      {open && (
        <div
          id={panelId}
          data-testid="nav-account-panel"
          className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border p-1.5 shadow-xl"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border-default)",
          }}
        >
          <p
            className="px-2.5 py-2 text-xs truncate"
            style={{ color: "var(--text-muted)" }}
            data-testid="nav-account-identity"
          >
            Signed in as{" "}
            <span style={{ color: "var(--text-secondary)" }}>{user.email ?? "your account"}</span>
          </p>

          <ul role="list" className="py-1">
            {accountLinks.map((item) => {
              const current = isActive(pathname, item, search);
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    data-nav-item={item.id}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2.5 py-2 text-sm transition-colors",
                      current
                        ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]",
                    )}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="border-t pt-1" style={{ borderColor: "var(--border-subtle)" }}>
            <button
              type="button"
              data-testid="nav-signout"
              onClick={async () => {
                setOpen(false);
                await signOut();
              }}
              className="w-full rounded-md px-2.5 py-2 text-left text-sm transition-colors text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountMenu;
