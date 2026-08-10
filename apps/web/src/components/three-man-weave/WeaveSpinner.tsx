"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArenaSeatPublic, TmwRoll } from "@/types/three-man-weave";
import { usePrefersReducedMotion } from "@/lib/a11y";
import { seatAccent } from "@/lib/three-man-weave-state";
import SpinReel, { REEL_SPIN_MS } from "@/components/shared/SpinReel";

/**
 * THE ROUND-OPENING CEREMONY: a full-focus reveal over the dimmed board.
 *
 * WHAT IT IS. Every round opens with the franchise × decade reel. Round 1 opens
 * with the match itself first -- the title, the three competitors with the human
 * marked, and the objective in one line -- so the sequence from Arena is matchup
 * -> anticipation -> play (TMW-06 and TMW-13, which are one animation and not
 * two).
 *
 * ========================================================================
 * THE CEREMONY IS A SERVER TURN NOW, AND THIS COMPONENT ONLY DRAWS IT
 * ========================================================================
 * WHAT IT USED TO BE. This component owned a `setTimeout` for a ~2270ms reel
 * plus its holds, and the room gated the pick overlay on the callback that timer
 * fired. The server had already stamped the 45-second decision deadline when the
 * turn OPENED, so on the first pick of every round the player lost the whole
 * ceremony -- plus up to one 2000ms poll -- off a clock that was visibly
 * counting down behind an overlay that would not open. The first repair simply
 * refused to mount the ceremony on rounds the human led, which removed the race
 * by removing the product requirement.
 *
 * WHAT IT IS NOW. The mode opens a real turn in `phase="reveal"`: it belongs to
 * no seat, accepts no command, and carries its own `deadline_at`. When it
 * expires the server opens the pick turn with a FULL `TURN_SECONDS`. So:
 *
 *   * THE CEREMONY'S LENGTH IS THE SERVER'S, not this file's. Every stage
 *     boundary below is a FRACTION of the window the server published, so the
 *     reel cannot outlast the phase and the phase cannot end mid-spin.
 *   * IT PLAYS ON EVERY ROUND FOR EVERY SEAT, including round 1 and including
 *     rounds the human leads, because it no longer costs them anything.
 *   * A RELOAD MID-CEREMONY RESUMES IT. `deadlineAt` is the server's remaining
 *     duration converted at the instant the response landed, so elapsed time is
 *     `window - remaining` -- a fact about the match, not about this mount. The
 *     ceremony picks up where it actually is: never restarted from full, never
 *     skipped. A client that arrives past the spin renders the settled pair
 *     rather than animating a reel whose journey is already over.
 *
 * REDUCED MOTION KEEPS THE BEAT AND DROPS THE MOVEMENT. The duration is
 * IDENTICAL -- it has to be, because the ceremony is a server turn and because
 * the pair still has to be read. What changes is that the reels cross-fade to
 * their answer instead of travelling to it. Shortening it would give a
 * reduced-motion player LESS time to take in the same information, which is the
 * opposite of the accommodation.
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

/**
 * THE CEREMONY'S SHAPE, AS FRACTIONS OF THE SERVER'S WINDOW.
 *
 * Fractions rather than milliseconds because the total is no longer ours to
 * choose. Absolute sub-durations would either overrun the phase -- leaving a
 * reel still spinning when the pick panel opens over it -- or underrun it,
 * leaving the board dimmed with a finished animation on top.
 *
 *   [0, INTRO)          round 1's matchup card
 *   [INTRO, SPIN)       the reels travel
 *   [SPIN, RESOLVE)     the reels have landed, the answer is not yet called
 *   [RESOLVE, 1]        the resolved pair holds, and the handoff line appears
 *
 * The two reel fractions are of the span AFTER the intro, so round 1's reel is
 * the same shape as every other round's, just compressed.
 */
const INTRO_SHARE = 0.3;
const SPIN_SHARE = 0.6;
const RESOLVE_SHARE = 0.78;

/** The reels' own travel, as a share of the spin span. Staggered, because two
 * independent physical wheels never stop on the same frame. */
const PRIMARY_REEL_SHARE = REEL_SPIN_MS.primary / REEL_SPIN_MS.secondary;

type Stage = "intro" | "spinning" | "locked" | "resolved";

interface Schedule {
  /** Total window, ms. */
  total: number;
  introEnds: number;
  spinEnds: number;
  resolvesAt: number;
  /** How long each reel travels, ms. */
  primaryMs: number;
  secondaryMs: number;
}

function schedule(totalMs: number, showIntro: boolean): Schedule {
  const total = Math.max(1, totalMs);
  const introEnds = showIntro ? total * INTRO_SHARE : 0;
  const reelSpan = total - introEnds;
  const secondaryMs = reelSpan * SPIN_SHARE;
  return {
    total,
    introEnds,
    spinEnds: introEnds + secondaryMs,
    resolvesAt: introEnds + reelSpan * RESOLVE_SHARE,
    primaryMs: secondaryMs * PRIMARY_REEL_SHARE,
    secondaryMs,
  };
}

function stageAt(elapsed: number, plan: Schedule): Stage {
  if (elapsed < plan.introEnds) return "intro";
  if (elapsed < plan.spinEnds) return "spinning";
  if (elapsed < plan.resolvesAt) return "locked";
  return "resolved";
}

export default function WeaveSpinner({
  roll,
  roundNumber,
  totalRounds,
  open = true,
  seats,
  yourSeatIndex,
  handoffLabel,
  showIntro = false,
  deadlineAt,
  revealSeconds,
}: {
  roll: TmwRoll | null;
  roundNumber: number | null;
  totalRounds: number;
  /** Mounted by the room exactly while the server's turn phase is `reveal`. */
  open?: boolean;
  seats?: ArenaSeatPublic[];
  yourSeatIndex?: number | null;
  /** "You're up" / "The Spark is on the clock" — the last beat before the board. */
  handoffLabel?: string;
  /** Round one only: the matchup card runs before the reel. */
  showIntro?: boolean;
  /**
   * WHEN THE SERVER SAYS THE CEREMONY ENDS, on this client's monotonic clock.
   * Produced by `deadlineFromSeconds`, i.e. `performance.now()` plus the
   * duration the server sent, so a skewed wall clock cannot move it. `null`
   * falls back to the full window from mount.
   */
  deadlineAt?: number | null;
  /** The window's nominal length, in seconds. The server's `REVEAL_SECONDS`. */
  revealSeconds: number;
}) {
  const reduced = usePrefersReducedMotion();
  const rollId = roll?.roll_id ?? null;
  const totalMs = Math.max(1, revealSeconds * 1000);

  const plan = useMemo(() => schedule(totalMs, showIntro), [totalMs, showIntro]);

  const [stage, setStage] = useState<Stage>(showIntro ? "intro" : "spinning");

  // WHETHER THE REELS TRAVEL AT ALL, decided ONCE per roll.
  //
  // A client that mounts (or reloads) after the spin window has already passed
  // must not animate a journey the match has finished making -- it would land
  // after the phase ended. The decision is latched against the roll id so the
  // poll, which re-seeds `deadlineAt` on every response, cannot flip it
  // mid-ceremony.
  const decidedFor = useRef<string | null>(null);
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    if (!rollId || !open) return;
    const remaining =
      deadlineAt === null || deadlineAt === undefined
        ? plan.total
        : deadlineAt - performance.now();
    // Clamped into the window: a deadline the server has already passed reads
    // as "the very end", never as a negative elapsed that would replay the reel.
    const elapsed = Math.min(plan.total, Math.max(0, plan.total - remaining));

    if (decidedFor.current !== rollId) {
      decidedFor.current = rollId;
      setAnimate(elapsed < plan.spinEnds);
    }

    setStage(stageAt(elapsed, plan));

    // Every boundary still ahead of us, armed at its DISTANCE FROM NOW. Ones
    // already behind fired above, by seeding the stage from elapsed.
    const timers: number[] = [];
    const arm = (at: number, next: Stage) => {
      if (at <= elapsed) return;
      timers.push(window.setTimeout(() => setStage(next), at - elapsed));
    };
    arm(plan.introEnds, "spinning");
    arm(plan.spinEnds, "locked");
    arm(plan.resolvesAt, "resolved");
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [rollId, open, plan, deadlineAt]);

  const franchisePool = useMemo(() => {
    if (!roll) return FRANCHISE_FILLER;
    const seen = new Set([roll.franchise_display_name, ...FRANCHISE_FILLER]);
    return [...seen];
  }, [roll]);

  // The reel's own settle callback. Nothing downstream waits on it -- the
  // ceremony's end is the server's, not a callback's -- so it is kept only
  // because `SpinReel` requires a handler.
  const noteSettled = useCallback(() => {}, []);

  if (!open) return null;

  if (!roll) {
    return (
      <section
        data-testid="tmw-roll-rolling"
        aria-live="polite"
        className="tmw-ceremony tmw-ceremony--idle"
      >
        <p className="tmw-ceremony-note">Rolling the next franchise and decade…</p>
      </section>
    );
  }

  const resolved = stage === "resolved";
  // Reduced motion and "resumed past the spin" reach the same place by
  // different routes: the reel shows its answer instead of travelling to it.
  const still = reduced || !animate;

  return (
    <div className="tmw-ceremony-scrim" data-testid="tmw-ceremony-scrim" data-stage={stage}>
      <section
        data-testid="tmw-roll"
        data-roll-id={roll.roll_id}
        data-phase={resolved ? "revealed" : stage}
        data-stage={stage}
        data-revealed={resolved ? "true" : "false"}
        data-reduced-motion={reduced ? "true" : "false"}
        aria-labelledby="tmw-roll-heading"
        className="tmw-ceremony"
      >
        {/* ROUND ONE OPENS ON THE MATCHUP (TMW-13). Title, the three
            competitors as competitors with the human marked, the objective in
            one line — then straight into the reel. Returning players are not
            made to sit through a tutorial: "How to play" stays in the room
            header for anyone who wants the rules. */}
        {showIntro && stage === "intro" ? (
          <div className="tmw-ceremony-intro" data-testid="tmw-intro">
            <p className="tmw-ceremony-eyebrow">PEAK3 Arena</p>
            <h2 className="tmw-ceremony-title">Three-Man Weave</h2>
            <ul className="tmw-ceremony-seats">
              {(seats ?? []).map((seat) => (
                <li
                  key={seat.seat_index}
                  data-seat-accent={seatAccent(seat.seat_index)}
                  data-is-you={seat.seat_index === yourSeatIndex ? "true" : "false"}
                  data-testid={`tmw-intro-seat-${seat.seat_index}`}
                  className="tmw-ceremony-seat"
                >
                  <span className="tmw-ceremony-seat-name">{seat.display_name}</span>
                  <span className="tmw-ceremony-seat-kind">
                    {seat.seat_index === yourSeatIndex
                      ? "You"
                      : seat.is_bot
                        ? "PEAK3 bot"
                        : "Drafter"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="tmw-ceremony-objective" data-testid="tmw-intro-objective">
              {totalRounds} franchise × decade rounds. Build the best legal five and a
              bench.
            </p>
          </div>
        ) : null}

        {stage !== "intro" ? (
          <>
            <p className="tmw-ceremony-eyebrow">
              Round {roundNumber ?? "—"} of {totalRounds} · everyone drafts from this
            </p>

            <h2 id="tmw-roll-heading" className="tmw-ceremony-reels">
              <span className="tmw-reel" data-reel="franchise">
                <span className="tmw-reel-label">Franchise</span>
                <SpinReel
                  pool={franchisePool}
                  target={roll.franchise_display_name}
                  spinMs={plan.primaryMs}
                  runKey={`${roll.roll_id}-franchise`}
                  reduced={still}
                  testId="tmw-roll-franchise"
                  onSettled={noteSettled}
                />
              </span>
              <span className="tmw-ceremony-x" aria-hidden="true">
                ×
              </span>
              <span className="tmw-reel" data-reel="decade">
                <span className="tmw-reel-label">Decade</span>
                <SpinReel
                  pool={DECADES}
                  target={roll.decade}
                  spinMs={plan.secondaryMs}
                  runKey={`${roll.roll_id}-decade`}
                  reduced={still}
                  testId="tmw-roll-decade"
                  onSettled={noteSettled}
                />
              </span>
            </h2>

            {/* ONE announcement for the pair, not two fragments, and only once
                it has landed — so a screen reader is told the answer rather
                than narrated at while a wheel turns. Screen-reader only: the
                reels above already show both halves. */}
            <p
              role="status"
              aria-live="polite"
              className="tmw-ceremony-result sr-only"
              data-testid="tmw-roll-result"
            >
              {resolved
                ? `${roll.franchise_display_name}, ${roll.decade}. ${roll.candidates.length} eligible ${
                    roll.candidates.length === 1 ? "player" : "players"
                  } undrafted.`
                : ""}
            </p>

            <p className="tmw-ceremony-note" aria-hidden={!resolved}>
              {resolved
                ? `${roll.candidates.length} eligible ${
                    roll.candidates.length === 1 ? "player" : "players"
                  } still undrafted`
                : "Rolling…"}
            </p>

            {resolved && handoffLabel ? (
              <p className="tmw-ceremony-handoff" data-testid="tmw-ceremony-handoff">
                {handoffLabel}
              </p>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
