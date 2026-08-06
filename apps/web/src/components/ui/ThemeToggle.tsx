"use client";

/**
 * The theme control. Two render modes, one shared state (`useTheme`):
 *
 * - `variant="icon"` (default) — the header's compact control. One click
 *   ALWAYS switches to the appearance you are not currently in, in both
 *   directions, as an explicit preference. It used to cycle System → Dark
 *   → Light → System, which made Light → Dark a two-click operation on any
 *   light-mode OS because `system` resolved back to light; see
 *   `nextThemePreference` for the full account. The icon shown is always
 *   the CURRENT resolved theme, and the accessible name states both the
 *   current state and what the next click does — a screen-reader user
 *   should never have to click blind to find out.
 * - `variant="menu"` — three explicit rows (System / Dark / Light) for the
 *   account-menu setting, where "what are my choices" matters more than
 *   "cycle quickly."
 *
 * `--pk-tap-min` on every hit target (PRODUCT_EXPERIENCE_CONTRACT.md §10 —
 * every new control must meet the project's existing 44px floor).
 */

import { useEffect } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { nextThemePreference, useTheme, type ThemePreference } from "@/lib/theme";
import { THEME_HYDRATED_FLAG } from "@/lib/theme-script";

const PREFERENCE_ICON: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  dark: Moon,
  light: Sun,
};

const PREFERENCE_LABEL: Record<ThemePreference, string> = {
  system: "System",
  dark: "Arena Night",
  light: "Arena Day",
};

export interface ThemeToggleProps {
  variant?: "icon" | "menu";
  className?: string;
}

export function ThemeToggle({ variant = "icon", className }: ThemeToggleProps) {
  const { preference, resolved, setPreference } = useTheme();

  // DISARM THE PRE-HYDRATION HANDLER, at the exact moment this component's own
  // React listener becomes real.
  //
  // The server renders this button and React attaches its `onClick` when the
  // bundle hydrates. In between, the control is visible, focusable and inert --
  // a click moves focus to it and does nothing, which is a first-click dead
  // state a user cannot tell from a broken toggle. `themeInitScript` installs a
  // capture-phase listener before first paint to cover that window; this effect
  // is how it learns to stop. Setting the flag on mount rather than in a layout
  // effect is deliberate: the two must not both handle the same click, and a
  // mount effect runs after the listener is attached, never before.
  useEffect(() => {
    (window as unknown as Record<string, boolean>)[THEME_HYDRATED_FLAG] = true;
    return () => {
      // If every toggle unmounts (a route with no header), the pre-hydration
      // handler is no longer redundant -- but it is also no longer reachable,
      // because its selector needs the button. Cleared anyway so the flag
      // describes the truth rather than the history.
      (window as unknown as Record<string, boolean>)[THEME_HYDRATED_FLAG] = false;
    };
  }, []);

  if (variant === "menu") {
    const options: ThemePreference[] = ["system", "dark", "light"];
    return (
      <div
        data-testid="theme-toggle-menu"
        role="group"
        aria-label="Theme"
        className={cn("flex items-center gap-1", className)}
      >
        {options.map((option) => {
          const Icon = PREFERENCE_ICON[option];
          const active = preference === option;
          return (
            <button
              key={option}
              type="button"
              data-testid={`theme-option-${option}`}
              aria-pressed={active}
              onClick={() => setPreference(option)}
              className="flex flex-1 flex-col items-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                minHeight: "var(--pk-tap-min, 44px)",
                borderColor: active ? "var(--peak-accent)" : "var(--border-subtle)",
                background: active ? "var(--peak-accent-bg)" : "transparent",
                color: active ? "var(--peak-accent)" : "var(--text-secondary)",
              }}
            >
              <Icon size={15} aria-hidden="true" />
              {PREFERENCE_LABEL[option]}
            </button>
          );
        })}
      </div>
    );
  }

  // THE INPUT IS THE RESOLVED THEME, NOT THE STORED PREFERENCE. One click
  // always moves to the appearance you are not currently in — see
  // `nextThemePreference` for the three-state cycle this replaced and why it
  // cost a second click in one direction only.
  const Icon = PREFERENCE_ICON[resolved === "light" ? "light" : "dark"];
  const next = nextThemePreference(resolved);
  const currentLabel =
    preference === "system" ? `System (currently ${PREFERENCE_LABEL[resolved]})` : PREFERENCE_LABEL[preference];

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={() => setPreference(next)}
      // The pressed state IS the appearance, so it reads true in Arena Day and
      // false in Arena Night whether that came from an explicit choice or from
      // following the system.
      aria-pressed={resolved === "light"}
      data-resolved-theme={resolved}
      aria-label={`Theme: ${currentLabel}. Switch to ${PREFERENCE_LABEL[next]}.`}
      title={currentLabel}
      className={cn(
        "pk-nav-account flex items-center justify-center rounded-md border transition-colors",
        "border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]",
        className,
      )}
      style={{ width: "var(--pk-tap-min, 44px)", height: "var(--pk-tap-min, 44px)" }}
    >
      <Icon size={16} aria-hidden="true" style={{ color: "var(--text-secondary)" }} />
    </button>
  );
}

export default ThemeToggle;
