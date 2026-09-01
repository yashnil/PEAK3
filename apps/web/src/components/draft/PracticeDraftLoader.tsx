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
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
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

  // The API requires a seed for a practice board (it has no date to key off,
  // unlike a daily). A seedless visit — every link that doesn't spell out
  // `?seed=`, including every "Practice" link on /arena/labs — used to send
  // no seed at all and get a 400 `board_error` back, which this component
  // then showed as its own generic "Could not create practice board" retry
  // screen: the create genuinely never happened, not a flaky API. Picked
  // once per mount (`useState` initializer), so it's stable across
  // `create()`'s own retries and doesn't fight `startedRef`'s StrictMode
  // guard by picking a new board on every re-render.
  const [effectiveSeed] = useState(() => seed ?? Math.floor(Math.random() * 1_000_000));

  const create = useCallback(() => {
    setFailed(false);
    createDraftGame(mode, "practice", { seed: effectiveSeed })
      .then(setGameState)
      .catch(() => setFailed(true));
  }, [mode, effectiveSeed]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    create();
  }, [create]);

  if (failed) {
    return (
      <PeakV2Shell width="live">
        <div className="mx-auto max-w-lg px-4 py-16 flex flex-col items-center gap-4 text-center">
          <p role="alert" style={{ color: "var(--incorrect)" }}>
            Could not create practice board. Is the API running?
          </p>
          <PeakV2SecondaryAction
            type="button"
            onClick={create}
            data-testid="practice-draft-retry"
          >
            Try again
          </PeakV2SecondaryAction>
        </div>
      </PeakV2Shell>
    );
  }

  if (!gameState) {
    return (
      <PeakV2Shell width="live">
        <div
          className="mx-auto max-w-lg px-4 py-16 text-center"
          role="status"
          data-testid="practice-draft-loading"
        >
          <p style={{ color: "var(--text-muted)" }}>Building your practice board…</p>
        </div>
      </PeakV2Shell>
    );
  }

  return <DraftScreen initialGameState={gameState} />;
}
