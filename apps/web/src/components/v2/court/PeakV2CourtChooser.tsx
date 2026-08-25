"use client";

/**
 * PeakV2CourtChooser — the 82-0 roll/chooser, CINEMATIC → LIVE in one flow
 * (Pass 3). `PeakV2DockedPanel` was built in Pass 2.5 explicitly for this —
 * "the court stays visible behind this card" — so this is its first real
 * integration: a bottom-docked sheet, never an opaque full-screen dialog,
 * with the court (`PeakV2CourtLive`, mounted by the caller, dimmed by the
 * panel's own real backdrop) still visible above/behind it.
 *
 * Reuses `SpinStage` (the real, reconnect-safe reveal ceremony) and
 * `EligiblePlayerSearch` (ADR-005 Decision 6: never renders a score) VERBATIM
 * — this pass restyles the chrome around them, not the reveal timing or the
 * candidate list's own correctness-critical logic.
 *
 * Pass 7 (human acceptance testing): the shell's total height is now FIXED
 * by `PeakV2DockedPanel`, not merely capped, and this component's own content
 * is split into a non-scrolling header (round title, respin/view-court
 * controls, the roll itself) and a scrollable body (the "choose a player"
 * search + candidate list only) — search narrowing the candidate count, or
 * the candidate section appearing after the ceremony resolves, no longer
 * resizes or repositions the sheet.
 */

import PeakV2DockedPanel from "../PeakV2DockedPanel";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2DisplayEmphasis from "../PeakV2DisplayEmphasis";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import SpinStage from "@/components/court/SpinStage";
import EligiblePlayerSearch from "@/components/court/EligiblePlayerSearch";
import type { CurrentSpin, SpinCandidate } from "@/types/perfect-season";

export interface PeakV2CourtChooserProps {
  open: boolean;
  onClose: () => void;
  roundNumber: number;
  totalRounds: number;
  spin: CurrentSpin;
  franchiseNames: string[];
  seasonLabels: string[];
  teamLogoUrls: Record<string, string>;
  onRevealComplete: () => void;
  onRespinSettled: () => void;
  respinFlashKey: number;
  respinKind: "team" | "season" | null;
  respinFrom: { team: string | null; season: string | null } | null;
  collapsed: boolean;

  ceremonyRevealed: boolean;
  displaySpin: CurrentSpin | null;
  candidates: SpinCandidate[] | null;
  onSelectCandidate: (playerSlug: string) => void;
  busy: boolean;
  respinPending: boolean;

  canRespinTeam: boolean;
  canRespinSeason: boolean;
  teamRespinsLeft: number;
  seasonRespinsLeft: number;
  onRespinTeam: () => void;
  onRespinSeason: () => void;

  difficulty: "easy" | "hard";
  hintUsed: boolean;
  hintMessage: string | null;
  /** The recommended candidate's slug, for `EligiblePlayerSearch`'s own
   *  `highlightSlug` marker — same identity legacy's search list marks,
   *  never a score (ADR-005 Decision 6 has none to leak). */
  hintSlug?: string | null;
  onHint: () => void;
}

export default function PeakV2CourtChooser({
  open,
  onClose,
  roundNumber,
  totalRounds,
  spin,
  franchiseNames,
  seasonLabels,
  teamLogoUrls,
  onRevealComplete,
  onRespinSettled,
  respinFlashKey,
  respinKind,
  respinFrom,
  collapsed,
  ceremonyRevealed,
  displaySpin,
  candidates,
  onSelectCandidate,
  busy,
  respinPending,
  canRespinTeam,
  canRespinSeason,
  teamRespinsLeft,
  seasonRespinsLeft,
  onRespinTeam,
  onRespinSeason,
  difficulty,
  hintUsed,
  hintMessage,
  hintSlug = null,
  onHint,
}: PeakV2CourtChooserProps) {
  return (
    <PeakV2DockedPanel
      open={open}
      onClose={onClose}
      label={`Round ${roundNumber} of ${totalRounds}`}
      maxHeightVh={82}
      // Mobile stays PeakV2DockedPanel's own default: a near-full-height
      // bottom sheet (82vh, bottom-anchored) -- intentional at 390px, see
      // the human-acceptance-testing note below. Desktop widths get a
      // shorter, VERTICALLY CENTERED panel instead of a sheet crowding the
      // viewport bottom (human acceptance testing, task §7/§Issue-1): a
      // bottom-anchored sheet at 82vh left only Dialog's own fixed 16px
      // inset between the panel and the true viewport bottom at both
      // 1440x900 and 1280x800 -- "crowding," not "breathing room," and not
      // remotely "centered." `.peak-v2-court-chooser-panel` (court.css)
      // overrides `align-self`/`height` above a 768px breakpoint only,
      // scoped to this one caller's own class -- `PeakV2DockedPanel` itself
      // (its bottom-sheet default, its own contract, its own unit tests)
      // is untouched, so every OTHER docked-panel caller keeps the exact
      // bottom-sheet behavior it already has.
      className="peak-v2-court-chooser-panel"
      // `SpinStage` below restarts its own reveal ceremony on every mount
      // (see its docstring, and legacy's identical `hidden`-not-unmounted
      // overlay) -- minimizing/reopening must never look like a fresh spin.
      keepMounted
    >
      {/* FIXED header zone (Pass 7 geometry contract): round title, respin/
          view-court controls, and the roll itself (`SpinStage`) never
          scroll away — task §6 requires all of these stay visible. Only
          the "choose a player" section below scrolls. `flexShrink: 0`
          keeps this zone's own height stable regardless of the scrollable
          body's content. */}
      <div style={{ flexShrink: 0 }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeakV2ResultHeadline as="h2" scale="line">
            Round {roundNumber} <PeakV2DisplayEmphasis tone="inherit">of {totalRounds}</PeakV2DisplayEmphasis>
          </PeakV2ResultHeadline>
          {/* `whitespace-nowrap` on each pill, `flex-wrap` on the row: at
              390px three pills plus the headline cannot share one line, so
              the GROUP wraps to its own row — a label like "Respin team (3)"
              must never wrap inside its own pill. */}
          <div className="flex flex-wrap items-center gap-2">
            {ceremonyRevealed && spin.spin_type === "team_year" ? (
              <>
                <PeakV2SecondaryAction size="sm" className="whitespace-nowrap" disabled={busy || !canRespinTeam} onClick={onRespinTeam}>
                  Respin team ({teamRespinsLeft})
                </PeakV2SecondaryAction>
                <PeakV2SecondaryAction size="sm" className="whitespace-nowrap" disabled={busy || !canRespinSeason} onClick={onRespinSeason}>
                  Respin season ({seasonRespinsLeft})
                </PeakV2SecondaryAction>
              </>
            ) : null}
            <PeakV2SecondaryAction size="sm" className="whitespace-nowrap" onClick={onClose}>
              View court
            </PeakV2SecondaryAction>
          </div>
        </div>

        <div className="mt-4">
          <SpinStage
            key={roundNumber}
            spin={spin}
            roundNumber={roundNumber}
            totalRounds={totalRounds}
            franchiseNames={franchiseNames}
            seasonLabels={seasonLabels}
            teamLogoUrls={teamLogoUrls}
            onRevealComplete={onRevealComplete}
            onRespinSettled={onRespinSettled}
            respinFlashKey={respinFlashKey}
            respinKind={respinKind}
            respinFrom={respinFrom}
            collapsed={collapsed}
          />
        </div>
      </div>

      {/* SCROLLABLE body zone: only this region scrolls, and only it is
          affected by search narrowing the candidate count — the header
          above never moves. `minHeight: 0` is required for a flex child to
          actually shrink below its content size and become scrollable
          rather than overflowing its flex parent. */}
      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }} className="mt-4">
        {displaySpin && ceremonyRevealed && candidates ? (
          <div data-testid="candidate-panel">
            {/* `flex-wrap`, matching the header row's own pattern above: at
                narrow widths the label plus the hint button cannot always
                share one line, so the label wrapping internally (splitting
                "N ELIGIBLE" across two lines mid-row against a vertically
                centered button) is worse than letting the button drop to its
                own row. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                style={{
                  fontFamily: "var(--v2-font-mono)",
                  fontSize: "0.6875rem",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--v2-text-muted)",
                }}
              >
                Choose a player · {candidates.length} eligible
              </span>
              {/* Secondary, not primary: the candidate list below already
                  carries its own gold "Choose" affordance on every single
                  row (`EligiblePlayerSearch`'s "CHOOSE" pill) -- a second,
                  filled-gold CTA sitting directly above a dozen more gold
                  pills competed with them and diluted gold's "one primary
                  action" scarcity (brief §Color/§Button). The hint is a
                  helper for the actual decision, not the decision itself. */}
              {difficulty === "easy" ? (
                <PeakV2SecondaryAction data-testid="hint-btn" size="sm" onClick={onHint} disabled={busy || respinPending || hintUsed}>
                  {hintUsed ? "Hint used" : "Give me a suggestion"}
                </PeakV2SecondaryAction>
              ) : null}
            </div>
            {hintMessage ? (
              <p data-testid="hint-message" className="mt-1" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-color-accent)" }}>
                {hintMessage}
              </p>
            ) : null}
            <div className="mt-3">
              <EligiblePlayerSearch candidates={candidates} onSelect={onSelectCandidate} disabled={busy || respinPending} highlightSlug={hintSlug} />
            </div>
          </div>
        ) : null}
      </div>
    </PeakV2DockedPanel>
  );
}
