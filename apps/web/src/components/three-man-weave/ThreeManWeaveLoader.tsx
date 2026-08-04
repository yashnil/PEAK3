"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ArenaReadiness, TmwMatchView } from "@/types/three-man-weave";
import { TMW_MODE } from "@/types/three-man-weave";
import {
  ArenaAPIError,
  createPracticeMatch,
  getArenaReadiness,
  getMatch,
} from "@/lib/arena-api";
import { modeMeta } from "@/lib/arena-modes";
import HowToPlay from "@/components/arena/HowToPlay";
import ThreeManWeaveGame from "./ThreeManWeaveGame";

/**
 * The explicit start gate, the resume path, and the styled failure states.
 *
 * MERELY FOLLOWING A LINK MUST NEVER CREATE A MATCH — the same structural rule
 * `PeakSeasonStartGate` and `RunTheTablePage` state. So this component fetches
 * readiness on mount and creates nothing until a button is pressed. A `matchId`
 * resumes an existing match instead, which is also what makes a reload
 * mid-draft safe: the server holds the state and this just re-reads it.
 *
 * AVAILABILITY IS READ FROM OBJECTS, NOT STRINGS. This check used to be
 * `readiness.modes.includes(TMW_MODE)` against a `modes: string[]` type that had
 * not matched the server since the seat count moved server-side. The server
 * publishes `[{id, seat_count}]`, so `includes` compared a string against
 * objects, returned false on every deployment, and this component rendered "not
 * available on this deployment yet" against a perfectly healthy server. The type
 * is now re-exported from the API client rather than hand-declared, so the
 * compiler catches the next divergence.
 *
 * A BAD MATCH ID IS A PEAK3 PAGE. An unknown or unauthorised id renders the
 * Arena's own error surface with a way back, never the framework's white 404 —
 * and the two cases are distinguished, because "that match is not yours" and
 * "that match does not exist" send a player to different places.
 */
export default function ThreeManWeaveLoader({ matchId }: { matchId?: string }) {
  const [readiness, setReadiness] = useState<ArenaReadiness | null>(null);
  const [match, setMatch] = useState<TmwMatchView | null>(null);
  const [loadError, setLoadError] = useState<ArenaAPIError | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = modeMeta(TMW_MODE);

  useEffect(() => {
    let cancelled = false;
    getArenaReadiness()
      .then((value) => {
        if (!cancelled) setReadiness(value);
      })
      .catch(() => {
        if (!cancelled) setStartError("Could not reach the Arena.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    getMatch(matchId)
      .then((value) => {
        if (!cancelled) setMatch(value as TmwMatchView);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof ArenaAPIError
            ? err
            : new ArenaAPIError(0, "Could not load that match."),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const start = useCallback(async () => {
    setBusy(true);
    setStartError(null);
    try {
      setMatch((await createPracticeMatch(TMW_MODE)) as TmwMatchView);
    } catch (err) {
      setStartError(
        err instanceof ArenaAPIError ? err.detail : "Could not start a match.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  if (match) return <ThreeManWeaveGame initialMatch={match} />;

  if (matchId && loadError) {
    const notYours = loadError.status === 403;
    return (
      <ArenaErrorState
        testId="tmw-match-error"
        code={notYours ? "Not your seat" : "Match not found"}
        title={
          notYours ? "This draft belongs to someone else" : "We could not find that draft"
        }
        body={
          notYours
            ? "Only the three players seated in a match can open it. If a friend sent you a room code, join from the multiplayer lobby instead."
            : "That match id does not resolve. Matches expire after two hours, so a link copied from an old session may have outlived its game."
        }
      />
    );
  }

  if (matchId) {
    return (
      <div className="ar-room" data-testid="tmw-loading">
        <p className="ar-notice">Loading the draft room…</p>
      </div>
    );
  }

  const available =
    Boolean(readiness?.arena_enabled) &&
    Boolean(readiness?.modes.some((m) => m.id === TMW_MODE));

  return (
    <div className="ar-lobby">
      <header className="ar-lobby-head">
        <p className="ar-eyebrow">PEAK3 Arena · Multiplayer</p>
        <h1 className="ar-lobby-title">Three-Man Weave</h1>
        <p className="ar-lobby-intro">
          Three drafters, six rounds, one shared franchise and decade per round.
          Every player is drafted off the roll they were eligible for and scored on
          their best PEAK3 season anywhere in that decade. Once a name is taken it
          is gone for everyone.
        </p>
      </header>

      <section className="ar-panel" data-testid="tmw-start-gate">
        {startError && (
          <p data-testid="tmw-start-error" role="alert" className="ar-notice">
            {startError}
          </p>
        )}

        {readiness && !available ? (
          <>
            <span className="ar-badge ar-badge-alpha">Closed alpha</span>
            <h2 className="ar-panel-title">Not open on this deployment yet</h2>
            <p className="ar-panel-body" data-testid="tmw-unavailable">
              Three-Man Weave is in closed alpha. Everything else in the Arena is
              playable now.
            </p>
            <Link className="ar-btn" href="/arena">
              Browse every PEAK3 game
            </Link>
          </>
        ) : (
          <>
            <h2 className="ar-panel-title">Start a draft</h2>
            <p className="ar-panel-body">
              Practice starts immediately against two PEAK3 Bots. For a public match
              or a private room, use the multiplayer lobby.
            </p>
            <div className="ar-panel-actions">
              <button
                type="button"
                data-testid="tmw-start"
                disabled={busy || !readiness}
                onClick={start}
                className="ar-btn ar-btn-primary"
              >
                {busy ? "Starting…" : "Play bots"}
              </button>
              <Link className="ar-btn" href="/arena/lobby?game=three_man_weave">
                Public match or private room
              </Link>
            </div>
          </>
        )}

        {meta ? (
          <HowToPlay title={meta.name} rules={meta.rules} testId="tmw-rules" />
        ) : null}
      </section>
    </div>
  );
}

/**
 * The Arena's own error surface.
 *
 * Kept in this file rather than exported into a shared module because it is
 * three elements and one class; a component that exists only to be imported
 * once is a layer, not a reuse.
 */
function ArenaErrorState({
  testId,
  code,
  title,
  body,
}: {
  testId: string;
  code: string;
  title: string;
  body: string;
}) {
  return (
    <div className="ar-error" role="alert" data-testid={testId}>
      <p className="ar-error-code">{code}</p>
      <h1 className="ar-error-title">{title}</h1>
      <p className="ar-error-body">{body}</p>
      <div className="ar-panel-actions">
        <Link className="ar-btn ar-btn-primary" href="/arena/lobby">
          Back to multiplayer
        </Link>
        <Link className="ar-btn" href="/arena">
          Every PEAK3 game
        </Link>
      </div>
    </div>
  );
}
