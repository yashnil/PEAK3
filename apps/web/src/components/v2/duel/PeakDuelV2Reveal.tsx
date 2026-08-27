"use client";

/**
 * PeakDuelV2Reveal — the intermediate result (Pass 3, product-direction).
 *
 * Verified against the reference (E2 page 22): same LEFT/RIGHT identities as
 * the question that produced this result, a center verdict column (points
 * awarded, difficulty/gap, streak/session total), five dot-on-line component
 * lanes (`PeakV2DataLane`, Pass 2.5's grammar) in FIXED left/right position —
 * never resorted by winner/loser — and one real server-generated explanation
 * line. The result stays on screen indefinitely; the player advances only by
 * pressing "Next Matchup" / "See results", the same `onNext` (dispatched
 * ADVANCE) action legacy's `RevealPanel` already uses. There is no auto-
 * advance timer anywhere in Peak Duel — removed entirely, not hidden.
 *
 * "YOUR PICK" SEMANTICS: `selectedPeakId` — the reducer's own
 * `selected_peak_id`, still populated in the `revealing` phase until
 * `ADVANCE` clears it — is the ONLY source of "which side is the player's",
 * never derived from `winnerIsLeft`/`answer.correct`. It drives the per-side
 * TAG ("Your pick · correct" / "Not selected"), and nothing else.
 *
 * DOT-FILL SEMANTICS (superseded, deliberately): the five component lanes
 * pass `fill="higher"`, so a filled dot means THIS SIDE SCORED HIGHER ON
 * THIS LANE — computed per lane, independently of the player's selection, of
 * who won the matchup overall, and of which side a name was dealt to. An
 * earlier pass filled the dot for the side the player clicked; that made the
 * lane row answer "what did I pick?", a question the reader already knows
 * the answer to and which the tags above already state, while leaving the
 * question the row exists to answer — "who was actually better at this?" —
 * readable only by comparing two small numbers by eye. It also degenerated
 * badly on a timeout: with no pick, every lane rendered both dots hollow and
 * the entire comparison went blank (see design-review/05).
 *
 * A lane whose two values are EQUAL at the one-decimal precision printed
 * beside them is a tie and renders neutral — both dots hollow. Real data
 * produces these regularly (design-review/05 had two in one matchup), and
 * promoting one side on a difference the reader cannot see would be the
 * lane claiming something its own printed numbers do not support.
 */

import { useEffect, useRef } from "react";
import PeakV2LiveHeader from "../PeakV2LiveHeader";
import PeakV2GameStatus from "../PeakV2GameStatus";
import PeakV2PlayerIdentity from "../PeakV2PlayerIdentity";
import PeakV2Score from "../PeakV2Score";
import PeakV2DataLane from "../PeakV2DataLane";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import { RANKING_COMPONENT_ORDER, RANKING_COMPONENT_TONE, RANKING_COMPONENT_LABEL } from "@/lib/v2-component-map";
import type { AnswerResponse, Duel } from "@/types";

export interface PeakDuelV2RevealProps {
  mode: "daily" | "endless";
  duel: Duel;
  answer: AnswerResponse;
  /** The reducer's own `selected_peak_id` — null only for a genuine no-pick
   *  (decision clock expired before the player chose a side). This is the
   *  sole source of "which side is the player's"; never re-derive it from
   *  `winning_peak_id`/`answer.correct`. */
  selectedPeakId: string | null;
  currentIndex: number;
  totalDuels: number;
  totalArenaPoints: number;
  currentStreak: number;
  isLast: boolean;
  onNext: () => void;
}

export default function PeakDuelV2Reveal({
  mode,
  duel,
  answer,
  selectedPeakId,
  currentIndex,
  totalDuels,
  totalArenaPoints,
  currentStreak,
  isLast,
  onNext,
}: PeakDuelV2RevealProps) {
  // Focus "Next Matchup" WITHOUT scrolling. The plain `autoFocus` prop this
  // replaced is `focus()` with no options, and the browser scrolls a freshly
  // focused element into view — this file's own duel-viewport.spec.ts exists
  // because that scroll is exactly the "page jumps when I pick" bug (measured
  // upstream, legacy's `RevealPanel`, at 603-626px). `preventScroll: true`
  // keeps the keyboard contract (focus lands here, Enter still advances)
  // while dropping the viewport-following side effect.
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);

  // FIXED left/right identity — never resorted by winner/loser. `winner`/
  // `loser` on `AnswerResponse` are PeakWindow objects; map each back onto
  // whichever real side (left/right) it actually is via `winning_peak_id`,
  // the exact same comparison `GameEngine`'s own legacy JSX already makes.
  const winnerIsLeft = answer.winning_peak_id === duel.left.peak_id;
  const leftWindow = winnerIsLeft ? answer.winner : answer.loser;
  const rightWindow = winnerIsLeft ? answer.loser : answer.winner;
  const leftIsWinner = winnerIsLeft;
  const rightIsWinner = !winnerIsLeft;

  // WHICH side is the player's — from the actual click, never from the
  // outcome. Drives the per-side tag only; the lane dots below are decided
  // by the lane's own data (`fill="higher"`), not by this.
  const pickedSide: "left" | "right" | "none" =
    selectedPeakId === null ? "none" : selectedPeakId === duel.left.peak_id ? "left" : "right";
  const leftPicked = pickedSide === "left";
  const rightPicked = pickedSide === "right";

  // Per-side tag: distinguishes "the player's pick" from "the correct
  // answer" — the two used to be silently conflated (the winning side
  // always read "Your pick · correct" even when the player picked the
  // OTHER side and was wrong).
  function sideTag(picked: boolean, isWinner: boolean): { text: string; color: string } {
    if (picked && isWinner) return { text: "Your pick · correct", color: "var(--v2-color-positive)" };
    if (picked && !isWinner) return { text: "Your pick · incorrect", color: "var(--v2-color-negative)" };
    if (!picked && isWinner) return { text: "Correct answer", color: "var(--v2-color-positive)" };
    return { text: "Not selected", color: "var(--v2-text-muted)" };
  }
  const leftTag = sideTag(leftPicked, leftIsWinner);
  const rightTag = sideTag(rightPicked, rightIsWinner);

  return (
    <div role="region" aria-label="Answer result">
      <PeakV2LiveHeader
        as="h1"
        title={mode === "daily" ? "Peak Duel · Daily" : "Peak Duel · Endless"}
        status={<PeakV2GameStatus label={mode === "daily" ? `${currentIndex + 1} of ${totalDuels}` : "Endless"} state="idle" />}
        instrument={
          <div className="flex items-center gap-4">
            {currentStreak > 0 ? (
              <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.8125rem", fontWeight: 700, color: "var(--v2-color-accent)" }}>
                🔥 {currentStreak}
              </span>
            ) : null}
            {/* Text and width kept IDENTICAL to `PeakDuelV2Question`'s own
                instrument span on purpose: this header row must render at
                the same height in both phases (see the note above the grid
                below) — a longer string here (e.g. a "Session total" prefix)
                is exactly what widens this `shrink-0` slot enough to squeeze
                the title onto two lines on a narrow viewport, which is a
                real, measured mobile regression this component used to have. */}
            <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.8125rem", fontWeight: 700, color: "var(--v2-text-primary)" }}>
              {totalArenaPoints.toLocaleString()} pts
            </span>
          </div>
        }
      />

      {/* The verdict lives INSIDE the grid's center column (below), not as a
          block above it. `PeakDuelV2Stage`'s wrapper vertically CENTERS its
          single child (`justify-center`, so a short question is never
          stranded near the top of a tall viewport) — any element inserted
          between the header and the grid changes this component's total
          height relative to `PeakDuelV2Question`'s, which re-centers the
          whole block and moves the cards on screen even though the window
          never scrolls (duel-viewport.spec.ts's "the cards moved on screen"
          failure mode). The header-to-grid gap is `mt-10` in both
          components for the same reason — verified by that file's own
          pixel-level assertions, not a coincidence. */}
      <div className="mt-10 grid grid-cols-1 items-start gap-6 sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
        <div data-testid="duel-card-left" className="flex flex-col items-start gap-1.5 text-left">
          <span
            style={{
              fontFamily: "var(--v2-font-mono)",
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: leftTag.color,
            }}
          >
            {leftTag.text}
          </span>
          <PeakV2PlayerIdentity name={duel.left.player_name} align="start" size="lg" state={leftIsWinner ? "current" : "default"} />
          <PeakV2Score value={leftWindow.prime_score.toFixed(1)} tone={leftIsWinner ? "positive" : "neutral"} size="lg" />
        </div>

        <div className="flex flex-col items-center gap-1 py-2 text-center">
          {/* Same "Correct!" / "Not quite." wording legacy's `RevealPanel`
              used, relocated into this column so it costs no extra height
              above the row the cards themselves start on. */}
          <p
            style={{
              fontFamily: "var(--v2-font-ui)",
              fontWeight: 700,
              fontSize: "1rem",
              margin: 0,
              color: answer.correct ? "var(--v2-color-positive)" : "var(--v2-text-secondary)",
            }}
          >
            {answer.correct ? "Correct!" : "Not quite."}
          </p>
          {answer.correct ? (
            <PeakV2Score value={`+${Math.round(answer.arena_points_awarded)}`} tone="accent" size="md" />
          ) : (
            <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "1.125rem", fontWeight: 700, color: "var(--v2-color-negative)" }}>
              +0
            </span>
          )}
          <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>
            {answer.difficulty} · gap {answer.score_gap.toFixed(1)}
          </span>
          <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, color: "var(--v2-text-muted)" }}>
            Session total {totalArenaPoints.toLocaleString()} pts
          </span>
        </div>

        <div data-testid="duel-card-right" className="flex flex-col items-start gap-1.5 text-left sm:items-end sm:text-right">
          <span
            style={{
              fontFamily: "var(--v2-font-mono)",
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: rightTag.color,
            }}
          >
            {rightTag.text}
          </span>
          {/* Inline rather than `PeakV2PlayerIdentity` (fixed `align`, no
              responsive variant) — mobile stays left-aligned like every
              other row on this screen; only `sm:` flips to right-flush. */}
          <span
            style={{
              fontFamily: "var(--v2-font-ui)",
              fontWeight: 700,
              fontSize: "1.25rem",
              color: rightIsWinner ? "var(--v2-color-accent)" : "var(--v2-text-primary)",
            }}
          >
            {duel.right.player_name}
          </span>
          <PeakV2Score value={rightWindow.prime_score.toFixed(1)} tone={rightIsWinner ? "positive" : "neutral"} size="lg" />
        </div>
      </div>

      <p
        className="mt-8"
        style={{
          fontFamily: "var(--v2-font-ui)",
          fontSize: "0.6875rem",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--v2-text-muted)",
        }}
      >
        Component comparison
      </p>
      <div className="mt-2 flex flex-col gap-3">
        {RANKING_COMPONENT_ORDER.map((key) => {
          const comp = answer.component_comparison[key];
          if (!comp) return null;
          const leftValue = winnerIsLeft ? comp.winner : comp.loser;
          const rightValue = winnerIsLeft ? comp.loser : comp.winner;
          const max = Math.max(Math.abs(leftValue), Math.abs(rightValue), 1) * 1.15;
          return (
            <PeakV2DataLane
              key={key}
              label={RANKING_COMPONENT_LABEL[key]}
              tone={RANKING_COMPONENT_TONE[key]}
              leftLabel=""
              leftValue={leftValue.toFixed(1)}
              rightLabel=""
              rightValue={rightValue.toFixed(1)}
              scaleMin={0}
              scaleMax={max}
              fill="higher"
            />
          );
        })}
      </div>

      <p
        className="mt-6 max-w-[64ch] border-l-2 pl-3 italic"
        style={{ borderColor: "var(--v2-color-accent)", fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}
      >
        {answer.explanation}
      </p>

      <div className="mt-6 flex items-center justify-between gap-3">
        <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
          Ready when you are.
        </p>
        <PeakV2PrimaryAction ref={nextRef} onClick={onNext}>
          {isLast ? "See results" : "Next Matchup"}
        </PeakV2PrimaryAction>
      </div>
    </div>
  );
}
