"use client";

/**
 * AN ACTION'S LIFECYCLE, MEASURED WHERE THE PLAYER FEELS IT.
 *
 * One timer per press, four marks, all on `performance.now()`:
 *
 *   pressed   the handler ran                                   (t = 0)
 *   ack       the first animation frame after the press          -> ack_ms
 *   response  the command's response body was decoded            -> response_ms
 *             (and the server's own share, from Server-Timing)   -> server_ms
 *   visible   the first frame after the authoritative state      -> visible_ms
 *             was applied
 *
 * plus one standalone mark for a turn HANDOFF (authoritative read landed ->
 * this seat's controls actionable), which is what "the next turn is visible"
 * means to a player.
 *
 * WHAT IS REPORTED. Durations, the mode id and the action kind -- nothing
 * about the match, the seat, the player or the board. Events go through the
 * existing telemetry pipe (`lib/analytics.ts`), which is allowlisted,
 * sampled by nothing but its own opt-outs, and never breaks the UI.
 *
 * A ring buffer of the last timings is kept on `window.__peak3ActionTimings`
 * outside production builds, so a QA driver can read exactly what the room
 * measured instead of re-deriving it from the DOM.
 */

import { analytics } from "@/lib/analytics";
import type { ServerTiming } from "./server-timing";

export type ArenaActionKind =
  | "pick"
  | "stage"
  | "rearrange"
  | "bid"
  | "pass"
  | "forfeit"
  | "intro_seen"
  | "handoff";

export interface ActionTiming {
  mode: string;
  kind: ArenaActionKind;
  ackMs: number | null;
  responseMs: number | null;
  serverMs: number | null;
  visibleMs: number | null;
  outcome: "accepted" | "refused" | "failed";
}

export interface ActionTimer {
  /** The command's response has been decoded. */
  responded(server: ServerTiming | null): void;
  /** The authoritative answer is applied; measured on the next frame, then reported. */
  settled(outcome: ActionTiming["outcome"]): void;
}

const RING = 50;

function nextFrame(callback: () => void): void {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => callback());
  } else {
    setTimeout(callback, 0);
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function round(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.round(value));
}

function report(timing: ActionTiming): void {
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    const ring = ((window as unknown as { __peak3ActionTimings?: ActionTiming[] }).__peak3ActionTimings ??= []);
    ring.push(timing);
    if (ring.length > RING) ring.splice(0, ring.length - RING);
  }
  analytics.track({
    type: "arena_action_timing",
    mode: timing.mode,
    decision: timing.kind,
    outcome: timing.outcome,
    ...(timing.ackMs !== null ? { ack_ms: timing.ackMs } : {}),
    ...(timing.responseMs !== null ? { response_ms: timing.responseMs } : {}),
    ...(timing.serverMs !== null ? { server_ms: timing.serverMs } : {}),
    ...(timing.visibleMs !== null ? { visible_ms: timing.visibleMs } : {}),
  });
}

/** Start timing one press. Call from the press handler, before any await. */
export function startActionTimer(mode: string, kind: ArenaActionKind): ActionTimer {
  const pressedAt = now();
  let ackMs: number | null = null;
  let responseMs: number | null = null;
  let serverMs: number | null = null;
  let done = false;
  nextFrame(() => {
    ackMs = now() - pressedAt;
  });
  return {
    responded(server) {
      if (done) return;
      responseMs = now() - pressedAt;
      serverMs = server?.totalMs ?? null;
    },
    settled(outcome) {
      if (done) return;
      done = true;
      nextFrame(() =>
        report({
          mode,
          kind,
          ackMs: round(ackMs),
          responseMs: round(responseMs),
          serverMs: round(serverMs),
          visibleMs: round(now() - pressedAt),
          outcome,
        }),
      );
    },
  };
}

/** Report a turn handoff: `sinceMs` is when the authoritative read that made
 *  this seat actionable landed (a `performance.now()` value). */
export function reportHandoff(mode: string, sinceMs: number): void {
  nextFrame(() =>
    report({
      mode,
      kind: "handoff",
      ackMs: null,
      responseMs: null,
      serverMs: null,
      visibleMs: round(now() - sinceMs),
      outcome: "accepted",
    }),
  );
}
