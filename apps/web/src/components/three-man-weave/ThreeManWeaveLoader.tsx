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
import { modeMeta } from "@/lib/arena-modes";
import HowToPlay from "@/components/arena/HowToPlay";
import ThreeManWeaveGame from "./ThreeManWeaveGame";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { StatusChip } from "@/components/ui/StatusChip";

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
      <PeakV2Shell width="live">
        <div className="pk-atmosphere py-9" data-testid="tmw-loading">
          <p role="status" className="text-sm" style={{ color: "var(--v2-text-secondary)" }}>
            Loading the draft room…
          </p>
        </div>
      </PeakV2Shell>
    );
  }

  const available =
    Boolean(readiness?.arena_enabled) &&
    Boolean(readiness?.modes.some((m) => m.id === TMW_MODE));

  return (
    <PeakV2Shell width="live">
      {/* The game briefing lives in `ThreeManWeaveGame` now, not here.
          gameplay-experience-polish: this lobby's own "Play bots" button is
          only ONE of the ways a player reaches a match -- the Arena hub's
          "quick practice" flow (`ArenaLobby.tsx`) creates a practice match
          and navigates straight to `/arena/three-man-weave/[matchId]`,
          skipping this component's "no match yet" branch entirely. An intro
          gated here would simply never show for that path. Putting it in
          `ThreeManWeaveGame` instead means every entry point -- this button,
          the Arena hub, a direct link, a resume -- shows the exact same
          briefing exactly once per match. */}
      <div className="pk-atmosphere pb-14 pt-9">
        <header className="flex flex-col gap-1.5 pb-1">
          <p
            className="text-xs font-bold uppercase tracking-[0.14em]"
            style={{ color: "var(--v2-color-accent)" }}
          >
            PEAK3 Arena · Multiplayer
          </p>
          <h1
            className="text-4xl font-bold sm:text-[2.75rem]"
            style={{ fontFamily: "var(--v2-font-display)", color: "var(--v2-text-primary)" }}
          >
            Three-Man Weave
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--v2-text-secondary)" }}>
            Three drafters, six rounds, one shared franchise and decade per round.
            Every player is drafted off the roll they were eligible for and scored on
            their best PEAK3 season anywhere in that decade. Once a name is taken it
            is gone for everyone.
          </p>
        </header>

        <section
          className="pk-depth pk-crown mt-5 flex flex-col items-start gap-3 rounded-2xl p-7"
          data-testid="tmw-start-gate"
          style={{ border: "1px solid var(--v2-border-subtle)" }}
        >
          {startError && (
            <p
              data-testid="tmw-start-error"
              role="alert"
              className="text-sm"
              style={{ color: "var(--v2-text-secondary)" }}
            >
              {startError}
            </p>
          )}

          {readiness && !available ? (
            <>
              <StatusChip tone="accent">Closed alpha</StatusChip>
              <h2
                className="text-xl font-bold"
                style={{ fontFamily: "var(--v2-font-display)", color: "var(--v2-text-primary)" }}
              >
                Not open on this deployment yet
              </h2>
              <p
                className="max-w-xl text-sm leading-relaxed"
                data-testid="tmw-unavailable"
                style={{ color: "var(--v2-text-secondary)" }}
              >
                Three-Man Weave is in closed alpha. Everything else in the Arena is
                playable now.
              </p>
              <PeakV2SecondaryAction href="/arena">Browse every PEAK3 game</PeakV2SecondaryAction>
            </>
          ) : (
            <>
              <h2
                className="text-xl font-bold"
                style={{ fontFamily: "var(--v2-font-display)", color: "var(--v2-text-primary)" }}
              >
                Start a draft
              </h2>
              <p className="max-w-xl text-sm leading-relaxed" style={{ color: "var(--v2-text-secondary)" }}>
                Practice starts immediately against two bot opponents. For a public match
                or a match with friends, use the multiplayer lobby.
              </p>
              <div className="flex flex-wrap gap-2.5">
                <PeakV2PrimaryAction
                  type="button"
                  data-testid="tmw-start"
                  disabled={busy || !readiness}
                  onClick={start}
                >
                  {busy ? "Starting…" : "Play bots"}
                </PeakV2PrimaryAction>
                <PeakV2SecondaryAction href="/arena/lobby?game=three_man_weave">
                  Public match or Play With Friends
                </PeakV2SecondaryAction>
              </div>
            </>
          )}

          {meta ? (
            <HowToPlay title={meta.name} rules={meta.rules} testId="tmw-rules" />
          ) : null}
        </section>
      </div>
    </PeakV2Shell>
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
    <PeakV2Shell width="live">
      <div
        className="pk-depth pk-crown mx-auto my-16 flex max-w-xl flex-col items-start gap-3 rounded-2xl p-8"
        role="alert"
        data-testid={testId}
        style={{ border: "1px solid var(--v2-border-subtle)" }}
      >
        <p
          className="text-xs font-bold uppercase tracking-[0.14em]"
          style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)" }}
        >
          {code}
        </p>
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: "var(--v2-font-display)", color: "var(--v2-text-primary)" }}
        >
          {title}
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: "var(--v2-text-secondary)" }}>
          {body}
        </p>
        <div className="flex flex-wrap gap-2.5">
          <PeakV2PrimaryAction href="/arena/lobby">Back to multiplayer</PeakV2PrimaryAction>
          <PeakV2SecondaryAction href="/arena">Every PEAK3 game</PeakV2SecondaryAction>
        </div>
      </div>
    </PeakV2Shell>
  );
}
