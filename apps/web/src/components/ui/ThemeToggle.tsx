"use client";

/**
 * The theme control. Two render modes, one shared state (`useTheme`):
 *
 * - `variant="icon"` (default) — the header's compact control. One click
 *   cycles System → Dark → Light → System (`nextThemePreference`), same
 *   interaction model as a browser's own reduced-UI toggles. The icon shown
 *   is always the CURRENT resolved theme (what you'd see if you clicked
 *   nothing else), and the accessible name states both the current state
 *   and what the next click does — a screen-reader user should never have
 *   to click blind to find out.
 * - `variant="menu"` — three explicit rows (System / Dark / Light) for the
 *   account-menu setting, where "what are my choices" matters more than
 *   "cycle quickly."
 *
 * `--pk-tap-min` on every hit target (PRODUCT_EXPERIENCE_CONTRACT.md §10 —
 * every new control must meet the project's existing 44px floor).
 */

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { nextThemePreference, useTheme, type ThemePreference } from "@/lib/theme";

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

  const Icon = PREFERENCE_ICON[resolved === "light" ? "light" : "dark"];
  const next = nextThemePreference(preference);
  const currentLabel =
    preference === "system" ? `System (currently ${PREFERENCE_LABEL[resolved]})` : PREFERENCE_LABEL[preference];

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={() => setPreference(next)}
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
