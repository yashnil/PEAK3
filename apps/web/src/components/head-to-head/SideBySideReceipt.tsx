"use client";

import {
  formatLevelValue,
  type HeadToHeadReceipt,
  type SettlementLevel,
} from "@/lib/head-to-head-api";

/**
 * The side-by-side final receipt (spec §6, "Experience").
 *
 * Renders the SERVER's comparison, level by level, in the published order. The
 * point is not to announce a winner but to show where the match was decided
 * and that nothing below that point counted -- levels after the deciding one
 * are marked "not consulted" by the server and shown that way here, because a
 * table that displayed a lower level as "winning" would imply a rule that does
 * not exist.
 *
 * No PEAK3 score is computed here. Every number is `settlement.levels`.
 */
export default function SideBySideReceipt({ receipt }: { receipt: HeadToHeadReceipt }) {
  const { settlement } = receipt;
  const decided = settlement.levels.find((l) => l.level === settlement.decided_by);

  return (
    <section aria-labelledby="h2h-receipt-heading">
      <h2 id="h2h-receipt-heading" className="text-xl font-semibold">
        Head-to-Head result
      </h2>

      <p className="mt-2 text-lg" data-testid="h2h-outcome">
        {outcomeSentence(receipt)}
      </p>
      <p className="mt-1 text-sm opacity-75" data-testid="h2h-decided-by">
        {decided
          ? `Decided on ${decided.label.toLowerCase()}.`
          : "Every tie-breaker was level — this one is a draw."}
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">
            Head-to-head comparison, in the published winner order
          </caption>
          <thead>
            <tr className="text-left opacity-70">
              <th scope="col" className="py-2 pr-3">Tie-breaker</th>
              <th scope="col" className="py-2 pr-3">{receipt.creator.display_name}</th>
              <th scope="col" className="py-2 pr-3">{receipt.opponent.display_name}</th>
              <th scope="col" className="py-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {settlement.levels.map((level, index) => (
              <tr
                key={level.level}
                data-testid={`h2h-level-${level.level}`}
                className={
                  level.level === settlement.decided_by
                    ? "font-semibold"
                    : level.verdict === "not_consulted"
                      ? "opacity-40"
                      : undefined
                }
              >
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <span className="mr-2 opacity-50">{index + 1}</span>
                  {level.label}
                </th>
                <td className="py-2 pr-3">{formatLevelValue(level.level, level.creator)}</td>
                <td className="py-2 pr-3">{formatLevelValue(level.level, level.opponent)}</td>
                <td className="py-2">{verdictLabel(level, receipt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs opacity-60">
        Tie-breakers are applied strictly in order; a level only counts when every
        level above it is exactly equal. Credit efficiency is roster PEAK3 total per
        net credit committed. Active play time is measured server-side from your
        run&apos;s first action to its last, and only separates two players when the
        gap is at least {marginSeconds(settlement.levels)} seconds — so latency
        cannot decide a match.
      </p>
    </section>
  );
}

function marginSeconds(levels: SettlementLevel[]): number {
  const time = levels.find((l) => l.level === "active_play_time");
  return time?.margin_seconds ?? 2;
}

function verdictLabel(level: SettlementLevel, receipt: HeadToHeadReceipt): string {
  switch (level.verdict) {
    case "creator":
      return receipt.creator.display_name;
    case "opponent":
      return receipt.opponent.display_name;
    case "tied":
      return "Level";
    case "tied_within_margin":
      return "Too close to call";
    case "not_consulted":
    default:
      return "Not consulted";
  }
}

function outcomeSentence(receipt: HeadToHeadReceipt): string {
  const you =
    receipt.your_role === "creator"
      ? receipt.creator.display_name
      : receipt.opponent.display_name;
  const them =
    receipt.your_role === "creator"
      ? receipt.opponent.display_name
      : receipt.creator.display_name;
  if (receipt.your_outcome === "draw") return `${you} and ${them} finished level.`;
  if (receipt.your_outcome === "won") return `${you} beat ${them}.`;
  return `${them} beat ${you}.`;
}
