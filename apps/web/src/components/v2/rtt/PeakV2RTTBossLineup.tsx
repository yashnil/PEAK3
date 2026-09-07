"use client";

/**
 * PeakV2RTTBossLineup — the reveal deal: the opening roster, or a boss
 * lineup paired against yours, dealt slot by slot.
 *
 * Consumes the SAME `track`/`sequence` `RunTheTableGame` computes
 * (`useRevealSequence`, `RevealTrack`); a slot whose beat has not reached
 * `identity` shows a resolving placeholder rather than a name, preserved by
 * only reading `track.revealed_slots[i]` for `i < presentationCursor`.
 *
 * THERE IS NO SKIP (final polish pass). The deal is the moment; every card
 * lands on its own beat and the only control is the one that moves on once
 * the last card has settled. Pause stays for anyone who needs the time.
 * Reduced motion shows the settled deal at once.
 *
 * `kind="boss"` auto-starts with zero clicks (the encounter is already on),
 * shows each boss card ABOVE your own card in the same seat so the matchup
 * reads the instant it lands, and continues to the matchup board.
 * `kind="roster"` is the first thing a new run shows: the four-line brief
 * and one press ("Reveal your roster") — the whole tutorial a first session
 * needs before it starts playing.
 */

import { useEffect, useRef } from "react";
import PeakV2ArenaLight from "../PeakV2ArenaLight";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import type { RevealSlot, RevealTrack, Role, RunCardPublic } from "@/types/run-the-table";
import type { RevealSequenceState } from "@/components/run-the-table/useRevealSequence";
import { slotLabel } from "@/lib/run-the-table-state";
import ScoreTransition from "@/components/game-feel/ScoreTransition";

const SLOT_X = ["12%", "31%", "50%", "69%", "88%"];

function slotX(index: number, total: number): string {
  if (total <= SLOT_X.length) {
    const start = Math.floor((SLOT_X.length - total) / 2);
    return SLOT_X[start + index] ?? "50%";
  }
  return `${((index + 0.5) / total) * 100}%`;
}

export interface PeakV2RTTBossLineupProps {
  kind?: "boss" | "roster";
  title: string;
  subtitle?: string;
  sourceNote?: string;
  track: RevealTrack;
  sequence: RevealSequenceState<RevealSlot>;
  reducedMotion: boolean;
  busy: boolean;
  onStartReveal: (count: number) => void;
  onContinue: () => void;
  pairedCardLookup?: (slotId: string) => RunCardPublic | null;
  /** Roster only: the run's shape for the four-line brief. */
  brief?: { lives?: number | null; credits?: number | null; acts?: number | null };
}

export default function PeakV2RTTBossLineup({ kind = "boss", title, subtitle, sourceNote, track, sequence, reducedMotion, busy, onStartReveal, onContinue, pairedCardLookup, brief }: PeakV2RTTBossLineupProps) {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

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
  const cover = kind === "roster" && !sequence.started;

  const handleManualStart = () => {
    onStartReveal(track.total);
    sequence.start();
  };

  return (
    <div className="rtt-reveal" data-kind={kind} data-testid={testId} data-reveal-complete={sequence.complete ? "true" : "false"} data-cover={cover ? "true" : "false"}>
      <PeakV2ArenaLight x={activeX} y="-6%" animatePosition={!reducedMotion} intensity="focus" />
      <div className="rtt-reveal-body">
        {cover ? (
          <div className="rtt-brief">
            <span className="rtt-eyebrow">Run the Table</span>
            <ol className="rtt-brief-lines">
              <li>Build your roster.</li>
              <li>Survive the run.</li>
              <li>Spend credits carefully.</li>
              <li>{brief?.lives ? `${brief.lives} lives.` : "Lives are limited."}</li>
            </ol>
            <p className="rtt-brief-sub">
              {brief?.acts ? `${brief.acts} acts, a boss at the end of each. ` : ""}
              Your seven are dealt now — the rest is up to you.
            </p>
            <PeakV2PrimaryAction data-testid="rtt-reveal-start-roster" onClick={handleManualStart} busy={busy} className="rtt-brief-action">
              {busy ? "Dealing…" : "Reveal your roster"}
            </PeakV2PrimaryAction>
            {sourceNote ? (
              <p className="rtt-fineprint" data-testid="rtt-reveal-source-roster">
                {sourceNote}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <span className="rtt-eyebrow">{kind === "roster" ? "Opening roster" : "Boss lineup"}</span>
            <h1 className="rtt-reveal-title">{title}</h1>
            {subtitle ? <p className="rtt-reveal-sub">{subtitle}</p> : null}
            {sourceNote ? (
              <p className="rtt-fineprint" data-testid={`rtt-reveal-source-${kind}`}>
                {sourceNote}
              </p>
            ) : null}
            <p className="rtt-reveal-count">
              Card {Math.min(sequence.presentationCursor + (sequence.activeIndex !== null ? 1 : 0), track.total)} of {track.total}
            </p>

            <ul className="rtt-reveal-cards" data-count={track.order.length}>
              {track.order.map((orderSlot, i) => {
                const settled = i < sequence.presentationCursor;
                const active = i === sequence.activeIndex;
                const slot = track.revealed_slots[i] ?? null;
                const identityKnown = settled && slot;
                const paired = identityKnown ? (pairedCardLookup?.(orderSlot.slot_id) ?? null) : null;
                const label = orderSlot.label ?? slotLabel({ slot_id: orderSlot.slot_id, role: orderSlot.slot_id as Role, is_starter: !orderSlot.slot_id.startsWith("bench_") });
                return (
                  <li key={orderSlot.slot_id} className="rtt-reveal-seat" data-testid="rtt-reveal-card" data-reveal-status={settled ? "settled" : active ? "active" : "concealed"}>
                    <span className="rtt-reveal-slot">{label}</span>
                    <span className="rtt-reveal-face" data-side={kind === "boss" ? "boss" : "you"}>
                      {identityKnown ? (
                        <>
                          <span className="rtt-reveal-name">{slot!.player_name}</span>
                          <span className="rtt-reveal-window">{slot!.anchor_season}</span>
                          <span className="rtt-reveal-score">
                            <ScoreTransition value={slot!.prime_score} from={reducedMotion ? undefined : 0} durationMs={520} format={(n) => n.toFixed(1)} />
                          </span>
                        </>
                      ) : (
                        <span className="rtt-reveal-placeholder" aria-hidden="true">
                          — · —
                        </span>
                      )}
                    </span>
                    {kind === "boss" ? (
                      <>
                        <span className="rtt-reveal-vs" aria-hidden="true">
                          vs
                        </span>
                        <span className="rtt-reveal-face" data-side="you" data-testid={paired ? "rtt-reveal-paired-card" : undefined}>
                          {paired ? (
                            <>
                              <span className="rtt-reveal-name">{paired.player_name}</span>
                              <span className="rtt-reveal-score">{paired.prime_score.toFixed(1)}</span>
                            </>
                          ) : (
                            <span className="rtt-reveal-placeholder" aria-hidden="true">
                              you
                            </span>
                          )}
                        </span>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <div role="status" aria-live="polite" className="sr-only">
              {sequence.complete ? `${title} fully revealed. ${track.revealed_slots.map((s) => `${s.player_name}, ${s.prime_score.toFixed(1)}`).join(". ")}.` : ""}
            </div>

            <div className="rtt-reveal-controls">
              {sequence.started && !sequence.complete ? (
                <>
                  {sequence.paused ? (
                    <PeakV2SecondaryAction data-testid={`rtt-reveal-resume-${kind}`} size="sm" onClick={sequence.resume}>
                      Resume
                    </PeakV2SecondaryAction>
                  ) : (
                    <PeakV2SecondaryAction data-testid={`rtt-reveal-pause-${kind}`} size="sm" onClick={sequence.pause}>
                      Pause
                    </PeakV2SecondaryAction>
                  )}
                </>
              ) : null}
              {sequence.complete ? (
                <PeakV2PrimaryAction data-testid={`rtt-reveal-continue-${kind}`} onClick={onContinue}>
                  {kind === "roster" ? "Start the run" : "To the matchup"}
                </PeakV2PrimaryAction>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

