"use client";
import type { ArenaResultView, TmwRoster } from "@/types/three-man-weave";
import {
  RANKING_BASIS_LABEL,
  outcomeHeadline,
  podium,
  rankingBasisLabel,
} from "@/lib/three-man-weave-state";
import { starterSlots, benchSlots } from "@/lib/three-man-weave-state";

/**
 * The final podium and the three-way receipt.
 *
 * TWO BINDING RULES LIVE ON THIS SURFACE.
 *
 * 1. THE RANKING BASIS IS NAMED WHERE THE WINNER IS DECLARED — not in a
 *    tooltip, not in a footnote. The 82-game record and the PEAK3 lineup score
 *    disagree about the winner in roughly one match in five, so a player whose
 *    71-11 roster lost to a 64-18 one must be able to read why without
 *    hunting. The basis sentence sits directly under the headline.
 *
 * 2. THE RECORD IS FLAVOUR AND IS VISUALLY SUBORDINATE. It appears smaller,
 *    muted, and labelled "projected", underneath the score that actually
 *    decided the match. It is never the headline, on the podium or in a row.
 *
 * A roster that could not be fully scored gets a real state — "Not ranked",
 * with the reason — rather than a blank or a zero. The server refuses to
 * fabricate that number and this surface must not fabricate it either;
 * `scoreDisplay` returns a discriminated union precisely so the `unrankable`
 * case cannot be forgotten.
 *
 * Modelled on `head-to-head/SideBySideReceipt.tsx`, widened from two columns
 * to three. Like that component, every number here is the server's.
 */
export default function PodiumReceipt({
  results,
  rosters,
  yourSeatIndex,
}: {
  results: ArenaResultView[];
  rosters: TmwRoster[];
  yourSeatIndex: number | null;
}) {
  const rows = podium(results);
  // The `unrankable` branch carries its own reason; pulled out here so the
  // JSX does not have to re-narrow the union inline.
  const unrankableReason =
    rows.map((row) => row.score).find((score) => score.kind === "unrankable")?.reason ?? null;

  if (!rows.length) {
    return (
      <section data-testid="tmw-podium" className="rounded-lg border p-4">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          This match has no recorded result.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section
        data-testid="tmw-podium"
        aria-labelledby="tmw-podium-heading"
        className="flex flex-col gap-1 rounded-lg border p-4"
        style={{ borderColor: "var(--peak-accent)", background: "var(--peak-accent-bg)" }}
      >
        <h2
          id="tmw-podium-heading"
          data-testid="tmw-outcome"
          className="text-xl font-bold"
          style={{ color: "var(--text-primary)" }}
        >
          {outcomeHeadline(rows)}
        </h2>
        {/* RULE 1: the basis, right here, not in a tooltip. */}
        <p
          data-testid="tmw-ranking-basis"
          className="text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          {rankingBasisLabel()}
        </p>

        <ol data-testid="tmw-podium-rows" className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.result.seat_index}
              data-testid={`tmw-podium-${row.result.seat_index}`}
              data-placement={row.result.placement}
              className="flex items-baseline gap-3 rounded px-2 py-1.5"
              style={{ background: "var(--bg-elevated)" }}
            >
              <span
                className="w-6 shrink-0 text-sm font-bold tabular-nums"
                style={{ color: "var(--text-muted)" }}
              >
                {row.result.placement}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-sm font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {row.result.display_name}
                {row.result.seat_index === yourSeatIndex && (
                  <span
                    className="ml-1.5 text-[9px] font-bold uppercase tracking-widest"
                    style={{ color: "var(--peak-accent-text)" }}
                  >
                    you
                  </span>
                )}
                {row.tied && (
                  <span
                    data-testid={`tmw-tied-${row.result.seat_index}`}
                    className="ml-1.5 text-[9px] font-bold uppercase tracking-widest"
                    style={{ color: "var(--text-muted)" }}
                  >
                    tied
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                {/* The deciding number: large, primary. */}
                <span
                  data-testid={`tmw-score-${row.result.seat_index}`}
                  className="block text-base font-bold tabular-nums"
                  style={{
                    color:
                      row.score.kind === "scored" ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {row.score.text}
                </span>
                {/* RULE 2: the record, subordinate. Smaller, muted, labelled. */}
                {row.record && (
                  <span
                    data-testid={`tmw-record-${row.result.seat_index}`}
                    className="block text-[10px] tabular-nums"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {row.record}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>

        {unrankableReason && (
          <p
            data-testid="tmw-unrankable-note"
            className="mt-2 text-[11px] leading-snug"
            style={{ color: "var(--text-muted)" }}
          >
            {unrankableReason}
          </p>
        )}
      </section>

      <section aria-labelledby="tmw-receipt-heading" className="flex flex-col gap-2">
        <h2
          id="tmw-receipt-heading"
          className="text-sm font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Full rosters
        </h2>
        <div className="grid gap-3 md:grid-cols-3" data-testid="tmw-receipt-rosters">
          {rows.map((row) => {
            const roster = rosters.find((r) => r.seat_index === row.result.seat_index);
            return (
              <article
                key={row.result.seat_index}
                data-testid={`tmw-receipt-${row.result.seat_index}`}
                className="flex min-w-0 flex-col gap-1 rounded-lg border p-3"
                style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)" }}
              >
                <header className="flex items-baseline justify-between gap-2">
                  <h3
                    className="min-w-0 truncate text-xs font-bold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {row.result.display_name}
                  </h3>
                  <span
                    className="shrink-0 text-xs font-bold tabular-nums"
                    style={{ color: "var(--peak-accent-text)" }}
                  >
                    {row.score.text}
                  </span>
                </header>
                <p className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  {RANKING_BASIS_LABEL}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {roster
                    ? [...starterSlots(roster), ...benchSlots(roster)].map(({ slotType, pick }) => (
                        <li
                          key={slotType}
                          className="flex min-w-0 items-baseline gap-2 text-[11px]"
                        >
                          <span
                            className="w-7 shrink-0 font-bold"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {slotType === "bench_1" ? "BN" : slotType}
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {pick?.player_name ?? "—"}
                          </span>
                          <span
                            className="shrink-0 tabular-nums"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {pick?.scoring_card
                              ? pick.scoring_card.prime_score.toFixed(1)
                              : "—"}
                          </span>
                        </li>
                      ))
                    : null}
                </ul>
                {row.result.detail?.structural_weakness && (
                  <p className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {row.result.detail.structural_weakness}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
