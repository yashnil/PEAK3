"use client";

/**
 * Creates a practice Peak Draft board **in the browser**, then hands it to
 * `DraftScreen`.
 *
 * WHY THIS EXISTS. `/arena/practice/[mode]` used to be an async Server
 * Component that called `createDraftGame()` itself. That worked only for as
 * long as `POST /draft/games/{id}/actions` accepted any caller at all: the API
 * establishes a game's owner by setting a signed `peak3_anon` cookie on the
 * create response, and when the create happens on the Next server that
 * `Set-Cookie` lands on a server-to-server fetch and is discarded. The browser
 * never receives it, so the player has no credential for the game they are
 * looking at.
 *
 * The moment ownership was enforced on the actions route (this pass's P0 fix),
 * that gap became visible as a 403 on every move in a practice draft — caught
 * by the e2e suite, not by any unit test, because the ownership check is what
 * made the missing cookie matter.
 *
 * Creating in the browser is also what every other mode already does: Daily
 * Grid, RUN THE TABLE, the daily draft route and the challenge route are all
 * client components that call their API from the browser. Peak Draft practice
 * was the only server-side creation left, and therefore the only surface where
 * the cookie could not be established.
 *
 * The page above stays a Server Component so `generateMetadata` and the invalid
 * -mode `notFound()` are unchanged; only the board fetch moves.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import DraftScreen from "@/components/draft/DraftScreen";
import { createDraftGame } from "@/lib/draft-api";
import type { DraftGameState, DraftMode } from "@/types/draft";

interface Props {
  mode: DraftMode;
  seed?: number;
}

export default function PracticeDraftLoader({ mode, seed }: Props) {
  const [gameState, setGameState] = useState<DraftGameState | null>(null);
  const [failed, setFailed] = useState(false);
  // React 18 StrictMode double-invokes effects in development. Without this
  // guard that would mint two boards and leave the first orphaned — harmless
  // but wasteful, and it makes the server logs lie about how many games exist.
  const startedRef = useRef(false);

  const create = useCallback(() => {
    setFailed(false);
    createDraftGame(mode, "practice", { seed })
      .then(setGameState)
      .catch(() => setFailed(true));
  }, [mode, seed]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    create();
  }, [create]);

  if (failed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p style={{ color: "var(--incorrect)" }}>
          Could not create practice board. Is the API running?
        </p>
        <button
          type="button"
          onClick={create}
          className="mt-4 rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--border-subtle)" }}
          data-testid="practice-draft-retry"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div
        className="mx-auto max-w-lg px-4 py-16 text-center"
        role="status"
        data-testid="practice-draft-loading"
      >
        <p style={{ color: "var(--text-muted)" }}>Building your practice board…</p>
      </div>
    );
  }

  return <DraftScreen initialGameState={gameState} />;
}
