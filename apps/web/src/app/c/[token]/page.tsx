"use client";

import { use, useEffect, useState, useCallback } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import DraftScreen from "@/components/draft/DraftScreen";
import ChallengeComparison from "@/components/draft/ChallengeComparison";
import {
  DraftGameState,
  ChallengeMeta,
  ChallengeComparisonResponse,
} from "@/types/draft";
import {
  getChallengeMeta,
  loadChallenge,
  getDraftGame,
  getChallengeComparison,
  DraftAPIError,
} from "@/lib/draft-api";
import { draftProgress } from "@/lib/draft-progress";
import { challengeTokenKey } from "@/lib/utils";
import { analytics } from "@/lib/analytics";

// ── State machine ────────────────────────────────────────────────────────────

type PageStatus =
  | "loading_meta"
  | "landing"
  | "already_started"
  | "playing"
  | "complete"
  | "error"
  | "not_found"
  | "expired";

interface PageState {
  status: PageStatus;
  meta?: ChallengeMeta;
  gameState?: DraftGameState;
  comparison?: ChallengeComparisonResponse;
  savedGameId?: string;
  errorMessage?: string;
}

interface Props {
  params: Promise<{ token: string }>;
}

export default function ChallengeTokenPage({ params }: Props) {
  const { token } = use(params);
  const tokenKey = challengeTokenKey(token);

  const [pageState, setPageState] = useState<PageState>({
    status: "loading_meta",
  });
  const [isStarting, setIsStarting] = useState(false);

  const initPage = useCallback(async () => {
    setPageState({ status: "loading_meta" });

    // 1. Fetch spoiler-safe challenge metadata
    let meta: ChallengeMeta;
    try {
      meta = await getChallengeMeta(token);
    } catch (e) {
      if (e instanceof DraftAPIError) {
        if (e.status === 404 || e.detail === "challenge_not_found") {
          setPageState({ status: "not_found" });
          return;
        }
        // All token-integrity failures → expired UI (safe, no structure leakage)
        if (
          e.detail === "challenge_expired" ||
          e.detail === "token_invalid_signature" ||
          e.detail === "token_malformed"
        ) {
          setPageState({ status: "expired" });
          return;
        }
      }
      setPageState({
        status: "error",
        errorMessage:
          e instanceof Error ? e.message : "Failed to load challenge.",
      });
      return;
    }

    // Check expired status from meta
    if (meta.status === "expired") {
      setPageState({ status: "expired", meta });
      return;
    }

    analytics.track({
      type: "challenge_opened",
      mode: meta.mode,
      board_label: meta.board_label,
    });

    // 2. Check for a saved game in localStorage
    const savedGameId = draftProgress.getChallengeGameId(tokenKey);

    if (savedGameId) {
      try {
        const gameState = await getDraftGame(savedGameId);

        if (gameState.status === "draft_complete") {
          // Try to fetch comparison (both players finished)
          try {
            const comparison = await getChallengeComparison(
              token,
              savedGameId,
            );
            setPageState({
              status: "complete",
              meta,
              comparison,
              savedGameId,
            });
            return;
          } catch {
            // Comparison not yet available — treat as completed play-through
            setPageState({ status: "playing", meta, gameState });
            return;
          }
        }

        if (gameState.status !== "expired") {
          // Game is still active — resume it
          setPageState({ status: "already_started", meta, gameState });
          return;
        }

        // Game expired — clear and fall through to landing
        draftProgress.clearChallengeGame(tokenKey);
      } catch {
        // Game not found or fetch error — clear and fall through
        draftProgress.clearChallengeGame(tokenKey);
      }
    }

    // 3. No saved game — show pre-play landing
    setPageState({ status: "landing", meta });
  }, [token, tokenKey]);

  useEffect(() => {
    initPage();
  }, [initPage]);

  const handleStartChallenge = async () => {
    if (!pageState.meta) return;
    setIsStarting(true);
    try {
      const gameState = await loadChallenge(token);
      draftProgress.saveChallengeGameId(tokenKey, gameState.game_id);
      analytics.track({ type: "challenge_started", mode: pageState.meta.mode });
      setPageState({ status: "playing", meta: pageState.meta, gameState });
    } catch (e) {
      setPageState({
        status: "error",
        errorMessage:
          e instanceof Error ? e.message : "Failed to start challenge.",
      });
    } finally {
      setIsStarting(false);
    }
  };

  const { status, meta, gameState, comparison, savedGameId, errorMessage } =
    pageState;

  // ── not_found: triggers custom not-found.tsx ──────────────────────────────
  if (status === "not_found") {
    notFound();
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (status === "loading_meta") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div
          role="status"
          aria-label="Loading challenge…"
          className="text-center"
        >
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--border-default)] border-t-[var(--peak-accent)] mx-auto mb-3" />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Loading challenge…
          </p>
        </div>
      </div>
    );
  }

  // ── Expired ───────────────────────────────────────────────────────────────
  if (status === "expired") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card-elevated max-w-md w-full p-8 text-center space-y-3">
          <h1
            className="text-xl font-bold"
            style={{ color: "var(--text-primary)" }}
          >
            Challenge Expired
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            This challenge has expired. Challenges are active for 7 days.
          </p>
          <Link
            href="/arena/daily"
            className="inline-block mt-2 text-sm underline"
            style={{ color: "var(--peak-accent)" }}
          >
            Play today&apos;s Daily
          </Link>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card-elevated max-w-md w-full p-8 text-center space-y-4">
          <p className="text-sm" style={{ color: "#ef4444" }}>
            {errorMessage ?? "Something went wrong. Please try again."}
          </p>
          <button
            onClick={initPage}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{
              background: "var(--peak-accent)",
              color: "var(--text-inverse)",
            }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ── Landing (spoiler-safe pre-play) ───────────────────────────────────────
  if (status === "landing") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12">
        <div className="card-elevated max-w-md w-full p-8 space-y-6">
          {/* Branding */}
          <p
            className="text-xs font-semibold tracking-[0.2em] uppercase text-center"
            style={{ color: "var(--text-muted)" }}
          >
            PEAK3 Arena
          </p>

          {/* Heading */}
          <div className="text-center space-y-2">
            <h1
              className="text-2xl font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              You&apos;ve been challenged!
            </h1>
            <p
              className="text-base font-semibold"
              style={{ color: "var(--peak-accent)" }}
            >
              {meta?.board_label}
            </p>
          </div>

          {/* Challenger display — no score, no lineup */}
          <div
            className="rounded-lg px-4 py-3 text-sm text-center"
            style={{
              background: "var(--bg-surface)",
              color: "var(--text-secondary)",
            }}
          >
            {meta?.challenger_display ?? "A PEAK3 player"} challenges you to
            beat their lineup
          </div>

          {/* Rules */}
          <p
            className="text-xs text-center"
            style={{ color: "var(--text-muted)" }}
          >
            5 rounds · 1 Hold · 1 Reframe · Pick your peak windows
          </p>

          {/* CTA */}
          <button
            onClick={handleStartChallenge}
            disabled={isStarting}
            className="w-full py-3 rounded-lg font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-60"
            style={{
              background: "var(--peak-accent)",
              color: "var(--text-inverse)",
            }}
          >
            {isStarting ? "Starting…" : "Start Challenge"}
          </button>
        </div>
      </div>
    );
  }

  // ── Already started (resumed) ─────────────────────────────────────────────
  if (status === "already_started" && gameState) {
    return (
      <div>
        <div className="max-w-lg mx-auto px-4 pt-4">
          <div
            className="text-xs px-3 py-2 rounded-lg border mb-2"
            style={{
              background: "#60a5fa10",
              borderColor: "#60a5fa40",
              color: "#60a5fa",
            }}
          >
            Welcome back — your challenge is in progress
          </div>
        </div>
        <DraftScreen initialGameState={gameState} challengeToken={token} />
      </div>
    );
  }

  // ── Playing ───────────────────────────────────────────────────────────────
  if (status === "playing" && gameState) {
    return <DraftScreen initialGameState={gameState} challengeToken={token} />;
  }

  // ── Complete (came back after finishing) ──────────────────────────────────
  if (status === "complete" && comparison && savedGameId) {
    return (
      <ChallengeComparison
        comparison={comparison}
        recipientGameId={savedGameId}
      />
    );
  }

  return null;
}
