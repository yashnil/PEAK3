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
import { draftProgress } from "@/lib/draft-progress";
import { todayUTC } from "@/lib/utils";
import { analytics } from "@/lib/analytics";

const VALID_MODES: DraftMode[] = ["apex_1y", "prime_3y", "foundation_5y"];

type PageState =
  | { status: "loading" }
  | { status: "already_completed"; summary: DraftCompletionSummary }
  | { status: "playing"; gameState: DraftGameState; isReplay?: boolean }
  | { status: "error"; message: string };

interface Props {
  params: Promise<{ mode: string }>;
}

export default function DailyDraftPage({ params }: Props) {
  const { mode } = use(params);
  const router = useRouter();
  const today = todayUTC();

  const [pageState, setPageState] = useState<PageState>({ status: "loading" });

  const loadGame = useCallback(async () => {
    setPageState({ status: "loading" });

    // Validate mode
    if (!VALID_MODES.includes(mode as DraftMode)) {
      router.replace("/arena/daily");
      return;
    }

    const draftMode = mode as DraftMode;
    const hasPriorCompletion = draftProgress.hasDailyCompletion(today, draftMode);

    analytics.track({
      type: "daily_board_opened",
      mode: draftMode,
      date: today,
      has_prior_completion: hasPriorCompletion,
    });

    // Already completed today?
    if (hasPriorCompletion) {
      const summary = draftProgress.getDailyCompletion(today, draftMode)!;
      setPageState({ status: "already_completed", summary });
      return;
    }

    // Try to resume an active game for this mode
    const active = draftProgress.getActiveGame();
    if (active && active.board_type === "daily" && active.mode === draftMode) {
      try {
        const gameState = await getDraftGame(active.game_id);
        if (
          gameState.status !== "draft_complete" &&
          gameState.status !== "expired"
        ) {
          setPageState({ status: "playing", gameState });
          return;
        }
        // Expired or already complete — clear and fall through
        draftProgress.clearActiveGame();
      } catch {
        draftProgress.clearActiveGame();
        // Fall through to create a new game
      }
    }

    // Create / fetch today's daily game
    try {
      const gameState = await getDailyDraft(draftMode, today);
      setPageState({ status: "playing", gameState });
    } catch (e) {
      const message =
        e instanceof DraftAPIError
          ? e.detail
          : "Could not load today's board. Is the API running?";
      setPageState({ status: "error", message });
    }
  }, [mode, today, router]);

  useEffect(() => {
    loadGame();
  }, [loadGame]);

  const handleViewResult = useCallback(
    async (summary: DraftCompletionSummary) => {
      try {
        const gameState = await getDraftGame(summary.game_id);
        setPageState({ status: "playing", gameState, isReplay: true });
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
    const { summary } = pageState;
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
            onClick={() => handleViewResult(summary)}
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
          boardDate={today}
        />
      </>
    );
  }

  return null;
}
