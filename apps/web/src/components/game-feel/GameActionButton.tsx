"use client";

/**
 * GameActionButton — the one way a game action is pressed.
 *
 * Every primary decision in an Arena game used to be a plain button whose
 * only feedback was the request's own latency: nothing on press, nothing
 * while the command was in flight, and a label that stayed live while a
 * duplicate click was silently dropped by a guard three components up.
 *
 * This button owns the whole interaction envelope, in five states carried on
 * `data-state` so a stylesheet (and a test) can read them:
 *
 *   idle -> pressed (pointer down, ~100ms) -> pending (the action's promise
 *   is unresolved; the label changes and the button refuses further presses)
 *   -> confirmed (resolved truthy, ~350ms lock beat) | error (rejected or
 *   resolved falsy, ~600ms) -> idle.
 *
 * ONE PRESS, ONE ACTION. A press while pending is ignored here, before any
 * handler runs, so a game never has to remember to guard its own handler.
 * The guard is a ref, not state, so it holds inside the same tick as the
 * press that armed it.
 */

import { forwardRef, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import type { V2ActionSize } from "@/components/v2/v2-action-base";

export type GameActionState = "idle" | "pressed" | "pending" | "confirmed" | "error";

export interface GameActionButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children"> {
  /** The action. A returned promise drives `pending`; resolving to `false`
   *  (or throwing) reads as an error rather than a confirmation. */
  onAction: () => Promise<unknown> | unknown;
  children: ReactNode;
  /** Shown while pending, e.g. "Drafting…". Defaults to the idle label. */
  pendingLabel?: ReactNode;
  /** Externally-known pending state (e.g. a command lane's own), OR-ed with
   *  this button's own. Lets a sibling control show the same busy state. */
  pending?: boolean;
  variant?: "primary" | "secondary";
  size?: V2ActionSize;
  /** How long the confirmed beat holds. Inside the event band (180-450ms). */
  confirmMs?: number;
}

const CONFIRM_MS = 350;
const ERROR_MS = 600;
const PRESS_MS = 120;

const GameActionButton = forwardRef<HTMLButtonElement, GameActionButtonProps>(function GameActionButton(
  {
    onAction,
    children,
    pendingLabel,
    pending: externalPending = false,
    variant = "primary",
    size = "md",
    confirmMs = CONFIRM_MS,
    disabled,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    className,
    ...rest
  },
  ref,
) {
  const [state, setState] = useState<GameActionState>("idle");
  const inFlight = useRef(false);
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const settle = useCallback(
    (next: GameActionState, holdMs: number) => {
      if (!mounted.current) return;
      setState(next);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (mounted.current) setState("idle");
      }, holdMs);
    },
    [],
  );

  const press = useCallback(() => {
    // THE DUPLICATE GUARD, synchronous. Nothing below runs twice.
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setState("pending");
    let outcome: Promise<unknown>;
    try {
      outcome = Promise.resolve(onAction());
    } catch (error) {
      outcome = Promise.reject(error);
    }
    outcome.then(
      (value) => {
        inFlight.current = false;
        settle(value === false ? "error" : "confirmed", value === false ? ERROR_MS : confirmMs);
      },
      () => {
        inFlight.current = false;
        settle("error", ERROR_MS);
      },
    );
  }, [confirmMs, disabled, onAction, settle]);

  const isPending = state === "pending" || externalPending;
  const inactive = disabled || isPending;
  const shared = {
    ...rest,
    ref,
    size,
    className,
    disabled: inactive,
    "aria-busy": isPending || undefined,
    "data-state": isPending ? "pending" : state,
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      onPointerDown?.(event);
      if (event.button > 0 || inactive) return;
      if (state === "idle") {
        setState("pressed");
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          if (mounted.current) setState((current) => (current === "pressed" ? "idle" : current));
        }, PRESS_MS);
      }
    },
    onPointerUp,
    onPointerLeave,
    onClick: () => press(),
  };
  const label = isPending && pendingLabel !== undefined ? pendingLabel : children;

  if (variant === "secondary") {
    return <PeakV2SecondaryAction {...shared}>{label}</PeakV2SecondaryAction>;
  }
  return (
    <PeakV2PrimaryAction {...shared} busy={false}>
      {label}
    </PeakV2PrimaryAction>
  );
});

export default GameActionButton;
