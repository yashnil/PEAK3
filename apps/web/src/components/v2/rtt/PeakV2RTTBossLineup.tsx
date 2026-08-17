"use client";

/**
 * PeakV2RTTBossLineup — phase 2 of the RTT boss-reveal cinematic (Pass 3):
 * "players enter sequentially, arena light follows current entrant, subtle
 * split-flap identity resolution, lineup settles" (brief).
 *
 * Consumes the SAME `track`/`sequence` `RunTheTableGame` already computes
 * (`useRevealSequence`, `RevealTrack`) — this is a V2 presentation of the
 * identical server-authoritative reveal, not a second reveal implementation.
 * `sequence.activeIndex` drives `PeakV2ArenaLight`'s sequenced `x` position
 * (its own docstring anticipates exactly this consumer); a slot whose beat
 * has not yet reached `identity` shows a resolving placeholder rather than a
 * name — the same "never leak identity early" contract
 * `RevealSequenceSurface`/`RevealCard` already enforce, preserved here by
 * only ever reading `track.revealed_slots[i]` for `i < presentationCursor`.
 *
 * The auto-start-on-mount effect below mirrors `RevealSequenceSurface`'s own
 * `kind === "boss"` behavior exactly (automatic, non-interactive reveal —
 * Pass 1 gameplay correctness) rather than depending on that component.
 */

import { useEffect, useRef } from "react";
import PeakV2ArenaLight from "../PeakV2ArenaLight";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import type { RevealSlot, RevealTrack } from "@/types/run-the-table";
import type { RevealSequenceState } from "@/components/run-the-table/useRevealSequence";

const SLOT_X = ["12%", "31%", "50%", "69%", "88%"];

function slotX(index: number, total: number): string {
  if (total <= SLOT_X.length) {
    // Center the used subset of the fixed five-point spread.
    const start = Math.floor((SLOT_X.length - total) / 2);
    return SLOT_X[start + index] ?? "50%";
  }
  return `${((index + 0.5) / total) * 100}%`;
}

export interface PeakV2RTTBossLineupProps {
  title: string;
  subtitle?: string;
  track: RevealTrack;
  sequence: RevealSequenceState<RevealSlot>;
  reducedMotion: boolean;
  busy: boolean;
  onStartReveal: (count: number) => void;
  onContinue: () => void;
}

export default function PeakV2RTTBossLineup({
  title,
  subtitle,
  track,
  sequence,
  reducedMotion,
  busy,
  onStartReveal,
  onContinue,
}: PeakV2RTTBossLineupProps) {
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (sequence.started || busy || autoStartedRef.current) return;
    autoStartedRef.current = true;
    onStartReveal(track.total);
    sequence.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequence.started, busy]);

  const activeX = sequence.activeIndex !== null ? slotX(sequence.activeIndex, track.order.length) : "50%";

  return (
    <div className="relative">
      <PeakV2ArenaLight x={activeX} y="-6%" animatePosition={!reducedMotion} intensity="focus" />
      <div className="relative py-10 text-center">
        <span
          style={{
            fontFamily: "var(--v2-font-mono)",
            fontSize: "0.6875rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--v2-text-muted)",
          }}
        >
          Boss lineup
        </span>
        <PeakV2ResultHeadline as="h1" scale="moment" className="mt-2">
          {title}
        </PeakV2ResultHeadline>
        {subtitle ? (
          <p className="mt-1" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.875rem", color: "var(--v2-text-secondary)" }}>
            {subtitle}
          </p>
        ) : null}

        <p
          className="mt-6"
          style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}
        >
          Card {Math.min(sequence.presentationCursor + (sequence.activeIndex !== null ? 1 : 0), track.total)} of {track.total}
        </p>

        <div className="mt-4 flex flex-wrap items-start justify-center gap-3">
          {track.order.map((orderSlot, i) => {
            const settled = i < sequence.presentationCursor;
            const active = i === sequence.activeIndex;
            const slot = track.revealed_slots[i] ?? null;
            const identityKnown = settled && slot;
            return (
              <div
                key={orderSlot.slot_id}
                className="flex w-32 flex-col items-center gap-2 rounded-lg border px-3 py-4 transition-colors"
                style={{
                  borderColor: active ? "var(--v2-color-accent)" : settled ? "var(--v2-border)" : "var(--v2-border-subtle)",
                  background: active ? "var(--v2-bg-plane)" : "transparent",
                }}
              >
                <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.625rem", color: "var(--v2-text-muted)" }}>
                  {orderSlot.label ?? orderSlot.slot_id.replace(/_/g, " ")}
                </span>
                {identityKnown ? (
                  <>
                    <span
                      style={{
                        fontFamily: "var(--v2-font-display)",
                        fontStyle: "italic",
                        fontSize: "0.9375rem",
                        color: "var(--v2-text-primary)",
                        lineHeight: 1.2,
                      }}
                    >
                      {slot!.player_name}
                    </span>
                    <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.8125rem", fontWeight: 700, color: "var(--v2-color-accent)" }}>
                      {slot!.prime_score.toFixed(1)}
                    </span>
                  </>
                ) : (
                  // Subtle mechanical resolution placeholder — the "not yet
                  // settled" beats (role/silhouette/…) share this same
                  // dashed glyph rather than a per-beat visual, which is the
                  // restrained reading of "split-flap" this pass ships.
                  <span
                    aria-hidden="true"
                    style={{
                      fontFamily: "var(--v2-font-mono)",
                      fontSize: "0.9375rem",
                      color: active ? "var(--v2-color-accent)" : "var(--v2-text-muted)",
                      opacity: active ? 1 : 0.5,
                    }}
                  >
                    — · —
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {sequence.complete
            ? `${title} fully revealed. ${track.revealed_slots.map((s) => `${s.player_name}, ${s.prime_score.toFixed(1)}`).join(". ")}.`
            : ""}
        </div>

        {sequence.started && !sequence.complete ? (
          <div className="mt-6 flex items-center justify-center gap-2">
            {sequence.paused ? (
              <PeakV2SecondaryAction size="sm" onClick={sequence.resume}>
                Resume
              </PeakV2SecondaryAction>
            ) : (
              <PeakV2SecondaryAction size="sm" onClick={sequence.pause}>
                Pause
              </PeakV2SecondaryAction>
            )}
            <PeakV2SecondaryAction size="sm" onClick={sequence.skipAll}>
              Skip all
            </PeakV2SecondaryAction>
          </div>
        ) : null}

        {sequence.complete ? (
          <div className="mt-8">
            <PeakV2PrimaryAction onClick={onContinue}>Continue to the briefing</PeakV2PrimaryAction>
          </div>
        ) : null}
      </div>
    </div>
  );
}
