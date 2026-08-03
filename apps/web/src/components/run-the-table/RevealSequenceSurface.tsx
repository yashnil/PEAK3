"use client";
import { useEffect, useRef, useState } from "react";
import { RevealSlot, RevealTrack, RunCardPublic } from "@/types/run-the-table";
import { RTT_COPY } from "@/lib/run-the-table-copy";
import RevealCard from "./RevealCard";
import { RevealSequenceState } from "./useRevealSequence";

/**
 * The shared reveal surface — one user action, then an automatic, paced
 * reveal of every slot, used identically for the opening roster and the boss
 * lineup (PRODUCT_EXPERIENCE_CONTRACT.md §2/§3, SYNTHESIS_CONTRACT.md §4).
 * This is the ONE component both call; `RevealCard` + `useRevealSequence` are
 * the "shared component/hook usage" Phase 5 verifies against, not a visual
 * resemblance between two separate implementations.
 *
 * THE LEAK FIX, BY CONSTRUCTION: before the single "Reveal" press, `track`'s
 * `revealed_slots` is empty and `useRevealSequence` has nothing to show, so
 * nothing renders here — and every slot renders through `RevealCard`, which
 * NEVER prints a name/window/score for a slot whose `status` isn't `settled`
 * or actively past the `identity` beat. This surface never reads
 * `state.starters`/`state.bench` for identity; `cardLookup` (passed in) is
 * used ONLY for lane percentiles on an already-settled slot — see
 * `RevealCard`'s module docstring.
 *
 * `sequence` is owned by the CALLER (`useRevealSequence`, lifted up to
 * `RunTheTableGame`) rather than by this component, specifically so the
 * roster reveal's presentation cursor can also be handed to `RunTray`'s
 * roster dock — the same cursor value drives both "how far the reveal stage
 * has animated" and "what the persistent rail is allowed to show as filled",
 * which is what makes the leak-by-construction fix a single source of truth
 * rather than two components independently guessing the same number.
 */
interface Props {
  track: RevealTrack;
  sequence: RevealSequenceState<RevealSlot>;
  kind: "roster" | "boss";
  title: string;
  subtitle?: string;
  sourceNote: string;
  /** The one-line label for each order position — `RevealSlotOrder.label` or
   *  a de-slugged `slot_id` fallback. */
  orderLabelFor: (slotId: string, label?: string) => string;
  /** Looked up BY `card_id` (never by slot position — the boss's `starters`/
   *  `bench` arrays carry no `slot_id`) for a slot the presentation cursor
   *  has already authorized. See `RevealCard`'s data-gap docstring. Never
   *  called for a concealed slot. */
  cardLookup: (cardId: string) => RunCardPublic | null;
  reducedMotion: boolean;
  busy: boolean;
  /** Fires the batched `reveal(target, track.total)` POST. Does not itself
   *  begin the local animation — see the "Reveal" button below. */
  onStartReveal: (count: number) => void;
  /** Once, when every slot has settled. */
  onComplete?: () => void;
  /** Rendered once the sequence is complete, e.g. a "Continue" control. */
  footer?: React.ReactNode;
}

export default function RevealSequenceSurface({
  track,
  sequence,
  kind,
  title,
  subtitle,
  sourceNote,
  orderLabelFor,
  cardLookup,
  reducedMotion,
  busy,
  onStartReveal,
  onComplete,
  footer,
}: Props) {
  const completedRef = useRef(false);
  useEffect(() => {
    if (sequence.complete && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
  }, [sequence.complete, onComplete]);

  // The complete, final roster — mounted empty, filled one frame after the
  // sequence finishes, the same "mutation of an already-mounted region"
  // pattern `BattleReveal.tsx` already uses for its verdict announcement.
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (!sequence.complete) return;
    const names = track.revealed_slots.map((s) => `${s.player_name}, ${s.prime_score.toFixed(1)}`);
    const id = requestAnimationFrame(() =>
      setAnnouncement(`${title} fully revealed. ${names.join(". ")}.`),
    );
    return () => cancelAnimationFrame(id);
  }, [sequence.complete, track.revealed_slots, title]);

  const handleReveal = () => {
    onStartReveal(track.total);
    sequence.start();
  };

  return (
    <section
      data-testid={kind === "roster" ? "rtt-opening-reveal" : "rtt-boss-reveal"}
      data-reveal-complete={sequence.complete ? "true" : "false"}
      className="rtt-decision-surface flex flex-col gap-3"
    >
      <header className="flex flex-col gap-1">
        <span className="rtt-node-kind">{kind === "roster" ? "Opening roster" : "Boss lineup"}</span>
        <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {subtitle}
          </p>
        )}
        <p className="rtt-node-consequence" data-testid={`rtt-reveal-source-${kind}`}>
          {sourceNote}
        </p>
      </header>

      <div role="status" aria-live="polite" className="sr-only" data-testid={`rtt-reveal-live-${kind}`}>
        {announcement}
      </div>

      {!sequence.started ? (
        // Nothing before this press shows any slot content anywhere on
        // screen — spec §2's hard requirement. This cover IS the whole
        // surface until the one action is taken.
        <button
          type="button"
          data-testid={`rtt-reveal-start-${kind}`}
          onClick={handleReveal}
          disabled={busy}
          className="rtt-tap self-start rounded-lg px-6 text-sm font-bold uppercase tracking-wide disabled:opacity-60"
          style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
        >
          {busy ? "Working…" : kind === "roster" ? "Reveal your roster" : "Reveal the lineup"}
        </button>
      ) : (
        <>
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            data-testid={`rtt-reveal-progress-${kind}`}
            style={{ color: "var(--text-muted)" }}
          >
            {sequence.presentationCursor} of {track.total} revealed
          </p>

          <ol className="flex flex-col gap-1.5" data-testid={`rtt-reveal-list-${kind}`}>
            {track.order.map((orderSlot, i) => {
              const settled = i < sequence.presentationCursor;
              const active = i === sequence.activeIndex && sequence.activeBeat;
              const status = settled
                ? ("settled" as const)
                : active
                  ? { beat: sequence.activeBeat! }
                  : ("concealed" as const);
              const revealedSlot = track.revealed_slots[i] ?? null;
              return (
                <RevealCard
                  key={orderSlot.slot_id}
                  orderLabel={orderLabelFor(orderSlot.slot_id, orderSlot.label)}
                  role={revealedSlot?.role}
                  slot={revealedSlot}
                  lanePercentiles={
                    settled && revealedSlot ? (cardLookup(revealedSlot.card_id)?.lane_percentiles ?? null) : null
                  }
                  status={status}
                  reducedMotion={reducedMotion}
                />
              );
            })}
          </ol>

          {!sequence.complete && (
            <div className="flex flex-wrap items-center gap-2">
              {sequence.paused ? (
                <button
                  type="button"
                  data-testid={`rtt-reveal-resume-${kind}`}
                  onClick={sequence.resume}
                  className="rtt-tap rounded-lg px-4 text-xs font-semibold uppercase tracking-wide"
                  style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
                >
                  Resume
                </button>
              ) : (
                <button
                  type="button"
                  data-testid={`rtt-reveal-pause-${kind}`}
                  onClick={sequence.pause}
                  className="rtt-tap rounded-lg px-4 text-xs font-semibold uppercase tracking-wide"
                  style={{
                    background: "var(--bg-surface)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-default)",
                  }}
                >
                  Pause
                </button>
              )}
              <button
                type="button"
                data-testid={`rtt-reveal-skip-${kind}`}
                onClick={sequence.skipAll}
                className="rtt-tap rounded-lg px-4 text-xs font-semibold uppercase tracking-wide"
                style={{
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-emphasis)",
                }}
              >
                Skip all
              </button>
            </div>
          )}

          {sequence.complete && footer}
        </>
      )}
    </section>
  );
}

/** `RTT_COPY`'s reveal-source sentences, by kind — kept here so both call
 *  sites (roster, boss) construct the same strings the same way. */
export function revealSourceFor(kind: "roster" | "boss"): string {
  return kind === "roster" ? RTT_COPY.revealSource : RTT_COPY.bossRevealSource;
}
