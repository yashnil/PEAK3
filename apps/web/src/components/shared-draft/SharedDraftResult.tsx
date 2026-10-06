"use client";

/**
 * The SHARED DRAFT result: who won, both roster totals, the five positions
 * head to head, where each total came from by PEAK3 component, and the cards
 * nobody took.
 *
 * EVERY NUMBER IS THE SERVER'S. Card scores, roster totals, component totals
 * and placements arrive in the completed projection; the only arithmetic here
 * is the display difference between two published card scores at one slot.
 * PEAK3 is described as rating a season, never as the truth about one.
 */

import type { SharedDraftCard, SharedDraftMatchView } from "@/types/shared-draft";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { GameActionButton, ResultReveal, RevealStep } from "@/components/game-feel";
import { LiveRegion } from "@/components/prime-arena/RoomChrome";
import PersonalRecordLine from "@/components/prime-arena/PersonalRecordLine";
import { componentColor, componentLabel } from "@/lib/utils";

const STEPS = [
  { name: "headline", at: 0 },
  { name: "slots", at: 450 },
  { name: "components", at: 1000 },
  { name: "actions", at: 1400 },
] as const;

const COMPONENT_ORDER = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
] as const;

function score(card: SharedDraftCard | null | undefined): string {
  return card?.prime_score != null ? card.prime_score.toFixed(2) : "—";
}

export default function SharedDraftResult({
  view,
  resumed,
  onPlayAgain,
  message,
  lobbyHref,
}: {
  view: SharedDraftMatchView;
  resumed: boolean;
  onPlayAgain: () => Promise<void>;
  message: string;
  lobbyHref: string;
}) {
  const state = view.public_state;
  const you = view.your_seat_index;
  const mine = state.seats.find((s) => s.seat_index === you) ?? state.seats[0];
  const theirs = state.seats.find((s) => s.seat_index !== mine.seat_index) ?? state.seats[1];
  const placement = state.placements?.find((p) => p.seat_index === mine.seat_index);
  const cards = state.cards;
  const undrafted = cards.filter((c) => c.drafted_by === null);

  const headline =
    state.ended_by === "forfeit"
      ? mine.forfeited
        ? "You conceded"
        : `${theirs.display_name} conceded`
      : placement?.outcome === "win"
        ? "You won the draft"
        : placement?.outcome === "draw"
          ? "Dead even"
          : `${theirs.display_name} won the draft`;

  return (
    <PeakV2Shell width="live">
      <div className="sdraft-result" data-arena="live" data-testid="sdraft-result">
        <ResultReveal steps={STEPS} sequenceKey={view.match_id} startComplete={resumed} testId="sdraft-result-reveal">
          {({ revealed }) => (
            <>
              <RevealStep name="headline" revealed={revealed}>
                <header className="sdraft-result-head">
                  <p className="parena-eyebrow">Shared Draft · final</p>
                  <h1 className="sdraft-result-title" data-testid="sdraft-result-title">{headline}</h1>
                  <dl className="sdraft-totals" data-testid="sdraft-totals">
                    <div data-you="true">
                      <dt>You</dt>
                      <dd className="pk-numeral" data-testid="sdraft-total-you">{mine.roster_total?.toFixed(2) ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>{theirs.display_name}</dt>
                      <dd className="pk-numeral" data-testid="sdraft-total-opponent">{theirs.roster_total?.toFixed(2) ?? "—"}</dd>
                    </div>
                  </dl>
                  <p className="sdraft-result-caption">Roster PEAK3 total · five career-best 1Y peak seasons</p>
                </header>
              </RevealStep>

              <RevealStep name="slots" revealed={revealed}>
                <table className="sdraft-h2h" data-testid="sdraft-h2h">
                  <caption className="sr-only">Your roster against {theirs.display_name}&apos;s, position by position</caption>
                  <thead>
                    <tr>
                      <th scope="col">Pos</th>
                      <th scope="col">You</th>
                      <th scope="col">{theirs.display_name}</th>
                      <th scope="col" className="sdraft-h2h-edge">Edge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.slots.map((slot) => {
                      const a = mine.roster[slot] !== null ? cards[mine.roster[slot] as number] : null;
                      const b = theirs.roster[slot] !== null ? cards[theirs.roster[slot] as number] : null;
                      const edge = a?.prime_score != null && b?.prime_score != null ? a.prime_score - b.prime_score : null;
                      return (
                        <tr key={slot} data-edge={edge === null ? undefined : edge > 0 ? "you" : edge < 0 ? "them" : "even"}>
                          <th scope="row">{slot}</th>
                          <td>
                            <span className="sdraft-h2h-name">{a?.player_name ?? "—"}</span>
                            <span className="sdraft-h2h-score pk-numeral">{score(a)}</span>
                          </td>
                          <td>
                            <span className="sdraft-h2h-name">{b?.player_name ?? "—"}</span>
                            <span className="sdraft-h2h-score pk-numeral">{score(b)}</span>
                          </td>
                          <td className="sdraft-h2h-edge pk-numeral">
                            {edge === null ? "—" : `${edge > 0 ? "+" : edge < 0 ? "−" : "±"}${Math.abs(edge).toFixed(2)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </RevealStep>

              <RevealStep name="components" revealed={revealed}>
                {mine.component_totals && theirs.component_totals ? (
                  <dl className="sdraft-components" aria-label="Where each total came from" data-testid="sdraft-components">
                    {COMPONENT_ORDER.map((key) => (
                      <div key={key} className="sdraft-component" style={{ ["--sdraft-comp" as string]: componentColor(key) }}>
                        <dt>{componentLabel(key)}</dt>
                        <dd>
                          <span className="pk-numeral">{(mine.component_totals?.[key] ?? 0).toFixed(1)}</span>
                          <span className="sdraft-component-vs">vs</span>
                          <span className="pk-numeral">{(theirs.component_totals?.[key] ?? 0).toFixed(1)}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {undrafted.length ? (
                  <p className="sdraft-leftover" data-testid="sdraft-undrafted">
                    Left on the board:{" "}
                    {undrafted.map((card, index) => (
                      <span key={card.card_index}>
                        {index > 0 ? ", " : ""}
                        {card.player_name} ({card.position}, <span className="pk-numeral">{score(card)}</span>)
                      </span>
                    ))}
                  </p>
                ) : null}
                <dl className="parena-receipt">
                  <PersonalRecordLine
                    mode="shared_draft"
                    matchId={view.match_id}
                    rated={view.rated}
                    scoreLabel="roster total"
                    formatScore={(value) => value.toFixed(2)}
                  />
                </dl>
                <p className="parena-footnote">
                  Each card is the player&apos;s best canonical 1-year PEAK3 season ({state.model_version}). The pool is
                  players who appeared in {state.latest_season}, the latest completed season PEAK3 has scored — not a
                  live roster check.
                </p>
              </RevealStep>

              <RevealStep name="actions" revealed={revealed}>
                <div className="parena-actions">
                  <GameActionButton onAction={onPlayAgain} pendingLabel="Dealing…" data-testid="sdraft-play-again">
                    Play again
                  </GameActionButton>
                  <PeakV2SecondaryAction href={lobbyHref}>Back to multiplayer</PeakV2SecondaryAction>
                </div>
              </RevealStep>
            </>
          )}
        </ResultReveal>
        <LiveRegion message={message} testId="sdraft-live" />
      </div>
    </PeakV2Shell>
  );
}
