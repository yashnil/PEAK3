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
 */

import PeakV2DockedPanel from "../PeakV2DockedPanel";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2DisplayEmphasis from "../PeakV2DisplayEmphasis";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
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
  onHint,
}: PeakV2CourtChooserProps) {
  return (
    <PeakV2DockedPanel open={open} onClose={onClose} label={`Round ${roundNumber} of ${totalRounds}`} maxHeightVh={82}>
      <div className="flex items-center justify-between gap-3">
        <PeakV2ResultHeadline as="h2" scale="line">
          Round {roundNumber} <PeakV2DisplayEmphasis tone="inherit">of {totalRounds}</PeakV2DisplayEmphasis>
        </PeakV2ResultHeadline>
        <div className="flex items-center gap-2">
          {ceremonyRevealed && spin.spin_type === "team_year" ? (
            <>
              <PeakV2SecondaryAction size="sm" disabled={busy || !canRespinTeam} onClick={onRespinTeam}>
                Respin team ({teamRespinsLeft})
              </PeakV2SecondaryAction>
              <PeakV2SecondaryAction size="sm" disabled={busy || !canRespinSeason} onClick={onRespinSeason}>
                Respin season ({seasonRespinsLeft})
              </PeakV2SecondaryAction>
            </>
          ) : null}
          <PeakV2SecondaryAction size="sm" onClick={onClose}>
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

      {displaySpin && ceremonyRevealed && candidates ? (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
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
            {difficulty === "easy" ? (
              <PeakV2PrimaryAction onClick={onHint} disabled={busy || respinPending || hintUsed}>
                {hintUsed ? "Hint used" : "Suggest one"}
              </PeakV2PrimaryAction>
            ) : null}
          </div>
          {hintMessage ? (
            <p className="mt-1" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-color-accent)" }}>
              {hintMessage}
            </p>
          ) : null}
          <div className="mt-3">
            <EligiblePlayerSearch candidates={candidates} onSelect={onSelectCandidate} disabled={busy || respinPending} />
          </div>
        </div>
      ) : null}
    </PeakV2DockedPanel>
  );
}
