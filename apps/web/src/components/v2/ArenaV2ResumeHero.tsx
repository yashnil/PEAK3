"use client";

/**
 * ArenaV2ResumeHero — the Arena hub's CINEMATIC entry moment (Pass 3).
 *
 * Verified against the real reference (`.claude-private/design/
 * PEAK3-Directions-E.pdf`, E2 page 13 — "PEAK3 Arena / Act 4 — *The Wall* /
 * Continue run · Run map"): a restrained arena-light header, an italic
 * boss/act statement, and the run's real instrumentation underneath —
 * never a generic "Welcome back" banner.
 *
 * REAL DATA ONLY, PER PRODUCT AUTHORITY. RUN THE TABLE progress is
 * localStorage-only (CLAUDE.md's Phase 1 limitation), so this is a client
 * component reading `useRttResumeState()` — the same hook `HomeV2ResumeRow`
 * already uses. No "ranked tier"/"streak"/aggregate-activity figure is
 * invented here: while the check is in flight or resolves to nothing, this
 * renders the plain no-run entry state, never a placeholder run.
 */

import PeakV2CinematicStage from "./PeakV2CinematicStage";
import PeakV2ResultHeadline from "./PeakV2ResultHeadline";
import PeakV2DisplayEmphasis from "./PeakV2DisplayEmphasis";
import PeakV2Score from "./PeakV2Score";
import PeakV2PrimaryAction from "./PeakV2PrimaryAction";
import PeakV2SecondaryAction from "./PeakV2SecondaryAction";
import { useRttResumeState } from "@/lib/v2-resume-state";
import { RUN_THE_TABLE_RUNS_HREF } from "@/lib/modes";

function Instrument({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-start">
      <span
        style={{
          fontFamily: "var(--v2-font-ui)",
          fontSize: "0.6875rem",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--v2-text-muted)",
        }}
      >
        {label}
      </span>
      <PeakV2Score value={value} size="sm" />
    </div>
  );
}

export default function ArenaV2ResumeHero() {
  const { run } = useRttResumeState();

  if (run == null) {
    // Covers BOTH the in-flight check (`undefined`) and "nothing to resume"
    // (`null`) with the same honest entry state — the run's own real fields
    // simply are not known yet either way, and a first-paint flash from "no
    // run" to "a run" reads as a glitch rather than as data arriving.
    return (
      <PeakV2CinematicStage light={{ y: "-6%" }} align="start" className="sm:!items-start">
        <p
          style={{
            fontFamily: "var(--v2-font-ui)",
            fontSize: "0.75rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--v2-color-accent)",
            margin: 0,
          }}
        >
          PEAK3 Arena
        </p>
        <PeakV2ResultHeadline as="h1" scale="hero" className="mt-3 !mx-0 !text-left">
          Every mode. <PeakV2DisplayEmphasis>One arena.</PeakV2DisplayEmphasis>
        </PeakV2ResultHeadline>
        <p
          className="mt-4 max-w-[46ch]"
          style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.9375rem", lineHeight: 1.6, color: "var(--v2-text-secondary)" }}
        >
          RUN THE TABLE is the flagship — five acts, five boss battles, decided
          lane by lane on the same five components as everything else here.
        </p>
        <div className="mt-6">
          <PeakV2PrimaryAction href="/arena/run-the-table?start=standard">
            Start a run
          </PeakV2PrimaryAction>
        </div>
      </PeakV2CinematicStage>
    );
  }

  const bossName = run.next_boss?.name;

  return (
    <PeakV2CinematicStage light={{ y: "-6%" }} align="start" className="sm:!items-start">
      <p
        style={{
          fontFamily: "var(--v2-font-ui)",
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--v2-color-accent)",
          margin: 0,
        }}
      >
        Resume · Run the Table
      </p>
      <PeakV2ResultHeadline as="h1" scale="hero" className="mt-3 !mx-0 !text-left">
        Act {run.act}
        {bossName ? (
          <>
            {" — "}
            <PeakV2DisplayEmphasis>{bossName}</PeakV2DisplayEmphasis>
          </>
        ) : null}
      </PeakV2ResultHeadline>
      <div className="mt-6 flex flex-wrap items-end gap-8">
        <Instrument label="Credits" value={run.credits} />
        <Instrument label="Lives" value={`${run.lives}/${run.max_lives}`} />
        <Instrument label="Stage" value={`${run.stage}/${run.stages_per_act}`} />
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <PeakV2PrimaryAction href="/arena/run-the-table">Continue run</PeakV2PrimaryAction>
        <PeakV2SecondaryAction href={RUN_THE_TABLE_RUNS_HREF}>Your runs</PeakV2SecondaryAction>
      </div>
    </PeakV2CinematicStage>
  );
}
