"use client";

/**
 * The match result: placement, score out of 900, primes found, strongest round,
 * largest miss, average canonical gap, the podium, per-round review, play again.
 * Every number is from `standings` and `round_results`.
 */

import { useMemo } from "react";

import type { FindThePrimeMatchView, FindThePrimeRoundReveal, FindThePrimeSeatAnswer } from "@/types/find-the-prime";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { GameActionButton, ResultReveal, RevealStep } from "@/components/game-feel";
import ArenaFinalPodium from "@/components/prime-arena/ArenaFinalPodium";
import { ordinal } from "@/components/prime-arena/ArenaMatchStrip";
import { LiveRegion } from "@/components/prime-arena/RoomChrome";
import PersonalRecordLine from "@/components/prime-arena/PersonalRecordLine";
import { answerSentence } from "./FindThePrimeReveal";

const STEPS = [
  { name: "headline", at: 0 },
  { name: "stats", at: 450 },
  { name: "podium", at: 1000 },
  { name: "rounds", at: 1400 },
  { name: "actions", at: 1700 },
] as const;

export default function FindThePrimeResult({
  view,
  resumed,
  onPlayAgain,
  message,
}: {
  view: FindThePrimeMatchView;
  resumed: boolean;
  onPlayAgain: () => Promise<void>;
  message: string;
}) {
  const state = view.public_state;
  const you = view.your_seat_index;
  const standing = state.standings.find((s) => s.seat_index === you);
  const placement = state.placements?.find((p) => p.seat_index === you);

  const facts = useMemo(() => {
    const mine = state.round_results
      .map((reveal) => ({ reveal, answer: reveal.seats.find((s) => s.seat_index === you) }))
      .filter((entry): entry is { reveal: FindThePrimeRoundReveal; answer: FindThePrimeSeatAnswer } => Boolean(entry.answer));
    const strongest = [...mine].sort((a, b) => b.answer.points - a.answer.points || a.answer.regret - b.answer.regret)[0];
    const miss = [...mine].sort((a, b) => b.answer.regret - a.answer.regret)[0];
    return { strongest, miss };
  }, [state.round_results, you]);

  const podiumRows = state.seats.map((seat) => {
    const p = state.placements?.find((x) => x.seat_index === seat.seat_index);
    const s = state.standings.find((x) => x.seat_index === seat.seat_index);
    return {
      seatIndex: seat.seat_index,
      name: seat.display_name,
      isBot: seat.is_bot,
      botTier: seat.bot_tier,
      placement: p?.placement ?? s?.position ?? 4,
      outcome: p?.outcome ?? "loss",
      scoreText: s ? `${s.total.toFixed(0)}` : "0",
      detailText: s ? `${s.found_primes} prime${s.found_primes === 1 ? "" : "s"} found` : undefined,
    };
  });

  const headline =
    state.ended_by === "forfeit" && standing?.forfeited
      ? "You conceded"
      : placement?.outcome === "win"
        ? "You found the most prime"
        : placement?.outcome === "draw"
          ? "Shared first"
          : placement
            ? `${ordinal(placement.placement)} of ${state.seats.length}`
            : "Match over";

  return (
    <PeakV2Shell width="live">
      <div className="fprime-result" data-arena="live" data-testid="fprime-result">
        <ResultReveal steps={STEPS} sequenceKey={view.match_id} startComplete={resumed} testId="fprime-result-reveal">
          {({ revealed }) => (
            <>
              <RevealStep name="headline" revealed={revealed}>
                <header className="pcut-result-head">
                  <p className="parena-eyebrow">Find the Prime · final</p>
                  <h1 className="pcut-result-title" data-testid="fprime-result-title">{headline}</h1>
                  <p className="pcut-result-score">
                    <span className="pcut-result-numeral pk-numeral" data-testid="fprime-total">
                      {standing ? standing.total.toFixed(0) : "0"}
                    </span>
                    <span className="pcut-result-caption">points of a possible {state.max_match_score.toFixed(0)}</span>
                  </p>
                </header>
              </RevealStep>

              <RevealStep name="stats" revealed={revealed}>
                <dl className="parena-receipt" data-testid="fprime-receipt">
                  <div>
                    <dt>Primes found</dt>
                    <dd className="pk-numeral">
                      {standing?.found_primes ?? 0} of {state.round_count}
                    </dd>
                  </div>
                  {facts.strongest ? (
                    <div>
                      <dt>Strongest round</dt>
                      <dd>
                        {facts.strongest.reveal.player_name} ({facts.strongest.reveal.duration}Y) —{" "}
                        <span className="pk-numeral">{facts.strongest.answer.points.toFixed(0)}</span> pts
                      </dd>
                    </div>
                  ) : null}
                  {facts.miss ? (
                    <div>
                      <dt>Largest miss</dt>
                      <dd>
                        {facts.miss.reveal.player_name} ({facts.miss.reveal.duration}Y) —{" "}
                        {answerSentence(facts.miss.answer, facts.miss.reveal)}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Average gap to PEAK3&apos;s best</dt>
                    <dd className="pk-numeral">
                      {standing?.average_regret != null ? `${standing.average_regret.toFixed(2)} pts` : "—"}
                    </dd>
                  </div>
                  <PersonalRecordLine
                    mode="find_the_prime"
                    matchId={view.match_id}
                    rated={view.rated}
                    scoreLabel="total"
                    formatScore={(value) => value.toFixed(0)}
                  />
                </dl>
              </RevealStep>

              <RevealStep name="podium" revealed={revealed}>
                <ArenaFinalPodium rows={podiumRows} yourSeat={you} scoreLabel="Points" testId="fprime-podium" />
              </RevealStep>

              <RevealStep name="rounds" revealed={revealed}>
                <details className="parena-details" data-testid="fprime-round-details">
                  <summary>Every round</summary>
                  <ol className="fprime-round-list">
                    {state.round_results.map((reveal) => {
                      const answer = reveal.seats.find((s) => s.seat_index === you);
                      const best = reveal.windows.find((w) => w.window_id === reveal.best_window_id);
                      return (
                        <li key={reveal.round_index} className="fprime-round-row">
                          <span className="fprime-round-name">
                            {reveal.player_name} · {reveal.duration}Y
                          </span>
                          <span className="fprime-round-best">
                            PEAK3 best: {best ? `${best.start_season} to ${best.end_season}` : "—"}
                          </span>
                          <span className="fprime-round-yours">{answer ? answerSentence(answer, reveal) : ""}</span>
                          <span className="pk-numeral fprime-round-points">{answer ? answer.points.toFixed(0) : "0"}</span>
                        </li>
                      );
                    })}
                  </ol>
                  <p className="parena-footnote">
                    Window ratings are PEAK3 {state.model_version} ({state.artifact_version}).
                  </p>
                </details>
              </RevealStep>

              <RevealStep name="actions" revealed={revealed}>
                <div className="parena-actions">
                  <GameActionButton onAction={onPlayAgain} pendingLabel="Dealing…" data-testid="fprime-play-again">
                    Play again
                  </GameActionButton>
                  <PeakV2SecondaryAction href="/arena/lobby?game=find_the_prime">Back to multiplayer</PeakV2SecondaryAction>
                </div>
              </RevealStep>
            </>
          )}
        </ResultReveal>
        <LiveRegion message={message} testId="fprime-live" />
      </div>
    </PeakV2Shell>
  );
}
