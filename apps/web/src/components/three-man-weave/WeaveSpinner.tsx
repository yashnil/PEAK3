"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TmwRoll } from "@/types/three-man-weave";
import { usePrefersReducedMotion } from "@/lib/a11y";
import SpinReel, {
  CEREMONY_MS,
  REDUCED_CEREMONY_MS,
  REEL_LOCK_MS,
  REEL_SPIN_MS,
} from "@/components/shared/SpinReel";

/**
 * The franchise x decade ceremony that opens every round.
 *
 * THE SPINNER NEVER DECIDES ANYTHING, and cannot. The roll arrives from the
 * server already resolved -- it is drawn against the live draft state when the
 * round opens, because feasibility depends on who has been taken and which
 * slots each seat still has -- so this component is handed the answer and
 * animates toward it. `onRevealComplete` is what unlocks the first pick, and
 * it fires from a timer this component owns, never from the animation
 * "finishing" in some way a stalled frame could prevent.
 *
 * THERE IS NOTHING TO REROLL. No client-side respin exists in this mode, and
 * no future roll is anywhere in the payload to preview: the snapshot holds
 * exactly one roll (the current one) plus the ids of those already used.
 *
 * WHAT REPLACED THE STATIC BANNER. The previous surface printed the franchise
 * and decade into a highlighted rectangle and staggered their opacity. It was
 * correct and it was not an event -- and the roll IS the event, because it is
 * the single constraint all three seats are about to draft under. The reels
 * are the 82-0 spinner's own, adapted rather than reimplemented, so the two
 * modes feel like one product.
 *
 * REDUCED MOTION IS AN EQUAL PATH, NOT A DEGRADED ONE. The animation is
 * decoration over a decided result, so removing it removes no information: the
 * same text, the same testids, the same `onRevealComplete`, in 80ms instead of
 * 2.3 seconds. Nothing is gated behind a transition finishing.
 */

/** Decorative reel contents. Franchise names come from the rolls already seen
 * plus the current one, so the wheel only ever ticks through real franchises
 * this match could have produced -- never a padded list of teams that could
 * not have come up. */
const DECADES = ["1980s", "1990s", "2000s", "2010s", "2020s"] as const;

const FRANCHISE_FILLER = [
  "Boston Celtics",
  "Chicago Bulls",
  "Detroit Pistons",
  "Golden State Warriors",
  "Houston Rockets",
  "Los Angeles Lakers",
  "Miami Heat",
  "New York Knicks",
  "Philadelphia 76ers",
  "Phoenix Suns",
  "San Antonio Spurs",
  "Utah Jazz",
];

export default function WeaveSpinner({
  roll,
  roundNumber,
  totalRounds,
  onRevealComplete,
}: {
  roll: TmwRoll | null;
  roundNumber: number | null;
  totalRounds: number;
  /** Fired once the ceremony finishes and picking may begin. */
  onRevealComplete?: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<"spinning" | "locked" | "revealed">(
    "spinning",
  );
  const settledReels = useRef(0);
  const rollId = roll?.roll_id ?? null;

  const franchisePool = useMemo(() => {
    if (!roll) return FRANCHISE_FILLER;
    const seen = new Set([roll.franchise_display_name, ...FRANCHISE_FILLER]);
    return [...seen];
  }, [roll]);

  // Re-armed per roll id, so each round animates exactly once and a re-render
  // (a poll landing, a resize) never replays it.
  useEffect(() => {
    if (!rollId) return;
    settledReels.current = 0;
    setPhase("spinning");
    const total = reduced ? REDUCED_CEREMONY_MS : CEREMONY_MS;
    const lock = window.setTimeout(
      () => setPhase("locked"),
      reduced ? 0 : total - REEL_LOCK_MS,
    );
    const reveal = window.setTimeout(() => {
      setPhase("revealed");
      onRevealComplete?.();
    }, total);
    return () => {
      window.clearTimeout(lock);
      window.clearTimeout(reveal);
    };
    // `onRevealComplete` is deliberately excluded: a parent that re-created the
    // callback would otherwise restart the ceremony mid-spin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollId, reduced]);

  const noteSettled = useCallback(() => {
    settledReels.current += 1;
  }, []);

  if (!roll) {
    return (
      <section
        data-testid="tmw-roll-rolling"
        aria-live="polite"
        className="tmw-spinner tmw-spinner--idle"
      >
        <p className="tmw-spinner-note">Rolling the next franchise and decade…</p>
      </section>
    );
  }

  const revealed = phase === "revealed";

  return (
    <section
      data-testid="tmw-roll"
      data-roll-id={roll.roll_id}
      data-phase={phase}
      data-revealed={revealed ? "true" : "false"}
      data-reduced-motion={reduced ? "true" : "false"}
      aria-labelledby="tmw-roll-heading"
      className="tmw-spinner"
    >
      <p className="tmw-spinner-round">
        Round {roundNumber ?? "—"} of {totalRounds} · everyone drafts from this
      </p>

      <h2 id="tmw-roll-heading" className="tmw-spinner-reels">
        <span className="tmw-reel" data-reel="franchise">
          <span className="tmw-reel-label">Franchise</span>
          <SpinReel
            pool={franchisePool}
            target={roll.franchise_display_name}
            spinMs={REEL_SPIN_MS.primary}
            runKey={`${roll.roll_id}-franchise`}
            reduced={reduced}
            testId="tmw-roll-franchise"
            onSettled={noteSettled}
          />
        </span>
        <span className="tmw-spinner-x" aria-hidden="true">
          ×
        </span>
        <span className="tmw-reel" data-reel="decade">
          <span className="tmw-reel-label">Decade</span>
          <SpinReel
            pool={DECADES}
            target={roll.decade}
            spinMs={REEL_SPIN_MS.secondary}
            runKey={`${roll.roll_id}-decade`}
            reduced={reduced}
            testId="tmw-roll-decade"
            onSettled={noteSettled}
          />
        </span>
      </h2>

      {/* ONE announcement for the pair, not two fragments. Rendered only once
          the ceremony has landed, so a screen reader is told the answer rather
          than narrated at while a wheel turns. */}
      <p
        role="status"
        aria-live="polite"
        className="tmw-spinner-result"
        data-testid="tmw-roll-result"
      >
        {revealed
          ? `${roll.franchise_display_name}, ${roll.decade}. ${roll.candidates.length} eligible ${
              roll.candidates.length === 1 ? "player" : "players"
            } undrafted.`
          : ""}
      </p>

      <p className="tmw-spinner-note" aria-hidden={!revealed}>
        {revealed
          ? `${roll.candidates.length} eligible ${
              roll.candidates.length === 1 ? "player" : "players"
            } still undrafted`
          : "Rolling…"}
      </p>
    </section>
  );
}
