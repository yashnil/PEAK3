"use client";

/**
 * PeakV2RTTShell — the run around the decision.
 *
 * One composition for every screen of a run, so the player never loses
 * their place between a draft and a boss:
 *
 *   header   identity (which run, which board) · objective · credits meter ·
 *            lives · act · how to play · start new run
 *   track    the whole run as chapters (`RunTrack`), current mark brightest
 *   body     LIVE  → decision (dominant) | roster rail
 *            FOCUS → the decision alone, wider (boss encounters, endings)
 *            BARE  → the receipt owns its own composition
 *
 * Moments (a signing, a life lost, an act cleared) are announced over the
 * body from the SAME snapshot that changed the board — the shell only
 * positions them. On a phone the rail becomes a collapsible block under the
 * decision and a sticky bar keeps credits and lives in reach.
 */

import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import PeakV2Shell from "../PeakV2Shell";
import PeakV2GameStatus from "../PeakV2GameStatus";
import ResourceMeter from "@/components/game-feel/ResourceMeter";
import LifeMeter from "@/components/game-feel/LifeMeter";
import RunTrack, { type RunTrackChapter } from "@/components/game-feel/RunTrack";
import EventMoment from "@/components/game-feel/EventMoment";
import RoundReveal from "@/components/game-feel/RoundReveal";
import ScoreTransition from "@/components/game-feel/ScoreTransition";
import { runIdentity, runTrackActs, type RunMoment, type ScoutIntel } from "@/lib/run-the-table-state";
import type { RunPublicState } from "@/types/run-the-table";
import { componentTextColor } from "@/lib/utils";
import PeakV2RTTRoster from "./PeakV2RTTRoster";

export interface ActTransitionMoment {
  id: string;
  /** "I" */
  numeral: string;
  detail?: string;
}

export interface PeakV2RTTShellProps {
  state: RunPublicState;
  objective: string;
  layout: "live" | "focus" | "bare";
  content: ReactNode;
  restartControl?: ReactNode;
  scoutIntel?: ScoutIntel | null;
  errorBanner?: ReactNode;
  /** Credits after the action the player is lining up, or null. */
  projectedCredits?: number | null;
  /** Roster slots the current selection could land in. */
  targetedSlots?: readonly string[];
  pendingSlot?: string | null;
  moment?: RunMoment | null;
  onMomentDone?: (id: string) => void;
  actTransition?: ActTransitionMoment | null;
  onHelp?: () => void;
  /** A boss encounter is on: the shell recedes and the track's boss mark leads. */
  boss?: boolean;
}

export function trackChapters(state: RunPublicState): RunTrackChapter[] {
  return runTrackActs(state.map, state.act).map((act) => ({
    key: `a${act.act}`,
    numeral: act.numeral,
    state: act.state,
    marks: [...act.nodes, act.boss].map((n) => ({
      key: n.key,
      kind: n.kind,
      state: n.state,
      label: n.label,
      lifeLost: n.lifeLost,
    })),
  }));
}

export default function PeakV2RTTShell({
  state,
  objective,
  layout,
  content,
  restartControl,
  scoutIntel,
  errorBanner,
  projectedCredits = null,
  targetedSlots = [],
  pendingSlot = null,
  moment = null,
  onMomentDone,
  actTransition = null,
  onHelp,
  boss = false,
}: PeakV2RTTShellProps) {
  if (layout === "bare") {
    return (
      <PeakV2Shell width="live">
        <div data-testid="rtt-shell" data-arena="live" className="rtt-run rtt-shell-bare" data-layout="bare">
          {content}
        </div>
      </PeakV2Shell>
    );
  }

  const identity = runIdentity(state);
  const chapters = trackChapters(state);
  const creditsMax = Math.max(state.starting_credits, state.credits, projectedCredits ?? 0);
  const danger = state.lives <= 1;

  return (
    <PeakV2Shell width="live-wide">
      <div data-testid="rtt-shell" data-arena="live" className="rtt-run" data-layout={layout} data-boss={boss ? "true" : "false"} data-danger={danger ? "true" : "false"}>
        <header className="rtt-head" data-testid="rtt-hud">
          <div className="rtt-head-identity">
            <div className="rtt-head-title-row">
              <PeakV2GameStatus label="Live" state="active" />
              <span className="rtt-head-title">Run the Table</span>
              <span className="rtt-head-run" data-testid="rtt-run-identity" data-run-kind={identity.kind} title={identity.note}>
                {identity.title} · {identity.detail}
              </span>
            </div>
            <span className="rtt-head-objective" data-testid="rtt-hud-objective">
              {objective}
            </span>
            {scoutIntel ? (
              <span className="rtt-head-scout" data-testid="rtt-hud-scout-pin">
                Scouted {scoutIntel.bossName} · weak <span style={{ color: componentTextColor(scoutIntel.weakestLane) }}>{scoutIntel.weakestLabel}</span>
              </span>
            ) : null}
          </div>
          <div className="rtt-head-meters">
            <span data-tour-id="rtt-credits" className="rtt-head-credits">
              <ResourceMeter
                value={state.credits}
                max={creditsMax}
                projected={projectedCredits}
                label="Credits"
                size="sm"
                testId="rtt-credits-meter"
                valueTestId="rtt-credits"
              />
            </span>
            <span data-tour-id="rtt-lives">
              <LifeMeter lives={state.lives} max={state.max_lives} testId="rtt-lives-meter" valueTestId="rtt-lives" />
            </span>
            <span className="rtt-head-act" data-testid="rtt-act">
              <span className="rtt-head-act-label">Act</span>
              <span className="rtt-head-act-value">
                {Math.min(state.act, state.acts_total)}/{state.acts_total}
              </span>
            </span>
            <span className="rtt-head-controls">
              {onHelp ? (
                <button type="button" className="rtt-help" onClick={onHelp} data-testid="rtt-help" aria-label="How to play">
                  <HelpCircle size={14} aria-hidden="true" />
                  <span>How to play</span>
                </button>
              ) : null}
              {restartControl}
            </span>
          </div>
        </header>

        <div className="rtt-track-row" data-tour-id="rtt-run-map">
          <RunTrack chapters={chapters} testId="rtt-run-track" markTestIdPrefix="rtt-map-row" />
        </div>

        <div className="rtt-body" data-layout={layout}>
          <div className="rtt-stage" data-tour-id="rtt-decision">
            {errorBanner}
            {content}
            <EventMoment moment={moment} onDone={onMomentDone} testId="rtt-moment" className="rtt-moment" durationMs={1600} />
            <RoundReveal
              open={actTransition !== null}
              eyebrow={actTransition ? `Act ${actTransition.numeral}` : undefined}
              title="Cleared"
              detail={actTransition?.detail}
              placement="overlay"
              testId="rtt-act-transition"
              className="rtt-act-transition"
            />
          </div>
          {layout === "live" ? (
            <aside className="rtt-rail">
              <PeakV2RTTRoster state={state} targetedSlots={targetedSlots} pendingSlot={pendingSlot} variant="rail" />
            </aside>
          ) : null}
        </div>

        {layout === "live" ? (
          <details className="rtt-sheet" data-testid="rtt-roster-sheet">
            <summary>
              <span className="rtt-eyebrow">Your roster</span>
              <span className="rtt-sheet-count">
                {[...state.starters, ...state.bench].filter((s) => s.card).length}/{state.starters.length + state.bench.length}
              </span>
            </summary>
            <PeakV2RTTRoster state={state} targetedSlots={targetedSlots} pendingSlot={pendingSlot} variant="sheet" testIds={false} />
          </details>
        ) : null}

        <div className="rtt-mobile-bar" data-testid="rtt-mobile-tray" data-tour-id="rtt-mobile-tray" data-danger={danger ? "true" : "false"}>
          <span className="rtt-mobile-stat">
            <span className="rtt-eyebrow">Credits</span>
            <ScoreTransition value={projectedCredits ?? state.credits} className="rtt-mobile-value" testId="rtt-mobile-credits" />
          </span>
          <LifeMeter lives={state.lives} max={state.max_lives} size="sm" testId="rtt-mobile-lives-meter" valueTestId="rtt-mobile-lives" />
          <span className="rtt-mobile-stat">
            <span className="rtt-eyebrow">Act</span>
            <span className="rtt-mobile-value">
              {Math.min(state.act, state.acts_total)}/{state.acts_total}
            </span>
          </span>
        </div>
      </div>
    </PeakV2Shell>
  );
}
