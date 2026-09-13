"use client";

/**
 * One FIND THE PRIME match — career film strip, timeline, peak ridge.
 *
 * BEFORE THE LOCK the stage is deliberately neutral: a player, a required
 * length, and the career's seasons on a rail. No score, no curve, no hint; the
 * view carries none. AFTER THE ROUND RESOLVES the same rail becomes the ridge:
 * the career's canonical window scores, PEAK3's highest-rated window, yours,
 * and every other seat's.
 *
 * SELECTING. Tap a season or use the arrow keys / Earlier-Later buttons; the
 * bracket snaps to legal starts only. Each move is STAGED to the server on a
 * coalescing, debounced channel (so a clock that runs out still counts it) and
 * LOCK is explicit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createPracticeMatch } from "@/lib/arena-api";
import { modeMeta } from "@/lib/arena-modes";
import { useArenaRoom } from "@/lib/prime-arena/useArenaRoom";
import { primeTelemetry } from "@/lib/prime-arena/telemetry";
import {
  FIND_THE_PRIME_COMMAND_FORFEIT,
  FIND_THE_PRIME_COMMAND_LOCK,
  FIND_THE_PRIME_COMMAND_STAGE,
  FIND_THE_PRIME_DECIDE_SECONDS,
  FIND_THE_PRIME_MODE,
  type FindThePrimeMatchView,
} from "@/types/find-the-prime";
import ArenaTimer from "@/components/shared/ArenaTimer";
import HowToPlay from "@/components/arena/HowToPlay";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import ArenaMatchStrip, { ordinal, type StripSeat } from "@/components/prime-arena/ArenaMatchStrip";
import {
  ConcedeControl,
  LiveRegion,
  RoomErrorBanner,
  RoomLoadFailure,
  RoomLoading,
  useLiveAnnouncer,
} from "@/components/prime-arena/RoomChrome";
import CareerRail, { windowLabel } from "./CareerRail";
import FindThePrimeReveal from "./FindThePrimeReveal";
import FindThePrimeResult from "./FindThePrimeResult";

const LOBBY_HREF = "/arena/lobby?game=find_the_prime";
const STAGE_DEBOUNCE_MS = 350;

export function findThePrimeCadence(view: FindThePrimeMatchView): number | null {
  if (view.status === "completed" || view.public_state.phase === "complete") return null;
  if (view.public_state.phase === "decide") {
    return view.private_state.locked_start !== null ? 700 : 1200;
  }
  const left = view.turn_seconds_remaining;
  const ms = left === null ? 800 : left * 1000 + 150;
  return Math.min(1500, Math.max(300, ms));
}

export function findThePrimeStillValid(view: FindThePrimeMatchView, command: string, payload: Record<string, unknown>): boolean {
  const state = view.public_state;
  return view.legal_commands.includes(command) && state.phase === "decide" && state.round_index === payload.round_index;
}

export default function FindThePrimeGame({ matchId }: { matchId: string }) {
  return <FindThePrimeRoom key={matchId} matchId={matchId} />;
}

function FindThePrimeRoom({ matchId }: { matchId: string }) {
  const router = useRouter();
  const room = useArenaRoom<FindThePrimeMatchView>({
    matchId,
    cadenceMs: findThePrimeCadence,
    stillValid: findThePrimeStillValid,
  });
  const [message, announce] = useLiveAnnouncer();
  const meta = modeMeta(FIND_THE_PRIME_MODE);
  const view = room.view;
  const previous = useRef<FindThePrimeMatchView | null>(null);
  const resumedComplete = useRef<boolean | null>(null);

  // Local selection for the CURRENT round. Seeded from the server's staged or
  // locked window whenever a new round opens (or the page reloads mid-round).
  const [selection, setSelection] = useState<{ round: number; start: number } | null>(null);
  const roundIndex = view?.public_state.round_index ?? -1;
  const serverStart = view ? view.private_state.locked_start ?? view.private_state.staged_start : null;
  useEffect(() => {
    if (!view || view.public_state.phase !== "decide") return;
    setSelection((current) => {
      if (current && current.round === roundIndex) return current;
      return serverStart !== null ? { round: roundIndex, start: serverStart } : null;
    });
  }, [view, roundIndex, serverStart]);

  const stageTimer = useRef<number | null>(null);
  const stage = useCallback(
    (start: number) => {
      if (stageTimer.current !== null) window.clearTimeout(stageTimer.current);
      stageTimer.current = window.setTimeout(() => {
        stageTimer.current = null;
        const current = room.view;
        if (!current || current.public_state.phase !== "decide") return;
        if (!current.legal_commands.includes(FIND_THE_PRIME_COMMAND_STAGE)) return;
        void room.send(
          FIND_THE_PRIME_COMMAND_STAGE,
          { round_index: current.public_state.round_index, start_season_end: start },
          { exclusive: false, coalesce: "stage" },
        );
      }, STAGE_DEBOUNCE_MS);
    },
    [room],
  );
  useEffect(() => () => {
    if (stageTimer.current !== null) window.clearTimeout(stageTimer.current);
  }, []);

  const select = useCallback(
    (start: number) => {
      if (!view || view.public_state.phase !== "decide" || view.private_state.locked_start !== null) return;
      const first = !selection || selection.round !== view.public_state.round_index;
      setSelection({ round: view.public_state.round_index, start });
      stage(start);
      primeTelemetry.decision(FIND_THE_PRIME_MODE, { stage: view.public_state.round_index + 1, decision: first ? "stage" : "move" });
    },
    [view, stage, selection],
  );

  const lock = useCallback(() => {
    const current = room.view;
    if (!current || !selection || selection.round !== current.public_state.round_index) return;
    if (stageTimer.current !== null) {
      window.clearTimeout(stageTimer.current);
      stageTimer.current = null;
    }
    const prompt = current.public_state.prompt;
    void room
      .send(FIND_THE_PRIME_COMMAND_LOCK, { round_index: current.public_state.round_index, start_season_end: selection.start })
      .then((ok) => {
        if (!ok) return;
        if (prompt) announce(`Locked: ${windowLabel(prompt.seasons, selection.start, prompt.duration)}.`);
        primeTelemetry.decision(FIND_THE_PRIME_MODE, { stage: current.public_state.round_index + 1, decision: "lock" });
      });
  }, [room, selection, announce]);

  // -- telemetry ---------------------------------------------------------------
  const telemetryPrev = useRef<FindThePrimeMatchView | null>(null);
  const openedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!view) return;
    const prev = telemetryPrev.current;
    telemetryPrev.current = view;
    const state = view.public_state;
    if (!prev) {
      openedAt.current = Date.now();
      primeTelemetry.opened(FIND_THE_PRIME_MODE);
      if (state.phase === "intro") primeTelemetry.matchStarted(FIND_THE_PRIME_MODE, view.entry_path, state.ruleset_version);
      return;
    }
    const before = prev.public_state;
    if (before.phase === state.phase && before.round_index === state.round_index) return;
    if (state.phase === "decide" && state.prompt) {
      primeTelemetry.roundStarted(FIND_THE_PRIME_MODE, state.round_index + 1, state.prompt.duration);
    }
    if (state.round_results.length > before.round_results.length) {
      const reveal = state.round_results[state.round_results.length - 1];
      const row = reveal.seats.find((s) => s.seat_index === view.your_seat_index);
      if (row && (row.locked_by === "no_selection" || row.locked_by === "staged_at_timeout")) {
        primeTelemetry.timeout(FIND_THE_PRIME_MODE, reveal.round_index + 1, row.locked_by === "no_selection" ? "none" : "staged");
      }
      primeTelemetry.roundCompleted(FIND_THE_PRIME_MODE, reveal.round_index + 1, reveal.duration, row?.points);
    }
    if (state.phase === "complete" && before.phase !== "complete") {
      const placement = state.placements?.find((p) => p.seat_index === view.your_seat_index);
      const standing = state.standings.find((s) => s.seat_index === view.your_seat_index);
      primeTelemetry.matchCompleted(FIND_THE_PRIME_MODE, {
        outcome: placement?.outcome,
        placement: placement?.placement,
        score: standing?.total,
        durationSeconds: openedAt.current ? Math.round((Date.now() - openedAt.current) / 1000) : undefined,
        bots: view.seats.filter((s) => s.is_bot).length,
      });
    }
  }, [view]);

  // -- announcements ---------------------------------------------------------
  useEffect(() => {
    if (!view) return;
    const prev = previous.current;
    previous.current = view;
    if (resumedComplete.current === null) resumedComplete.current = view.status === "completed";
    const state = view.public_state;
    const prevState = prev?.public_state;
    if (prevState && prevState.phase === state.phase && prevState.round_index === state.round_index) return;
    if (state.phase === "decide" && state.prompt) {
      announce(
        `Round ${state.round_index + 1} of 9. ${state.prompt.player_name}: find the best ${state.prompt.duration}-year window. ${state.prompt.legal_starts.length} windows to choose from.`,
      );
    } else if (state.phase === "reveal") {
      const result = state.round_results[state.round_results.length - 1];
      const row = result?.seats.find((s) => s.seat_index === view.your_seat_index);
      const standing = state.standings.find((s) => s.seat_index === view.your_seat_index);
      if (result && row) {
        const timeout = row.locked_by === "no_selection" ? " Time ran out with no window selected." : row.locked_by === "staged_at_timeout" ? " Time ran out; your placed window was locked." : "";
        announce(`Round ${result.round_index + 1} revealed.${timeout} You scored ${row.points.toFixed(0)} points. You are ${standing ? ordinal(standing.position) : ""}.`);
      }
    } else if (state.phase === "complete") {
      const placement = state.placements?.find((p) => p.seat_index === view.your_seat_index);
      const standing = state.standings.find((s) => s.seat_index === view.your_seat_index);
      if (placement && standing) announce(`Match complete. You finished ${ordinal(placement.placement)} with ${standing.total.toFixed(0)} of 900.`);
    }
  }, [view, announce]);

  const playAgain = useCallback(async () => {
    const current = room.view;
    if (!current) return;
    primeTelemetry.rematch(FIND_THE_PRIME_MODE);
    const soloTable = current.seats.every((seat) => seat.is_bot || seat.seat_index === current.your_seat_index);
    if (soloTable) {
      const created = await createPracticeMatch(FIND_THE_PRIME_MODE);
      router.replace(`/arena/find-the-prime/${created.match_id}`);
      return;
    }
    router.push(LOBBY_HREF);
  }, [room.view, router]);

  const stripSeats: StripSeat[] = useMemo(() => {
    if (!view) return [];
    const state = view.public_state;
    return state.seats.map((seat) => {
      const standing = state.standings.find((s) => s.seat_index === seat.seat_index);
      return {
        seatIndex: seat.seat_index,
        name: seat.display_name,
        isBot: seat.is_bot,
        botTier: seat.bot_tier,
        position: standing?.position ?? 1,
        scoreText: standing ? standing.total.toFixed(0) : "0",
        locked: seat.locked,
        forfeited: seat.forfeited,
      };
    });
  }, [view]);

  if (room.loadError && !view) {
    return <RoomLoadFailure error={room.loadError} gameName="Find the Prime" lobbyHref={LOBBY_HREF} testId="fprime-load-error" />;
  }
  if (!view) return <RoomLoading label="Pulling the career files…" testId="fprime-loading" />;

  const state = view.public_state;
  const mine = view.private_state;
  const phase = state.phase;

  if (phase === "complete" || view.status === "completed") {
    return <FindThePrimeResult view={view} resumed={resumedComplete.current === true} onPlayAgain={playAgain} message={message} />;
  }

  const prompt = state.prompt;
  const lockedStart = mine.locked_start;
  const current = selection && selection.round === state.round_index ? selection.start : null;
  const shown = lockedStart ?? current;
  const canLock = phase === "decide" && lockedStart === null && shown !== null && view.legal_commands.includes(FIND_THE_PRIME_COMMAND_LOCK);
  const waitingOn = state.seats.filter((s) => !s.locked && !s.forfeited).length;
  const reveal = phase === "reveal" ? state.round_results[state.round_results.length - 1] : null;

  return (
    <PeakV2Shell width="live-wide">
      <div className="fprime-room" data-arena="live" data-phase={phase} data-testid="fprime-room">
        <header className="fprime-head">
          <div>
            <p className="parena-eyebrow">
              Find the Prime · {view.rated ? "Rated" : view.entry_path === "private_room" ? "Private room" : "Practice"}
            </p>
            <h1 className="fprime-heading">
              {phase === "intro" ? "Find his best stretch." : `Round ${state.round_index + 1} of ${state.round_count}`}
            </h1>
          </div>
          {prompt ? (
            <p className="fprime-length" data-testid="fprime-length">
              <span className="pk-numeral">{prompt.duration}</span>-year window
            </p>
          ) : null}
          <div className="fprime-clock">
            <ArenaTimer
              deadlineAt={room.deadlineAt}
              totalSeconds={view.turn_total_seconds ?? FIND_THE_PRIME_DECIDE_SECONDS}
              label={phase === "decide" ? (lockedStart !== null ? "Locked · waiting" : "Lock in") : phase === "reveal" ? "Next round" : "Starts in"}
              yours={phase === "decide" && lockedStart === null}
              consequence={
                phase === "decide" && lockedStart === null
                  ? shown !== null
                    ? "Runs out: your placed window locks"
                    : "Runs out: no window, 0 points"
                  : null
              }
              testId="fprime-clock"
            />
          </div>
        </header>

        <section className="fprime-stage" aria-label="The career" data-testid="fprime-stage">
          {room.commandError ? (
            <RoomErrorBanner message={room.commandError.message} onDismiss={room.dismissError} testId="fprime-error" />
          ) : null}
          {phase === "intro" ? (
            <div className="fprime-slate" data-testid="fprime-intro">
              <p className="parena-eyebrow">Find the Prime</p>
              <h2 className="fprime-slate-title">Find his best stretch.</h2>
              <p className="fprime-slate-body">Pick the strongest contiguous 2-, 3- or 5-year window of each player&apos;s career.</p>
              <ul className="fprime-slate-rules">
                <li>Select a legal window on the career timeline.</li>
                <li>Lock before time expires.</li>
                <li>The closer your window is to the player&apos;s PEAK3 prime, the more points you earn.</li>
              </ul>
            </div>
          ) : null}

          {prompt && phase === "decide" ? (
            <>
              <div className="fprime-player">
                <h2 className="fprime-player-name" data-testid="fprime-player-name">
                  {prompt.player_name}
                </h2>
                <p className="fprime-player-span">
                  <span className="pk-numeral">{prompt.career_first_season}</span> to{" "}
                  <span className="pk-numeral">{prompt.career_last_season}</span> · {prompt.seasons.length} PEAK3 seasons ·{" "}
                  {prompt.legal_starts.length} possible windows
                </p>
              </div>
              <CareerRail
                seasons={prompt.seasons}
                legalStarts={prompt.legal_starts}
                duration={prompt.duration}
                selectedStart={shown}
                locked={lockedStart !== null}
                onSelect={select}
              />
              <div className="fprime-lock-row">
                <p className="fprime-selection" data-testid="fprime-selection" aria-live="off">
                  {shown !== null ? (
                    <>
                      {lockedStart !== null ? "Locked" : "Your window"}:{" "}
                      <strong className="pk-numeral">{windowLabel(prompt.seasons, shown, prompt.duration)}</strong>
                    </>
                  ) : (
                    "Tap a season to place your window."
                  )}
                </p>
                {lockedStart === null ? (
                  <button
                    type="button"
                    className="fprime-lock"
                    data-testid="fprime-lock"
                    disabled={!canLock || room.pending === FIND_THE_PRIME_COMMAND_LOCK}
                    aria-busy={room.pending === FIND_THE_PRIME_COMMAND_LOCK}
                    onClick={lock}
                  >
                    {room.pending === FIND_THE_PRIME_COMMAND_LOCK ? "Locking…" : "Lock window"}
                  </button>
                ) : (
                  <p className="fprime-waiting" data-testid="fprime-waiting">
                    Locked. {waitingOn > 0 ? `Waiting on ${waitingOn} player${waitingOn === 1 ? "" : "s"}.` : "Revealing…"}
                  </p>
                )}
              </div>
            </>
          ) : null}

          {reveal ? <FindThePrimeReveal view={view} reveal={reveal} /> : null}
        </section>

        <div className="fprime-strip">
          <ArenaMatchStrip
            seats={stripSeats}
            yourSeat={view.your_seat_index}
            showLocks={phase === "decide"}
            title="Standings"
            progress={`${state.round_results.length} of ${state.round_count} rounds scored`}
            scoreLabel="Points"
            testId="fprime-strip"
          />
        </div>

        <footer className="fprime-foot">
          {meta ? <HowToPlay title={meta.name} rules={meta.rules} testId="fprime-rules" /> : null}
          {view.legal_commands.includes(FIND_THE_PRIME_COMMAND_FORFEIT) ? (
            <ConcedeControl
              busy={room.pending === FIND_THE_PRIME_COMMAND_FORFEIT}
              onConfirm={() => {
                primeTelemetry.abandoned(FIND_THE_PRIME_MODE, state.round_index + 1);
                return room.send(FIND_THE_PRIME_COMMAND_FORFEIT, {});
              }}
              testId="fprime-concede"
            />
          ) : null}
        </footer>
        <LiveRegion message={message} testId="fprime-live" />
      </div>
    </PeakV2Shell>
  );
}
