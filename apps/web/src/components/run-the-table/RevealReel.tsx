"use client";
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";
import { motionTransition } from "@/lib/motion";
import { RTT_COPY } from "@/lib/run-the-table-copy";
import { skipAllCount } from "@/lib/run-the-table-state";
import type { RevealSlot, RevealTrack } from "@/types/run-the-table";

/**
 * The slot-by-slot reveal (spec §3), used for BOTH the opening roster and each
 * boss lineup — one component, because the payload gives both the identical
 * `RevealTrack` shape.
 *
 * WHAT MAKES THIS HONEST RATHER THAN THEATRE:
 *
 * * **No client RNG anywhere.** `track.next_slot` is the card the SERVER has
 *   already decided on. The reel animates to it; it never picks it. Same seed,
 *   same roster, same order — which is what a daily board and a challenge link
 *   are built on, and it is asserted end to end in
 *   `apps/api/tests/test_run_the_table.py`.
 * * **Progress is run state, not browser state.** Every press is a `reveal`
 *   action, so a refresh mid-reveal resumes at the same card instead of
 *   restarting. `track.revealed` is the server's count.
 * * **Reduced motion reveals instantly.** `usePrefersReducedMotion` turns the
 *   enter transition off entirely — the card is finished on first paint rather
 *   than playing a shortened version of the same animation.
 * * **Skip-all after the first reveal.** `track.can_skip` is the server's
 *   answer (`0 < revealed < total`), so the affordance appears exactly when the
 *   player has seen what a reveal is and there is still something to skip. It
 *   is ONE call: `count` saturates server-side.
 * * **It is labelled.** A card-by-card reel reads like something being decided
 *   as you watch, so both surfaces say outright that it was fixed before the
 *   run started.
 */
interface Props {
  track: RevealTrack;
  /** Distinguishes the two surfaces for testids, headings and the source line. */
  kind: "roster" | "boss";
  title: string;
  subtitle?: string;
  /** The engine's own note about where this lineup came from, if any. */
  sourceNote?: string;
  busy: boolean;
  onReveal: (count: number) => void;
  /** Rendered under the reel once the reveal is complete — the "carry on"
   *  control belongs to the caller, which knows what comes next. */
  footer?: React.ReactNode;
}

export default function RevealReel({
  track,
  kind,
  title,
  subtitle,
  sourceNote,
  busy,
  onReveal,
  footer,
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const remaining = track.total - track.revealed;

  return (
    <section
      data-testid={kind === "roster" ? "rtt-opening-reveal" : "rtt-boss-reveal"}
      data-reveal-complete={track.complete ? "true" : "false"}
      className="rtt-decision-surface flex flex-col gap-3"
      style={{ "--rtt-node-accent": "var(--peak-accent)" } as CSSProperties}
    >
      <header className="flex flex-col gap-1">
        <span className="rtt-node-kind">
          {kind === "roster" ? "Opening roster" : "Boss lineup"}
        </span>
        <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {subtitle}
          </p>
        )}
        {/* Not decoration. See the component docstring. */}
        <p className="rtt-node-consequence" data-testid={`rtt-reveal-source-${kind}`}>
          {sourceNote ?? (kind === "roster" ? RTT_COPY.revealSource : RTT_COPY.bossRevealSource)}
        </p>
      </header>

      <p
        className="text-xs font-semibold uppercase tracking-wide"
        data-testid={`rtt-reveal-progress-${kind}`}
        style={{ color: "var(--text-muted)" }}
      >
        {track.revealed} of {track.total} revealed
      </p>

      <ol className="flex flex-col gap-1.5" data-testid={`rtt-reveal-list-${kind}`}>
        {track.order.map((slot, index) => {
          const revealedSlot: RevealSlot | undefined = track.revealed_slots[index];
          const isNext = !revealedSlot && index === track.revealed;
          return (
            <li key={slot.slot_id}>
              <motion.div
                /* Keyed on whether this row has turned over, so the enter
                   transition plays once, on the card that just landed. Under
                   reduced motion `initial={false}` skips it entirely and the
                   row is finished on first paint. */
                key={revealedSlot ? `${slot.slot_id}-open` : `${slot.slot_id}-closed`}
                initial={
                  reducedMotion || !revealedSlot
                    ? false
                    : { opacity: 0, transform: "translateY(6px)" }
                }
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                transition={motionTransition("base", "out", reducedMotion)}
                data-testid={`rtt-reveal-slot-${slot.slot_id}`}
                data-revealed={revealedSlot ? "true" : "false"}
                className="flex items-center gap-2 rounded-lg border px-3 py-2"
                style={{
                  background: revealedSlot ? "var(--bg-surface)" : "var(--bg-elevated)",
                  borderColor: isNext ? "var(--peak-accent)" : "var(--border-subtle)",
                }}
              >
                <span
                  className="shrink-0 text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: "var(--text-muted)", minWidth: "5.5rem" }}
                >
                  {slot.label ?? slot.slot_id.replace(/_/g, " ")}
                </span>
                {revealedSlot ? (
                  <span className="flex min-w-0 flex-col">
                    <span
                      className="truncate text-sm font-bold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {revealedSlot.player_name}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {revealedSlot.window ?? revealedSlot.anchor_season} ·{" "}
                      <span className="score-number">
                        {revealedSlot.prime_score.toFixed(1)}
                      </span>
                    </span>
                  </span>
                ) : (
                  <span
                    className="text-sm font-semibold"
                    style={{ color: "var(--text-muted)" }}
                    aria-label="Not revealed yet"
                  >
                    —
                  </span>
                )}
              </motion.div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        {!track.complete && (
          <button
            type="button"
            data-testid={`rtt-reveal-next-${kind}`}
            onClick={() => onReveal(1)}
            disabled={busy}
            className="rtt-tap rounded-lg px-5 text-sm font-bold uppercase tracking-wide disabled:opacity-60"
            style={{ background: "var(--peak-accent)", color: "#000" }}
          >
            {kind === "roster" ? "Reveal next player" : "Reveal next"}
          </button>
        )}
        {/* `can_skip` is the SERVER's rule: after the first card, and only while
            something is left. Never re-derived here. */}
        {track.can_skip && (
          <button
            type="button"
            data-testid={`rtt-reveal-skip-${kind}`}
            onClick={() => onReveal(skipAllCount(track))}
            disabled={busy}
            className="rtt-tap rounded-lg px-4 text-xs font-semibold uppercase tracking-wide disabled:opacity-60"
            style={{
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-emphasis)",
            }}
          >
            Skip all ({remaining})
          </button>
        )}
        {footer}
      </div>
    </section>
  );
}
