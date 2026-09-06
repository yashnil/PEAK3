"use client";

/**
 * THE INTERACTION CONTRACT EVERY SERVER-AUTHORITATIVE GAME SHARES.
 *
 * Two small primitives, extracted from what Three-Man Weave and 82-0 were
 * each half-implementing on their own:
 *
 *   1. `isNewer` — the one rule for whether a snapshot may replace what is on
 *      screen. A response is applied only if its version is strictly newer,
 *      so an older GET/poll that lands after a newer mutation cannot roll the
 *      board back (the "old poll overwrites new command" race).
 *
 *   2. `useCommandLane` — the one rule for how commands leave the client.
 *      Every command is SERIALIZED through a single lane, so a "Draft" press
 *      issued while a background stage request is still in flight is queued
 *      behind it rather than dropped, and runs against whatever version is
 *      current when it actually executes. Exclusive kinds (a pick, a
 *      placement, a replay) cannot be queued twice: a second press while one
 *      is pending returns `null` immediately, which is what "one click, one
 *      action" means at the transport layer. A coalescing channel (staging
 *      a selection) keeps only the latest queued intent.
 *
 * Neither primitive knows anything about a game. They know versions and
 * promises, which is the whole point of sharing them.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** May `next` replace `current` on screen? Strictly newer by version, or the
 *  same version with a different phase (a defensive allowance for a server
 *  that advances a phase without bumping the version — none does today). */
export function isNewer(
  current: { version: number; phase?: string | null },
  next: { version: number; phase?: string | null },
): boolean {
  if (next.version > current.version) return true;
  if (next.version < current.version) return false;
  return (next.phase ?? null) !== (current.phase ?? null);
}

export interface CommandLaneRunOptions {
  /** Only one command of an exclusive kind may be pending or queued at a
   *  time; a second `run` of the same kind (or any exclusive kind while one
   *  is pending) returns `null` without running. Default true. */
  exclusive?: boolean;
  /** Queued (not yet started) tasks on the same channel are replaced by the
   *  newest — for staging, where only the latest intent matters. */
  coalesce?: string;
}

interface QueuedTask {
  kind: string;
  channel: string | null;
  exclusive: boolean;
  start: () => void;
  cancel: () => void;
}

export interface CommandLane {
  /** Run `fn` when the lane is free. Resolves with `fn`'s result, or `null`
   *  when the run was refused (a duplicate of a pending exclusive command)
   *  or superseded (a coalesced stage). Never throws for refusal; a thrown
   *  `fn` rejects as usual. */
  run<R>(kind: string, fn: () => Promise<R>, options?: CommandLaneRunOptions): Promise<R | null>;
  /** The exclusive kind currently pending (executing or queued), or null. */
  pending: string | null;
  /** True while ANY command (exclusive or not) is executing or queued. */
  busy: boolean;
  /** Synchronous read of the exclusive pending kind, for guards inside
   *  handlers that must not wait for a re-render. */
  pendingNow(): string | null;
  /** Synchronous read of `busy`, for a poll that must not race a command. */
  busyNow(): boolean;
}

export function useCommandLane(): CommandLane {
  const queue = useRef<QueuedTask[]>([]);
  const executing = useRef<QueuedTask | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const publish = useCallback(() => {
    if (!mounted.current) return;
    const tasks = [executing.current, ...queue.current].filter(Boolean) as QueuedTask[];
    const exclusive = tasks.find((task) => task.exclusive);
    setPending(exclusive ? exclusive.kind : null);
    setBusy(tasks.length > 0);
  }, []);

  const pump = useCallback(() => {
    if (executing.current) return;
    const next = queue.current.shift();
    if (!next) {
      publish();
      return;
    }
    executing.current = next;
    publish();
    next.start();
  }, [publish]);

  const pendingNow = useCallback((): string | null => {
    const tasks = [executing.current, ...queue.current].filter(Boolean) as QueuedTask[];
    return tasks.find((task) => task.exclusive)?.kind ?? null;
  }, []);

  const busyNow = useCallback((): boolean => executing.current !== null || queue.current.length > 0, []);

  const run = useCallback(
    <R,>(kind: string, fn: () => Promise<R>, options: CommandLaneRunOptions = {}): Promise<R | null> => {
      const exclusive = options.exclusive ?? true;
      if (exclusive && pendingNow() !== null) return Promise.resolve(null);
      if (options.coalesce) {
        queue.current = queue.current.filter((task) => {
          if (task.channel !== options.coalesce) return true;
          task.cancel();
          return false;
        });
      }
      return new Promise<R | null>((resolve, reject) => {
        const task: QueuedTask = {
          kind,
          channel: options.coalesce ?? null,
          exclusive,
          cancel: () => resolve(null),
          start: () => {
            fn().then(
              (value) => {
                executing.current = null;
                resolve(value);
                pump();
              },
              (error: unknown) => {
                executing.current = null;
                reject(error);
                pump();
              },
            );
          },
        };
        queue.current.push(task);
        pump();
      });
    },
    [pendingNow, pump],
  );

  return { run, pending, busy, pendingNow, busyNow };
}
