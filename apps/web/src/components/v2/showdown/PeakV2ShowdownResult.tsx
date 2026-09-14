"use client";

/**
 * PeakV2ShowdownResult — the auction closes, in sequence (game-feel pass 2;
 * payoff pass).
 *
 * THE FINAL SCOREBOARD COMES FIRST. The previous ending printed both
 * rosters, then a head-to-head lane, and only then the verdict -- so the
 * one thing a player wants to know (who won, by how much) sat under ten
 * roster rows. It now reads the way a broadcast final does:
 *
 *   AUCTION CLOSED   the eyebrow, at once
 *   the scoreboard   both roster totals tally up side by side; the verdict
 *                    lands between them; the split bar shows the share
 *   the money        what each side spent and left -- and, plainly, that
 *                    money left over scores nothing
 *   the rosters      both completed lineups, price and PEAK3 per slot
 *   the reasons      where it was decided: positions won, the decisive lot,
 *                    the best value buy, the least value per dollar
 *   the actions      Play again, Back to Arena, Copy result
 *
 * A FORFEIT IS NOT A DRAW. The server scores a conceded match's rosters as
 * they stood but overrides the outcome -- the conceding seat loses (see
 * `_forfeit` in the API's twenty_dollar mode). The receipt's own settlement
 * only knows the totals, so a concession at lot 0 used to read "DREW · Level
 * on PEAK3". The outcome here is taken from `forfeited_by` whenever it is
 * set, and no PEAK3 margin is claimed for it.
 *
 * `ResultReveal` owns the schedule (about three seconds); a click or a key
 * anywhere on the stage completes it, reduced motion completes it at once,
 * and every section is in the DOM from the first frame. EVERY NUMBER IS THE
 * SERVER'S: no PEAK3 score, margin, verdict or component value is computed
 * here -- the only arithmetic is the difference and share of two published
 * totals, and counting slot winners the receipt already named.
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
/** `receipt.py::_most_decisive` publishes the card's `prime_score` too; the
 *  shared type predates it, so it is read as optional rather than assumed. */
type Decisive = NonNullable<TwentyDollarReceiptData["most_decisive"]> & { prime_score?: number };
type PositionalRow = TwentyDollarReceiptData["positional"][number];

const STEPS = [
  { name: "closed", at: 0 },
  { name: "rosters", at: 300 },
  { name: "money", at: 1150 },
  { name: "compare", at: 1500 },
  { name: "verdict", at: 1900 },
  { name: "moments", at: 2500 },
  { name: "actions", at: 2900 },
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

/** Slots each side won, from the receipt's own per-slot `winner_seat`, and the
 *  widest slot where both sides had a player. Counting, not scoring. */
function positionalSummary(rows: PositionalRow[], leftSeat: number, rightSeat: number) {
  let left = 0;
  let right = 0;
  let widest: PositionalRow | null = null;
  for (const row of rows) {
    if (row.winner_seat === leftSeat) left += 1;
    else if (row.winner_seat === rightSeat) right += 1;
    if (row.seats[leftSeat] && row.seats[rightSeat] && row.winner_seat !== null && (widest === null || row.margin > widest.margin)) {
      widest = row;
    }
  }
  return { left, right, widest };
}

interface RosterLiveEntry {
  player_name: string;
  anchor_season: string;
  price: number;
  prime_score: number;
  autofilled: boolean;
}

function RosterRow({ slot, entry, index, emptyLabel }: { slot: string; entry: RosterLiveEntry | undefined; index: number; emptyLabel: string }) {
  return (
    <li className="sd-result-row" data-filled={entry ? "true" : "false"} style={{ ["--sd-row-index" as string]: index } as CSSProperties}>
      <span className="sd-result-slot">{slot}</span>
      <div className="min-w-0 flex-1">
        {entry ? (
          <PeakV2PlayerIdentity name={entry.player_name} meta={`${entry.anchor_season}${entry.autofilled ? " · auto-filled" : ""}`} size="sm" />
        ) : (
          <span className="sd-result-empty">{emptyLabel}</span>
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
  slots,
  bySlot,
  emptyLabel,
}: {
  seatLabel: string;
  isWinner: boolean;
  total: number;
  slots: string[];
  bySlot: Map<string, RosterLiveEntry>;
  emptyLabel: string;
}) {
  return (
    <div className="sd-result-roster" data-winner={isWinner ? "true" : "false"}>
      <div className="sd-result-roster-head">
        <span className="sd-result-seat-label" data-winner={isWinner ? "true" : "false"}>
          {seatLabel}
          {isWinner ? <span className="sd-result-winner-tag">Winner</span> : null}
        </span>
        <span className="sd-result-roster-cols" aria-hidden="true">
          <span>Paid</span>
          <span>PEAK3</span>
        </span>
      </div>
      <ul className="flex flex-col">
        {slots.map((slot, index) => (
          <RosterRow key={slot} slot={slot} entry={bySlot.get(slot)} index={index} emptyLabel={emptyLabel} />
        ))}
      </ul>
      <div className="sd-result-roster-total">
        <span>Roster total</span>
        <span className="pk-numeral">{total.toFixed(2)}</span>
      </div>
    </div>
  );
}

function FinalSide({
  name,
  total,
  spent,
  unspent,
  align,
  isWinner,
  countUp,
  moneyRevealed,
}: {
  name: string;
  total: number;
  spent: number;
  unspent: number;
  align: "start" | "end";
  isWinner: boolean;
  countUp: boolean;
  moneyRevealed: boolean;
}) {
  return (
    <div className="sd-final-side" data-align={align} data-winner={isWinner ? "true" : "false"}>
      <span className="sd-final-name">
        {name}
        {isWinner ? <span className="sd-result-winner-tag">Winner</span> : null}
      </span>
      <span className="sd-final-total pk-numeral">
        {countUp ? <ScoreTransition value={total} from={0} durationMs={900} format={(n) => n.toFixed(2)} /> : total.toFixed(2)}
      </span>
      <span className="sd-final-money pk-numeral" data-revealed={moneyRevealed ? "true" : "false"}>
        {formatDollars(spent)} spent · {formatDollars(unspent)} left
      </span>
    </div>
  );
}

function ReasonRow({ tag, figure, figureSub, children, testId }: { tag: string; figure?: ReactNode; figureSub?: string; children: ReactNode; testId: string }) {
  return (
    <li className="sd-reason" data-testid={testId}>
      <div className="sd-reason-text">
        <span className="sd-reason-tag">{tag}</span>
        <p className="sd-reason-body">{children}</p>
      </div>
      {figure !== undefined ? (
        <span className="sd-reason-figure pk-numeral">
          {figure}
          {figureSub ? <span className="sd-reason-sub"> {figureSub}</span> : null}
        </span>
      ) : null}
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
  const forfeited = (publicState as { forfeited_by?: number | null }).forfeited_by ?? null;
  const leftSeat = yourSeat !== null ? yourSeat : 0;
  const rightSeat = 1 - leftSeat;

  // THE CONCEDING SEAT LOSES, whatever the totals say (server `_forfeit`).
  const winner = forfeited !== null ? (forfeited === leftSeat ? rightSeat : leftSeat) : (receipt.settlement?.winner_seat ?? null);
  const drawn = forfeited === null && (receipt.settlement?.outcome === "draw" || winner === null);
  const youWon = winner !== null && winner === yourSeat;
  const outcome: "win" | "loss" | "draw" = drawn ? "draw" : youWon ? "win" : "loss";

  const seatOf = (index: number) => receipt.seats.find((s) => s.seat_index === index) ?? null;
  const totals = receipt.seats.map((seat) => seat.roster_total);
  const sum = totals.reduce((a, b) => a + b, 0);
  const fingerprint = Math.round(sum * 100 + receipt.rounds_played);
  const yourTotal = seatOf(leftSeat)?.roster_total ?? 0;
  const theirTotal = seatOf(rightSeat)?.roster_total ?? 0;
  const margin = Math.abs(yourTotal - theirTotal);
  const opponentName = seatNames[rightSeat] ?? "Opponent";

  function nameOf(seat: number): string {
    return seat === yourSeat ? "You" : (seatNames[seat] ?? `Seat ${seat + 1}`);
  }
  function whoIn(seat: number): string {
    return seat === yourSeat ? "you" : (seatNames[seat] ?? `seat ${seat + 1}`);
  }

  const outcomeTextColor = outcome === "win" ? v2ToneVar("positive") : outcome === "loss" ? v2ToneVar("negative") : "var(--v2-text-primary)";
  const lightTone: V2Tone = outcome === "win" ? "positive" : outcome === "loss" ? "negative" : "accent";

  const moneyOf = (index: number) => {
    const seat = seatOf(index);
    const live = publicState.seats[index];
    const unspent = live?.budget ?? seat?.budget_remaining ?? receipt.starting_budget;
    return { spent: receipt.starting_budget - unspent, unspent };
  };

  const share = sum > 0 ? yourTotal / sum : 0.5;
  const positions = positionalSummary(receipt.positional ?? [], leftSeat, rightSeat);
  const decisive = receipt.most_decisive as Decisive | null;
  const bargain = receipt.best_bargain;
  const overpay = receipt.biggest_overpay;
  const overpayIsBargain = Boolean(bargain && overpay && bargain.player_name === overpay.player_name && bargain.seat_index === overpay.seat_index);
  const lotsWord = receipt.rounds_played === 1 ? "lot" : "lots";

  const response =
    forfeited !== null
      ? forfeited === yourSeat
        ? "You conceded the match."
        : `${seatNames[forfeited] ?? "Your opponent"} conceded — the match is yours.`
      : responseLine(outcome, margin, fingerprint);

  return (
    <PeakV2Shell width="live">
      <ResultReveal steps={STEPS} sequenceKey={`${receipt.rounds_played}:${yourTotal}:${theirTotal}`} testId="td-result-reveal">
        {({ revealed, complete }) => (
          <div
            className="sd-result pb-16 pt-6"
            data-outcome={outcome}
            data-forfeit={forfeited !== null ? "true" : "false"}
            data-testid="td-result"
            data-sequence-complete={complete ? "true" : "false"}
          >
            <Celebration active={youWon && revealed("verdict")} testId="td-celebration" />
            <PeakV2ArenaLight y="-6%" tone={revealed("verdict") ? lightTone : "accent"} intensity="focus" />

            <RevealStep name="closed" revealed={revealed} className="sd-result-closed">
              <span style={LABEL_STYLE}>{forfeited !== null ? "Match conceded" : "Auction closed"}</span>
              <p className="sd-result-closed-line">
                {receipt.rounds_played} {lotsWord} · {formatDollars(receipt.starting_budget)} each
                {forfeited !== null ? ` · ${nameOf(forfeited)} conceded` : ""}
              </p>
            </RevealStep>

            {/* THE FINAL SCOREBOARD. Totals tally on the sides; the verdict lands
                in the middle; the bar is the share of the combined PEAK3. */}
            <RevealStep name="rosters" revealed={revealed} className="sd-final mt-5">
              <div className="sd-final-board" data-outcome={revealed("verdict") ? outcome : "pending"}>
                <FinalSide
                  name="You"
                  total={yourTotal}
                  {...moneyOf(leftSeat)}
                  align="start"
                  isWinner={revealed("verdict") && winner === leftSeat}
                  countUp={revealed("rosters")}
                  moneyRevealed={revealed("money")}
                />
                <RevealStep name="verdict" revealed={revealed} className="sd-final-verdict">
                  <div data-testid="td-result-headline">
                    <PeakV2ResultHeadline as="h1" scale="hero" tone="primary" style={{ color: outcomeTextColor }}>
                      {drawn ? "DREW" : youWon ? "WON" : "LOST"}
                    </PeakV2ResultHeadline>
                  </div>
                  <p className="sd-result-margin pk-numeral" data-testid="td-result-margin">
                    {forfeited !== null ? (
                      "by concession"
                    ) : drawn ? (
                      "Level on PEAK3"
                    ) : (
                      <>
                        by <span style={{ color: outcomeTextColor }}>{margin.toFixed(2)}</span> PEAK3
                      </>
                    )}
                  </p>
                </RevealStep>
                <FinalSide
                  name={opponentName}
                  total={theirTotal}
                  {...moneyOf(rightSeat)}
                  align="end"
                  isWinner={revealed("verdict") && winner === rightSeat}
                  countUp={revealed("rosters")}
                  moneyRevealed={revealed("money")}
                />
              </div>

              <div
                className="sd-final-bar"
                data-testid="td-result-bar"
                data-revealed={revealed("compare") ? "true" : "false"}
                role="img"
                aria-label={`Roster PEAK3: you ${yourTotal.toFixed(2)}, ${opponentName} ${theirTotal.toFixed(2)}`}
                style={{ ["--sd-share" as string]: share.toFixed(4) } as CSSProperties}
              >
                <span className="sd-final-bar-you" data-winner={revealed("verdict") && winner === leftSeat ? "true" : "false"} />
                <span className="sd-final-bar-them" data-winner={revealed("verdict") && winner === rightSeat ? "true" : "false"} />
              </div>

              <RevealStep name="money" revealed={revealed} className="sd-final-note">
                {forfeited !== null
                  ? "A concession decides the match. Totals are the rosters as they stood."
                  : "Roster PEAK3 totals decide the match. Money left over scores nothing."}
              </RevealStep>

              <RevealStep name="verdict" revealed={revealed}>
                <p className="sd-result-response" data-testid="td-result-response">
                  {response}
                </p>
              </RevealStep>

              {receipt.settlement && receipt.settlement.levels.length > 1 ? (
                <RevealStep name="compare" revealed={revealed} className="mx-auto mt-6 flex max-w-md flex-col gap-4">
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
                </RevealStep>
              ) : null}
            </RevealStep>

            <RevealStep name="rosters" revealed={revealed} className="mt-10">
              <div className="sd-result-seats" data-testid="td-result-seats">
                {[leftSeat, rightSeat].map((seatIndex) => {
                  const seat = seatOf(seatIndex);
                  if (!seat) return null;
                  const live = publicState.seats[seat.seat_index];
                  const { spent } = moneyOf(seat.seat_index);
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
                        },
                      ]),
                  );
                  return (
                    <div key={seat.seat_index} data-testid={`td-result-seat-${seat.seat_index}`}>
                      <RosterBlock
                        seatLabel={nameOf(seat.seat_index)}
                        isWinner={revealed("verdict") && winner === seat.seat_index}
                        total={seat.roster_total}
                        slots={publicState.slots}
                        bySlot={bySlot}
                        emptyLabel={forfeited !== null ? "Unfilled at concession" : "No player"}
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

            <RevealStep name="moments" revealed={revealed} className="mt-10">
              <h2 className="sd-result-section-title">{forfeited !== null ? "How it ended" : "Where it was decided"}</h2>
              <ul className="sd-reasons" data-testid="td-result-facts">
                {forfeited !== null ? (
                  <ReasonRow testId="td-callout-forfeit" tag="Concession">
                    {nameOf(forfeited)} conceded after {receipt.rounds_played} settled {lotsWord}. Conceding loses the match whatever the rosters would have said.
                  </ReasonRow>
                ) : null}
                {forfeited === null && positions.left + positions.right > 0 ? (
                  <ReasonRow
                    testId="td-callout-positions"
                    tag="Head-to-head slots"
                    figure={`${positions.left}–${positions.right}`}
                    figureSub="slots"
                  >
                    {positions.left === positions.right
                      ? `The five positions split ${positions.left}–${positions.right}.`
                      : `${positions.left > positions.right ? "You" : opponentName} had the higher-rated player at ${Math.max(positions.left, positions.right)} of ${publicState.slots.length} positions.`}
                    {positions.widest
                      ? ` The widest gap was at ${positions.widest.slot}: PEAK3 rates ${positions.widest.seats[leftSeat]?.player_name} ${positions.widest.seats[leftSeat]?.prime_score.toFixed(1)} against ${positions.widest.seats[rightSeat]?.player_name} ${positions.widest.seats[rightSeat]?.prime_score.toFixed(1)}.`
                      : ""}
                  </ReasonRow>
                ) : null}
                {decisive ? (
                  <ReasonRow
                    testId="td-callout-decisive"
                    tag="Decisive lot"
                    figure={decisive.prime_score != null ? decisive.prime_score.toFixed(1) : formatDollars(decisive.price)}
                    figureSub={decisive.prime_score != null ? `for ${formatDollars(decisive.price)}` : undefined}
                  >
                    {decisive.prime_score != null
                      ? `PEAK3 rates ${decisive.player_name} highest of every player sold. ${whoIn(decisive.winner_seat) === "you" ? "You" : nameOf(decisive.winner_seat)} won the lot for ${formatDollars(decisive.price)}.`
                      : `${decisive.player_name}, the highest-rated player sold — to ${whoIn(decisive.winner_seat)} for ${formatDollars(decisive.price)}.`}
                  </ReasonRow>
                ) : null}
                {bargain ? (
                  <ReasonRow testId="td-callout-bargain" tag="Best value buy" figure={bargain.prime_score.toFixed(1)} figureSub={`for ${formatDollars(bargain.price)}`}>
                    {nameOf(bargain.seat_index)} bought {bargain.player_name} for {formatDollars(bargain.price)} — the most PEAK3 per dollar on either roster.
                  </ReasonRow>
                ) : null}
                {overpay && !overpayIsBargain ? (
                  <ReasonRow testId="td-callout-overpay" tag="Least value per dollar" figure={formatDollars(overpay.price)} figureSub={`for ${overpay.prime_score.toFixed(1)}`}>
                    {nameOf(overpay.seat_index)} paid {formatDollars(overpay.price)} for {overpay.player_name} — the fewest PEAK3 points per dollar of any purchase.
                  </ReasonRow>
                ) : null}
                {forfeited !== null && receipt.rounds_played === 0 ? (
                  <li className="sd-reason-none">No lot sold before the match ended.</li>
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
                  Scored under {receipt.model_version} · {receipt.rounds_played} {lotsWord}
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
