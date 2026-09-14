"use client";

/**
 * The match result: placement, the Prime Cut match score, the three durations as
 * distinct bands, the podium, a concise analytical receipt, and play again.
 *
 * EVERY NUMBER IS THE SERVER'S. Heat scores, optimal keeps, the placements and
 * the receipt facts (best call, costliest cut) all come from `heat_results` and
 * `standings`; this component only chooses which to name. PEAK3 is described as
 * rating a peak, never as the truth about one.
 */

import { useMemo } from "react";

import type { PrimeCutHeatResult, PrimeCutMatchView, PrimeCutRevealCard } from "@/types/prime-cut";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { GameActionButton, ResultReveal, RevealStep } from "@/components/game-feel";
import ArenaFinalPodium from "@/components/prime-arena/ArenaFinalPodium";
import { ordinal } from "@/components/prime-arena/ArenaMatchStrip";
import { LiveRegion } from "@/components/prime-arena/RoomChrome";
import PersonalRecordLine from "@/components/prime-arena/PersonalRecordLine";
import { CutLineList } from "./PrimeCutHeatReveal";

const STEPS = [
  { name: "headline", at: 0 },
  { name: "bands", at: 450 },
  { name: "podium", at: 1100 },
  { name: "receipt", at: 1500 },
  { name: "actions", at: 1800 },
] as const;

function cardIn(result: PrimeCutHeatResult, index: number | null): PrimeCutRevealCard | undefined {
  return index === null ? undefined : result.cards.find((c) => c.card_index === index);
}

export default function PrimeCutResult({
  view,
  resumed,
  onPlayAgain,
  message,
}: {
  view: PrimeCutMatchView;
  resumed: boolean;
  onPlayAgain: () => Promise<void>;
  message: string;
}) {
  const state = view.public_state;
  const you = view.your_seat_index;
  const standing = state.standings.find((s) => s.seat_index === you);
  const placement = state.placements?.find((p) => p.seat_index === you);

  const receipt = useMemo(() => {
    let bestCall: { card: PrimeCutRevealCard; margin: number; duration: number } | null = null;
    let costliest: { card: PrimeCutRevealCard; duration: number } | null = null;
    let optimalKept = 0;
    for (const result of state.heat_results) {
      const row = result.seats.find((s) => s.seat_index === you);
      if (!row) continue;
      optimalKept += row.optimal_kept;
      const call = cardIn(result, row.best_call);
      if (call) {
        const margin = Math.abs(call.prime_score - result.cut_line);
        if (!bestCall || margin < bestCall.margin) bestCall = { card: call, margin, duration: result.duration };
      }
      const cut = cardIn(result, row.costliest_cut);
      if (cut && (!costliest || cut.prime_score > costliest.card.prime_score)) costliest = { card: cut, duration: result.duration };
    }
    return { bestCall, costliest, optimalKept };
  }, [state.heat_results, you]);

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
      scoreText: s?.match_score != null ? s.match_score.toFixed(1) : "—",
      detailText: s ? `${s.optimal_keeps}/${state.heat_results.length * 4} best kept` : undefined,
    };
  });

  const headline =
    state.ended_by === "forfeit" && standing?.forfeited
      ? "You conceded"
      : placement?.outcome === "win"
        ? "You won the cut"
        : placement?.outcome === "draw"
          ? "Shared first"
          : placement
            ? `${ordinal(placement.placement)} of ${state.seats.length}`
            : "Match over";

  return (
    <PeakV2Shell width="live">
      <div className="pcut-result" data-arena="live" data-testid="pcut-result">
        <ResultReveal steps={STEPS} sequenceKey={view.match_id} startComplete={resumed} testId="pcut-result-reveal">
          {({ revealed }) => (
            <>
              <RevealStep name="headline" revealed={revealed}>
                <header className="pcut-result-head">
                  <p className="parena-eyebrow">Prime Cut · final</p>
                  <h1 className="pcut-result-title" data-testid="pcut-result-title">{headline}</h1>
                  <p className="pcut-result-score">
                    <span className="pcut-result-numeral pk-numeral" data-testid="pcut-match-score">
                      {standing?.match_score != null ? standing.match_score.toFixed(1) : "—"}
                    </span>
                    <span className="pcut-result-caption">Prime Cut match score · average of the heats played</span>
                  </p>
                </header>
              </RevealStep>

              <RevealStep name="bands" revealed={revealed}>
                <ol className="pcut-bands" aria-label="Heat scores by peak length" data-testid="pcut-bands">
                  {state.durations.map((duration, heatIndex) => {
                    const result = state.heat_results.find((r) => r.heat_index === heatIndex);
                    const row = result?.seats.find((s) => s.seat_index === you);
                    return (
                      <li key={duration} className="pcut-band" data-testid={`pcut-band-${duration}y`}>
                        <p className="pcut-band-label">{duration}-year peaks</p>
                        <p className="pcut-band-score pk-numeral">{row ? row.capture.toFixed(1) : "—"}</p>
                        <p className="pcut-band-detail">
                          {row ? `${row.optimal_kept} of the best 4 kept` : "Not played"}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              </RevealStep>

              <RevealStep name="podium" revealed={revealed}>
                <ArenaFinalPodium rows={podiumRows} yourSeat={you} scoreLabel="Match score" testId="pcut-podium" />
              </RevealStep>

              <RevealStep name="receipt" revealed={revealed}>
                <dl className="parena-receipt" data-testid="pcut-receipt">
                  <div>
                    <dt>Best four kept</dt>
                    <dd className="pk-numeral">
                      {receipt.optimalKept} of {state.heat_results.length * 4}
                    </dd>
                  </div>
                  {receipt.bestCall ? (
                    <div>
                      <dt>Best call</dt>
                      <dd>
                        {receipt.bestCall.card.player_name} ({receipt.bestCall.duration}Y,{" "}
                        <span className="pk-numeral">{receipt.bestCall.card.prime_score.toFixed(2)}</span>) — the closest
                        call to a cut line you got right
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Costliest cut</dt>
                    <dd>
                      {receipt.costliest
                        ? `${receipt.costliest.card.player_name} (${receipt.costliest.duration}Y, ${receipt.costliest.card.prime_score.toFixed(2)}) — PEAK3 rated it among that heat's best four`
                        : "None — you never cut one of PEAK3's best four"}
                    </dd>
                  </div>
                  <PersonalRecordLine
                    mode="prime_cut"
                    matchId={view.match_id}
                    rated={view.rated}
                    scoreLabel="match score"
                    formatScore={(value) => value.toFixed(1)}
                  />
                </dl>
                <details className="parena-details" data-testid="pcut-heat-details">
                  <summary>Every heat, card by card</summary>
                  {state.heat_results.map((result) => (
                    <section key={result.heat_index} aria-label={`Heat ${result.heat_index + 1}`}>
                      <h2 className="pcut-side-title">
                        Heat {result.heat_index + 1} · {result.duration}-year peaks
                      </h2>
                      <CutLineList result={result} seatIndex={you} testId={`pcut-result-cutline-${result.heat_index}`} />
                    </section>
                  ))}
                  <p className="parena-footnote">
                    Scores are PEAK3 {state.model_version} ratings of each exact window ({state.artifact_version}).
                  </p>
                </details>
              </RevealStep>

              <RevealStep name="actions" revealed={revealed}>
                <div className="parena-actions">
                  <GameActionButton onAction={onPlayAgain} pendingLabel="Dealing…" data-testid="pcut-play-again">
                    Play again
                  </GameActionButton>
                  <PeakV2SecondaryAction href="/arena/lobby?game=prime_cut">Back to multiplayer</PeakV2SecondaryAction>
                </div>
              </RevealStep>
            </>
          )}
        </ResultReveal>
        <LiveRegion message={message} testId="pcut-live" />
      </div>
    </PeakV2Shell>
  );
}
