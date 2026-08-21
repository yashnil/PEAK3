"use client";

/**
 * HomeV2YourArena — "make PEAK3 feel alive and replayable" (Pass 6,
 * product-direction consistency pass). A small, real-state strip between
 * the game slate and the methodology explainer: not a second catalogue,
 * an answer to "what's mine right now?"
 *
 * REAL DATA ONLY, PER PRODUCT AUTHORITY (same rule `HomeV2ResumeRow` and
 * `ArenaV2ResumeHero` already follow). Every tile is built from a source
 * this app already has and already trusts elsewhere:
 *
 *   - `useResumeState()` (`lib/resume-state.ts`) — the exact same
 *     localStorage-only run/Daily-Grid summary the nav's mobile drawer
 *     already surfaces. Read-only, SSR-safe, never invents a run.
 *   - `progressionApi.getSummary()` (`lib/progression-api.ts`, Phase 3.1) —
 *     the same authenticated endpoint `/profile` renders from. Fetched only
 *     when a session exists; a fetch failure degrades to omitting the tile,
 *     never a placeholder streak.
 *   - `multiplayerModes`, a prop this page already computed server-side
 *     from the Arena's own fail-closed readiness check (`getArenaCatalogue`)
 *     — never guessed here.
 *
 * Anonymous, no-signal visitors are not shown fabricated activity; the
 * section renders nothing rather than a hollow "Welcome!" banner (the same
 * fail-closed instinct `NbaFactOfTheDay` and `HeroVignette` already use).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import { progressionApi, type ProgressionSummary } from "@/lib/progression-api";
import { useResumeState } from "@/lib/resume-state";

export interface HomeV2YourArenaMode {
  href: string;
  title: string;
}

export interface HomeV2YourArenaProps {
  multiplayerModes: HomeV2YourArenaMode[];
}

interface ArenaTile {
  key: string;
  eyebrow: string;
  badge?: string;
  title: string;
  desc: string;
  href: string;
  cta: string;
}

function ArenaTileCell({ tile }: { tile: ArenaTile }) {
  return (
    <Link href={tile.href} className="v2-slate-cell group">
      <span className="v2-slate-cell-head">
        <span className="v2-slate-cell-tag">{tile.eyebrow}</span>
        {tile.badge ? <span className="v2-slate-cell-badge">{tile.badge}</span> : null}
      </span>
      <span className="v2-slate-cell-title">{tile.title}</span>
      <span className="v2-slate-cell-desc">{tile.desc}</span>
      <span className="v2-slate-cell-action" aria-hidden="true">
        {tile.cta} <span className="v2-slate-cell-arrow">→</span>
      </span>
    </Link>
  );
}

export default function HomeV2YourArena({ multiplayerModes }: HomeV2YourArenaProps) {
  const { user, loading: authLoading, supabaseEnabled } = useAuth();
  const resume = useResumeState();
  const [summary, setSummary] = useState<ProgressionSummary | null>(null);

  useEffect(() => {
    if (!user) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const s = await progressionApi.getSummary(token);
        if (!cancelled) setSummary(s);
      } catch {
        // Fails closed — the tile is simply omitted, never a fabricated level.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const tiles: ArenaTile[] = [];

  if (resume.run) {
    tiles.push({
      key: "run",
      eyebrow: "In progress",
      title: "Run the Table",
      desc: resume.run.label,
      href: resume.run.href,
      cta: "Continue",
    });
  }

  if (resume.dailyGrid) {
    const { completedToday, currentStreak } = resume.dailyGrid;
    tiles.push({
      key: "grid",
      eyebrow: "Daily Grid",
      badge: completedToday ? undefined : "Open",
      title: completedToday ? "Today's board is done" : "Today's board is open",
      desc: currentStreak > 0 ? `${currentStreak}-day streak` : "Nine squares, one shot at each",
      href: "/daily/grid",
      cta: completedToday ? "See result" : "Play now",
    });
  }

  if (multiplayerModes.length > 0) {
    tiles.push({
      key: "multiplayer",
      eyebrow: "Multiplayer",
      badge: "Live",
      title: `${multiplayerModes.length} live mode${multiplayerModes.length === 1 ? "" : "s"} open`,
      desc: multiplayerModes.map((m) => m.title).join(" · "),
      href: multiplayerModes[0].href,
      cta: "Enter",
    });
  }

  if (user && summary) {
    tiles.push({
      key: "progression",
      eyebrow: "Your progress",
      title: `Level ${summary.level.current_level}`,
      desc:
        summary.current_streak > 0
          ? `${summary.current_streak}-day streak · ${summary.achievement_count} achievement${summary.achievement_count === 1 ? "" : "s"}`
          : `${summary.achievement_count} achievement${summary.achievement_count === 1 ? "" : "s"} earned`,
      href: "/profile",
      cta: "View profile",
    });
  } else if (!user && !authLoading && supabaseEnabled) {
    tiles.push({
      key: "signin",
      eyebrow: "Optional, always",
      title: "Sign in to keep it",
      desc: "An account carries your streak and run history across devices.",
      href: "/signin",
      cta: "Sign in",
    });
  }

  if (tiles.length === 0) return null;

  const shown = tiles.slice(0, 4);

  return (
    <section aria-labelledby="v2-your-arena-heading" className="v2-slate-section">
      <div className="v2-slate-heading-row">
        <span className="v2-live-dot" aria-hidden="true" />
        <h2 id="v2-your-arena-heading" className="v2-slate-heading">
          Your Arena
        </h2>
      </div>
      <div className="v2-slate-grid v2-arena-grid" style={{ "--v2-arena-cols": shown.length } as React.CSSProperties}>
        {shown.map((tile) => (
          <ArenaTileCell key={tile.key} tile={tile} />
        ))}
      </div>
    </section>
  );
}
