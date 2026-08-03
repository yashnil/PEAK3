"use client";

/**
 * The homepage primary control.
 *
 * Launch-polish §6 REPLACES the menu-button this used to be. The audit that
 * fed the original brief ("opens a menu containing only 'Standard run'")
 * turned out not to match this file at all -- `BASE_OPTIONS` always had two
 * unconditional entries, never one -- but the brief's underlying INTENT was
 * still real and still in scope: a homepage's primary action should be a
 * direct action, not a decision. Clicking "Play Run the Table" used to open
 * a dropdown and make the visitor choose among up to three items before
 * anything happened at all; now it IS the choice, made the obvious way:
 *
 *   - no run in progress  -> the primary control starts a standard run,
 *     directly (`?start=standard`, auto-started once by `RunTheTableGame`);
 *   - a run in progress   -> the primary control becomes "Continue Run",
 *     landing on the bare route, which resumes it and creates nothing;
 *   - "Start New Run" (only offered once there IS a run to prefer instead --
 *     otherwise the primary control already IS starting a new run) and the
 *     daily shared run are both still one click away, just as smaller,
 *     secondary links rather than co-equal menu rows.
 *
 * The daily deliberately still does NOT carry `?start=`, for the same
 * reason it never did: it is one shared board per UTC day and one attempt
 * per player, so making the URL itself the trigger would let a bookmark, a
 * forwarded link, or a restored browser session spend someone's attempt on
 * navigation with no confirmation. `/arena/run-the-table?mode=daily` lands
 * on the start gate with the daily button emphasised instead -- one extra
 * click, and it is the click that spends the attempt.
 *
 * No ARIA menu-button machinery is needed any more: every affordance here
 * is a real `<Link>`, so Tab order, Enter-to-activate and screen-reader
 * semantics are correct for free, with none of the open/close/focus-return
 * bookkeeping the dropdown required.
 */

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, Play, RotateCcw } from "lucide-react";
import { loadActiveRun } from "@/lib/run-the-table-state";

/** The three ways into RUN THE TABLE. */
export const LAUNCHER_STANDARD_HREF = "/arena/run-the-table?start=standard";
/**
 * Daily deliberately does NOT carry `?start=`.
 *
 * A standard run costs nothing to create — the seed is random, and starting a
 * second one loses you nothing — so auto-starting it directly is safe. The
 * daily is not that: it is one shared board per UTC day and one attempt per
 * player. `?start=daily` on a plain `<Link>` makes the URL itself the
 * trigger, so anyone the address bar is copied to — a group chat, a
 * bookmark, a browser session restore — has today's attempt spent for them
 * on navigation, with no confirmation.
 *
 * `/arena/run-the-table?mode=daily` lands on the start gate with the daily
 * button emphasised, which is what `/arena` has always linked to
 * (`RUN_THE_TABLE_DAILY_HREF` in lib/modes.ts) and what the route's own
 * docstring promises. One extra click, and it is the click that spends the
 * attempt.
 */
export const LAUNCHER_DAILY_HREF = "/arena/run-the-table?mode=daily";
/** The bare route on purpose: it must NOT start anything. */
export const LAUNCHER_RESUME_HREF = "/arena/run-the-table";

export interface HeroLauncherProps {
  /** Trigger label when there is no run to continue. Frozen by the plan;
   *  overridable only for tests. */
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
  // Read on the client only: the server cannot know what is in localStorage,
  // and rendering "Continue Run" during SSR would hydrate-mismatch every
  // visitor whose browser has no saved run.
  const [hasActiveRun, setHasActiveRun] = useState(false);
  useEffect(() => {
    setHasActiveRun(loadActiveRun() !== null);
  }, []);

  const primaryHref = hasActiveRun ? LAUNCHER_RESUME_HREF : LAUNCHER_STANDARD_HREF;
  const primaryLabel = hasActiveRun ? "Continue Run" : label;
  const PrimaryIcon = hasActiveRun ? RotateCcw : Play;

  return (
    <div className={className ? `flex flex-col items-start ${className}` : "flex flex-col items-start"}>
      <div className="flex flex-wrap items-center" style={{ gap: "var(--pk-space-3, 12px)" }}>
        <Link href={primaryHref} data-testid="home-primary-cta" className="home-launcher-trigger">
          <PrimaryIcon size={16} aria-hidden="true" />
          {primaryLabel}
        </Link>
        {children}
      </div>

      {/* Secondary, on purpose -- smaller type, no button chrome, plain
          underline-on-hover links. The primary control above already IS
          "start something"; these are the alternatives to that one
          default, not co-equal choices in a menu. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {hasActiveRun && (
          <Link
            href={LAUNCHER_STANDARD_HREF}
            data-testid="home-launcher-standard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded"
            style={{ color: "var(--text-secondary)" }}
          >
            <Play size={12} aria-hidden="true" />
            Start New Run
          </Link>
        )}
        <Link
          href={LAUNCHER_DAILY_HREF}
          data-testid="home-launcher-daily"
          className="inline-flex items-center gap-1.5 text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded"
          style={{ color: "var(--text-secondary)" }}
        >
          <CalendarDays size={12} aria-hidden="true" />
          Today&rsquo;s shared run <span style={{ color: "var(--text-muted)" }}>&middot; one attempt per day</span>
        </Link>
      </div>
    </div>
  );
}
