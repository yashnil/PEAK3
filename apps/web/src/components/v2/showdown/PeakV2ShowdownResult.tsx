"use client";

/**
 * PeakV2ShowdownResult — the V2 "Broadcast Arena" result screen for The $20
 * Showdown (S20-15's V2 counterpart).
 *
 * Same two-part structure every other V2 result screen uses (see
 * `PeakV2RTTBattleResult.tsx`): a brief CINEMATIC hero — WON/LOST/DREW, the
 * margin, the deterministic `responseLine` (reused verbatim, not
 * reinvented — the same function `ShowdownResult.tsx` exports and the same
 * one the legacy screen's own tests exercise) and a head-to-head dot-on-line
 * read of both totals — then a `PeakV2Rule`, then LIVE progressively
 * discoverable detail: both five-slot rosters, the settlement ladder, the
 * three real callouts, and the component disclosure. The itemised
 * slot-by-slot comparison is the one thing tucked behind a native
 * `<details>`, same convention the legacy screen uses for its full receipt.
 *
 * REAL DATA THE PRIOR V2 EXPERIENCE SHOWED NONE OF:
 *
 *   * `receipt.settlement.levels` — the tie-break ladder, walked in the
 *     server's own order (`SETTLEMENT_ORDER` in
 *     `nba_peak/twenty_dollar/receipt.py`), rendered as `PeakV2DataLane` rows.
 *     Today that ladder is exactly one level (`roster_total`) — an
 *     AGGREGATE, not one of the five PEAK3 components — so it stays
 *     `tone="neutral"` per the brief's rule that component color is reserved
 *     for real component data; `settlementLevelTone` still checks a level's
 *     id against the five real component keys first, so a future level that
 *     genuinely is one of them (e.g. a `statistical_impact` tiebreak) would
 *     pick up its real tone automatically, with no re-authoring here.
 *   * `receipt.component_disclosure` — this board publishes five of the six
 *     PEAK3 components. The five shown ones render with their real
 *     component tone via the same `RANKING_COMPONENT_TONE`/`_LABEL` maps
 *     Peak Duel and RUN THE TABLE already use (`@/lib/v2-component-map`) —
 *     the exact same long-form keys (`statistical_impact`,
 *     `traditional_production`, `individual_recognition`,
 *     `postseason_individual_value`, `team_achievement`) the server's
 *     `COMPONENT_FIELDS` publishes. The absent sixth (`teammate_adjustment`)
 *     is shown too, struck through and unfilled, with the server's own
 *     explanation of WHY it is missing (never estimated, never omitted).
 *   * `receipt.positional` — slot-by-slot, behind the `<details>`.
 *
 * EVERY NUMBER IS THE SERVER'S, same discipline as the legacy screen: no
 * PEAK3 score, margin, verdict or component value is computed in this file.
 */

import type { CSSProperties, ReactNode } from "react";
import PeakV2Shell from "../PeakV2Shell";
import PeakV2CinematicStage from "../PeakV2CinematicStage";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2Rule from "../PeakV2Rule";
import PeakV2DataLane from "../PeakV2DataLane";
import PeakV2Score from "../PeakV2Score";
import PeakV2PlayerIdentity from "../PeakV2PlayerIdentity";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import { v2ToneVar, type V2Tone } from "../v2-tone";
import Celebration from "@/components/shared/Celebration";
import { responseLine } from "@/components/twenty-dollar/ShowdownResult";
import type { TwentyDollarReceiptData } from "@/components/twenty-dollar/TwentyDollarReceipt";
import { formatDollars, type TwentyDollarPublicState } from "@/lib/twenty-dollar-api";
import { RANKING_COMPONENT_LABEL, RANKING_COMPONENT_TONE } from "@/lib/v2-component-map";

type SettlementLevel = NonNullable<TwentyDollarReceiptData["settlement"]>["levels"][number];

const LABEL_STYLE: CSSProperties = {
  fontFamily: "var(--v2-font-mono)",
  fontSize: "0.6875rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--v2-text-muted)",
};

const SECTION_HEAD_STYLE: CSSProperties = {
  fontFamily: "var(--v2-font-mono)",
  fontSize: "0.6875rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--v2-text-muted)",
};

/** A settlement level's id is a real PEAK3 component key only if the server
 *  ever names one that way (e.g. a future `statistical_impact` tiebreak).
 *  `roster_total` — the only level today — is an aggregate of all five, not
 *  one of them, so it correctly falls back to neutral. */
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
  return [
    decidingSeat === leftSeat ? "Decided the match" : undefined,
    decidingSeat === rightSeat ? "Decided the match" : undefined,
  ];
}

function Field({ label, value, style }: { label: string; value: ReactNode; style?: CSSProperties }) {
  return (
    <div className="flex flex-col">
      <span style={LABEL_STYLE}>{label}</span>
      <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)", ...style }}>
        {value}
      </span>
    </div>
  );
}

interface RosterLiveEntry {
  player_name: string;
  anchor_season: string;
  price: number;
  prime_score: number;
  autofilled: boolean;
}

function RosterRow({ slot, entry }: { slot: string; entry: RosterLiveEntry | undefined }) {
  return (
    <li
      className="flex items-center gap-3 py-2"
      style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}
    >
      <span style={{ ...LABEL_STYLE, width: 26, flexShrink: 0 }}>{slot}</span>
      <div className="min-w-0 flex-1">
        {entry ? (
          <PeakV2PlayerIdentity
            name={entry.player_name}
            meta={`${entry.anchor_season}${entry.autofilled ? " · auto-filled" : ""}`}
            size="sm"
          />
        ) : (
          <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-muted)" }}>
            No player
          </span>
        )}
      </div>
      <span
        className="shrink-0 text-right"
        style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "0.75rem", color: "var(--v2-text-secondary)", minWidth: 36 }}
      >
        {entry ? formatDollars(entry.price) : "—"}
      </span>
      <span
        className="shrink-0 text-right"
        style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-text-primary)", minWidth: 44 }}
      >
        {entry?.prime_score != null ? entry.prime_score.toFixed(1) : "—"}
      </span>
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
}: {
  seatLabel: string;
  isWinner: boolean;
  total: number;
  spent: number;
  unspent: number;
  slots: string[];
  bySlot: Map<string, RosterLiveEntry>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span
          style={{
            fontFamily: "var(--v2-font-ui)",
            fontWeight: 700,
            fontSize: "1rem",
            color: isWinner ? "var(--v2-color-positive)" : "var(--v2-text-primary)",
          }}
        >
          {seatLabel}
          {isWinner ? " · Winner" : ""}
        </span>
        <PeakV2Score value={total.toFixed(2)} tone={isWinner ? "positive" : "neutral"} size="md" />
      </div>
      <p style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
        {formatDollars(spent)} spent · {formatDollars(unspent)} unspent
      </p>
      <ul className="flex flex-col">
        {slots.map((slot) => (
          <RosterRow key={slot} slot={slot} entry={bySlot.get(slot)} />
        ))}
      </ul>
    </div>
  );
}

function CalloutRow({
  tag,
  headline,
  body,
  testId,
}: {
  tag: string;
  headline: ReactNode;
  body: string;
  testId: string;
}) {
  return (
    <li
      className="flex items-center justify-between gap-4 py-3"
      style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}
      data-testid={testId}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span style={LABEL_STYLE}>{tag}</span>
        <span
          className="truncate"
          style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}
        >
          {body}
        </span>
      </div>
      <span
        className="shrink-0"
        style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "1.0625rem", fontWeight: 700, color: "var(--v2-text-primary)" }}
      >
        {headline}
      </span>
    </li>
  );
}

export default function PeakV2ShowdownResult({
  receipt,
  publicState,
  seatNames,
  yourSeat,
  onPlayAgain,
  onCopy,
  copied,
}: {
  receipt: TwentyDollarReceiptData;
  publicState: TwentyDollarPublicState;
  seatNames: string[];
  yourSeat: number | null;
  onPlayAgain: () => void;
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
  // Same fingerprint formula as the legacy screen, so the two presentations
  // never disagree about which line a given match reads.
  const fingerprint = Math.round(sum * 100 + receipt.rounds_played);

  function nameOf(seat: number): string {
    return seat === yourSeat ? "You" : (seatNames[seat] ?? `Seat ${seat + 1}`);
  }

  const leftSeat = yourSeat !== null ? yourSeat : 0;
  const rightSeat = 1 - leftSeat;
  const yourTotal = totals[leftSeat] ?? 0;
  const theirTotal = totals[rightSeat] ?? 0;
  const opponentName = seatNames[rightSeat] ?? "Opponent";

  const outcomeTextColor =
    outcome === "win" ? v2ToneVar("positive") : outcome === "loss" ? v2ToneVar("negative") : "var(--v2-text-primary)";
  const lightTone: V2Tone = outcome === "win" ? "positive" : outcome === "loss" ? "negative" : "accent";

  return (
    <PeakV2Shell width="live">
      <div className="pb-16 pt-6" data-outcome={outcome} data-testid="td-result">
        <Celebration active={youWon} testId="td-celebration" />

        <PeakV2CinematicStage light={{ y: "-6%", tone: lightTone }}>
          <span style={LABEL_STYLE}>
            Auction closed · {receipt.rounds_played} lots · {formatDollars(receipt.starting_budget)} each
          </span>
          <div data-testid="td-result-headline">
            <PeakV2ResultHeadline as="h1" scale="hero" tone="primary" className="mt-2" style={{ color: outcomeTextColor }}>
              {drawn ? "DREW" : youWon ? "WON" : "LOST"}
            </PeakV2ResultHeadline>
          </div>
          <p
            className="mt-2"
            data-testid="td-result-margin"
            style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "1.125rem", fontWeight: 700, color: "var(--v2-text-secondary)" }}
          >
            {drawn ? "Level on PEAK3" : (
              <>
                by <span style={{ color: outcomeTextColor }}>{margin.toFixed(2)}</span> PEAK3
              </>
            )}
          </p>
          <p
            className="mt-3 max-w-md"
            data-testid="td-result-response"
            style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.9375rem", color: "var(--v2-text-secondary)" }}
          >
            {responseLine(outcome, margin, fingerprint)}
          </p>

          <div className="mt-8 w-full max-w-md" data-testid="td-result-bar">
            <PeakV2DataLane
              label="Head-to-head"
              tone={outcome === "win" ? "positive" : outcome === "loss" ? "negative" : "neutral"}
              leftLabel="You"
              leftValue={yourTotal.toFixed(2)}
              rightLabel={opponentName}
              rightValue={theirTotal.toFixed(2)}
              scaleMin={0}
              scaleMax={Math.max(sum, 1)}
            />
          </div>
        </PeakV2CinematicStage>

        <PeakV2Rule spacing="lg" />

        {/* LIVE: two rosters, five slots each, the exact live assignment
            (`SeatPublic.roster` carries `.slot`; the receipt's own roster
            list does not, so slot placement is read from the same live
            projection the legacy screen reads it from). */}
        <div>
          <span style={SECTION_HEAD_STYLE}>Rosters</span>
          <div className="mt-4 grid grid-cols-1 gap-8 sm:grid-cols-2" data-testid="td-result-seats">
            {receipt.seats.map((seat) => {
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
                    },
                  ]),
              );
              return (
                <div key={seat.seat_index} data-testid={`td-result-seat-${seat.seat_index}`}>
                  <RosterBlock
                    seatLabel={nameOf(seat.seat_index)}
                    isWinner={winner === seat.seat_index}
                    total={seat.roster_total}
                    spent={spent}
                    unspent={live?.budget ?? seat.budget_remaining}
                    slots={publicState.slots}
                    bySlot={bySlot}
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
        </div>

        <PeakV2Rule spacing="lg" />

        {/* LIVE: the settlement ladder, in the server's own order — but only
            when it carries information the hero bar above does not already
            show. A single-level ladder IS the roster-total margin: the same
            two numbers the "Head-to-head" lane already rendered right above
            the Rosters section, in the identical dot-on-line grammar,
            seconds apart. That is a repeated section, not a second fact, so
            it stays hidden until a real tie-break ladder (two or more
            levels — see `settlementLevelTone`) actually has something new
            to say about which one decided the match. */}
        {receipt.settlement && receipt.settlement.levels.length > 1 ? (
          <div>
            <span style={SECTION_HEAD_STYLE}>Settlement</span>
            <div className="mt-4 flex flex-col gap-4">
              {receipt.settlement.levels.map((level) => {
                const values = level.values;
                const leftValue = values[leftSeat];
                const rightValue = values[rightSeat];
                const [leftCaption, rightCaption] = levelCaptions(level, leftSeat, rightSeat);
                const scaleMax = Math.max(...values.filter((v) => Number.isFinite(v)), 1) * 1.15;
                return (
                  <div key={level.level} data-testid={`td-level-${level.level}`}>
                    <PeakV2DataLane
                      label={level.label}
                      tone={settlementLevelTone(level.level)}
                      leftLabel="You"
                      leftValue={leftValue?.toFixed(2) ?? "—"}
                      leftPosition={leftValue}
                      leftCaption={leftCaption}
                      rightLabel={opponentName}
                      rightValue={rightValue?.toFixed(2) ?? "—"}
                      rightPosition={rightValue}
                      rightCaption={rightCaption}
                      scaleMin={0}
                      scaleMax={scaleMax}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Only re-drawn when the Settlement section above actually
            rendered — otherwise this would double up with the rule already
            printed before it, leaving two consecutive hairlines with
            nothing between them. */}
        {receipt.settlement && receipt.settlement.levels.length > 1 ? <PeakV2Rule spacing="lg" /> : null}

        {/* LIVE: the three real callouts, one hairline-divided list rather
            than three bordered cards. */}
        <div>
          <span style={SECTION_HEAD_STYLE}>The match, in three lots</span>
          <ul className="mt-4 flex flex-col" data-testid="td-result-facts">
            {receipt.best_bargain ? (
              <CalloutRow
                testId="td-callout-bargain"
                tag="Steal of the night"
                headline={
                  <>
                    {receipt.best_bargain.prime_score.toFixed(1)}
                    <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--v2-text-muted)" }}>
                      {" "}for {formatDollars(receipt.best_bargain.price)}
                    </span>
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
                    <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--v2-text-muted)" }}>
                      {" "}for {receipt.biggest_overpay.prime_score.toFixed(1)}
                    </span>
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
        </div>

        <PeakV2Rule spacing="lg" />

        {/* LIVE: the component disclosure, shown rather than omitted. This
            board publishes five of the six PEAK3 components — each shown
            one gets its real component tone from the same map Peak Duel and
            RUN THE TABLE use; the absent sixth renders struck through. */}
        <div data-testid="td-component-disclosure">
          <span style={SECTION_HEAD_STYLE}>Components published</span>
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
              <span key={field} className="inline-flex items-center gap-1.5" style={{ opacity: 0.6 }}>
                <span
                  aria-hidden="true"
                  style={{ width: 7, height: 7, borderRadius: "50%", border: "1px solid var(--v2-text-muted)" }}
                />
                <span
                  style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-muted)", textDecoration: "line-through" }}
                >
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
          <Field
            label="Scored under"
            value={`${receipt.model_version} · ${receipt.rounds_played} lots`}
            style={{ fontFamily: "var(--v2-font-mono)", marginTop: "0.5rem" }}
          />
        </div>

        <PeakV2Rule spacing="lg" />

        {/* Actions. */}
        <div className="flex flex-wrap items-center gap-3">
          <PeakV2PrimaryAction onClick={onPlayAgain} data-testid="td-play-again">
            Play again
          </PeakV2PrimaryAction>
          <PeakV2SecondaryAction href="/arena" data-testid="td-back-to-arena">
            Back to Arena
          </PeakV2SecondaryAction>
          <PeakV2SecondaryAction onClick={onCopy} data-testid="td-share">
            {copied ? "Copied" : "Copy result"}
          </PeakV2SecondaryAction>
        </div>

        {/* Behind the fold: the itemised slot-by-slot comparison. Same
            convention as the legacy screen's "Full receipt" disclosure —
            this answers "how exactly", the sections above already answered
            "what happened". */}
        <details className="mt-10">
          <summary
            data-testid="td-result-detail-toggle"
            style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", fontWeight: 600, color: "var(--v2-text-secondary)", cursor: "pointer" }}
          >
            Slot-by-slot detail
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            {receipt.positional.map((row) => {
              const leftEntry = row.seats[leftSeat];
              const rightEntry = row.seats[rightSeat];
              const values = [leftEntry?.prime_score, rightEntry?.prime_score].filter(
                (v): v is number => typeof v === "number",
              );
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
          </div>
        </details>
      </div>
    </PeakV2Shell>
  );
}
