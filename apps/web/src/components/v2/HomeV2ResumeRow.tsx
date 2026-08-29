"use client";

/**
 * HomeV2ResumeRow — the FEATURED Run the Table panel in "Your Arena"
 * (product-UX-recovery pass).
 *
 * Was one of seven identically-sized cells in a five-column slate, which is
 * how a flagship ended up indistinguishable from the 82-0 Leaderboard link
 * beside it. It is now the section's second rank in its own right: display
 * serif title, real description measure, and a filled gold button rather
 * than a text link with an arrow.
 *
 * IT IS ALSO THE SECTION'S ONLY RUN-THE-TABLE ENTRY POINT. The homepage
 * used to offer three (hero CTA, slate cell, and a separate "In progress /
 * Continue" tile in Your Arena) and could show two of them at once saying
 * the same thing. `HomeV2YourArena`'s status strip therefore no longer
 * carries a run row at all — this panel resumes, so the duplication is
 * removed structurally rather than hidden behind a condition.
 *
 * Real resume state only: `useRttResumeState` swaps the copy and the verb
 * the instant it resolves a run, and renders the plain pitch otherwise.
 * Never a placeholder run.
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
      className="v2-arena-featured"
      data-testid="home-flagship-card"
      data-featured="true"
    >
      <span>
        <span className="v2-arena-featured-tag" data-testid="flagship-badge">
          Flagship
        </span>
        <span className="v2-arena-featured-title">{mode.title}</span>
        <span className="v2-arena-featured-desc">
          {resuming
            ? `Act ${run.act} of ${run.acts_total} · Credits ${run.credits} · Lives ${run.lives}/${run.max_lives}${bossName ? ` · ${bossName} next` : ""}`
            : mode.description}
        </span>
      </span>
      <span className="v2-arena-featured-action">
        {resuming ? "Continue run" : "Play"}
      </span>
    </Link>
  );
}
