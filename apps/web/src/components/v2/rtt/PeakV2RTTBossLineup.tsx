"use client";

/**
 * PeakV2RTTBossLineup — the RTT reveal-sequence cinematic (Pass 3), shared
 * between the boss lineup AND the opening roster reveal (Pass 3 polish —
 * `kind="roster"`): "players enter sequentially, arena light follows
 * current entrant, subtle split-flap identity resolution, lineup settles"
 * (brief).
 *
 * ROSTER SUPPORT (this polish pass). The opening roster reveal previously had
 * no V2 surface at all — `RunTheTableGame`'s `v2Content` if/else chain never
 * checked `showRosterReveal`, so it fell through to the generic `surface`
 * fallback, which is legacy's own `RevealSequenceSurface` (hardcoded
 * `--peak-accent`/`--text-primary` tokens, `rtt-node-kind`/`rtt-decision-
 * surface` classes, no V2 typography grammar at all). That meant every run
 * under `?ui=v2` opened on a fully legacy-styled screen before a single V2
 * pixel had rendered. `kind="roster"` below is the fix: the identical
 * card-grid/arena-light presentation this component already built for the
 * boss, with the one behavioural difference the legacy component also draws
 * — roster reveal requires an explicit "Reveal your roster" press (never
 * auto-starts, unlike the boss).
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
 * Pass 1 gameplay correctness) rather than depending on that component. The
 * roster path is deliberately untouched by that effect — same as legacy.
 */

import { useEffect, useRef } from "react";
import PeakV2ArenaLight from "../PeakV2ArenaLight";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import type { RevealSlot, RevealTrack, Role, RunCardPublic } from "@/types/run-the-table";
import type { RevealSequenceState } from "@/components/run-the-table/useRevealSequence";
import { slotLabel } from "@/lib/run-the-table-state";

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
  /** `"boss"` (default, unchanged callers) auto-starts and never gates on a
   *  press. `"roster"` requires the explicit "Reveal your roster" press —
   *  the one intentional manual beat the opening reveal keeps, mirroring
   *  legacy `RevealSequenceSurface`. */
  kind?: "boss" | "roster";
  title: string;
  subtitle?: string;
  /** `RTT_COPY.revealSource`/`.bossRevealSource` via `revealSourceFor(kind)`
   *  — where this data comes from, stated once, same source legacy reads. */
  sourceNote?: string;
  track: RevealTrack;
  sequence: RevealSequenceState<RevealSlot>;
  reducedMotion: boolean;
  busy: boolean;
  onStartReveal: (count: number) => void;
  onContinue: () => void;
  /** `kind="boss"` only — the player's own already-known card in this same
   *  seat, same `pairedCardLookup` legacy `RevealSequenceSurface` reads, so
   *  the comparison reads the instant the boss card lands rather than
   *  screens later (see `RevealCard.tsx`'s own comment). */
  pairedCardLookup?: (slotId: string) => RunCardPublic | null;
}

export default function PeakV2RTTBossLineup({
  kind = "boss",
  title,
  subtitle,
  sourceNote,
  track,
  sequence,
  reducedMotion,
  busy,
  onStartReveal,
  onContinue,
  pairedCardLookup,
}: PeakV2RTTBossLineupProps) {
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (kind !== "boss") return;
    if (sequence.started || busy || autoStartedRef.current) return;
    autoStartedRef.current = true;
    onStartReveal(track.total);
    sequence.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, sequence.started, busy]);

  const activeX = sequence.activeIndex !== null ? slotX(sequence.activeIndex, track.order.length) : "50%";
  const testId = kind === "roster" ? "rtt-opening-reveal" : "rtt-boss-reveal";

  const handleManualStart = () => {
    onStartReveal(track.total);
    sequence.start();
  };

  return (
    <div
      className="relative"
      data-testid={testId}
      data-reveal-complete={sequence.complete ? "true" : "false"}
    >
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
          {kind === "roster" ? "Opening roster" : "Boss lineup"}
        </span>
        <PeakV2ResultHeadline as="h1" scale="moment" className="mt-2">
          {title}
        </PeakV2ResultHeadline>
        {subtitle ? (
          <p className="mt-1" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.875rem", color: "var(--v2-text-secondary)" }}>
            {subtitle}
          </p>
        ) : null}
        {sourceNote ? (
          <p
            data-testid={`rtt-reveal-source-${kind}`}
            className="mt-1"
            style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}
          >
            {sourceNote}
          </p>
        ) : null}

        {kind === "roster" && !sequence.started ? (
          // The one manual beat this surface keeps: nothing is turned over
          // until the player asks (same contract as legacy's cover button).
          <div className="mt-8">
            <PeakV2PrimaryAction
              data-testid={`rtt-reveal-start-${kind}`}
              onClick={handleManualStart}
              busy={busy}
            >
              {busy ? "Working…" : "Reveal your roster"}
            </PeakV2PrimaryAction>
          </div>
        ) : (
          <>
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
                    data-testid="rtt-reveal-card"
                    data-reveal-status={settled ? "settled" : active ? "active" : "concealed"}
                    className="flex w-32 flex-col items-center gap-2 rounded-lg border px-3 py-4 transition-colors"
                    style={{
                      borderColor: active ? "var(--v2-color-accent)" : settled ? "var(--v2-border)" : "var(--v2-border-subtle)",
                      background: active ? "var(--v2-bg-plane)" : "transparent",
                    }}
                  >
                    <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.625rem", color: "var(--v2-text-muted)" }}>
                      {/* The boss reveal never sends `label` (only the opening-
                          roster reveal does — see RevealSlot's own docstring),
                          so this always hit the raw-lowercase fallback for a
                          boss's cards ("lead creator") while the identical
                          slot rendered "Lead Creator" on the user's own
                          roster. `slot_id` doubles as the role id for starter
                          slots (confirmed against ROLE_LABELS' own keys) and
                          as "bench_N" for bench slots — both are exactly what
                          `slotLabel` already formats correctly. */}
                      {orderSlot.label ??
                        slotLabel({ slot_id: orderSlot.slot_id, role: orderSlot.slot_id as Role, is_starter: !orderSlot.slot_id.startsWith("bench_") })}
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
                        {/* The paired half — your already-known card in this
                            same seat, placed beside the boss card so the
                            comparison reads the instant it lands rather than
                            screens later. Static, same as legacy's. */}
                        {(() => {
                          const paired = pairedCardLookup?.(orderSlot.slot_id) ?? null;
                          if (!paired) return null;
                          return (
                            <span
                              data-testid="rtt-reveal-paired-card"
                              className="mt-1 flex flex-col items-center gap-0.5"
                              style={{ borderTop: "1px solid var(--v2-border-subtle)", paddingTop: "0.375rem" }}
                            >
                              <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", fontWeight: 600, color: "var(--v2-text-secondary)" }}>
                                {paired.player_name}
                              </span>
                              <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>
                                {paired.prime_score.toFixed(1)}
                              </span>
                            </span>
                          );
                        })()}
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
                  <PeakV2SecondaryAction data-testid={`rtt-reveal-resume-${kind}`} size="sm" onClick={sequence.resume}>
                    Resume
                  </PeakV2SecondaryAction>
                ) : (
                  <PeakV2SecondaryAction data-testid={`rtt-reveal-pause-${kind}`} size="sm" onClick={sequence.pause}>
                    Pause
                  </PeakV2SecondaryAction>
                )}
                <PeakV2SecondaryAction data-testid={`rtt-reveal-skip-${kind}`} size="sm" onClick={sequence.skipAll}>
                  Skip all
                </PeakV2SecondaryAction>
              </div>
            ) : null}

            {sequence.complete ? (
              <div className="mt-8">
                <PeakV2PrimaryAction data-testid={`rtt-reveal-continue-${kind}`} onClick={onContinue}>
                  {kind === "roster" ? "Continue" : "Continue to the briefing"}
                </PeakV2PrimaryAction>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
