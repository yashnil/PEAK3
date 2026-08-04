"use client";

/**
 * The desktop "Play" launcher.
 *
 * WHY A BUTTON AND NOT A LINK. "Play" used to be a plain link to `/arena`, so
 * the only way to learn that five other finished modes existed was to land on
 * the hub and read it. It is now a disclosure button: `aria-expanded`,
 * `aria-haspopup`, `aria-controls`, and a panel that lists every mode grouped
 * by what it is. `/arena` did not lose its door — it is the panel's last entry,
 * "View all games", and ArrowUp on the trigger opens the menu with focus
 * already on it. So the hub is still one keyboard interaction away.
 *
 * WHY NOT `role="menu"`. Every row here is a navigation link, not a command.
 * `role="menu"` would make screen readers announce them as menu items, remove
 * them from the links rotor, and force `role="group"` gymnastics around the
 * section headings. The panel is therefore an ordinary set of labelled lists;
 * arrow-key roving is layered ON TOP as a convenience, exactly as the ARIA
 * Authoring Practices' "disclosure navigation" pattern describes.
 *
 * WHY NO HOVER-OPEN. Hover-to-open plus click-to-toggle is a trap: the pointer
 * reaches the trigger, hover opens the panel, and the click that follows closes
 * it again. The brief asks for click and keyboard to work standalone; adding a
 * hover path that fights the click path would be a regression dressed as
 * polish. Pointer users get a normal, reliable click.
 *
 * 200% ZOOM. The panel has no fixed height. It is capped in `vh` and scrolls,
 * its width is `min()`-clamped against the viewport, and every dimension is in
 * rem — so at 200% it gets taller and narrower and scrolls, rather than
 * clipping its last group.
 *
 * Owner: W1 (UX / Organization / Polish pass).
 */

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronDown,
  Gavel,
  Grid3x3,
  History,
  Infinity as InfinityIcon,
  LayoutGrid,
  Medal,
  Scale,
  Swords,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFocusableElements, useEscapeKey, useLayerStack } from "@/lib/a11y";
import type { ModeIconKey } from "@/lib/modes";
import {
  isActive,
  navGroups,
  PLAY_TRIGGER_ACTIVE,
  type NavAvailability,
  type NavItem,
} from "@/lib/nav-model";

/**
 * Icon-key → component. Lives here rather than in `lib/nav-model.ts` so that
 * module stays JSX-free and unit-testable without a renderer.
 */
const ICONS: Record<ModeIconKey, LucideIcon> = {
  swords: Swords,
  trophy: Trophy,
  grid: Grid3x3,
  scale: Scale,
  layout: LayoutGrid,
  chart: BarChart3,
  book: BookOpen,
  medal: Medal,
  history: History,
  infinity: InfinityIcon,
  calendar: CalendarDays,
  users: Users,
  gavel: Gavel,
};

function iconFor(key: ModeIconKey): LucideIcon {
  return ICONS[key] ?? LayoutGrid;
}

export interface PlayMenuProps {
  pathname: string;
  /** `usePathname()` gives no query, so callers that have one pass it here. */
  search?: string;
  availability?: NavAvailability;
  className?: string;
}

export function PlayMenu({ pathname, search = "", availability, className }: PlayMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  /** Where to put focus once the panel has mounted: first item, or last. */
  const pendingFocus = useRef<"first" | "last" | null>(null);

  const panelId = useId();
  const groups = navGroups(availability);
  const sectionActive = isActive(pathname, PLAY_TRIGGER_ACTIVE, search);

  // ONE layer registration. There is no focus trap here on purpose (Tab must
  // leave the menu and close it), but the registration still matters: a dialog
  // opened over the nav must be the only thing Escape reaches.
  const isTopLayer = useLayerStack(open);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEscapeKey(open, () => close(true), isTopLayer);

  // Route changes close the panel — the user has arrived, the menu is done.
  useEffect(() => {
    setOpen(false);
  }, [pathname, search]);

  // Outside pointer press closes without stealing focus (the user is already
  // reaching for something else).
  useEffect(() => {
    if (!open) return;
    function handle(event: MouseEvent) {
      if (wrapperRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Focus moving out of the whole component (Tab from the last row, or a click
  // into the page) closes it. `requestAnimationFrame` because `relatedTarget`
  // is null for some browsers' programmatic blurs; re-checking the live
  // `activeElement` is the reliable form.
  useEffect(() => {
    if (!open) return;
    function handle() {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && wrapperRef.current?.contains(active)) return;
        setOpen(false);
      });
    }
    const node = wrapperRef.current;
    node?.addEventListener("focusout", handle);
    return () => node?.removeEventListener("focusout", handle);
  }, [open]);

  const focusEdge = useCallback((where: "first" | "last") => {
    const items = getFocusableElements(panelRef.current);
    if (items.length === 0) return;
    (where === "last" ? items[items.length - 1] : items[0]).focus();
  }, []);

  // Deferred focus placement. The panel does not exist on the render that opens
  // it, so "focus the first item" has to happen once it does.
  useEffect(() => {
    if (!open || pendingFocus.current === null) return;
    focusEdge(pendingFocus.current);
    pendingFocus.current = null;
  }, [open, focusEdge]);

  const openWith = useCallback(
    (where: "first" | "last") => {
      // Already open (ArrowDown pressed twice on the trigger): `open` does not
      // change, so the effect above would never fire. Move focus directly.
      if (open) {
        focusEdge(where);
        return;
      }
      pendingFocus.current = where;
      setOpen(true);
    },
    [open, focusEdge],
  );

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open && event.key !== "ArrowDown") {
        close(false);
        return;
      }
      openWith("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openWith("last");
    }
  }

  /** Roving focus inside the panel. Tab is left alone so it can exit. */
  function onPanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const items = getFocusableElements(panelRef.current);
    if (items.length === 0) return;
    event.preventDefault();

    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % items.length;
    else next = index <= 0 ? items.length - 1 : index - 1;

    items[next].focus();
  }

  return (
    <div ref={wrapperRef} className={cn("pk-playmenu", className)}>
      <button
        ref={triggerRef}
        type="button"
        id={`${panelId}-trigger`}
        aria-expanded={open}
        /*
         * NO `aria-haspopup`. It was `"true"`, which ARIA defines as an alias
         * for `"menu"` — so the trigger announced "menu button", a user pressed
         * ArrowDown expecting menuitems, and got a plain list of links. That
         * contradicted the "WHY NOT role=menu" reasoning directly above.
         *
         * The disclosure-navigation pattern this component implements needs
         * only `aria-expanded` + `aria-controls`; the panel is an ordinary set
         * of labelled lists, and the announcement now matches what is there.
         */
        // Only while the panel exists: the panel is conditionally rendered, and
        // an `aria-controls` pointing at an absent id is worse than none — the
        // same rule nav.tsx applies to the mobile trigger.
        aria-controls={open ? panelId : undefined}
        aria-current={sectionActive ? "page" : undefined}
        data-testid="nav-play-trigger"
        data-open={open ? "true" : "false"}
        onClick={() => (open ? close(false) : openWith("first"))}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "pk-nav-link px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
          sectionActive
            ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]",
        )}
      >
        <span>Play</span>
        <ChevronDown className="pk-playmenu-chevron" size={14} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className="pk-playmenu-panel"
          data-testid="nav-play-panel"
          aria-labelledby={`${panelId}-trigger`}
          onKeyDown={onPanelKeyDown}
        >
          <div className="pk-playmenu-groups">
            {groups.map((group) => (
              <section key={group.id} className="pk-playmenu-group" data-group={group.id}>
                <h2 className="pk-playmenu-group-title">
                  {group.label}
                  <span className="pk-playmenu-group-hint">{group.hint}</span>
                </h2>
                <ul className="pk-playmenu-list" role="list">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <PlayMenuRow item={item} pathname={pathname} search={search} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayMenuRow({
  item,
  pathname,
  search,
}: {
  item: NavItem;
  pathname: string;
  search: string;
}) {
  const Icon = iconFor(item.iconKey);
  const current = isActive(pathname, item, search);
  return (
    <Link
      href={item.href}
      // NOT `data-featured`: that attribute is a page-level invariant asserted
      // to appear exactly once per page, and the launcher is not a page.
      data-nav-featured={item.featured ? "true" : undefined}
      data-nav-item={item.id}
      aria-current={current ? "page" : undefined}
      className={cn("pk-playmenu-row", item.featured && "pk-playmenu-row-featured")}
    >
      <span className="pk-playmenu-icon" aria-hidden="true">
        <Icon size={item.featured ? 18 : 16} />
      </span>
      <span className="pk-playmenu-text">
        <span className="pk-playmenu-label">
          {item.label}
          {item.badge && <span className="pk-playmenu-badge">{item.badge}</span>}
        </span>
        {item.blurb && <span className="pk-playmenu-blurb">{item.blurb}</span>}
      </span>
      {current && (
        <span className="pk-playmenu-current" aria-hidden="true">
          Current
        </span>
      )}
    </Link>
  );
}

export default PlayMenu;
