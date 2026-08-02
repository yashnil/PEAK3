"use client";

import { use, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DraftScreen from "@/components/draft/DraftScreen";
import {
  DraftGameState,
  DraftMode,
  DraftCompletionSummary,
  MODE_LABELS,
} from "@/types/draft";
import { getDailyDraft, getDraftGame, DraftAPIError } from "@/lib/draft-api";
import { boardIdDate, draftProgress } from "@/lib/draft-progress";
import { type DailyWindowPayload, extractDailyWindow } from "@/lib/daily-time";
import { useDailyReset } from "@/lib/use-daily-reset";
import { analytics } from "@/lib/analytics";

const VALID_MODES: DraftMode[] = ["apex_1y", "prime_3y", "foundation_5y"];

type PageState =
  | { status: "loading" }
  | { status: "already_completed"; summary: DraftCompletionSummary; date: string }
  | { status: "playing"; gameState: DraftGameState; date: string; isReplay?: boolean }
  | { status: "error"; message: string };

interface Props {
  params: Promise<{ mode: string }>;
}

/**
 * Peak Draft Daily.
 *
 * TWO STALE-BOARD BUGS LIVED HERE, and they compounded.
 *
 * 1. `today` was computed from the browser clock in render scope and sent to
 *    the API as `?date=`. The server only used its own clock when the parameter
 *    was ABSENT, so the browser was the one deciding what day it was.
 * 2. The resume branch checked `board_type` and `mode` but never compared the
 *    stored `board_id`'s embedded date to today, and returned BEFORE fetching
 *    today's board — so yesterday's unfinished daily was resumed forever and
 *    the new board was never requested at all.
 *
 * Both are fixed by the same principle: the server names the day, the client
 * discards anything that does not match the day it was named.
 */
export default function DailyDraftPage({ params }: Props) {
  const { mode } = use(params);
  const router = useRouter();

  const [pageState, setPageState] = useState<PageState>({ status: "loading" });
  const [window_, setWindow] = useState<DailyWindowPayload | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const loadGame = useCallback(async () => {
    setPageState({ status: "loading" });

    // Validate mode
    if (!VALID_MODES.includes(mode as DraftMode)) {
      router.replace("/arena/daily");
      return;
    }

    const draftMode = mode as DraftMode;

    // TODAY'S BOARD, FROM THE SERVER, FIRST. No `date` argument: the request
    // carries no opinion about what day it is, and the answer names the day.
    // Fetching before consulting local state is what makes every check below
    // reliable — the old order asked "have I played today?" against a date the
    // server had never agreed to.
    let gameState: DraftGameState;
    try {
      gameState = await getDailyDraft(draftMode);
    } catch (e) {
      const message =
        e instanceof DraftAPIError
          ? e.detail
          : "Could not load today's board. Is the API running?";
      setPageState({ status: "error", message });
      return;
    }

    const dailyWindow = extractDailyWindow(gameState);
    setWindow(dailyWindow);
    const today =
      dailyWindow?.daily_key ?? boardIdDate(gameState.board_metadata?.board_id) ?? "";

    const hasPriorCompletion = draftProgress.hasDailyCompletion(today, draftMode);
    analytics.track({
      type: "daily_board_opened",
      mode: draftMode,
      date: today,
      has_prior_completion: hasPriorCompletion,
    });

    if (hasPriorCompletion) {
      const summary = draftProgress.getDailyCompletion(today, draftMode)!;
      setPageState({ status: "already_completed", summary, date: today });
      return;
    }

    // Resume an active game — but only if it is a daily, in this mode, AND on
    // TODAY'S board. A pointer at yesterday's board is not a resumable game,
    // it is a stale pointer, and it is discarded rather than followed.
    const active = draftProgress.getActiveGame();
    const activeIsToday =
      active !== null && boardIdDate(active.board_id) === today && today !== "";
    if (active && active.board_type === "daily" && active.mode === draftMode) {
      if (!activeIsToday) {
        draftProgress.clearActiveGame();
      } else {
        try {
          const resumed = await getDraftGame(active.game_id);
          if (
            resumed.status !== "draft_complete" &&
            resumed.status !== "expired"
          ) {
            setPageState({ status: "playing", gameState: resumed, date: today });
            return;
          }
          // Expired or already complete — clear and fall through to the board
          // that was already fetched above.
          draftProgress.clearActiveGame();
        } catch {
          draftProgress.clearActiveGame();
        }
      }
    }

    setPageState({ status: "playing", gameState, date: today });
  }, [mode, router]);

  useEffect(() => {
    loadGame();
    // `reloadToken` changes when the board rolls over; see useDailyReset below.
  }, [loadGame, reloadToken]);

  // The rollover. Refetches today's board when the countdown reaches zero and
  // when the tab returns from the background past the boundary.
  useDailyReset({
    dailyKey: window_?.daily_key ?? null,
    secondsRemaining: window_?.seconds_remaining ?? null,
    window: window_,
    onReset: useCallback(() => setReloadToken((t) => t + 1), []),
  });

  const handleViewResult = useCallback(
    async (summary: DraftCompletionSummary, date: string) => {
      try {
        const gameState = await getDraftGame(summary.game_id);
        setPageState({ status: "playing", gameState, date, isReplay: true });
      } catch {
        setPageState({
          status: "error",
          message: "Could not load your result. Please try again.",
        });
      }
    },
    [],
  );

  const modeLabel = MODE_LABELS[mode as DraftMode] ?? mode;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (pageState.status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div
          role="status"
          aria-label="Loading today's board…"
          className="text-center"
        >
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--border-default)] border-t-[var(--peak-accent)] mx-auto mb-3" />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Loading today&apos;s board…
          </p>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (pageState.status === "error") {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="card-elevated p-6 rounded-xl space-y-4">
          <p className="text-sm" style={{ color: "#ef4444" }}>
            {pageState.message}
          </p>
          <button
            onClick={loadGame}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{
              background: "var(--peak-accent)",
              color: "var(--text-inverse)",
            }}
          >
            Try Again
          </button>
          <div>
            <Link
              href="/arena"
              className="text-sm underline"
              style={{ color: "var(--text-muted)" }}
            >
              Back to Arena
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Already completed ──────────────────────────────────────────────────────
  if (pageState.status === "already_completed") {
    const { summary, date } = pageState;
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="card-elevated p-6 rounded-xl space-y-4">
          <h1
            className="text-xl font-bold"
            style={{ color: "var(--text-primary)" }}
          >
            ✓ Today&apos;s {modeLabel} Complete
          </h1>

          <div className="space-y-1">
            <span
              className="text-3xl font-bold score-number"
              style={{ color: "var(--peak-accent)" }}
            >
              {summary.lineup_peak_rating.toFixed(1)}
            </span>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Lineup Peak Rating
            </p>
            {summary.draft_efficiency !== null && (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Efficiency:{" "}
                {(summary.draft_efficiency * 100).toFixed(0)}%
              </p>
            )}
            {summary.board_percentile !== null && (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Top {(100 - summary.board_percentile * 100).toFixed(0)}%
              </p>
            )}
          </div>

          <button
            onClick={() => handleViewResult(summary, date)}
            className="w-full py-2 rounded-lg text-sm font-medium border transition-all hover:bg-[var(--bg-surface)]"
            style={{
              borderColor: "var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            View Result
          </button>

          <div
            className="text-xs px-3 py-2 rounded-lg border"
            style={{
              background: "#f59e0b10",
              borderColor: "#f59e0b40",
              color: "#f59e0b",
            }}
          >
            Replaying this board is for practice only and won&apos;t update
            your result.
          </div>

          <Link
            href="/arena/daily"
            className="block text-sm"
            style={{ color: "var(--peak-accent)" }}
          >
            Play Other Modes
          </Link>
        </div>
      </div>
    );
  }

  // ── Playing ────────────────────────────────────────────────────────────────
  if (pageState.status === "playing") {
    return (
      <>
        {pageState.isReplay && (
          <div className="max-w-lg mx-auto px-4 pt-4">
            <div
              className="text-xs px-3 py-2 rounded-lg border mb-2"
              style={{
                background: "#f59e0b10",
                borderColor: "#f59e0b40",
                color: "#f59e0b",
              }}
            >
              Replaying this board is for practice only and won&apos;t update
              your result.
            </div>
          </div>
        )}
        <DraftScreen
          initialGameState={pageState.gameState}
          boardDate={pageState.date}
        />
      </>
    );
  }

  return null;
}
