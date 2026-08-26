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

import PeakV2Shell from "./PeakV2Shell";
import PeakV2Rule from "./PeakV2Rule";
import PeakV2LiveHeader from "./PeakV2LiveHeader";
import PeakV2GameStatus from "./PeakV2GameStatus";
import ArenaV2ResumeHero from "./ArenaV2ResumeHero";
import type { ArenaCatalogue } from "@/lib/arena-readiness-server";
import { MODE_COPY } from "@/lib/modes";

function ModeGroupRow({
  title,
  description,
  href,
  cta,
  testId,
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
  testId?: string;
}) {
  return (
    <a
      href={href}
      data-testid={testId}
      className="flex items-center justify-between gap-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}
    >
      <div className="min-w-0">
        <div style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.9375rem", color: "var(--v2-text-primary)" }}>
          {title}
        </div>
        <div style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}>
          {description}
        </div>
      </div>
      {/* Only the decorative arrow glyph is `aria-hidden` -- the CTA text
          itself ("Build a Perfect Season", "Play", …) is real, meaningful
          link content (it's what names the destination for a screen-reader
          user, and what courtbuilder.spec.ts's "Build a Perfect Season"
          link-name assertions read), not decoration. */}
      <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-color-accent)", whiteSpace: "nowrap" }}>
        {cta} <span aria-hidden="true">→</span>
      </span>
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

  return (
    <PeakV2Shell width="live">
      {/* Client-only. Always renders a real cinematic hero — either resume
          state or the plain no-run entry statement — so this page never
          shows a second, competing `<h1>` beneath it. */}
      <ArenaV2ResumeHero />
      <PeakV2Rule spacing="lg" />

      <section aria-labelledby="v2-arena-flagship">
        <PeakV2LiveHeader
          as="h2"
          title="Flagship"
          subtitle="One branching run, five boss battles, roughly a quarter of an hour."
          status={<PeakV2GameStatus label="Live" state="active" />}
        />
        <div className="mt-1 flex flex-col">
          <ModeGroupRow title={rtt.title} description={rtt.description} href={rtt.href} cta="Start a run" />
        </div>
      </section>

      {courtBuilderEnabled ? (
        <>
          <PeakV2Rule spacing="md" />
          <section aria-labelledby="v2-arena-season">
            <PeakV2LiveHeader as="h2" title="Full season" subtitle="Spin a real franchise and era, then draft a position-aware roster." rule={false} />
            <div className="mt-1 flex flex-col">
              <ModeGroupRow title={peakSeason.title} description={peakSeason.description} href={peakSeason.href} cta="Build a Perfect Season" />
              <ModeGroupRow
                testId="daily-peak-season-cta"
                title="82-0 · Today's Daily"
                description="Everyone gets the same spin sequence each day."
                href="/arena/court/daily/apex_1y"
                cta="Play"
              />
            </div>
            <a
              href="/arena/court/history"
              data-testid="court-history-link"
              className="mt-2 inline-block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", fontWeight: 700, color: "var(--v2-color-accent)" }}
            >
              Your runs →
            </a>
          </section>
        </>
      ) : null}

      <PeakV2Rule spacing="md" />

      <section aria-labelledby="v2-arena-daily">
        <PeakV2LiveHeader as="h2" title="Daily · quick play" subtitle="One board a day, identical for everyone, a few minutes each." rule={false} />
        <div className="mt-1 flex flex-col">
          <ModeGroupRow title={dailyGrid.title} description={dailyGrid.description} href={dailyGrid.href} cta="Play" />
          <ModeGroupRow title={peakDuel.title} description={peakDuel.description} href={peakDuel.href} cta="Play" />
        </div>
      </section>

      {arenaCatalogue.available && arenaCatalogue.modes.length > 0 ? (
        <>
          <PeakV2Rule spacing="md" />
          <section aria-labelledby="v2-arena-multiplayer">
            <PeakV2LiveHeader as="h2" title="Multiplayer · live games" subtitle="Play other people in real time. Bots fill any empty seat." rule={false} />
            <div className="mt-1 flex flex-col" data-testid="arena-multiplayer-grid">
              {arenaCatalogue.modes.map((mode) => (
                <ModeGroupRow
                  key={mode.id}
                  testId={`arena-${mode.id}-card`}
                  title={mode.name}
                  description={mode.description}
                  href={mode.href}
                  cta="Find a game"
                />
              ))}
            </div>
          </section>
        </>
      ) : null}

      <PeakV2Rule spacing="md" />

      <section aria-labelledby="v2-arena-competitive" className="pb-10">
        <PeakV2LiveHeader as="h2" title="Competitive" subtitle="Measure a roster against other players, or against the model itself." rule={false} />
        <div className="mt-1 flex flex-col">
          <ModeGroupRow
            title="The PEAK Index"
            description="All-time peak windows and single seasons, with a full component breakdown."
            href="/rankings"
            cta="See rankings"
          />
          <ModeGroupRow
            title="Formula Explorer"
            description="The five components, their official weights and how a score is assembled."
            href="/methodology"
            cta="Read methodology"
          />
        </div>
      </section>
    </PeakV2Shell>
  );
}
