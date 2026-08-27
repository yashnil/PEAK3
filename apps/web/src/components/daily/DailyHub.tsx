"use client";

import { useCallback, useEffect, useState } from "react";
import { MODE_COPY } from "@/lib/modes";
import type { DailyGridArchive } from "@/types/daily-grid";
import { hasCompleted, loadArchive } from "@/lib/daily-grid-archive";
import { getDailyGridBoard } from "@/lib/daily-grid-api";
import {
  type DailyWindowPayload,
  extractDailyWindow,
  formatCountdown,
  localDailyWindow,
} from "@/lib/daily-time";
import { useDailyReset } from "@/lib/use-daily-reset";
import PeakV2DailyHub from "@/components/v2/PeakV2DailyHub";

/**
 * The Daily hub: every PEAK3 game that resets once a day, in one place.
 *
 * Phase 12A. The Daily Grid lived at `/daily` and Peak Duel Daily at
 * `/play/daily`, with nothing linking them — a player who found one had no way
 * to discover the other. The Grid moved to `/daily/grid` and this became the
 * hub.
 *
 * Every card's title/description/meta comes from `lib/modes.ts`, so this hub
 * cannot drift from the homepage and the Arena hub the way it did before. The
 * only thing this file decides is the Grid's CTA, which depends on whether you
 * already played today — state, not copy.
 *
 * The Grid's status (streak, played-today) is read from localStorage in an
 * effect, not during render: this is a client component under a server-rendered
 * route, and touching storage on the first pass would hydrate differently on
 * the server and the client. Peak Duel Daily carries no status here because its
 * completion lives in a different store — showing a blank where the Grid shows
 * a streak would read as "you have no streak" rather than "not tracked here".
 */
export default function DailyHub() {
  const [archive, setArchive] = useState<DailyGridArchive | null>(null);
  // The server's window. `today` is read off it rather than computed here, so
  // this page and the board the player is about to open can never disagree
  // about which day it is.
  const [window_, setWindow] = useState<DailyWindowPayload | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const board = await getDailyGridBoard();
        if (cancelled) return;
        setWindow(extractDailyWindow(board) ?? localDailyWindow());
      } catch {
        // The hub is navigation, not gameplay: if the API is unreachable it
        // still has to render every card. The countdown falls back to the same
        // zone and the same arithmetic the server uses, which is right unless
        // this device's own clock is wrong.
        if (!cancelled) setWindow(localDailyWindow());
      }
      // The archive is read after the window so `today` and the streak are
      // evaluated against the same day.
      if (!cancelled) setArchive(loadArchive());
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // Re-derives everything at the boundary, and on returning to a tab that was
  // away past it. This effect used to have `[]` deps and never ran again: the
  // countdown ticked to 0s and stayed there, and "played today" kept pointing
  // at yesterday until the page was reloaded by hand.
  const { secondsLeft } = useDailyReset({
    dailyKey: window_?.daily_key ?? null,
    secondsRemaining: window_?.seconds_remaining ?? null,
    window: window_,
    onReset: useCallback(() => setReloadToken((t) => t + 1), []),
  });

  const today = window_?.daily_key ?? "";
  const countdown = secondsLeft ?? window_?.seconds_remaining ?? null;
  const gridPlayed = today !== "" && archive !== null && hasCompleted(archive, today);
  const streak = archive?.current_streak ?? 0;

  const dailyGrid = MODE_COPY["daily-grid"];
  const peakDuel = MODE_COPY["peak-duel"];
  const flagship = MODE_COPY["run-the-table"];
  const peakSeason = MODE_COPY["peak-season"];

  return (
    <PeakV2DailyHub
      dailyGrid={dailyGrid}
      peakDuel={peakDuel}
      flagship={flagship}
      peakSeason={peakSeason}
      countdownLabel={countdown !== null ? formatCountdown(countdown) : null}
      gridPlayed={gridPlayed}
      streak={streak}
      totalCompleted={archive?.total_completed ?? 0}
    />
  );
}
