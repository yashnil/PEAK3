"use client";
import { useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  ChallengeComparisonResponse,
  ComparisonPlayer,
  ComparisonOutcome,
  ROLE_LABELS,
} from "@/types/draft";
import DNABar from "./DNABar";

interface Props {
  comparison: ChallengeComparisonResponse;
  recipientGameId: string;
  challengeUrl?: string;
  onPlayAgain?: () => void;
}

const OUTCOME_TEXT: Record<ComparisonOutcome, string> = {
  recipient_wins: "YOU WIN 🏆",
  challenger_wins: "YOU LOSE",
  draw: "DRAW",
};

const OUTCOME_COLOR: Record<ComparisonOutcome, string> = {
  recipient_wins: "#34d399",
  challenger_wins: "#ef4444",
  draw: "#f5c842",
};

// ── Sub-components ─────────────────────────────────────────────────────────

function ScoreCol({
  label,
  player,
  isWinner,
}: {
  label: string;
  player: ComparisonPlayer;
  isWinner: boolean;
}) {
  const rating = Math.round(player.lineup_peak_rating * 10) / 10;
  const effPct =
    player.draft_efficiency != null
      ? Math.round(player.draft_efficiency * 100)
      : null;
  const pctLabel =
    player.board_percentile != null
      ? Math.round(player.board_percentile)
      : null;
  const synergySign = player.synergy_total >= 0 ? "+" : "";

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2"
      style={{
        background: "var(--bg-elevated)",
        border: `1px solid ${isWinner ? "var(--peak-accent)" : "var(--border-default)"}`,
      }}
    >
      <div
        className="text-xs uppercase tracking-wider font-semibold"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div
        className="text-xs truncate"
        style={{ color: "var(--text-secondary)" }}
        title={player.display_name}
      >
        {player.display_name}
      </div>
      <div
        className="text-4xl font-bold tabular-nums leading-none"
        style={{ color: isWinner ? "var(--peak-accent)" : "var(--text-primary)" }}
      >
        {rating.toFixed(1)}
      </div>
      <div className="flex flex-col gap-1 mt-1">
        <div
          className="flex justify-between text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          <span>Talent</span>
          <span className="tabular-nums">
            {(Math.round(player.talent_score * 10) / 10).toFixed(1)}
          </span>
        </div>
        <div
          className="flex justify-between text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          <span>Coverage</span>
          <span className="tabular-nums">
            {(Math.round(player.coverage_score * 10) / 10).toFixed(1)}
          </span>
        </div>
        <div
          className="flex justify-between text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          <span>Synergy</span>
          <span className="tabular-nums">
            {synergySign}
            {(player.synergy_total * 100).toFixed(1)}%
          </span>
        </div>
        {effPct != null && (
          <div
            className="flex justify-between text-xs"
            style={{ color: "var(--text-secondary)" }}
          >
            <span>Efficiency</span>
            <span className="tabular-nums">{effPct}%</span>
          </div>
        )}
        {pctLabel != null && (
          <div
            className="flex justify-between text-xs"
            style={{ color: "var(--text-secondary)" }}
          >
            <span>Board</span>
            <span className="tabular-nums">Top {pctLabel}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PicksCol({
  label,
  player,
}: {
  label: string;
  player: ComparisonPlayer;
}) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {/* Column header with tool badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-secondary)" }}
        >
          {label}
        </span>
        {player.hold_used && (
          <span
            className="text-xs px-1.5 py-0.5 rounded font-medium"
            style={{
              background: "rgba(245,200,66,0.12)",
              color: "var(--peak-accent)",
            }}
          >
            ✓ Hold
          </span>
        )}
        {player.reframe_used && (
          <span
            className="text-xs px-1.5 py-0.5 rounded font-medium"
            style={{
              background: "rgba(167,139,250,0.12)",
              color: "#a78bfa",
            }}
          >
            ✓ Reframe
          </span>
        )}
      </div>

      {/* Pick rows */}
      {player.selected_cards.map((card) => (
        <div
          key={card.round}
          className="rounded-lg px-3 py-2 flex flex-col gap-0.5 min-w-0"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div className="flex items-center justify-between gap-1">
            <span
              className="text-xs truncate"
              style={{ color: "var(--text-muted)" }}
            >
              R{card.round} · {ROLE_LABELS[card.role]}
            </span>
            <span
              className="text-xs tabular-nums font-semibold shrink-0"
              style={{ color: "var(--peak-accent)" }}
            >
              {card.individual_peak_score.toFixed(1)}
            </span>
          </div>
          <div
            className="text-sm font-medium leading-snug truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {card.player_name}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ChallengeComparison({
  comparison,
  challengeUrl,
  onPlayAgain,
}: Props) {
  const { outcome, challenger, recipient, board_label } = comparison;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to outcome heading on mount for screen reader announcement
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const handleShareResult = useCallback(async () => {
    if (!challengeUrl) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "PEAK3 Challenge Result",
          url: challengeUrl,
        });
      } catch {
        // cancelled or error — silently ignore
      }
    } else {
      try {
        await navigator.clipboard.writeText(challengeUrl);
      } catch {
        // clipboard blocked — silently ignore
      }
    }
  }, [challengeUrl]);

  const challengerWins = outcome === "challenger_wins";
  const recipientWins = outcome === "recipient_wins";
  const outcomeBadgeColor = OUTCOME_COLOR[outcome];
  const hasDNA = challenger.final_dna !== null || recipient.final_dna !== null;

  return (
    <div data-testid="challenge-comparison" className="flex flex-col gap-6 pb-8 min-w-0">
      {/* ── Outcome header ── */}
      <div className="flex flex-col items-center gap-2 pt-4">
        <h2
          ref={headingRef}
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className="text-3xl font-bold tracking-tight text-center outline-none"
          style={{ color: outcomeBadgeColor }}
        >
          {OUTCOME_TEXT[outcome]}
        </h2>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {board_label}
        </p>
      </div>

      {/* ── Scores ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ScoreCol
          label="Challenger"
          player={challenger}
          isWinner={challengerWins}
        />
        <ScoreCol label="You" player={recipient} isWinner={recipientWins} />
      </div>

      {/* ── Picks ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PicksCol label="Challenger picks" player={challenger} />
        <PicksCol label="Your picks" player={recipient} />
      </div>

      {/* ── DNA ── */}
      {hasDNA && (
        <div className="flex flex-col gap-3">
          <div
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Lineup DNA
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {challenger.final_dna && (
              <div
                className="rounded-xl p-4"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <DNABar dna={challenger.final_dna} label="Challenger" />
              </div>
            )}
            {recipient.final_dna && (
              <div
                className="rounded-xl p-4"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <DNABar dna={recipient.final_dna} label="You" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flex flex-col gap-2">
        <Link
          href="/arena/daily"
          className="block w-full text-center py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
          style={{
            background: "var(--peak-accent)",
            color: "var(--text-inverse)",
          }}
        >
          Play Today&apos;s Daily
        </Link>

        {onPlayAgain && (
          <button
            onClick={onPlayAgain}
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-80"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            Play Again
          </button>
        )}

        {challengeUrl && (
          <button
            onClick={handleShareResult}
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-80"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              color: "var(--text-secondary)",
            }}
          >
            Share Result
          </button>
        )}
      </div>
    </div>
  );
}
