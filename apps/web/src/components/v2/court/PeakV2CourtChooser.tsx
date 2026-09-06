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
import { GameActionButton, RoundReveal } from "@/components/game-feel";
import { usePrefersReducedMotion } from "@/lib/a11y";
import { useEffect, useState } from "react";
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
  /** Which command the builder's lane holds, and which candidate row it is
   *  about -- the row shows pending, the others stay disabled buttons. */
  pendingKind?: string | null;
  pendingSlug?: string | null;
  /** Changes per new round (and per new game): the round card lands once
   *  per key, over the reels, for the first beat only. */
  roundKey?: string;
  respinPending: boolean;

  canRespinTeam: boolean;
  canRespinSeason: boolean;
  teamRespinsLeft: number;
  seasonRespinsLeft: number;
  onRespinTeam: () => Promise<unknown> | void;
  onRespinSeason: () => Promise<unknown> | void;

  difficulty: "easy" | "hard";
  hintUsed: boolean;
  hintMessage: string | null;
  /** The recommended candidate's slug, for `EligiblePlayerSearch`'s own
   *  `highlightSlug` marker — same identity legacy's search list marks,
   *  never a score (ADR-005 Decision 6 has none to leak). */
  hintSlug?: string | null;
  onHint: () => Promise<unknown> | void;
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
  pendingKind = null,
  pendingSlug = null,
  roundKey,
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
  // ROUND START: the round identifier lands over the reels for one short
  // beat (Level 2), then the spin -- which has ALREADY started underneath --
  // takes over. Adds no time to the ceremony: the reels' own clock is
  // untouched. Under reduced motion the card is skipped entirely.
  const reduced = usePrefersReducedMotion();
  const [roundCardFor, setRoundCardFor] = useState<string | null>(null);
  useEffect(() => {
    if (!roundKey || reduced || !open) return;
    setRoundCardFor(roundKey);
    const id = window.setTimeout(() => setRoundCardFor(null), 620);
    return () => window.clearTimeout(id);
  }, [roundKey, reduced, open]);
  const roundCardOpen = roundCardFor !== null && roundCardFor === roundKey;

  return (
    <PeakV2DockedPanel
      open={open}
      onClose={onClose}
      label={`Round ${roundNumber} of ${totalRounds} — choose a player`}
      data-testid="selection-overlay"
      data-backdrop-testid="selection-overlay-scrim"
      maxHeightVh={96}
      // Mobile stays PeakV2DockedPanel's own near-full-height bottom sheet
      // (bottom-anchored) -- intentional at 390px, see the human-
      // acceptance-testing note below. Desktop widths get a shorter,
      // VERTICALLY CENTERED panel instead of a sheet crowding the viewport
      // bottom (human acceptance testing, task §7/§Issue-1): a
      // bottom-anchored sheet at 82vh left only Dialog's own fixed 16px
      // inset between the panel and the true viewport bottom at both
      // 1440x900 and 1280x800 -- "crowding," not "breathing room," and not
      // remotely "centered." `.peak-v2-court-chooser-panel` (court.css)
      // overrides `align-self`/`height` above a 768px breakpoint only,
      // scoped to this one caller's own class -- `PeakV2DockedPanel` itself
      // (its bottom-sheet default, its own contract, its own unit tests)
      // is untouched, so every OTHER docked-panel caller keeps the exact
      // bottom-sheet behavior it already has, and this prop change is
      // invisible above 768px.
      //
      // 82 -> 96 (mobile hit-testing fix): the fixed header zone below
      // (round title + up to three wrapped respin/view-court pills +
      // SpinStage's two-wheel grid) measures ~527px tall at a 390px CI
      // viewport on a long roll -- real, verified `getBoundingClientRect`
      // data, not an estimate. At 82vh (596px total, `PeakV2DockedPanel`'s
      // `min(82vh, 100dvh-32px)`) that left the scrollable candidate body
      // only 31-47px, with candidate rows rendered below the panel's own
      // `overflow:hidden` bottom edge -- axe-clean, actionable per
      // Playwright's own checks, but landing `elementFromPoint` on
      // `selection-overlay`/`spin-stage` instead, and occasionally racing
      // the scroll-into-view long enough to blow the 120s CI test budget.
      // Raising the RESERVED PANEL BUDGET (not capping the header, which a
      // reverted earlier version of this fix tried -- see the head zone's
      // own comment for why that broke the roll-stage/chooser containment
      // check instead) gives both zones real, non-overlapping room without
      // touching either one's own sizing rule. 96vh is still bounded by
      // `PeakV2DockedPanel`'s own `calc(100dvh - 32px)` term, so this can
      // never exceed the sheet's existing hard ceiling -- it only claims
      // more of the room already available under it.
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
          body's content. See `maxHeightVh` on `PeakV2DockedPanel` below for
          how the body is guaranteed real room WITHOUT capping this zone's
          own box -- capping it (an earlier version of this fix) let
          `SpinStage`'s actual content run past this zone's own bottom edge
          while the body's rect started right at that (now-too-small) edge,
          which is precisely the overlap
          "respin animation stays contained (Bug 4)" already exists to
          catch, and did, in CI. */}
      <div data-testid="selection-overlay-head" style={{ flexShrink: 0 }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <PeakV2ResultHeadline as="h2" scale="line">
              Round {roundNumber} <PeakV2DisplayEmphasis tone="inherit">of {totalRounds}</PeakV2DisplayEmphasis>
            </PeakV2ResultHeadline>
            {/* The rolled team/season + eligible count, reveal-safe: reads
                from `displaySpin` (the same "previous roll while a respin
                is still visually landing" guard the candidate list below
                already uses), never the raw, possibly-not-yet-visible
                `spin`. */}
            {displaySpin && displaySpin.spin_type !== "open_pool" && ceremonyRevealed ? (
              <span
                data-testid="overlay-roll-summary"
                className="truncate"
                style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 600, color: "var(--v2-text-secondary)" }}
              >
                {/* THE LEAK-SAFE STATEMENT OF THE ROLL.
                    This line reads `displaySpin`, not `spin` — the "keep
                    showing the PREVIOUS roll while a respin is still
                    visually landing" guard — which makes it the one piece
                    of text on this panel that provably cannot leak a new
                    team or season before the reel lands. Two regression
                    tests depend on exactly that
                    (`courtbuilder.spec.ts` 2.6, team and season respins).
                    An earlier version of this pass trimmed it to just the
                    eligible count to remove a third statement of the same
                    facts, which silently disarmed both guards — so it
                    stays, small and secondary, and the redundancy that was
                    actually removed is elsewhere (the "You rolled:"
                    sentence and the eligible-count sentence under the
                    reels). */}
                {displaySpin.franchise_display_name} · {displaySpin.era_label}
                <span style={{ color: "var(--v2-text-muted)" }}> · {displaySpin.candidates.length} eligible</span>
              </span>
            ) : null}
          </div>
          {/* `whitespace-nowrap` on each pill, `flex-wrap` on the row: at
              390px three pills plus the headline cannot share one line, so
              the GROUP wraps to its own row — a label like "Respin team (3)"
              must never wrap inside its own pill. */}
          {/* THE RESPINS ARE NOT HERE ANY MORE. They used to sit in this row
              as two detached rectangles next to "View court" — three pills
              that looked alike, only one of which had anything to do with
              the roll, and neither of which said WHICH axis it acted on.
              They are now rendered inside their own axis in `SpinStage`
              below (`teamAction`/`seasonAction`), where "Respin team (3
              left)" sits beside the team it would respin. The remaining
              count travels with the control, so it stays visible.

              What is left in this row is the one control that genuinely
              belongs to the PANEL rather than to the roll — the way out to
              the court — plus the round's one-time hint, moved up from the
              candidate list's own header where it occupied a full 38px row
              of the list's height for a single button. */}
          <div className="flex flex-wrap items-center gap-2">
            {difficulty === "easy" && !collapsed && ceremonyRevealed ? (
              <GameActionButton
                variant="secondary"
                data-testid="hint-btn"
                size="sm"
                className="whitespace-nowrap"
                onAction={onHint}
                pending={pendingKind === "hint"}
                pendingLabel="Asking PEAK3…"
                disabled={busy || respinPending || hintUsed}
              >
                {hintUsed ? "Hint used" : "Give me a suggestion"}
              </GameActionButton>
            ) : null}
            <PeakV2SecondaryAction data-testid="minimize-overlay-btn" size="sm" className="whitespace-nowrap" onClick={onClose}>
              View court
            </PeakV2SecondaryAction>
          </div>
        </div>

        <div className="relative mt-4" data-testid="spin-stage-frame">
          <RoundReveal
            open={roundCardOpen}
            eyebrow="82-0 PEAK Season"
            title={`Round ${roundNumber}`}
            detail={`of ${totalRounds} · a real team-season is being drawn`}
            testId="court-round-reveal"
            className="court-round-reveal"
          />
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
            teamAction={
              !collapsed && ceremonyRevealed && spin.spin_type === "team_year" ? (
                <GameActionButton variant="secondary" data-testid="respin-team-btn" size="sm" className="whitespace-nowrap" disabled={busy || !canRespinTeam} pending={pendingKind === "respin_team"} pendingLabel="Respinning…" onAction={onRespinTeam}>
                  Respin team ({teamRespinsLeft} left)
                </GameActionButton>
              ) : null
            }
            seasonAction={
              !collapsed && ceremonyRevealed && spin.spin_type === "team_year" ? (
                <GameActionButton variant="secondary" data-testid="respin-season-btn" size="sm" className="whitespace-nowrap" disabled={busy || !canRespinSeason} pending={pendingKind === "respin_season"} pendingLabel="Respinning…" onAction={onRespinSeason}>
                  Respin season ({seasonRespinsLeft} left)
                </GameActionButton>
              ) : null
            }
          />
        </div>
      </div>

      {/* SCROLLABLE body zone: only this region scrolls, and only it is
          affected by search narrowing the candidate count — the header
          above never moves. `minHeight: 0` is required for a flex child to
          actually shrink below its content size and become scrollable
          rather than overflowing its flex parent. */}
      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }} className="mt-4">
        {/* Gated on `!collapsed` (== `phase === "spinning"`), matching
            legacy's own `phase === "spinning" && ...` gate exactly: once a
            player is selected (`phase === "placing"`), the candidate panel
            must actually disappear (not just visually collapse behind the
            docked panel, which stays `keepMounted`) -- selection and
            placement never overlap, on the court or in the DOM. */}
        {!collapsed && displaySpin && ceremonyRevealed && candidates ? (
          <div data-testid="candidate-panel">
            {/* `flex-wrap`, matching the header row's own pattern above: at
                narrow widths the label plus the hint button cannot always
                share one line, so the label wrapping internally (splitting
                "N ELIGIBLE" across two lines mid-row against a vertically
                centered button) is worse than letting the button drop to its
                own row. */}
            {/* NO HEADER ROW. It held a "Step 1 · Choose a player · N
                eligible" label (the third statement of two facts already on
                this panel) and the hint button, which has moved to the panel
                header. Both cost the candidate list ~50px — nearly a whole
                row — to say nothing new. */}
            {hintMessage ? (
              <p data-testid="hint-message" className="mb-2" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-color-accent)" }}>
                {hintMessage}
              </p>
            ) : null}
            <div>
              <EligiblePlayerSearch candidates={candidates} onSelect={onSelectCandidate} disabled={busy || respinPending} pendingSlug={pendingSlug} highlightSlug={hintSlug} />
            </div>
          </div>
        ) : null}
      </div>
    </PeakV2DockedPanel>
  );
}
