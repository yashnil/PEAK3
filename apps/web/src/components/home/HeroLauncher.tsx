"use client";

/**
 * The homepage primary control.
 *
 * ARENA-FIRST PASS. The primary control used to BE Run the Table: "Play Run
 * the Table" (or, with a run saved, "Continue Run") linking straight into
 * that one mode. The product now has six playable modes and a hub built to
 * show all of them side by side, so a homepage that still funnels every
 * visitor into one specific game before they have even seen the hub exists
 * is the thing standing between a new player and "oh, there's more than one
 * game here." The primary control now always leads to the ARENA HUB
 * (`ARENA_HUB_HREF`, "/arena") — a destination, not a decision, exactly as
 * direct as the old one-mode link was.
 *
 * RESUME IS PRESERVED, NOT DROPPED. A player with a Run the Table run already
 * in progress still deserves a fast way back into it from the homepage — that
 * capability does not go away just because it is no longer the button's own
 * href. When `loadActiveRun()` finds one, a second, still-prominent "Continue
 * Run" control renders beside the primary Arena CTA (own `pk-lift`/`pk-press`
 * feedback, no `pk-sheen` — that stays reserved for the page's single primary
 * action), landing on the bare route, which resumes the run and creates
 * nothing. "Start New Run" stays one click further down as a small secondary
 * link, offered only once there is a run to prefer it over.
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
 * bookkeeping a dropdown would require.
 */

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { LayoutGrid, Play, RotateCcw } from "lucide-react";
import { loadActiveRun } from "@/lib/run-the-table-state";
import { ARENA_HUB_HREF } from "@/lib/nav-model";

/** The two ways into RUN THE TABLE, still one click away via the resume
 *  affordances below even though neither is the primary control's own href. */
export const LAUNCHER_STANDARD_HREF = "/arena/run-the-table?start=standard";
/** The bare route on purpose: it must NOT start anything. */
export const LAUNCHER_RESUME_HREF = "/arena/run-the-table";

export interface HeroLauncherProps {
  /** Primary control's label. Frozen by the plan; overridable only for
   *  tests. Always renders — unlike the pre-Arena-first version, this no
   *  longer swaps to "Continue Run" itself; resume gets its own control. */
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
  label = "Visit Arena",
  children,
  className,
  revealIndex,
}: HeroLauncherProps) {
  // Read on the client only: the server cannot know what is in localStorage,
  // and rendering the resume control during SSR would hydrate-mismatch every
  // visitor whose browser has no saved run.
  const [hasActiveRun, setHasActiveRun] = useState(false);
  useEffect(() => {
    setHasActiveRun(loadActiveRun() !== null);
  }, []);

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
            the resume control right beside it, which gets lift and press and
            stops there. */}
        <Link
          href={ARENA_HUB_HREF}
          data-testid="home-primary-cta"
          className="home-launcher-trigger pk-lift pk-press pk-sheen"
        >
          <LayoutGrid size={16} aria-hidden="true" />
          {label}
        </Link>
        {/* RESUME, PRESERVED AS A PEER RATHER THAN THE PRIMARY CONTROL'S OWN
            HREF. Going Arena-first means the button's destination can no
            longer swap to the run itself, but a returning player with a run
            in progress still gets a fast, prominent way back into it — same
            `.pk-lift`/`.pk-press` treatment as the primary control, just no
            `.pk-sheen`. Only rendered once there is a run to resume. */}
        {hasActiveRun && (
          <Link
            href={LAUNCHER_RESUME_HREF}
            data-testid="home-launcher-resume"
            className="home-secondary-cta pk-lift pk-press"
          >
            <RotateCcw size={15} aria-hidden="true" />
            Continue Run
          </Link>
        )}
        {children}
      </div>

      {/* Secondary, on purpose -- smaller type, no button chrome, plain
          underline-on-hover links. Only rendered once there is something to
          prefer it over -- with no run in progress there is nothing this
          link would offer that "Visit Arena" doesn't already reach. */}
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
