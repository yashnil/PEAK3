"use client";
import { useEffect, useState } from "react";
import type { TmwRoll } from "@/types/three-man-weave";
import { usePrefersReducedMotion } from "@/lib/a11y";
import { MOTION_DURATION_MS, cssTransition } from "@/lib/motion";

/**
 * The shared franchise x decade reveal — the moment all three seats see the
 * same constraint at the same time.
 *
 * REDUCED MOTION IS AN EQUAL PATH, NOT A DEGRADED ONE. The animation here is
 * decoration over a result the server already decided; removing it removes no
 * information, so with `prefers-reduced-motion` the roll simply appears,
 * fully legible, with the same text and the same testids. Nothing is gated
 * behind a transition finishing — a player who never sees the animation is
 * never waiting on it.
 *
 * The two halves are staggered (franchise, then decade) because the pair is
 * the constraint and reading it as one unit matters more than reading either
 * half early. Both land well inside a turn.
 */
export default function RollReveal({
  roll,
  roundNumber,
  totalRounds,
}: {
  roll: TmwRoll | null;
  roundNumber: number | null;
  totalRounds: number;
}) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState<string | null>(null);

  const rollId = roll?.roll_id ?? null;
  useEffect(() => {
    if (!rollId) return;
    if (reduced) {
      setShown(rollId);
      return;
    }
    // Re-armed per roll id, so each new round animates once and a re-render
    // (a poll, a resize) never replays it.
    setShown(null);
    const timer = window.setTimeout(() => setShown(rollId), MOTION_DURATION_MS.fast);
    return () => window.clearTimeout(timer);
  }, [rollId, reduced]);

  if (!roll) {
    return (
      <section
        data-testid="tmw-roll-rolling"
        aria-live="polite"
        className="rounded-lg border px-4 py-6 text-center"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)" }}
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Rolling the next franchise and decade…
        </p>
      </section>
    );
  }

  const revealed = shown === roll.roll_id;

  return (
    <section
      data-testid="tmw-roll"
      data-roll-id={roll.roll_id}
      data-revealed={revealed ? "true" : "false"}
      aria-labelledby="tmw-roll-heading"
      className="rounded-lg border px-4 py-5 text-center"
      style={{
        borderColor: "var(--peak-accent)",
        background: "var(--peak-accent-bg)",
      }}
    >
      <p
        className="text-[10px] font-bold uppercase tracking-widest"
        style={{ color: "var(--text-muted)" }}
      >
        Round {roundNumber ?? "—"} of {totalRounds} · everyone drafts from this
      </p>

      {/* aria-live on the wrapper, not on each half, so a screen reader hears
          the pair as one announcement rather than two fragments. */}
      <h2
        id="tmw-roll-heading"
        aria-live="polite"
        className="mt-2 flex flex-col items-center gap-0.5 sm:flex-row sm:justify-center sm:gap-3"
      >
        <span
          data-testid="tmw-roll-franchise"
          className="text-xl font-bold sm:text-2xl"
          style={{
            color: "var(--text-primary)",
            opacity: revealed ? 1 : 0,
            transform: revealed ? "none" : "translateY(6px)",
            transition: cssTransition("opacity, transform", "reveal", "out", reduced),
          }}
        >
          {roll.franchise_display_name}
        </span>
        <span
          data-testid="tmw-roll-decade"
          className="text-xl font-bold sm:text-2xl"
          style={{
            color: "var(--peak-accent-text)",
            opacity: revealed ? 1 : 0,
            transform: revealed ? "none" : "translateY(6px)",
            transition: cssTransition(
              "opacity, transform",
              "reveal",
              "out",
              reduced,
            ),
            transitionDelay: reduced ? "0ms" : `${MOTION_DURATION_MS.fast}ms`,
          }}
        >
          {roll.decade}
        </span>
      </h2>

      <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
        {roll.candidates.length} eligible {roll.candidates.length === 1 ? "player" : "players"}{" "}
        still undrafted
      </p>
    </section>
  );
}
