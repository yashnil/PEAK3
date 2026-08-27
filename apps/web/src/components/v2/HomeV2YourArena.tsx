"use client";

/**
 * HomeV2YourArena — the STATUS rank of the unified "Your Arena" section
 * (product-UX-recovery pass).
 *
 * WAS: its own titled section of up to four equal dashboard cards, sitting
 * directly beneath a seven-cell game slate in the identical grammar. The two
 * sections asked the same question, and "In progress / Run the Table /
 * Continue" appeared here while the slate's flagship cell offered the same
 * run immediately above it.
 *
 * NOW: rows, not cards, inside the one Arena section — and no run row at
 * all, because `HomeV2ResumeRow`'s featured panel resumes Run the Table
 * itself. What is left is genuinely status: today's Daily Grid, live
 * multiplayer, your progression. "Today's board is done · 1-day streak" is
 * a sentence a reader scans, so it is set as a line with a verb on the
 * right, not as an object in a bordered box.
 *
 * REAL DATA ONLY, PER PRODUCT AUTHORITY (unchanged). Every row is built from
 * a source this app already has and already trusts elsewhere:
 *
 *   - `useResumeState()` (`lib/resume-state.ts`) — the exact same
 *     localStorage-only Daily-Grid summary the nav's mobile drawer already
 *     surfaces. Read-only, SSR-safe, never invents progress.
 *   - `progressionApi.getSummary()` (`lib/progression-api.ts`) — the same
 *     authenticated endpoint `/profile` renders from. Fetched only when a
 *     session exists; a failure omits the row, never a placeholder level.
 *   - `multiplayerModes`, computed server-side from the Arena's own
 *     fail-closed readiness check — never guessed here.
 *
 * Anonymous, no-signal visitors are not shown fabricated activity: with no
 * rows this renders nothing, and the section's featured panel and mode grid
 * still stand on their own.
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
  title: string;
  desc: string;
  href: string;
  cta: string;
}

function ArenaStatusRow({ tile }: { tile: ArenaTile }) {
  return (
    <Link href={tile.href} className="v2-arena-status-row">
      <span className="v2-arena-status-eyebrow">{tile.eyebrow}</span>
      <span className="v2-arena-status-body">
        <span className="v2-arena-status-title">{tile.title}</span>
        <span className="v2-arena-status-detail">{tile.desc}</span>
      </span>
      <span className="v2-arena-status-cta">
        {tile.cta} <span className="v2-arena-status-arrow" aria-hidden="true">→</span>
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

  // NO RUN-THE-TABLE ROW. The featured panel directly below this strip
  // (`HomeV2ResumeRow`) already resumes the active run and says so. A row
  // here as well was the same offer twice, a few hundred pixels apart.

  if (resume.dailyGrid) {
    const { completedToday, currentStreak } = resume.dailyGrid;
    tiles.push({
      key: "grid",
      eyebrow: "Daily Grid",
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

  // Rows are cheap now that they are lines rather than 168px cells, but the
  // strip is still status, not a catalogue — three keeps it scannable.
  const shown = tiles.slice(0, 3);

  return (
    <div className="v2-arena-status" data-testid="home-arena-status">
      {shown.map((tile) => (
        <ArenaStatusRow key={tile.key} tile={tile} />
      ))}
    </div>
  );
}
