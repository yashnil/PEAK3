/**
 * ArenaPageV2 — the Arena hub, V2 (Pass 3, product-direction).
 *
 * Per the brief's <arena> section: "feel like entering a competitive
 * basketball environment, not opening an admin dashboard." Structure —
 * cinematic resume state (client-only, real data or nothing at all) → LIVE
 * mode rows, grouped exactly like the legacy catalog (flagship / full
 * season / daily / multiplayer / competitive) but as hairline rows rather
 * than a grid of equal cards. No invented tiers, ranks or aggregate arena
 * activity anywhere on this page — every row links to a route this
 * repository actually serves, and the multiplayer rows render only when
 * `arenaCatalogue.available` is real (never a card that would 403).
 */

import { ModeSlateCell } from "./HomePageV2";
import PeakV2Shell from "./PeakV2Shell";
import PeakV2Rule from "./PeakV2Rule";
import PeakV2LiveHeader from "./PeakV2LiveHeader";
import PeakV2GameStatus from "./PeakV2GameStatus";
import ArenaV2ResumeHero from "./ArenaV2ResumeHero";
import type { ReactNode } from "react";
import type { ArenaCatalogue, ArenaCatalogueMode } from "@/lib/arena-readiness-server";
import { MODE_COPY, RUN_THE_TABLE_RUNS_HREF } from "@/lib/modes";

/**
 * ONE GAME WITH SEVERAL RULESETS, as one cell: the game's name links to its
 * family card in the lobby, and each ruleset the server serves (Classic,
 * Franchise Draft, Decade Draft) is a link of its own beneath it. A
 * `ModeSlateCell` is a single link and cannot hold these, which is why the
 * family is not three more cells beside the $20 Showdown.
 */
function ModeFamilyCell({ mode }: { mode: ArenaCatalogueMode }) {
  const titleId = `v2-arena-family-${mode.id}`;
  return (
    <div className="v2-arena-family" data-testid={`arena-${mode.id}-card`} role="group" aria-labelledby={titleId}>
      <span className="v2-arena-mode-head">
        <a id={titleId} href={mode.href} className="v2-arena-family-title">
          {mode.name}
        </a>
        <span className="v2-arena-mode-live">Live</span>
      </span>
      <span className="v2-arena-mode-desc">{mode.description}</span>
      <ul className="v2-arena-family-variants" aria-label={`${mode.name} formats`}>
        {(mode.variants ?? []).map((variant) => (
          <li key={variant.id}>
            <a href={variant.href} className="v2-arena-family-variant" data-testid={`arena-variant-${variant.id}`}>
              <span className="v2-arena-family-variant-label">{variant.label}</span>
              <span className="v2-arena-family-variant-summary">{variant.summary}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A small secondary text link, styled like the legacy hub's `arena-link-row`
 *  entries — a lighter-weight action beside a `ModeGroupRow`'s primary CTA. */
function InlineLink({ href, testId, children }: { href: string; testId?: string; children: ReactNode }) {
  return (
    <a
      href={href}
      data-testid={testId}
      className="inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", fontWeight: 600, color: "var(--v2-text-secondary)" }}
    >
      {children} <span aria-hidden="true">→</span>
    </a>
  );
}

export default function ArenaPageV2({
  courtBuilderEnabled,
  arenaCatalogue,
}: {
  courtBuilderEnabled: boolean;
  arenaCatalogue: ArenaCatalogue;
}) {
  const rtt = MODE_COPY["run-the-table"];
  const peakSeason = MODE_COPY["peak-season"];
  const dailyGrid = MODE_COPY["daily-grid"];
  const peakDuel = MODE_COPY["peak-duel"];

  // ONE CELL COMPONENT, SHARED WITH THE HOMEPAGE (`ModeSlateCell`). The
  // catalogue's job is "what games exist, and which do I want" rather than the
  // homepage's "what should I play now", so it differs in GROUPING and
  // ordering — flagship, daily, full season, multiplayer, competitive — and
  // not in what a mode looks like. Before this, the same six modes were cards
  // on one page and hairline text rows on the other.
  const cellsFor = (
    entries: { mode: Parameters<typeof ModeSlateCell>[0]["mode"]; testId?: string; live?: boolean; cta: string; featured?: boolean }[],
  ) =>
    entries.map((e) => (
      <ModeSlateCell
        key={e.testId ?? e.mode.id}
        mode={e.mode}
        testId={e.testId}
        live={e.live}
        cta={e.cta}
        featured={e.featured}
        descriptionSource="description"
      />
    ));

  return (
    <PeakV2Shell width="live">
      {/* Client-only. Always renders a real cinematic hero — either resume
          state or the plain no-run entry statement — so this page never
          shows a second, competing `<h1>` beneath it. */}
      <ArenaV2ResumeHero />
      <PeakV2Rule spacing="md" />

      <section aria-labelledby="v2-arena-flagship">
        <PeakV2LiveHeader
          as="h2"
          title="Flagship"
          subtitle="One branching run, five boss battles, roughly a quarter of an hour."
          status={<PeakV2GameStatus label="Live" state="active" />}
        />
        {/* A one-cell grid rather than a full-width slab: the flagship is
            marked by its badge and its ground, not by being a different SHAPE
            from every other mode (rule 13's "no giant marketing slabs"). */}
        <div className="v2-arena-modes v2-arena-modes--single">
          {cellsFor([
            {
              mode: { id: "run-the-table", href: rtt.href, title: rtt.title, description: rtt.description },
              testId: "arena-flagship-card",
              cta: "Start a run",
              featured: true,
            },
          ])}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <InlineLink href="/arena/run-the-table?start=standard" testId="arena-rtt-start-link">
            Start a standard run
          </InlineLink>
          <InlineLink href={RUN_THE_TABLE_RUNS_HREF} testId="arena-rtt-runs-link">
            Resume a saved run
          </InlineLink>
        </div>
      </section>

      <PeakV2Rule spacing="md" />

      <section aria-labelledby="v2-arena-daily">
        <PeakV2LiveHeader as="h2" title="Daily · quick play" subtitle="One board a day, identical for everyone, a few minutes each." rule={false} />
        <div className="v2-arena-modes v2-arena-modes--pair">
          {cellsFor([
            { mode: { id: dailyGrid.id, href: dailyGrid.href, title: dailyGrid.title, description: dailyGrid.description }, testId: "arena-daily-grid-card", cta: "Play" },
            { mode: { id: peakDuel.id, href: peakDuel.href, title: peakDuel.title, description: peakDuel.description }, testId: "arena-daily-duel-card", cta: "Play" },
          ])}
        </div>
      </section>

      {courtBuilderEnabled ? (
        <>
          <PeakV2Rule spacing="md" />
          <section aria-labelledby="v2-arena-season">
            <PeakV2LiveHeader as="h2" title="Full season" subtitle="Spin a real franchise and era, then draft a position-aware roster." rule={false} />
            <div className="v2-arena-modes v2-arena-modes--pair" data-testid="courtbuilder-hero">
              {cellsFor([
                { mode: { id: "peak-season", href: peakSeason.href, title: peakSeason.title, description: peakSeason.description }, cta: "Build a Perfect Season" },
                {
                  mode: {
                    id: "peak-season-daily",
                    href: "/arena/court/daily/apex_1y",
                    title: "82-0 · Today's Daily",
                    description: "Everyone gets the same spin sequence each day.",
                  },
                  testId: "daily-peak-season-cta",
                  cta: "Play",
                },
              ])}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <InlineLink href="/arena/court/history" testId="court-history-link">
                Your saved seasons
              </InlineLink>
              <InlineLink href="/arena/court/leaderboard" testId="arena-leaderboard-link">
                82-0 Leaderboard
              </InlineLink>
            </div>
          </section>
        </>
      ) : null}

      {arenaCatalogue.available && arenaCatalogue.modes.length > 0 ? (
        <>
          <PeakV2Rule spacing="md" />
          <section aria-labelledby="v2-arena-multiplayer">
            <PeakV2LiveHeader as="h2" title="Multiplayer · live games" subtitle="Play other people in real time. Bots fill any empty seat." rule={false} />
            <div className="v2-arena-modes v2-arena-modes--pair" data-testid="arena-multiplayer-grid">
              {/* `live` is set from the real catalogue, not from a decorative
                  chip on every row — rule 13's "no repetitive LIVE dots". */}
              {arenaCatalogue.modes.map((mode) =>
                mode.variants?.length ? (
                  <ModeFamilyCell key={mode.id} mode={mode} />
                ) : (
                  cellsFor([
                    {
                      mode: { id: mode.id, href: mode.href, title: mode.name, description: mode.description },
                      testId: `arena-${mode.id}-card`,
                      live: true,
                      cta: "Find a game",
                    },
                  ])
                ),
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <InlineLink href="/arena/lobby" testId="arena-lobby-link">
                All multiplayer games
              </InlineLink>
              <InlineLink href="/?feedback=game_idea#feedback" testId="arena-suggest-mode">
                Suggest a game mode
              </InlineLink>
            </div>
          </section>
        </>
      ) : null}

      <PeakV2Rule spacing="md" />

      <section aria-labelledby="v2-arena-competitive" className="pb-10">
        <PeakV2LiveHeader as="h2" title="Competitive" subtitle="Measure a roster against other players, or against the model itself." rule={false} />
        <div className="v2-arena-modes v2-arena-modes--pair">
          {cellsFor([
            {
              mode: {
                id: "peak-index",
                href: "/rankings",
                title: "The PEAK Index",
                description: "All-time peak windows and single seasons, with a full component breakdown.",
              },
              cta: "See rankings",
            },
            {
              mode: {
                id: "formula-explorer",
                href: "/methodology",
                title: "Formula Explorer",
                description: "The five components, their official weights and how a score is assembled.",
              },
              cta: "Read methodology",
            },
          ])}
        </div>
      </section>
    </PeakV2Shell>
  );
}
