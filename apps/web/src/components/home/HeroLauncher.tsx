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
 * LAUNCH-POLISH LP2-3 REMOVED THE THIRD WAY IN. This launcher used to offer a
 * "Today's shared run" secondary link beside the primary CTA. It is gone:
 * `docs/implementation/launch-polish/RTT_DAILY_EVIDENCE.md` traced every
 * stage of run generation, battle resolution and pricing and found no
 * `run_type` branch anywhere — a daily run and a standard run given the same
 * seed are byte-identical in everything except which seed they got — and the
 * one player-facing signal the backend computes specifically for daily
 * (`already_played`) was never wired into this frontend at all. A link that
 * cannot point to anything a player would choose it FOR does not belong next
 * to the one that can. The backend contract is untouched: `GET
 * /run-the-table/daily`, `daily_seed()`, the partial unique index and any
 * already-saved daily run all still work exactly as before, and an existing
 * bookmark or shared link to `/arena/run-the-table?mode=daily` still resolves
 * — it is simply no longer a link this app hands out.
 *
 * No ARIA menu-button machinery is needed any more: every affordance here
 * is a real `<Link>`, so Tab order, Enter-to-activate and screen-reader
 * semantics are correct for free, with none of the open/close/focus-return
 * bookkeeping the dropdown required.
 */

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Play, RotateCcw } from "lucide-react";
import { loadActiveRun } from "@/lib/run-the-table-state";

/** The two ways into RUN THE TABLE from the homepage. */
export const LAUNCHER_STANDARD_HREF = "/arena/run-the-table?start=standard";
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
  /**
   * Position in the hero's staggered reveal, 0-based. The caller adds
   * `.pk-reveal` through `className`; this supplies the index that class reads.
   * Taken as a prop rather than folded into `className` because the value is a
   * CUSTOM PROPERTY, and there is no class name that carries a number.
   */
  revealIndex?: number;
}

export default function HeroLauncher({
  label = "Play Run the Table",
  children,
  className,
  revealIndex,
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
    <div
      className={className ? `flex flex-col items-start ${className}` : "flex flex-col items-start"}
      style={
        revealIndex === undefined
          ? undefined
          : ({ "--pk-reveal-index": revealIndex } as CSSProperties)
      }
    >
      <div className="flex flex-wrap items-center" style={{ gap: "var(--pk-space-3, 12px)" }}>
        {/* THE ONE PLACE ON THE HOMEPAGE THAT GETS `.pk-sheen`.
            A single specular pass across the control on hover. It is the one
            primitive in the set that turns into noise the moment a second
            element on the same screen has it, which is exactly why it belongs
            on the page's single primary action and nowhere else — including
            the "Explore Rankings" link twelve pixels to its right, which gets
            lift and press and stops there. */}
        <Link
          href={primaryHref}
          data-testid="home-primary-cta"
          className="home-launcher-trigger pk-lift pk-press pk-sheen"
        >
          <PrimaryIcon size={16} aria-hidden="true" />
          {primaryLabel}
        </Link>
        {children}
      </div>

      {/* Secondary, on purpose -- smaller type, no button chrome, plain
          underline-on-hover links. The primary control above already IS
          "start something"; this is the alternative to that one default,
          not a co-equal choice in a menu. Only rendered once there is
          something to prefer it over -- with no run in progress there is
          nothing this link would offer that the primary control doesn't
          already do. */}
      {hasActiveRun && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Link
            href={LAUNCHER_STANDARD_HREF}
            data-testid="home-launcher-standard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded"
            style={{ color: "var(--text-secondary)" }}
          >
            <Play size={12} aria-hidden="true" />
            Start New Run
          </Link>
        </div>
      )}
    </div>
  );
}
