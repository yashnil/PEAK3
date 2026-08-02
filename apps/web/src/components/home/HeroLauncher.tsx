"use client";

/**
 * The homepage primary control — a menu button, not a link.
 *
 * WHY THIS EXISTS (plan §5.1). The old `home-primary-cta` was a link labelled
 * "Start a Run" that landed on `/arena/run-the-table`, whose first screen is
 * `RunStartGate` with a second, identical "Start a run" button. Two identical
 * commitments in a row read as a bug.
 *
 * Deleting the second gate was not an option: following a bare link must never
 * create a run (it fixes the seed and, for the daily, burns the day's attempt),
 * which `play-routing.spec.ts` pins. So the fix is at this end — the control
 * now NAMES the choice it is about to make instead of pretending there is only
 * one. Picking an option carries `?start=` into the route, which
 * `RunTheTableGame` (W4) consumes exactly once; a bare
 * `/arena/run-the-table` still shows the gate, unchanged.
 *
 * Interaction is the WAI-ARIA menu-button pattern, hand-rolled rather than
 * pulled from a dependency (plan §2: zero new runtime packages):
 *   - `aria-haspopup="menu"` + `aria-expanded` + `aria-controls`
 *   - opening focuses the first item; ArrowUp opens onto the last
 *   - ArrowDown/ArrowUp/Home/End move between items
 *   - Escape closes and returns focus to the trigger
 *   - Tab or an outside click closes without stealing focus back
 *
 * Deliberately an anchored in-place panel, NOT a Dialog: it locks nothing,
 * traps nothing and leaves the page behind readable. A modal for three links
 * would be heavier than the decision.
 */

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, Play, RotateCcw } from "lucide-react";
import { useEscapeKey, useLayerStack } from "@/lib/a11y";
import { loadActiveRun } from "@/lib/run-the-table-state";

/** The three ways into RUN THE TABLE, in the order they are offered. */
export const LAUNCHER_STANDARD_HREF = "/arena/run-the-table?start=standard";
/**
 * Daily deliberately does NOT carry `?start=`.
 *
 * A standard run costs nothing to create — the seed is random, and starting a
 * second one loses you nothing — so auto-starting it from an explicit "Standard
 * run" choice is safe. The daily is not that: it is one shared board per UTC
 * day and one attempt per player. `?start=daily` on a plain `<Link>` makes the
 * URL itself the trigger, so anyone the address bar is copied to — a group
 * chat, a bookmark, a browser session restore — has today's attempt spent for
 * them on navigation, with no confirmation.
 *
 * `/arena/run-the-table?mode=daily` lands on the start gate with the daily
 * button emphasised, which is what `/arena` has always linked to
 * (`RUN_THE_TABLE_DAILY_HREF` in lib/modes.ts) and what the route's own
 * docstring promises. One extra click, and it is the click that spends the
 * attempt.
 */
export const LAUNCHER_DAILY_HREF = "/arena/run-the-table?mode=daily";
/** Resume is the bare route on purpose: it must NOT start anything. */
export const LAUNCHER_RESUME_HREF = "/arena/run-the-table";

interface LauncherOption {
  key: "standard" | "daily" | "resume";
  href: string;
  label: string;
  hint: string;
  testId: string;
  Icon: typeof Play;
}

const BASE_OPTIONS: LauncherOption[] = [
  {
    key: "standard",
    href: LAUNCHER_STANDARD_HREF,
    label: "Standard run",
    hint: "A fresh randomly-seeded run. Starts as soon as it loads.",
    testId: "home-launcher-standard",
    Icon: Play,
  },
  {
    key: "daily",
    href: LAUNCHER_DAILY_HREF,
    label: "Today's shared run",
    hint: "The same seeded board everyone else gets today. One attempt per day.",
    testId: "home-launcher-daily",
    Icon: CalendarDays,
  },
];

const RESUME_OPTION: LauncherOption = {
  key: "resume",
  href: LAUNCHER_RESUME_HREF,
  label: "Resume your run",
  hint: "Pick up the run saved in this browser. Nothing new is started.",
  testId: "home-launcher-resume",
  Icon: RotateCcw,
};

export interface HeroLauncherProps {
  /** Trigger label. Frozen by the plan; overridable only for tests. */
  label?: string;
  /**
   * Secondary action rendered beside the trigger — the homepage passes its
   * "Explore Rankings" link. Taken as `children` so it stays a server-rendered
   * node: this island must not turn the hero's second CTA into client markup.
   */
  children?: ReactNode;
  className?: string;
}

export default function HeroLauncher({
  label = "Play Run the Table",
  children,
  className,
}: HeroLauncherProps) {
  const [open, setOpen] = useState(false);
  const [hasActiveRun, setHasActiveRun] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  /** Which item to focus once the menu has rendered. -1 means "the last". */
  const pendingFocus = useRef<number>(0);
  const menuId = useId();

  // Read on the client only: the server cannot know what is in localStorage,
  // and rendering "Resume" during SSR would hydrate-mismatch every visitor
  // whose browser has no saved run. Re-read on open so a run finished in
  // another tab does not leave a stale entry.
  useEffect(() => {
    setHasActiveRun(loadActiveRun() !== null);
  }, []);

  const options = hasActiveRun ? [...BASE_OPTIONS, RESUME_OPTION] : BASE_OPTIONS;

  const closeAndRefocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const isTopLayer = useLayerStack(open);
  useEscapeKey(open, closeAndRefocus, isTopLayer);

  // Outside click closes, and deliberately does NOT pull focus back to the
  // trigger — the user is already on their way somewhere else.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  // Focus the requested item once the menu exists.
  useEffect(() => {
    if (!open) return;
    const items = itemRefs.current.filter(Boolean) as HTMLAnchorElement[];
    if (items.length === 0) return;
    const index = pendingFocus.current < 0 ? items.length - 1 : Math.min(pendingFocus.current, items.length - 1);
    items[index]?.focus();
  }, [open, options.length]);

  const openMenu = useCallback((focusIndex: number) => {
    pendingFocus.current = focusIndex;
    setHasActiveRun(loadActiveRun() !== null);
    setOpen(true);
  }, []);

  const onTriggerClick = () => {
    if (open) {
      setOpen(false);
      return;
    }
    openMenu(0);
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(-1);
    }
  };

  const focusItem = (index: number) => {
    const items = itemRefs.current.filter(Boolean) as HTMLAnchorElement[];
    if (items.length === 0) return;
    const wrapped = ((index % items.length) + items.length) % items.length;
    items[wrapped]?.focus();
  };

  const onItemKeyDown = (event: React.KeyboardEvent<HTMLAnchorElement>, index: number) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(options.length - 1);
        break;
      case "Tab":
        // Menus close on Tab rather than trapping — this is a menu button, not
        // a modal, so the rest of the page must stay reachable.
        //
        // But NOT synchronously. React flushes this discrete event before the
        // browser performs the default Tab, so `setOpen(false)` here unmounted
        // the very element focus was leaving FROM. `document.activeElement`
        // fell back to `<body>`, and the browser's Tab then walked from the top
        // of the document — sending a keyboard user on the homepage back to the
        // skip link instead of forward to "Explore Rankings".
        //
        // Deferring to a microtask lets the default Tab land first, so focus is
        // already on the next real control when the panel goes away.
        queueMicrotask(() => setOpen(false));
        break;
      default:
        break;
    }
  };

  return (
    <div className={className ? `flex flex-col items-start ${className}` : "flex flex-col items-start"}>
      <div className="flex flex-wrap items-center" style={{ gap: "var(--pk-space-3, 12px)" }}>
        <div ref={rootRef} className="home-launcher">
          <button
            ref={triggerRef}
            type="button"
            data-testid="home-primary-cta"
            className="home-launcher-trigger"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={onTriggerClick}
            onKeyDown={onTriggerKeyDown}
          >
            {label}
            <ChevronDown className="home-launcher-chevron" size={16} aria-hidden="true" />
          </button>

          {open && (
            <div
              id={menuId}
              role="menu"
              data-testid="home-launcher-menu"
              aria-label="Choose how to start Run the Table"
              className="home-launcher-menu"
            >
              {options.map((option, index) => {
                const { Icon } = option;
                return (
                  <Link
                    key={option.key}
                    href={option.href}
                    role="menuitem"
                    tabIndex={-1}
                    data-testid={option.testId}
                    className="home-launcher-item"
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    onKeyDown={(event) => onItemKeyDown(event, index)}
                    onClick={() => setOpen(false)}
                  >
                    <span className="home-launcher-item-icon" aria-hidden="true">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0">
                      <span
                        className="block text-sm font-semibold"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {option.label}
                      </span>
                      <span className="home-launcher-hint">{option.hint}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {children}
      </div>

      {/* The resume state, stated in the page rather than only inside the menu
          — a player with a run in flight should see that before they decide to
          open anything. */}
      {hasActiveRun && (
        <p
          data-testid="home-resume-notice"
          className="mt-3 text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          You have a run in progress in this browser.
        </p>
      )}
    </div>
  );
}
