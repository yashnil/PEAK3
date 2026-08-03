"use client";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BattlePublic, BossPublic } from "@/types/run-the-table";
import { Coachmark } from "@/components/ui/GuidedTour";
import { Explainer } from "@/components/ui";
import {
  battleVerdict,
  decisiveLane,
  laneColorVar,
  laneSentence,
  runningSeries,
} from "@/lib/run-the-table-state";
import { LANE_RATING_LABELS } from "@/lib/run-the-table-copy";
import { componentTextColor } from "@/lib/utils";

const STAGGER_S = 0.09;
const DURATION_S = 0.35;
/** Milliseconds between lane reveals — the same cadence as the motion
 *  stagger, so the running series count and the bars advance together. */
const STEP_MS = STAGGER_S * 1000;

/**
 * The five-lane battle reveal.
 *
 * Forked from `components/game/component-comparison.tsx` — same
 * `1fr auto 1fr` lane grid, same `--comp-*` lane colours — and extended with
 * the run-specific parts: the top contributing card on each side, a running
 * series count, and a verdict stamp.
 *
 * Three hard rules, all of them accessibility rules:
 *
 *  1. The COMPLETE verdict (every lane's numbers, the winner, the tiebreak) is
 *     in the DOM at t=0 inside `role="status" aria-live="polite"`. Nothing a
 *     player or a screen reader needs is gated behind an animation.
 *  2. "Skip to result" is always present, never conditional on the reveal
 *     being in progress — a player who wants the answer gets it in one click.
 *  3. `useReducedMotion()` collapses the whole thing to `initial: false,
 *     duration: 0`, so the reveal is finished on first paint.
 *
 * Only `transform` and `opacity` are animated.
 *
 * Pause/resume and replay (PRODUCT_EXPERIENCE_CONTRACT.md §3) are additive:
 * pause holds the lane-by-lane interval in place without losing progress;
 * replay is offered only once `done`, and replays the ALREADY-RESOLVED
 * `battle` prop from the top — no network call, no re-decision, matching the
 * hard rule "Replay replays an already-resolved result. It never re-fetches
 * or re-decides."
 */
interface Props {
  battle: BattlePublic;
  boss: BossPublic | null;
  busy: boolean;
  onAdvance: () => void;
  advanceLabel: string;
  /** `state.lanes_to_win` — the engine's `LANES_TO_WIN`, never a literal. */
  lanesToWin?: number;
}

export default function BattleReveal({
  battle,
  boss,
  busy,
  onAdvance,
  advanceLabel,
  lanesToWin,
}: Props) {
  const reduced = useReducedMotion();
  const [skipped, setSkipped] = useState(false);
  const instant = reduced || skipped;

  const [revealed, setRevealed] = useState(instant ? battle.lanes.length : 0);

  /** Pause holds the interval in place — the tick still fires on schedule but
   *  does nothing while paused, so resuming continues from wherever it was
   *  rather than losing time. `replayCount` re-runs the effect from scratch:
   *  REPLAY, not a re-fetch — `battle` itself never changes, only the local
   *  presentation restarts (§3: "replays an already-resolved result, never
   *  re-fetches or re-decides"). */
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const [replayCount, setReplayCount] = useState(0);

  useEffect(() => {
    if (instant) {
      setRevealed(battle.lanes.length);
      return;
    }
    setRevealed(0);
    let n = 0;
    const id = window.setInterval(() => {
      if (pausedRef.current) return;
      n += 1;
      setRevealed(n);
      if (n >= battle.lanes.length) window.clearInterval(id);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [instant, battle.lanes.length, battle.boss_id, replayCount]);

  /** Available only once the reveal has completed once — never before. */
  const handleReplay = () => {
    setPaused(false);
    setSkipped(false);
    setReplayCount((c) => c + 1);
  };

  const series = runningSeries(battle.lanes, revealed);
  const verdict = battleVerdict(battle);
  const done = revealed >= battle.lanes.length;
  const decisive = lanesToWin != null ? decisiveLane(battle, lanesToWin) : null;
  // The restrained lock-in moment: the frame the deciding lane lands on.
  const lockedIn = lanesToWin != null && (series.player >= lanesToWin || series.opponent >= lanesToWin);
  const stampColor =
    battle.outcome === "win"
      ? "var(--correct)"
      : battle.outcome === "loss"
        ? "var(--incorrect)"
        : "var(--text-secondary)";

  // See the live region below: mounted empty, filled after paint.
  const [verdictAnnouncement, setVerdictAnnouncement] = useState("");
  useEffect(() => {
    const text =
      `${verdict.stamp}. ${verdict.detail} ` +
      battle.lanes.map((lane) => laneSentence(lane)).join(" ") +
      ` Credits awarded: ${battle.credits_awarded}. Lives remaining: ${battle.lives_after}.`;
    // A frame, not zero, so the region has certainly been committed to the
    // accessibility tree before its text changes.
    const id = requestAnimationFrame(() => setVerdictAnnouncement(text));
    return () => cancelAnimationFrame(id);
  }, [battle, verdict]);

  return (
    <section data-testid="rtt-battle-reveal" className="rtt-decision-surface flex flex-col gap-3">
      {/* (1) The complete verdict.
          Visually hidden because the staged reveal below says the same thing in
          the product's own language — but it is never absent, and never late.

          The region is MOUNTED EMPTY and filled one tick later, which is the
          whole point. A live region that is inserted into the DOM already
          populated is not a mutation of an existing region, and screen readers
          generally do not announce it — so rendering the verdict inline here
          (which is what this did) meant the entire battle result was announced
          to nobody. `LiveRegion.tsx` states the rule; `SpinStage` already
          follows it. Filling on an effect also separates this announcement from
          the shell's own `rtt-live` write in the same tick, so two polite
          regions no longer race and clobber each other. */}
      <div role="status" aria-live="polite" className="sr-only" data-testid="rtt-battle-verdict-live">
        {verdictAnnouncement}
      </div>

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--peak-accent)" }}
          >
            Act {battle.act} · Battle
          </span>
          <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            Your five vs {boss?.name ?? battle.boss_id}
          </h2>
          {lanesToWin != null && (
            <span
              className="text-[11px]"
              style={{ color: "var(--text-muted)" }}
              data-testid="rtt-battle-win-condition"
            >
              First to <span className="score-number">{lanesToWin}</span> of five component lanes.
              A comparison of PEAK3 component totals — no game is simulated.
            </span>
          )}
          {boss?.rule && (
            <span
              className="text-[11px]"
              style={{ color: "var(--peak-accent)" }}
              data-testid="rtt-battle-rule"
            >
              Rule in force · {boss.rule.name} —{" "}
              <span style={{ color: "var(--text-secondary)" }}>{boss.rule.summary}</span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Pause/resume — meaningless once every lane is already resolved,
              so it only appears mid-reveal, same as the reveal sequence's
              own pause control. */}
          {!done &&
            !instant &&
            (paused ? (
              <button
                type="button"
                data-testid="rtt-battle-resume"
                onClick={() => setPaused(false)}
                className="rtt-tap rounded-lg px-3 text-[11px] font-semibold uppercase tracking-wide"
                style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
              >
                Resume
              </button>
            ) : (
              <button
                type="button"
                data-testid="rtt-battle-pause"
                onClick={() => setPaused(true)}
                className="rtt-tap rounded-lg px-3 text-[11px] font-semibold uppercase tracking-wide"
                style={{
                  background: "var(--bg-surface)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-default)",
                }}
              >
                Pause
              </button>
            ))}
          <button
            type="button"
            data-testid="rtt-battle-skip"
            onClick={() => setSkipped(true)}
            className="rtt-tap rounded-lg px-3 text-[11px] font-semibold uppercase tracking-wide"
            style={{
              background: "var(--bg-surface)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-default)",
            }}
          >
            Skip to result
          </button>
          {/* Replay — available ONLY once the sequence has completed once.
              Replays the ALREADY-RESOLVED `battle` prop; no network call,
              no re-decision. */}
          {done && (
            <button
              type="button"
              data-testid="rtt-battle-replay"
              onClick={handleReplay}
              className="rtt-tap rounded-lg px-3 text-[11px] font-semibold uppercase tracking-wide"
              style={{
                background: "var(--bg-surface)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-default)",
              }}
            >
              Replay
            </button>
          )}
        </div>
      </header>

      {/* Running series count */}
      <div
        className={`flex items-center justify-center gap-4 rounded-xl border py-2${
          lockedIn && !instant ? " rtt-lock-in" : ""
        }`}
        style={{
          background: "var(--bg-elevated)",
          borderColor: lockedIn ? "var(--peak-accent-dim)" : "var(--border-default)",
        }}
        data-testid="rtt-battle-series"
        data-locked-in={lockedIn ? "true" : "false"}
      >
        <span className="score-number text-2xl font-bold" style={{ color: "var(--correct)" }}>
          {series.player}
        </span>
        <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          Lanes won
        </span>
        <span className="score-number text-2xl font-bold" style={{ color: "var(--text-secondary)" }}>
          {series.opponent}
        </span>
        {series.ties > 0 && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            <span className="score-number">{series.ties}</span> tied
          </span>
        )}
      </div>

      {/* Column headers — these two numbers are a ROSTER-WIDE mean, never any
          one player's own value (SCORE_RECONCILIATION.md §2). Labelled once
          here rather than five times per lane so the wording doesn't compete
          with the per-lane numbers below it. `roster_total` is a different,
          reserved engine field — this rating is never called a "total". */}
      <div
        className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2"
        data-testid="rtt-battle-lane-rating-header"
      >
        <span
          className="text-right text-[9px] font-bold uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          {LANE_RATING_LABELS.player}
        </span>
        <span className="flex w-24 items-center justify-center gap-1 @[520px]:w-28">
          <Explainer
            label={`What "${LANE_RATING_LABELS.player}" / "${LANE_RATING_LABELS.boss}" means`}
            term={LANE_RATING_LABELS.definition}
            data-testid="rtt-lane-rating-explainer"
          />
        </span>
        <span
          className="text-left text-[9px] font-bold uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          {LANE_RATING_LABELS.boss}
        </span>
      </div>

      {/* Lanes */}
      <ul className="flex flex-col gap-2" data-testid="rtt-battle-lanes">
        {battle.lanes.map((lane, i) => {
          const color = laneColorVar(lane.token);
          const max = Math.max(lane.player_lineup_rating, lane.boss_lineup_rating, 1);
          const playerPct = (lane.player_lineup_rating / max) * 100;
          const opponentPct = (lane.boss_lineup_rating / max) * 100;
          const isRevealed = i < revealed;
          return (
            <motion.li
              key={lane.lane}
              data-testid={`rtt-lane-${lane.lane}`}
              data-lane-winner={lane.winner}
              initial={instant ? false : { opacity: 0, transform: "translateY(6px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              transition={
                instant ? { duration: 0 } : { duration: DURATION_S, delay: i * STAGGER_S }
              }
              className="rounded-lg px-2 py-1.5"
              style={{
                background: isRevealed && lane.winner === "player" ? "var(--bg-surface)" : "transparent",
                border: `1px solid ${
                  isRevealed && lane.winner === "player" ? "var(--border-subtle)" : "transparent"
                }`,
              }}
            >
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                {/* Player side */}
                <div className="flex items-center justify-end gap-2 min-w-0">
                  <span
                    className="score-number text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {lane.player_lineup_rating.toFixed(1)}
                  </span>
                  <div
                    className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full @[520px]:w-20"
                    style={{ background: "var(--border-subtle)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${playerPct}%`,
                        background: lane.winner === "player" ? color : "var(--text-muted)",
                      }}
                    />
                  </div>
                </div>

                {/* Label. `color` (`laneColorVar` — the frozen --comp-* hex)
                    is measurably unreadable as TEXT on Arena Day — 1.6-2.6:1
                    against every surface tier, failing even the 3:1
                    large-text floor. It stays exactly what the token was
                    tuned for: a fill/border accent (the bars above, the dot
                    below). The label's own text uses `componentTextColor`
                    (lib/utils.ts, P3-G2) — the named, app-wide text-safe
                    sibling that preserves the lane's identity colour while
                    clearing AA, rather than dropping to neutral
                    `--text-primary`. */}
                <div className="flex w-24 flex-col items-center text-center @[520px]:w-28">
                  <span className="flex items-center gap-1">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: lane.winner === "tie" ? "var(--text-muted)" : color }}
                    />
                    <span
                      className="text-[10px] font-medium leading-tight"
                      style={{
                        color: lane.winner === "tie" ? "var(--text-primary)" : componentTextColor(lane.lane),
                      }}
                    >
                      {lane.label}
                    </span>
                  </span>
                  <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                    {lane.winner === "player"
                      ? "You"
                      : lane.winner === "opponent"
                        ? "Them"
                        : "Tied"}
                  </span>
                </div>

                {/* Opponent side */}
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full @[520px]:w-20"
                    style={{ background: "var(--border-subtle)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${opponentPct}%`,
                        background: lane.winner === "opponent" ? color : "var(--text-muted)",
                      }}
                    />
                  </div>
                  <span
                    className="score-number text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {lane.boss_lineup_rating.toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Top contributor on each side — visually and semantically a
                  SEPARATE fact from the lineup rating above it: this is one
                  player's OWN value in this lane, never the roster mean. No
                  individual label may visually own the roster-wide number
                  (SCORE_RECONCILIATION.md §2), so this row gets its own
                  micro-label, its own border, and its own number — never
                  stacked unlabelled under the lineup rating the way it used
                  to be ("27.2 — Victor Wembanyama" read as one fact). */}
              <div
                className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-md px-1.5 py-1"
                style={{ background: "var(--bg-page)", border: "1px solid var(--border-subtle)" }}
                data-testid={`rtt-lane-contributors-${lane.lane}`}
              >
                <span className="flex items-center justify-end gap-1.5 min-w-0 text-right">
                  <span
                    className="score-number shrink-0 text-[10px] font-semibold"
                    style={{ color: "var(--text-secondary)" }}
                    data-testid={`rtt-lane-player-contributor-value-${lane.lane}`}
                  >
                    {lane.top_contributor ? lane.top_contributor.own_lane_index_value.toFixed(1) : "—"}
                  </span>
                  <span className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {lane.top_contributor?.name ?? "—"}
                  </span>
                </span>
                <span
                  className="w-24 text-center text-[8px] font-bold uppercase tracking-wider @[520px]:w-28"
                  style={{ color: "var(--text-muted)" }}
                >
                  {LANE_RATING_LABELS.topContributor}
                </span>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {lane.opponent_top_contributor?.name ?? "—"}
                  </span>
                  <span
                    className="score-number shrink-0 text-[10px] font-semibold"
                    style={{ color: "var(--text-secondary)" }}
                    data-testid={`rtt-lane-opponent-contributor-value-${lane.lane}`}
                  >
                    {lane.opponent_top_contributor
                      ? lane.opponent_top_contributor.own_lane_index_value.toFixed(1)
                      : "—"}
                  </span>
                </span>
              </div>

              {/* THE EXPANDABLE RECEIPT (SYNTHESIS_CONTRACT.md §2.3): how
                  `player_lineup_rating` was actually built, behind
                  disclosure so it never competes with the at-a-glance
                  numbers above. The three addends are the server's own
                  decomposition — `bench_adjustment` is computed as the
                  residual so they sum to `final_rating` with zero client
                  arithmetic and no rounding drift to explain. */}
              <details
                className="mt-1"
                data-testid={`rtt-lane-receipt-${lane.lane}`}
              >
                <summary
                  className="cursor-pointer select-none text-[9px]"
                  style={{ color: "var(--text-muted)", textDecoration: "underline", textUnderlineOffset: "2px" }}
                >
                  How this rating was built
                </summary>
                <div
                  className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 text-[10px]"
                  style={{ background: "var(--bg-page)", color: "var(--text-secondary)" }}
                >
                  <span data-testid={`rtt-lane-receipt-pre-${lane.lane}`}>
                    Before perk{" "}
                    <span className="score-number" style={{ color: "var(--text-primary)" }}>
                      {lane.pre_perk_rating.toFixed(2)}
                    </span>
                  </span>
                  <span aria-hidden="true">+</span>
                  <span data-testid={`rtt-lane-receipt-bench-${lane.lane}`}>
                    Bench{" "}
                    <span className="score-number" style={{ color: "var(--text-primary)" }}>
                      {lane.bench_adjustment.toFixed(2)}
                    </span>
                  </span>
                  <span aria-hidden="true">+</span>
                  <span data-testid={`rtt-lane-receipt-perk-${lane.lane}`}>
                    Perk{" "}
                    <span className="score-number" style={{ color: "var(--text-primary)" }}>
                      {lane.perk_adjustment.toFixed(2)}
                    </span>
                  </span>
                  <span aria-hidden="true">=</span>
                  <span data-testid={`rtt-lane-receipt-final-${lane.lane}`}>
                    Final{" "}
                    <span className="score-number" style={{ color: "var(--peak-accent)" }}>
                      {lane.final_rating.toFixed(2)}
                    </span>
                  </span>
                </div>
              </details>

              {/* Why the boss rule changed anything. `tie_broken_by_rule` is
                  the only per-lane rule signal the engine emits, and it used to
                  render as the word "rule" with no explanation of what it did. */}
              {lane.tie_broken_by_rule && (
                <p
                  className="pt-0.5 text-center text-[9px]"
                  style={{ color: "var(--peak-accent)" }}
                  data-testid={`rtt-lane-rule-${lane.lane}`}
                >
                  This lane was level on totals; {boss?.rule?.name ?? "the boss rule"} decided it.
                </p>
              )}
            </motion.li>
          );
        })}
      </ul>

      {/* Verdict stamp — visible copy of what the status region already said. */}
      <motion.div
        data-testid="rtt-battle-stamp"
        data-outcome={battle.outcome}
        initial={instant ? false : { opacity: 0, transform: "scale(0.96)" }}
        animate={
          done ? { opacity: 1, transform: "scale(1)" } : { opacity: 0, transform: "scale(0.96)" }
        }
        transition={{ duration: instant ? 0 : DURATION_S }}
        /* A win gets ONE brief accent sweep; a loss gets the same layout in a
           neutral frame with no shaming treatment at all. Reduced motion (and
           the skip button) drop the sweep entirely. */
        className={`rounded-xl border p-3 flex flex-col gap-1${
          done && !instant && battle.outcome === "win" ? " rtt-victory-accent" : ""
        }`}
        style={{
          background: "var(--bg-elevated)",
          borderColor: stampColor,
        }}
      >
        <span
          className="text-lg font-black uppercase tracking-[0.2em]"
          style={{ color: stampColor }}
        >
          {verdict.stamp}
        </span>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {verdict.detail}
        </span>
        {/* The decisive lane, in one sentence. Counted from the winners the
            server sent, in the order it sent them — never re-decided here. */}
        {decisive && (
          <span
            className="text-xs"
            style={{ color: "var(--text-primary)" }}
            data-testid="rtt-battle-decisive"
          >
            {decisive.sentence}
          </span>
        )}
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Summed lane margin{" "}
          <span className="score-number">{battle.summed_margin.toFixed(2)}</span> · roster totals{" "}
          <span className="score-number">{battle.player_roster_total.toFixed(1)}</span> vs{" "}
          <span className="score-number">{battle.opponent_roster_total.toFixed(1)}</span> · bench
          weight <span className="score-number">{battle.bench_weight.toFixed(2)}</span>
        </span>
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span className="score-number">{battle.credits_awarded}</span> credits awarded ·{" "}
          <span className="score-number">{battle.lives_after}</span> lives remaining
        </span>
      </motion.div>

      <div>
        <button
          type="button"
          data-testid="rtt-battle-advance"
          onClick={onAdvance}
          disabled={busy}
          className="rtt-tap rounded-lg px-6 text-sm font-bold uppercase tracking-wide disabled:opacity-60"
          style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
        >
          {busy ? "Working…" : advanceLabel}
        </button>
      </div>

      {/* LAST in DOM order — the e2e driver clicks `rtt-battle-skip` then
          `rtt-battle-advance` inside this surface, and a coachmark's "Got it"
          placed earlier would sit between them. Self-dismissing, so it only
          ever appears on the first battle a player reaches. */}
      <Coachmark id="boss_battle" />
    </section>
  );
}
