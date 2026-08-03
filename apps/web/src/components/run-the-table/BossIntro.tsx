"use client";
import { useEffect, useRef, useState } from "react";
import { BossPublic } from "@/types/run-the-table";
import { lanesToWinSentence } from "@/lib/run-the-table-copy";

/** 700ms/numeral — PRODUCT_EXPERIENCE_CONTRACT.md §8's countdown value,
 *  unmodified: three beats, not a 7-card sequence, so none of the reveal
 *  budget's compression reasoning applies here. */
const COUNTDOWN_STEP_MS = 700;
const NUMERALS = [3, 2, 1] as const;

/**
 * The boss cinematic's pre-roll: name, philosophy, win condition, a 3-2-1
 * countdown, and a skip control live from the first frame
 * (PRODUCT_EXPERIENCE_CONTRACT.md §3, VERIFICATION_PLAN.md §2 item 6).
 *
 * NO PLAYER DATA BEHIND THE NUMERALS. The countdown is pure pacing — three
 * numbers counting down to the lineup reveal that follows this component,
 * never a reveal of anything itself. Nothing here is server-authoritative
 * beyond what was already on `BossPublic` before this component existed
 * (`name`, `tagline`, `act`) plus `lanesToWin`, already on `RunPublicState`.
 */
interface Props {
  boss: BossPublic;
  lanesToWin?: number;
  reducedMotion: boolean;
  /** Fires once, whether the countdown finished on its own or was skipped. */
  onComplete: () => void;
}

export default function BossIntro({ boss, lanesToWin, reducedMotion, onComplete }: Props) {
  const [count, setCount] = useState<number>(reducedMotion ? 0 : NUMERALS.length);
  const doneRef = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onComplete();
  };

  useEffect(() => {
    if (reducedMotion) {
      // Collapsed to a single "Battle starting" state, no numerals — matches
      // §8's reduced-motion row for the countdown exactly.
      finish();
      return;
    }
    if (count <= 0) {
      finish();
      return;
    }
    const id = window.setTimeout(() => setCount((c) => c - 1), COUNTDOWN_STEP_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, reducedMotion]);

  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setAnnouncement(
        `Boss battle: ${boss.name}. ${boss.tagline}${
          lanesToWin != null ? ` First to ${lanesToWin} of five lanes.` : ""
        }`,
      ),
    );
    return () => cancelAnimationFrame(id);
  }, [boss.name, boss.tagline, lanesToWin]);

  const numeral = NUMERALS[NUMERALS.length - count] ?? null;

  return (
    <section
      data-testid="rtt-boss-intro"
      className="rtt-decision-surface rtt-boss-intro flex flex-col items-center gap-4 text-center"
      style={{ background: "var(--bg-page)", borderColor: "var(--peak-accent-dim)" }}
    >
      <div role="status" aria-live="polite" className="sr-only" data-testid="rtt-boss-intro-live">
        {announcement}
      </div>

      <span
        className="text-[10px] font-bold uppercase tracking-widest"
        style={{ color: "var(--peak-accent)" }}
      >
        Act {boss.act} · Boss Battle
      </span>

      {/* Full-bleed name treatment — the arena moment, not a routine decision
          screen. */}
      <h2
        className="text-3xl font-black uppercase tracking-wide"
        style={{ color: "var(--text-primary)" }}
      >
        {boss.name}
      </h2>
      <p className="max-w-md text-sm" style={{ color: "var(--text-secondary)" }}>
        {boss.tagline}
      </p>
      {lanesToWin != null && (
        <p
          className="text-xs font-semibold"
          style={{ color: "var(--text-primary)" }}
          data-testid="rtt-boss-intro-win-condition"
        >
          {lanesToWinSentence(lanesToWin)}
        </p>
      )}

      {/* The countdown. Numerals only — no player data is behind them. */}
      <div
        className="flex h-24 w-24 items-center justify-center rounded-full border-2"
        style={{ borderColor: "var(--peak-accent)", background: "var(--peak-accent-bg)" }}
        aria-hidden="true"
        data-testid="rtt-boss-intro-countdown"
        data-count={numeral ?? "go"}
      >
        <span className="text-5xl font-black" style={{ color: "var(--peak-accent)" }}>
          {numeral ?? "GO"}
        </span>
      </div>

      {/* Skip is interactive from the FIRST frame, never merely present-but-
          disabled — VERIFICATION_PLAN.md §2 item 6 checks exactly this. */}
      <button
        type="button"
        data-testid="rtt-boss-intro-skip"
        onClick={finish}
        className="rtt-tap rounded-lg px-5 text-xs font-semibold uppercase tracking-wide"
        style={{
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-default)",
        }}
      >
        Skip
      </button>
    </section>
  );
}
