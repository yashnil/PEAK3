"use client";

/**
 * HomeV2ResumeRow — the RUN THE TABLE game-slate cell, upgraded with real
 * client-only resume state (Pass 3, reshaped for Pass 5's horizontal slate).
 * Renders the exact same cell markup as `ModeSlateCell` while a resume check
 * is in flight or finds nothing (`run` is `undefined`/`null`), then swaps
 * its description line and badge to the actual act/stage/boss the instant
 * `useRttResumeState` resolves one — never a placeholder, never a layout
 * shift beyond that one text swap.
 */

import Link from "next/link";
import { useRttResumeState } from "@/lib/v2-resume-state";
import type { HomePageV2Mode } from "./HomePageV2";

export default function HomeV2ResumeRow({ mode }: { mode: HomePageV2Mode }) {
  const { run } = useRttResumeState();
  const resuming = run != null;
  const bossName = run?.next_boss?.name;

  return (
    <Link
      href={resuming ? "/arena/run-the-table" : mode.href}
      className="v2-slate-cell v2-slate-cell-flagship group"
      data-testid="home-flagship-card"
      data-featured="true"
    >
      <span className="v2-slate-cell-head">
        <span className="v2-slate-cell-tag" data-testid="flagship-badge">
          {mode.tag ?? "Flagship"}
        </span>
        {resuming ? <span className="v2-slate-cell-badge">In progress</span> : null}
      </span>
      <span className="v2-slate-cell-title">{mode.title}</span>
      <span className="v2-slate-cell-desc">
        {resuming
          ? `Act ${run.act} of ${run.acts_total} · Credits ${run.credits} · Lives ${run.lives}/${run.max_lives}${bossName ? ` · ${bossName} next` : ""}`
          : mode.description}
      </span>
      <span className="v2-slate-cell-action" aria-hidden="true">
        {resuming ? "Continue" : "Play"} <span className="v2-slate-cell-arrow">→</span>
      </span>
    </Link>
  );
}
