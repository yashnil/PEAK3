"use client";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BattlePublic, BossPublic } from "@/types/run-the-table";
import { Coachmark } from "@/components/ui/GuidedTour";
import {
  battleVerdict,
  decisiveLane,
  laneColorVar,
  laneSentence,
  runningSeries,
} from "@/lib/run-the-table-state";

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
 *  2. "Reveal instantly" is always present, never conditional on the reveal
 *     being in progress — a player who wants the answer gets it in one click.
 *  3. `useReducedMotion()` collapses the whole thing to `initial: false,
 *     duration: 0`, so the reveal is finished on first paint.
 *
 * Only `transform` and `opacity` are animated.
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

  useEffect(() => {
    if (instant) {
      setRevealed(battle.lanes.length);
      return;
    }
    setRevealed(0);
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setRevealed(n);
      if (n >= battle.lanes.length) window.clearInterval(id);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [instant, battle.lanes.length, battle.boss_id]);

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
            style={{ color: "var(--peak-accent-text)" }}
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
              style={{ color: "var(--peak-accent-text)" }}
              data-testid="rtt-battle-rule"
            >
              Rule in force · {boss.rule.name} —{" "}
              <span style={{ color: "var(--text-secondary)" }}>{boss.rule.summary}</span>
            </span>
          )}
        </div>
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
          Reveal instantly
        </button>
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

      {/* Lanes */}
      <ul className="flex flex-col gap-2" data-testid="rtt-battle-lanes">
        {battle.lanes.map((lane, i) => {
          const color = laneColorVar(lane.token);
          const max = Math.max(lane.player_score, lane.opponent_score, 1);
          const playerPct = (lane.player_score / max) * 100;
          const opponentPct = (lane.opponent_score / max) * 100;
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
                    {lane.player_score.toFixed(1)}
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

                {/* Label */}
                <div className="flex w-24 flex-col items-center text-center @[520px]:w-28">
                  <span
                    className="text-[10px] font-medium leading-tight"
                    style={{ color: lane.winner === "tie" ? "var(--text-muted)" : color }}
                  >
                    {lane.label}
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
                    {lane.opponent_score.toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Top contributor on each side */}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 pt-0.5">
                <span className="truncate text-right text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {lane.player_top_card?.player_name ?? "—"}
                </span>
                <span className="w-24 text-center text-[9px] @[520px]:w-28" style={{ color: "var(--text-muted)" }}>
                  led by
                </span>
                <span className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {lane.opponent_top_card?.player_name ?? "—"}
                </span>
              </div>

              {/* Why the boss rule changed anything. `tie_broken_by_rule` is
                  the only per-lane rule signal the engine emits, and it used to
                  render as the word "rule" with no explanation of what it did. */}
              {lane.tie_broken_by_rule && (
                <p
                  className="pt-0.5 text-center text-[9px]"
                  style={{ color: "var(--peak-accent-text)" }}
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
          style={{ background: "var(--peak-accent)", color: "#000" }}
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
