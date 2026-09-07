"use client";

/**
 * PeakV2ShowdownResult — the auction closes, in sequence (game-feel pass 2).
 *
 * The ending resolves the tension the auction built, in the order a
 * spectator would want it:
 *
 *   AUCTION CLOSED   the eyebrow, at once
 *   the rosters      both completed lineups settle into view, totals counting
 *                    up to the server's number
 *   the money        what each side spent and left behind
 *   the comparison   the head-to-head lane assembles
 *   the verdict      WON / LOST / DREW and the margin
 *   the moments      the steal, the overpay, the decisive lot
 *   the actions      Play Again, Back to Arena, Copy result
 *
 * `ResultReveal` owns the schedule (about three seconds); a click or a key
 * anywhere on the stage completes it, reduced motion completes it at once,
 * and every section is in the DOM from the first frame. EVERY NUMBER IS THE
 * SERVER'S: no PEAK3 score, margin, verdict or component value is computed
 * here.
 */

import type { CSSProperties, ReactNode } from "react";
import PeakV2Shell from "../PeakV2Shell";
import PeakV2ArenaLight from "../PeakV2ArenaLight";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2Rule from "../PeakV2Rule";
import PeakV2DataLane from "../PeakV2DataLane";
import PeakV2PlayerIdentity from "../PeakV2PlayerIdentity";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import { v2ToneVar, type V2Tone } from "../v2-tone";
import Celebration from "@/components/shared/Celebration";
import { GameActionButton, ResultReveal, RevealStep, ScoreTransition } from "@/components/game-feel";
import { responseLine } from "@/components/twenty-dollar/ShowdownResult";
import type { TwentyDollarReceiptData } from "@/components/twenty-dollar/TwentyDollarReceipt";
import { formatDollars, type TwentyDollarPublicState } from "@/lib/twenty-dollar-api";
import { RANKING_COMPONENT_LABEL, RANKING_COMPONENT_TONE } from "@/lib/v2-component-map";

type SettlementLevel = NonNullable<TwentyDollarReceiptData["settlement"]>["levels"][number];

const STEPS = [
  { name: "closed", at: 0 },
  { name: "rosters", at: 350 },
  { name: "money", at: 1250 },
  { name: "compare", at: 1750 },
  { name: "verdict", at: 2350 },
  { name: "moments", at: 3000 },
  { name: "actions", at: 3400 },
] as const;

const LABEL_STYLE: CSSProperties = {
  fontFamily: "var(--v2-font-mono)",
  fontSize: "0.6875rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--v2-text-muted)",
};

function settlementLevelTone(levelId: string): V2Tone {
  return (RANKING_COMPONENT_TONE as Record<string, V2Tone | undefined>)[levelId] ?? "neutral";
}

function humanizeField(field: string): string {
  return field
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function levelCaptions(level: SettlementLevel, leftSeat: number, rightSeat: number): [string | undefined, string | undefined] {
  if (level.verdict === "not_consulted") return ["Not consulted", undefined];
  if (level.verdict === "tied") return ["Level", undefined];
  const match = /^seat_(\d+)$/.exec(level.verdict);
  const decidingSeat = match ? Number(match[1]) : null;
  return [decidingSeat === leftSeat ? "Decided the match" : undefined, decidingSeat === rightSeat ? "Decided the match" : undefined];
}

interface RosterLiveEntry {
  player_name: string;
  anchor_season: string;
  price: number;
  prime_score: number;
  autofilled: boolean;
  headshot_url?: string | null;
}

function RosterRow({ slot, entry, index }: { slot: string; entry: RosterLiveEntry | undefined; index: number }) {
  return (
    <li className="sd-result-row" style={{ ["--sd-row-index" as string]: index } as CSSProperties}>
      <span style={{ ...LABEL_STYLE, width: 26, flexShrink: 0 }}>{slot}</span>
      <div className="min-w-0 flex-1">
        {entry ? (
          <PeakV2PlayerIdentity name={entry.player_name} meta={`${entry.anchor_season}${entry.autofilled ? " · auto-filled" : ""}`} size="sm" />
        ) : (
          <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-muted)" }}>No player</span>
        )}
      </div>
      <span className="sd-result-price pk-numeral">{entry ? formatDollars(entry.price) : "—"}</span>
      <span className="sd-result-score pk-numeral">{entry?.prime_score != null ? entry.prime_score.toFixed(1) : "—"}</span>
    </li>
  );
}

function RosterBlock({
  seatLabel,
  isWinner,
  total,
  spent,
  unspent,
  slots,
  bySlot,
  countUp,
  moneyRevealed,
}: {
  seatLabel: string;
  isWinner: boolean;
  total: number;
  spent: number;
  unspent: number;
  slots: string[];
  bySlot: Map<string, RosterLiveEntry>;
  countUp: boolean;
  moneyRevealed: boolean;
}) {
  return (
    <div className="sd-result-roster" data-winner={isWinner ? "true" : "false"}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="sd-result-seat-label" data-winner={isWinner ? "true" : "false"}>
          {seatLabel}
          {isWinner ? " · Winner" : ""}
        </span>
        <span className="sd-result-total pk-numeral" data-winner={isWinner ? "true" : "false"}>
          {countUp ? <ScoreTransition value={total} from={0} durationMs={900} format={(n) => n.toFixed(2)} /> : total.toFixed(2)}
        </span>
      </div>
      <p className="sd-result-money pk-numeral" data-revealed={moneyRevealed ? "true" : "false"}>
        {formatDollars(spent)} spent · {formatDollars(unspent)} unspent
      </p>
      <ul className="flex flex-col">
        {slots.map((slot, index) => (
          <RosterRow key={slot} slot={slot} entry={bySlot.get(slot)} index={index} />
        ))}
      </ul>
    </div>
  );
}

function CalloutRow({ tag, headline, body, testId }: { tag: string; headline: ReactNode; body: string; testId: string }) {
  return (
    <li className="sd-callout" data-testid={testId}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span style={LABEL_STYLE}>{tag}</span>
        <span className="truncate" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}>
          {body}
        </span>
      </div>
      <span className="sd-callout-figure pk-numeral">{headline}</span>
    </li>
  );
}

export default function PeakV2ShowdownResult({
  receipt,
  publicState,
  seatNames,
  yourSeat,
  onPlayAgain,
  playAgainPending = false,
  onCopy,
  copied,
}: {
  receipt: TwentyDollarReceiptData;
  publicState: TwentyDollarPublicState;
  seatNames: string[];
  yourSeat: number | null;
  onPlayAgain: () => Promise<boolean> | void;
  playAgainPending?: boolean;
  onCopy: () => void;
  copied: boolean;
}) {
  const winner = receipt.settlement?.winner_seat ?? null;
  const drawn = receipt.settlement?.outcome === "draw" || winner === null;
  const youWon = winner !== null && winner === yourSeat;
  const outcome: "win" | "loss" | "draw" = drawn ? "draw" : youWon ? "win" : "loss";
  const totals = receipt.seats.map((seat) => seat.roster_total);
  const margin = totals.length === 2 ? Math.abs(totals[0] - totals[1]) : 0;
  const sum = totals.reduce((a, b) => a + b, 0);
  const fingerprint = Math.round(sum * 100 + receipt.rounds_played);
  const forfeited = (publicState as { forfeited_by?: number | null }).forfeited_by ?? null;

  function nameOf(seat: number): string {
    return seat === yourSeat ? "You" : (seatNames[seat] ?? `Seat ${seat + 1}`);
  }

  const leftSeat = yourSeat !== null ? yourSeat : 0;
  const rightSeat = 1 - leftSeat;
  const yourTotal = totals[leftSeat] ?? 0;
  const theirTotal = totals[rightSeat] ?? 0;
  const opponentName = seatNames[rightSeat] ?? "Opponent";

  const outcomeTextColor = outcome === "win" ? v2ToneVar("positive") : outcome === "loss" ? v2ToneVar("negative") : "var(--v2-text-primary)";
  const lightTone: V2Tone = outcome === "win" ? "positive" : outcome === "loss" ? "negative" : "accent";

  return (
    <PeakV2Shell width="live">
      <ResultReveal steps={STEPS} sequenceKey={`${receipt.rounds_played}:${yourTotal}:${theirTotal}`} testId="td-result-reveal">
        {({ revealed, complete }) => (
          <div className="sd-result pb-16 pt-6" data-outcome={outcome} data-testid="td-result" data-sequence-complete={complete ? "true" : "false"}>
            <Celebration active={youWon && revealed("verdict")} testId="td-celebration" />
            <PeakV2ArenaLight y="-6%" tone={revealed("verdict") ? lightTone : "accent"} intensity="focus" />

            <RevealStep name="closed" revealed={revealed} className="sd-result-closed">
              <span style={LABEL_STYLE}>Auction closed</span>
              <p className="sd-result-closed-line">
                {receipt.rounds_played} lots · {formatDollars(receipt.starting_budget)} each
                {forfeited !== null ? ` · ${nameOf(forfeited)} conceded` : ""}
              </p>
            </RevealStep>

            <RevealStep name="rosters" revealed={revealed} className="mt-6">
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2" data-testid="td-result-seats">
                {[leftSeat, rightSeat].map((seatIndex) => {
                  const seat = receipt.seats.find((s) => s.seat_index === seatIndex);
                  if (!seat) return null;
                  const live = publicState.seats[seat.seat_index];
                  const spent = receipt.starting_budget - (live?.budget ?? seat.budget_remaining);
                  const bySlot = new Map<string, RosterLiveEntry>(
                    (live?.roster ?? [])
                      .filter((entry) => entry.slot)
                      .map((entry) => [
                        entry.slot as string,
                        {
                          player_name: entry.player_name,
                          anchor_season: entry.anchor_season,
                          price: entry.price,
                          prime_score: entry.prime_score,
                          autofilled: entry.autofilled,
                          headshot_url: entry.headshot_url,
                        },
                      ]),
                  );
                  return (
                    <div key={seat.seat_index} data-testid={`td-result-seat-${seat.seat_index}`}>
                      <RosterBlock
                        seatLabel={nameOf(seat.seat_index)}
                        isWinner={revealed("verdict") && winner === seat.seat_index}
                        total={seat.roster_total}
                        spent={spent}
                        unspent={live?.budget ?? seat.budget_remaining}
                        slots={publicState.slots}
                        bySlot={bySlot}
                        countUp={revealed("rosters")}
                        moneyRevealed={revealed("money")}
                      />
                      <span data-testid={`td-result-total-${seat.seat_index}`} className="sr-only">
                        {seat.roster_total.toFixed(2)}
                      </span>
                      <span data-testid={`td-result-money-${seat.seat_index}`} className="sr-only">
                        {formatDollars(spent)} spent
                      </span>
                    </div>
                  );
                })}
              </div>
            </RevealStep>

            <RevealStep name="compare" revealed={revealed} className="mt-8">
              <div className="mx-auto w-full max-w-md" data-testid="td-result-bar">
                <PeakV2DataLane
                  label="Head-to-head"
                  tone={revealed("verdict") ? (outcome === "win" ? "positive" : outcome === "loss" ? "negative" : "neutral") : "neutral"}
                  leftLabel="You"
                  leftValue={yourTotal.toFixed(2)}
                  rightLabel={opponentName}
                  rightValue={theirTotal.toFixed(2)}
                  scaleMin={0}
                  scaleMax={Math.max(sum, 1)}
                />
              </div>
              {receipt.settlement && receipt.settlement.levels.length > 1 ? (
                <div className="mt-6 flex flex-col gap-4">
                  {receipt.settlement.levels.map((level) => {
                    const values = level.values;
                    const [leftCaption, rightCaption] = levelCaptions(level, leftSeat, rightSeat);
                    const scaleMax = Math.max(...values.filter((v) => Number.isFinite(v)), 1) * 1.15;
                    return (
                      <div key={level.level} data-testid={`td-level-${level.level}`}>
                        <PeakV2DataLane
                          label={level.label}
                          tone={settlementLevelTone(level.level)}
                          leftLabel="You"
                          leftValue={values[leftSeat]?.toFixed(2) ?? "—"}
                          leftPosition={values[leftSeat]}
                          leftCaption={leftCaption}
                          rightLabel={opponentName}
                          rightValue={values[rightSeat]?.toFixed(2) ?? "—"}
                          rightPosition={values[rightSeat]}
                          rightCaption={rightCaption}
                          scaleMin={0}
                          scaleMax={scaleMax}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </RevealStep>

            <RevealStep name="verdict" revealed={revealed} className="sd-result-verdict mt-8">
              <div data-testid="td-result-headline">
                <PeakV2ResultHeadline as="h1" scale="hero" tone="primary" style={{ color: outcomeTextColor }}>
                  {drawn ? "DREW" : youWon ? "WON" : "LOST"}
                </PeakV2ResultHeadline>
              </div>
              <p className="sd-result-margin pk-numeral" data-testid="td-result-margin">
                {drawn ? (
                  "Level on PEAK3"
                ) : (
                  <>
                    by <span style={{ color: outcomeTextColor }}>{margin.toFixed(2)}</span> PEAK3
                  </>
                )}
              </p>
              <p className="sd-result-response mt-3 max-w-md" data-testid="td-result-response">
                {responseLine(outcome, margin, fingerprint)}
              </p>
            </RevealStep>

            <RevealStep name="moments" revealed={revealed} className="mt-10">
              <PeakV2Rule spacing="sm" />
              <span style={LABEL_STYLE}>The match, in three lots</span>
              <ul className="mt-3 flex flex-col" data-testid="td-result-facts">
                {receipt.best_bargain ? (
                  <CalloutRow
                    testId="td-callout-bargain"
                    tag="Steal of the night"
                    headline={
                      <>
                        {receipt.best_bargain.prime_score.toFixed(1)}
                        <span className="sd-callout-sub"> for {formatDollars(receipt.best_bargain.price)}</span>
                      </>
                    }
                    body={`${receipt.best_bargain.player_name} — ${nameOf(receipt.best_bargain.seat_index)}`}
                  />
                ) : null}
                {receipt.biggest_overpay ? (
                  <CalloutRow
                    testId="td-callout-overpay"
                    tag="Biggest overpay"
                    headline={
                      <>
                        {formatDollars(receipt.biggest_overpay.price)}
                        <span className="sd-callout-sub"> for {receipt.biggest_overpay.prime_score.toFixed(1)}</span>
                      </>
                    }
                    body={`${receipt.biggest_overpay.player_name} — ${nameOf(receipt.biggest_overpay.seat_index)}`}
                  />
                ) : null}
                {receipt.most_decisive ? (
                  <CalloutRow
                    testId="td-callout-decisive"
                    tag="Decisive lot"
                    headline={formatDollars(receipt.most_decisive.price)}
                    body={`${receipt.most_decisive.player_name} — to ${nameOf(receipt.most_decisive.winner_seat)}`}
                  />
                ) : null}
              </ul>
            </RevealStep>

            <RevealStep name="actions" revealed={revealed} className="mt-8">
              <div className="flex flex-wrap items-center gap-3">
                <GameActionButton onAction={() => onPlayAgain()} pending={playAgainPending} pendingLabel="Dealing a new auction…" data-testid="td-play-again">
                  Play again
                </GameActionButton>
                <PeakV2SecondaryAction href="/arena" data-testid="td-back-to-arena">
                  Back to Arena
                </PeakV2SecondaryAction>
                <PeakV2SecondaryAction onClick={onCopy} data-testid="td-share">
                  {copied ? "Copied" : "Copy result"}
                </PeakV2SecondaryAction>
              </div>

              <PeakV2Rule spacing="lg" />

              <div data-testid="td-component-disclosure">
                <span style={LABEL_STYLE}>Components published</span>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                  {receipt.component_disclosure.shown.map((field) => (
                    <span key={field} className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: v2ToneVar(RANKING_COMPONENT_TONE[field as keyof typeof RANKING_COMPONENT_TONE]) ?? "var(--v2-text-muted)",
                        }}
                      />
                      <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}>
                        {RANKING_COMPONENT_LABEL[field as keyof typeof RANKING_COMPONENT_LABEL] ?? humanizeField(field)}
                      </span>
                    </span>
                  ))}
                  {receipt.component_disclosure.absent.map((field) => (
                    <span key={field} className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", border: "1px solid var(--v2-text-muted)" }} />
                      <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-muted)", textDecoration: "line-through" }}>
                        {humanizeField(field)}
                      </span>
                    </span>
                  ))}
                </div>
                <p className="mt-3 max-w-2xl" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}>
                  <strong style={{ color: "var(--v2-text-primary)" }}>
                    {receipt.component_disclosure.count} of {receipt.component_disclosure.house_count} components shown.
                  </strong>{" "}
                  {receipt.component_disclosure.note}
                </p>
                <p className="mt-2" style={{ ...LABEL_STYLE, textTransform: "none", letterSpacing: 0 }}>
                  Scored under {receipt.model_version} · {receipt.rounds_played} lots
                </p>
              </div>

              <details className="mt-10">
                <summary data-testid="td-result-detail-toggle" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", fontWeight: 600, color: "var(--v2-text-secondary)", cursor: "pointer" }}>
                  Slot-by-slot detail and every lot
                </summary>
                <div className="mt-4 flex flex-col gap-4">
                  {receipt.positional.map((row) => {
                    const leftEntry = row.seats[leftSeat];
                    const rightEntry = row.seats[rightSeat];
                    const values = [leftEntry?.prime_score, rightEntry?.prime_score].filter((v): v is number => typeof v === "number");
                    const scaleMax = (values.length ? Math.max(...values) : 1) * 1.15 || 1;
                    return (
                      <div key={row.slot} data-testid={`td-positional-${row.slot}`}>
                        <PeakV2DataLane
                          label={row.slot}
                          tone="neutral"
                          leftLabel="You"
                          leftValue={leftEntry ? leftEntry.prime_score.toFixed(1) : "—"}
                          leftPosition={leftEntry?.prime_score}
                          leftCaption={leftEntry ? `${leftEntry.player_name} · ${formatDollars(leftEntry.price)}` : "No player"}
                          rightLabel={opponentName}
                          rightValue={rightEntry ? rightEntry.prime_score.toFixed(1) : "—"}
                          rightPosition={rightEntry?.prime_score}
                          rightCaption={rightEntry ? `${rightEntry.player_name} · ${formatDollars(rightEntry.price)}` : "No player"}
                          scaleMin={0}
                          scaleMax={scaleMax}
                        />
                      </div>
                    );
                  })}
                  <ol className="sd-result-history" data-testid="td-result-history">
                    {publicState.history.map((lot) => (
                      <li key={lot.lot_index} className="sd-result-history-row">
                        <span style={LABEL_STYLE}>Lot {lot.lot_index + 1}</span>
                        <span className="sd-result-history-name">{lot.candidate.player_name}</span>
                        <span className="sd-result-history-verdict">{verdictText(lot.winner_seat, lot.price, lot.decided_by, nameOf)}</span>
                        <span className="sd-result-score pk-numeral">{lot.candidate.prime_score.toFixed(1)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            </RevealStep>
          </div>
        )}
      </ResultReveal>
    </PeakV2Shell>
  );
}

function verdictText(winner: number | null, price: number, decidedBy: string | null, nameOf: (seat: number) => string): string {
  if (winner === null) return "Unsold";
  if (decidedBy === "forced_fill") return `Assigned to ${nameOf(winner)} · ${formatDollars(price)}`;
  if (decidedBy === "autofill") return `Auto-filled to ${nameOf(winner)}`;
  return `${nameOf(winner)} · ${formatDollars(price)}`;
}
