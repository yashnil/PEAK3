"use client";
import { useCallback, useEffect, useState } from "react";
import type { ArenaReadiness, TmwMatchView } from "@/types/three-man-weave";
import { TMW_MODE } from "@/types/three-man-weave";
import {
  ArenaAPIError,
  createPracticeMatch,
  getArenaReadiness,
  getMatch,
} from "@/lib/arena-api";
import ThreeManWeaveGame from "./ThreeManWeaveGame";

/**
 * The explicit start gate, and the resume path.
 *
 * MERELY FOLLOWING A LINK MUST NEVER CREATE A MATCH — the same structural
 * rule `PeakSeasonStartGate` and `RunTheTablePage` state. So this component
 * fetches readiness on mount and creates nothing until a button is pressed.
 * A `matchId` in the URL resumes an existing match instead, which is also what
 * makes a reload mid-draft safe: the server holds the state and this just
 * re-reads it.
 */
export default function ThreeManWeaveLoader({ matchId }: { matchId?: string }) {
  const [readiness, setReadiness] = useState<ArenaReadiness | null>(null);
  const [match, setMatch] = useState<TmwMatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getArenaReadiness()
      .then((value) => {
        if (!cancelled) setReadiness(value);
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the Arena.");
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
        setError(
          err instanceof ArenaAPIError ? err.detail : "Could not load that match.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setMatch((await createPracticeMatch(TMW_MODE)) as TmwMatchView);
    } catch (err) {
      setError(err instanceof ArenaAPIError ? err.detail : "Could not start a match.");
    } finally {
      setBusy(false);
    }
  }, []);

  if (match) return <ThreeManWeaveGame initialMatch={match} />;

  const available = readiness?.arena_enabled && readiness.modes.includes(TMW_MODE);

  return (
    <section
      data-testid="tmw-start-gate"
      className="flex flex-col items-start gap-3 rounded-lg border p-5"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)" }}
    >
      <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
        Three-Man Weave
      </h2>
      <p className="max-w-prose text-sm" style={{ color: "var(--text-secondary)" }}>
        Three drafters, six rounds, one shared franchise and decade per round. Every player is
        drafted off the roll they were eligible for, and scored on their best PEAK3 season anywhere
        in that decade. Once a name is taken it is gone for everyone.
      </p>

      {error && (
        <p data-testid="tmw-start-error" role="alert" className="text-xs" style={{ color: "var(--text-primary)" }}>
          {error}
        </p>
      )}

      {readiness && !available ? (
        <p data-testid="tmw-unavailable" className="text-xs" style={{ color: "var(--text-muted)" }}>
          Three-Man Weave is not available on this deployment yet.
        </p>
      ) : (
        <button
          type="button"
          data-testid="tmw-start"
          disabled={busy || !readiness}
          onClick={start}
          className="rounded px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: "var(--peak-accent)", color: "var(--peak-accent-on)" }}
        >
          {busy ? "Starting…" : "Start a practice draft"}
        </button>
      )}
    </section>
  );
}
