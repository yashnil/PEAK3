"use client";

/**
 * The room hook for PRIME CUT and FIND THE PRIME.
 *
 * WHY A NEW HOOK AND NOT THE SHOWDOWN'S ROOM. `TwentyDollarGame` owns its own
 * polling and command wiring and is tested as such; migrating it would change a
 * working game (ADR-006). The two new modes share this instead. It is built
 * from the SAME primitives every Arena room uses (`docs/design/GAME_FEEL.md`):
 *
 *   1. NEWER WINS. A response is applied only if `isNewer` says so, so a poll
 *      issued before a command and landing after it can never roll the board
 *      back.
 *   2. ONE COMMAND LANE. Decisions are exclusive: a second press while one is
 *      pending is refused before it leaves the client. Staging a window is a
 *      coalescing channel: only the latest queued intent is sent.
 *   3. A STALE VERSION IS NOT A REJECTION OF THE PLAYER. Both modes are
 *      SIMULTANEOUS: every other seat's lock bumps `state_version`, so a press
 *      made against a version a bot moved a moment earlier is refused as
 *      stale. The response carries the fresh view; if that view is still the
 *      same card or round and the command is still legal, the hook resubmits
 *      against it (up to twice). The payload names its card or round, so a
 *      retry can never land on a different decision -- the server would refuse
 *      it as `wrong_card` / `wrong_round`.
 *   4. THE SERVER'S CLOCK. `deadlineAt` is derived from the view's
 *      `turn_seconds_remaining` at the instant that view was applied, and only
 *      re-derived when the server's number disagrees by more than a second.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ArenaAPIError, commandIdempotencyKey, getMatch, submitCommand } from "@/lib/arena-api";
import { isNewer, useCommandLane } from "@/lib/game-feel/authoritative";
import { roomErrorMessage, transportErrorMessage } from "./rejections";

export interface RoomViewBase {
  match_id: string;
  state_version: number;
  status: string;
  turn_phase: string | null;
  your_seat_index: number | null;
  legal_commands: string[];
  turn_seconds_remaining: number | null;
}

export interface RoomError {
  code: string | null;
  message: string;
}

export interface UseArenaRoomOptions<TView extends RoomViewBase> {
  matchId: string;
  /** Milliseconds until the next authoritative read, or null to stop polling. */
  cadenceMs: (view: TView) => number | null;
  /** May a stale-refused command be retried against this fresher view? */
  stillValid: (view: TView, command: string, payload: Record<string, unknown>) => boolean;
}

export interface SendOptions {
  exclusive?: boolean;
  coalesce?: string;
  /** Report no command error to the player (for a background report, never a press). */
  quiet?: boolean;
}

export interface ArenaRoom<TView extends RoomViewBase> {
  view: TView | null;
  /** `performance.now()`-based deadline of the open turn, or null. */
  deadlineAt: number | null;
  loadError: ArenaAPIError | null;
  commandError: RoomError | null;
  pending: string | null;
  send: (command: string, payload: Record<string, unknown>, options?: SendOptions) => Promise<boolean>;
  reload: () => void;
  dismissError: () => void;
}

const FIRST_READ_RETRY_MS = [400, 800, 1600] as const;
const MAX_STALE_RETRIES = 2;
const DEADLINE_DRIFT_SECONDS = 1.0;
const MIN_POLL_MS = 250;

interface Applied<TView> {
  view: TView;
  deadlineAt: number | null;
}

function deadlineFor(view: RoomViewBase): number | null {
  const left = view.turn_seconds_remaining;
  return left === null || left === undefined ? null : performance.now() + left * 1000;
}

export function useArenaRoom<TView extends RoomViewBase>({
  matchId,
  cadenceMs,
  stillValid,
}: UseArenaRoomOptions<TView>): ArenaRoom<TView> {
  const [applied, setApplied] = useState<Applied<TView> | null>(null);
  const latest = useRef<Applied<TView> | null>(null);
  const [loadError, setLoadError] = useState<ArenaAPIError | null>(null);
  const [commandError, setCommandError] = useState<RoomError | null>(null);
  const [epoch, setEpoch] = useState(0);
  const lane = useCommandLane();
  const firstReadAttempts = useRef(0);
  const cadenceRef = useRef(cadenceMs);
  cadenceRef.current = cadenceMs;
  const validRef = useRef(stillValid);
  validRef.current = stillValid;

  const apply = useCallback((next: TView): boolean => {
    const prev = latest.current;
    if (prev) {
      const newer = isNewer(
        { version: prev.view.state_version, phase: prev.view.turn_phase },
        { version: next.state_version, phase: next.turn_phase },
      );
      if (!newer) {
        if (next.state_version !== prev.view.state_version) return false;
        // Same version: correct only a clock that has genuinely drifted (a
        // suspended tab), never re-base a countdown on every poll.
        const fresh = deadlineFor(next);
        const drift =
          fresh === null || prev.deadlineAt === null
            ? fresh !== prev.deadlineAt
            : Math.abs(fresh - prev.deadlineAt) / 1000 > DEADLINE_DRIFT_SECONDS;
        if (drift) {
          const corrected = { view: next, deadlineAt: fresh };
          latest.current = corrected;
          setApplied(corrected);
        }
        return false;
      }
    }
    const nextApplied = { view: next, deadlineAt: deadlineFor(next) };
    latest.current = nextApplied;
    setApplied(nextApplied);
    return true;
  }, []);

  const load = useCallback(async () => {
    if (lane.busyNow()) {
      setEpoch((n) => n + 1);
      return;
    }
    try {
      const next = (await getMatch(matchId)) as unknown as TView;
      if (!lane.busyNow()) apply(next);
      setLoadError(null);
    } catch (err) {
      const apiError =
        err instanceof ArenaAPIError ? err : new ArenaAPIError(0, "Could not reach the server.", "network_error");
      if (!latest.current && apiError.status !== 404) {
        // A fresh session can answer the very first read with a 401/403 that a
        // read a moment later would not; retry before showing a wall.
        const attempt = firstReadAttempts.current;
        if (attempt < FIRST_READ_RETRY_MS.length) {
          firstReadAttempts.current = attempt + 1;
          window.setTimeout(() => void loadRef.current(), FIRST_READ_RETRY_MS[attempt]);
          return;
        }
      }
      setLoadError(apiError);
    } finally {
      setEpoch((n) => n + 1);
    }
  }, [matchId, apply, lane]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    void loadRef.current();
  }, [matchId]);

  const view = applied?.view ?? null;

  useEffect(() => {
    const current = latest.current;
    if (!current) return;
    const delay = cadenceRef.current(current.view);
    if (delay === null) return;
    const id = window.setTimeout(() => void loadRef.current(), Math.max(MIN_POLL_MS, delay));
    return () => window.clearTimeout(id);
  }, [epoch, view]);

  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "visible") void loadRef.current();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, []);

  const send = useCallback(
    async (command: string, payload: Record<string, unknown>, options: SendOptions = {}): Promise<boolean> => {
      const result = await lane.run(
        command,
        async () => {
          let base = latest.current?.view ?? null;
          for (let attempt = 0; base && attempt <= MAX_STALE_RETRIES; attempt += 1) {
            const key = commandIdempotencyKey(matchId, base.your_seat_index ?? -1, base.state_version, command, payload);
            let response;
            try {
              response = await submitCommand(matchId, command, payload, base.state_version, key);
            } catch (err) {
              const status = err instanceof ArenaAPIError ? err.status : 0;
              if (!options.quiet) setCommandError({ code: err instanceof ArenaAPIError ? err.code ?? null : "network_error", message: transportErrorMessage(status) });
              return false;
            }
            const next = response.match as unknown as TView;
            apply(next);
            if (response.accepted) {
              setCommandError(null);
              return true;
            }
            if (response.rejection_code === "stale_state_version" && validRef.current(next, command, payload)) {
              base = next;
              continue;
            }
            if (!options.quiet) setCommandError({ code: response.rejection_code, message: roomErrorMessage(response.rejection_code, response.message) });
            return false;
          }
          return false;
        },
        { exclusive: options.exclusive ?? true, coalesce: options.coalesce },
      );
      return result === true;
    },
    [lane, matchId, apply],
  );

  const reload = useCallback(() => void loadRef.current(), []);
  const dismissError = useCallback(() => setCommandError(null), []);

  return {
    view,
    deadlineAt: applied?.deadlineAt ?? null,
    loadError,
    commandError,
    pending: lane.pending,
    send,
    reload,
    dismissError,
  };
}

/**
 * Tell the server this seat has the intro ON SCREEN.
 *
 * Both Prime modes open in `arrival`: the intro is rendered, but its clock does
 * not start until every human seat has reported it (or the server's arrival
 * backstop fires). An intro timed from match creation could expire while a slow
 * client was still loading the route, and the player would land in live play
 * never having seen it. This effect runs after the render that put the intro
 * on screen, so the intro's whole length is measured from there.
 *
 * QUIET. A refusal only ever means the intro has already started (the table's
 * last report or the backstop), and the next read shows that. A send that did
 * not land is tried again on a later render while the command is still legal.
 */
export function useReportIntroSeen<TView extends RoomViewBase>(room: ArenaRoom<TView>, command: string, arriving: boolean): void {
  const sent = useRef(false);
  const legal = arriving && (room.view?.legal_commands.includes(command) ?? false);
  const { send } = room;
  useEffect(() => {
    if (!legal || sent.current) return;
    sent.current = true;
    void send(command, {}, { exclusive: false, quiet: true }).then((ok) => {
      if (!ok) sent.current = false;
    });
  });
}
