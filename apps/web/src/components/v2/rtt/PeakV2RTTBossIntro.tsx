"use client";

/**
 * PeakV2RTTBossIntro — the boss title card.
 *
 * The first beat of every boss encounter, and the one place the run is
 * allowed a Level-3 moment on entry: the act numeral, the boss's name, its
 * tagline, the rule in force and the stakes, held for under two seconds
 * while the lineup gets ready behind it. One control ("Face the lineup")
 * ends the hold early from the first frame; reduced motion ends it at once.
 * The final boss wears the same card at a larger scale — distinction by
 * scale and composition, not by a longer wait.
 *
 * `onComplete` fires exactly once, however the hold ends.
 */

import { useEffect, useRef, useState } from "react";
import PeakV2ArenaLight from "../PeakV2ArenaLight";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import { lanesToWinSentence } from "@/lib/run-the-table-copy";
import { actNumeral } from "@/lib/run-the-table-state";
import type { BossPublic } from "@/types/run-the-table";
import PeakV2RTTCoach from "./PeakV2RTTCoach";

export const BOSS_INTRO_HOLD_MS = 1800;

export interface PeakV2RTTBossIntroProps {
  boss: BossPublic;
  lanesToWin?: number;
  lives: number;
  maxLives: number;
  reducedMotion: boolean;
  onComplete: () => void;
}

export default function PeakV2RTTBossIntro({ boss, lanesToWin, lives, maxLives, reducedMotion, onComplete }: PeakV2RTTBossIntroProps) {
  const doneRef = useRef(false);
  const [held, setHeld] = useState(false);
  const final = boss.is_final === true;

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onComplete();
  };

  useEffect(() => {
    if (reducedMotion) {
      finish();
      return;
    }
    const raf = window.requestAnimationFrame(() => setHeld(true));
    const id = window.setTimeout(finish, BOSS_INTRO_HOLD_MS);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  return (
    <section data-testid="rtt-boss-intro" className="rtt-boss-card" data-final={final ? "true" : "false"} data-held={held ? "true" : "false"} data-reduced-motion={reducedMotion ? "true" : "false"}>
      <PeakV2ArenaLight y="-8%" tone={final ? "negative" : "accent"} intensity="focus" />
      <div className="rtt-boss-card-body">
        <span className="rtt-eyebrow rtt-boss-card-eyebrow">{final ? "Final boss" : "Boss battle"} · Act {actNumeral(boss.act)}</span>
        <span className="rtt-boss-card-numeral" aria-hidden="true">
          {actNumeral(boss.act)}
        </span>
        <h1 className="rtt-boss-card-name">{boss.name}</h1>
        <p className="rtt-boss-card-tagline">{boss.tagline}</p>
        <p className="rtt-boss-card-rule" data-testid="rtt-boss-intro-win-condition">
          {boss.rule ? <strong>{boss.rule.name}. </strong> : null}
          {lanesToWinSentence(lanesToWin)}
        </p>
        <p className="rtt-boss-card-stakes">
          Lose and one life is gone. <strong>{lives} of {maxLives}</strong> left.
        </p>
        <PeakV2RTTCoach coach="first_boss" active className="rtt-boss-card-coach" />
        <span className="rtt-boss-card-hold" data-testid="rtt-boss-intro-countdown" aria-hidden="true">
          <span className="rtt-boss-card-hold-fill" style={{ ["--rtt-hold-ms" as string]: `${BOSS_INTRO_HOLD_MS}ms` } as React.CSSProperties} />
        </span>
        <PeakV2PrimaryAction data-testid="rtt-boss-intro-skip" size="sm" className="rtt-boss-card-action" onClick={finish}>
          Face the lineup
        </PeakV2PrimaryAction>
      </div>
    </section>
  );
}
