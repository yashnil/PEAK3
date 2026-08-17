"use client";

/**
 * HomeV2ResumeRow — the RUN THE TABLE mode-slate row, upgraded with real
 * client-only resume state (Pass 3). Renders the exact same row shape as
 * every other `HomePageV2Mode` link while a resume check is in flight or
 * finds nothing (`run` is `undefined`/`null`), then swaps its meta line to
 * the actual act/stage/boss the instant `useRttResumeState` resolves one —
 * never a placeholder, never a layout shift beyond that one text swap.
 */

import Link from "next/link";
import { useRttResumeState } from "@/lib/v2-resume-state";
import type { HomePageV2Mode } from "./HomePageV2";

const ROW_TITLE_STYLE = {
  fontFamily: "var(--v2-font-ui)",
  fontWeight: 700,
  fontSize: "0.9375rem",
  color: "var(--v2-text-primary)",
} as const;

const ROW_META_STYLE = {
  fontFamily: "var(--v2-font-ui)",
  fontSize: "0.75rem",
  color: "var(--v2-text-secondary)",
} as const;

export default function HomeV2ResumeRow({ mode }: { mode: HomePageV2Mode }) {
  const { run } = useRttResumeState();
  const resuming = run != null;
  const bossName = run?.next_boss?.name;

  return (
    <Link
      href={resuming ? "/arena/run-the-table" : mode.href}
      className="flex items-center justify-between gap-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}
    >
      <div>
        <div style={ROW_TITLE_STYLE}>{mode.title}</div>
        <div style={ROW_META_STYLE}>
          {resuming
            ? `Act ${run.act} of ${run.acts_total} · Credits ${run.credits} · Lives ${run.lives}/${run.max_lives}${bossName ? ` · ${bossName} next` : ""}`
            : mode.description}
        </div>
      </div>
      <span
        aria-hidden="true"
        style={{
          fontFamily: "var(--v2-font-ui)",
          fontSize: "0.75rem",
          fontWeight: 700,
          color: "var(--v2-color-accent)",
          whiteSpace: "nowrap",
        }}
      >
        {resuming ? "Continue →" : "→"}
      </span>
    </Link>
  );
}
