"use client";

/**
 * Small pieces both new rooms share: a polite live region, the loading and
 * load-failure gates, the in-room error banner, and the two-step concede.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ArenaAPIError } from "@/lib/arena-api";
import { transportErrorMessage } from "@/lib/prime-arena/rejections";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";

/** Announce a sentence to assistive technology. Re-announcing identical text
 *  toggles a zero-width suffix so the change is still observed. */
export function useLiveAnnouncer(): [string, (message: string) => void] {
  const [message, setMessage] = useState("");
  const toggle = useRef(false);
  const announce = useCallback((next: string) => {
    toggle.current = !toggle.current;
    setMessage(toggle.current ? next : `${next}​`);
  }, []);
  return [message, announce];
}

export function LiveRegion({ message, testId }: { message: string; testId: string }) {
  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid={testId}>
      {message}
    </p>
  );
}

export function RoomLoading({ label, testId }: { label: string; testId: string }) {
  return (
    <PeakV2Shell width="live">
      <div className="py-9" data-testid={testId}>
        <p role="status" className="text-sm" style={{ color: "var(--v2-text-secondary)" }}>
          {label}
        </p>
      </div>
    </PeakV2Shell>
  );
}

export function RoomLoadFailure({
  error,
  gameName,
  lobbyHref,
  testId,
}: {
  error: ArenaAPIError;
  gameName: string;
  lobbyHref: string;
  testId: string;
}) {
  const notYours = error.status === 403;
  return (
    <PeakV2Shell width="live">
      <div className="parena-gate" role="alert" data-testid={testId}>
        <p className="parena-eyebrow">{notYours ? "Not your seat" : "Match unavailable"}</p>
        <h1 className="parena-gate-title">
          {notYours ? `This ${gameName} match belongs to other players` : `We could not open that ${gameName} match`}
        </h1>
        <p className="parena-gate-body">{transportErrorMessage(error.status)}</p>
        <div className="parena-gate-actions">
          <PeakV2PrimaryAction href={lobbyHref}>Back to multiplayer</PeakV2PrimaryAction>
          <PeakV2SecondaryAction href="/arena">Every PEAK3 game</PeakV2SecondaryAction>
        </div>
      </div>
    </PeakV2Shell>
  );
}

/** A private room that is still filling. Not the match: nothing has been dealt,
 *  no clock is running, and the page says so rather than showing an intro for a
 *  match that has not started. It keeps polling (the room hook) and gives way to
 *  the match the moment the server opens it. */
export function RoomForming({
  gameName,
  seatsTaken,
  seatCount,
  roomCode,
  testId,
}: {
  gameName: string;
  seatsTaken: number;
  seatCount: number;
  roomCode: string | null;
  testId: string;
}) {
  return (
    <PeakV2Shell width="live">
      <div className="parena-gate" role="status" data-arena="quiet" data-testid={testId}>
        <p className="parena-eyebrow">{gameName} · Private room</p>
        <h1 className="parena-gate-title">Waiting for the table</h1>
        <p className="parena-gate-body">
          {seatsTaken} of {seatCount} seats taken. The match starts by itself when the last seat fills, or when the
          host fills the empty seats with bots.
        </p>
        {roomCode ? (
          <p className="parena-room-code">
            Room code <span className="pk-numeral">{roomCode}</span>
          </p>
        ) : null}
      </div>
    </PeakV2Shell>
  );
}

export function RoomErrorBanner({
  message,
  onDismiss,
  testId,
}: {
  message: string;
  onDismiss: () => void;
  testId: string;
}) {
  return (
    <div className="parena-error" role="alert" data-testid={testId}>
      <p>{message}</p>
      <button type="button" className="parena-link-button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

/** Two deliberate presses; Escape backs out; the destructive choice is never
 *  the one under the cursor. */
export function ConcedeControl({
  onConfirm,
  busy,
  testId,
}: {
  onConfirm: () => Promise<boolean> | void;
  busy: boolean;
  testId: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (!confirming) return;
    keepRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirming(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  if (!confirming) {
    return (
      <PeakV2SecondaryAction type="button" size="sm" data-testid={testId} onClick={() => setConfirming(true)}>
        Concede match
      </PeakV2SecondaryAction>
    );
  }
  return (
    <div className="parena-concede" role="group" aria-label="Confirm concede" data-testid={`${testId}-confirm`}>
      <p>Leave with a last-place finish?</p>
      <PeakV2SecondaryAction type="button" size="sm" ref={keepRef} onClick={() => setConfirming(false)}>
        Keep playing
      </PeakV2SecondaryAction>
      <PeakV2SecondaryAction
        type="button"
        size="sm"
        disabled={busy}
        data-testid={`${testId}-yes`}
        onClick={() => void onConfirm()}
        style={{ color: "var(--v2-color-negative)", borderColor: "var(--v2-color-negative)" }}
      >
        {busy ? "Conceding…" : "Concede"}
      </PeakV2SecondaryAction>
    </div>
  );
}
