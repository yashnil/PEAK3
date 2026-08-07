import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  BarChart3,
  GitBranch,
  Grid3x3,
  ListOrdered,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import GameCard from "@/components/shared/GameCard";
import HeroLauncher from "@/components/home/HeroLauncher";
import HeroVignette from "@/components/home/HeroVignette";
import ModelProofStrip from "@/components/home/ModelProofStrip";
import ComponentComparison from "@/components/home/ComponentComparison";
import LeaderboardPreview from "@/components/home/LeaderboardPreview";
import NbaFactOfTheDay from "@/components/home/NbaFactOfTheDay";
import {
  loadHomeModelData,
  loadNbaFactOfTheDay,
} from "@/components/home/home-data";
import MultiplayerSection, {
  MultiplayerLobbyLink,
} from "@/components/arena/MultiplayerSection";
import { MODE_COPY } from "@/lib/modes";
import { getArenaCatalogue } from "@/lib/arena-readiness-server";
import { getCourtBuilderReadiness } from "@/lib/perfect-season-api";

export const metadata: Metadata = {
  title: "PEAK3 Arena — Run the Table",
  description:
    "Draft exact NBA peak windows across a branching run, spend scarce credits, and beat five escalating statistical lineups. A basketball strategy game built on a transparent, open-weight rating formula — with receipts on every result.",
};

const HOW_IT_WORKS: { icon: typeof Users; title: string; body: string }[] = [
  {
    icon: Users,
    title: "Draft",
    body: "Every card is one exact 3-year peak window, priced by the engine. A fixed credit budget means you cannot buy the board.",
  },
  {
    icon: GitBranch,
    title: "Branch",
    body: "Each act is a map, not a queue. Draft rooms, trade desks, film rooms and rest banks — you never get to take them all.",
  },
  {
    icon: Swords,
    title: "Battle",
    body: "Each act ends against a boss lineup. Five lanes, one point each, and the receipt shows every number that decided it.",
  },
];

/** The five official component weights, the same numbers the model uses. */
const COMPONENT_WEIGHTS: { label: string; pct: string; color: string }[] = [
  { label: "Statistical Impact", pct: "38%", color: "var(--comp-si)" },
  { label: "Traditional Production", pct: "21%", color: "var(--comp-tp)" },
  { label: "Individual Recognition", pct: "20%", color: "var(--comp-rec)" },
  { label: "Playoff Rate Impact", pct: "18%", color: "var(--comp-po)" },
  { label: "Team Result", pct: "3%", color: "var(--comp-team)" },
];

/**
 * The catalogue's group labels ("Flagship", "Daily · quick play", …).
 *
 * WAS `text-[11px] font-bold uppercase tracking-[0.18em]` plus an inline
 * `color: var(--text-muted)` at every one of its five call sites. Two things
 * were wrong with that and only one of them was cosmetic.
 *
 * The tracking was a fourth hand-picked value in a page that also used 0.2em,
 * 0.16em and 0.14em for the same typographic idea; `.home-eyebrow` reads
 * `--pk-track-eyebrow`, which is that idea named once.
 *
 * The colour was `--text-muted` — the faintest ink the palette has, reserved
 * for genuinely tertiary metadata — on the ONLY labels that tell a visitor how
 * this page is organised. They are section headings that happen to be small.
 * `--text-secondary` is a measured tier up, so the promotion cannot cost
 * contrast anywhere.
 */
const GROUP_LABEL_CLASS = "home-eyebrow";
const GROUP_LABEL_STYLE = { color: "var(--text-secondary)" } as const;

/**
 * The homepage leads with RUN THE TABLE, the flagship mode.
 *
 * WHAT THE UX PASS CHANGED (W2, plan §5.1 and brief §6).
 *
 * 1. The first viewport is ACTION, the second is PROOF. The headline lost
 *    roughly half its type size — it is still the same sentence, word for word,
 *    because it is a frozen invariant, but it no longer occupies a screen on
 *    its own. The space it gave back went to `HeroVignette`, which shows real
 *    top-ranked peak windows with their real component contributions: the hero
 *    is now a piece of the game rather than a poster about it.
 *
 * 2. `home-primary-cta` is a plain link, not a menu button. It WAS a menu
 *    button, back when the launcher offered several starting choices. With one
 *    meaningful public mode, a click whose only result is a list to click again
 *    buys nothing, so it now goes straight to a standard run — or reads
 *    "Continue Run" when one is in progress, with "Start New Run" appearing
 *    only once there is something to prefer it over. The daily keeps its own
 *    `?mode=daily` route into the start gate rather than `?start=daily`,
 *    because a bare link or bookmark must never silently spend the day's one
 *    attempt.
 *
 * 3. The mode cards are grouped (flagship / daily / full season / competitive)
 *    instead of listed, and the groups use different surface tiers so the page
 *    is not one dark rectangle repeated eight times.
 *
 * History, because the lead has moved: Peak Duel (Phase 1), then 82-0 PEAK
 * Season (Phase 8E), now RUN THE TABLE. Each time, the previous flagship was
 * demoted to a clearly-labeled secondary card rather than removed — every one
 * of those modes still works and is still supported, and this page still links
 * to all of them.
 *
 * Exactly one card on this page is `featured`. A second gold card would make
 * the word meaningless, which is the whole reason the hierarchy is expressed in
 * the card component rather than in copy.
 *
 * The 82-0 card stays behind the same fail-closed readiness check it has always
 * had: a fetch failure (API down) means the card is not rendered, never a link
 * to a mode that may not work. RUN THE TABLE is not gated on it — that flag
 * describes CourtBuilder only.
 *
 * Still a server component: the only client JS this page adds is the launcher
 * island and the vignette's rotation, both small, both hydrating over markup
 * that was already rendered on the server.
 *
 * WHAT THE VISUAL-IDENTITY PASS CHANGED, AND WHAT IT DELIBERATELY DID NOT.
 *
 * Nothing above is undone. Not one destination, heading level, `data-testid`,
 * readiness gate or sentence of copy moved; the page renders exactly the same
 * information in exactly the same order. Four things changed:
 *
 *   1. A TYPE SCALE, WHERE THERE WAS A HERO AND THEN NOTHING. The page had a
 *      48px headline followed by four 20px section headings, so the catalogue,
 *      the explanation, the comparison and the leaderboards all read as the
 *      same rank of thing. Section titles are 24px now and take their tracking
 *      and leading from `--pk-track-heading` / `--pk-leading-heading` instead
 *      of from whatever `font-display` happened to apply; the hero takes
 *      `--pk-track-display` / `--pk-leading-display`. Every uppercase
 *      micro-label — six of them at four different hand-picked tracking values
 *      — is now `.home-eyebrow`, which reads `--pk-track-eyebrow`.
 *
 *   2. CARDS ARE OBJECTS. `.pk-lift` / `.pk-lift-lg` / `.pk-press` on every
 *      mode card and every control, `.pk-sheen` on exactly one — the hero's
 *      primary launcher, because a specular pass on a second element is where
 *      it stops being premium and starts being a casino. The card physics that
 *      `home.css` used to hand-roll were deleted rather than left to compete
 *      with the primitives at equal specificity.
 *
 *   3. SECTIONS ARRIVE INSTEAD OF APPEARING. `.pk-reveal` with a staggered
 *      `--pk-reveal-index` on the hero column, the mode grids, the three
 *      "how a run works" steps, the proof facts and the five weight cards.
 *      Indices restart per group, so each group reads as its own beat and
 *      nothing waits behind a queue of thirty. It is pure CSS — no
 *      IntersectionObserver, no client JS, nothing that changes what this page
 *      renders on the server.
 *
 *   4. FAINT COPY MOVED UP A TIER. `--text-muted` was carrying the six group
 *      labels, the five component NAMES, the proof strip's terms, the "you can
 *      play as a guest" promise and the paragraph that exists specifically to
 *      stop a reader misreading the five weights. Those are not metadata; they
 *      are the page. Each moved to `--text-secondary`, which is a measured
 *      tier up and therefore cannot cost contrast anywhere. What stayed muted
 *      stayed muted on purpose — the meta chips on a card, a rank numeral, a
 *      "across 4 runs" suffix — because a tier nothing uses is a tier that
 *      means nothing.
 */
/**
 * `?fact=YYYY-MM-DD` — the fact card for a specific day.
 *
 * WHY THIS EXISTS, AND WHY IT COSTS NOTHING. `GET /api/v1/nba-facts/today`
 * already accepts `?on=` and its own docstring gives the reason: "makes the
 * selection testable and cacheable: the same date always returns the same
 * fact". The homepage had no way to use it, so the card could only ever be
 * reviewed on whatever day the reviewer happened to be looking — and a
 * screenshot review of a DAILY card that can only see one day is not a review
 * of the card.
 *
 * Client-side interception cannot substitute: the fact is fetched by this
 * server component, so nothing a browser does can reach it.
 *
 * No new disclosure — the API parameter is already public and unauthenticated,
 * and this forwards to it. No new cost either: `loadNbaFactOfTheDay` uses
 * `cache: "no-store"`, so this page is already dynamically rendered.
 * A malformed value is ignored rather than 400ing the homepage.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const requested = Array.isArray(params.fact) ? params.fact[0] : params.fact;
  const factDate = requested && ISO_DATE.test(requested) ? requested : undefined;

  const [readinessResult, modelData, arenaCatalogue, nbaFact] = await Promise.all([
    getCourtBuilderReadiness().then(
      (r) => r.courtbuilder_enabled,
      () => false,
    ),
    loadHomeModelData(),
    // Fail-closed inside the helper, so this cannot reject and cannot take the
    // homepage down when the Arena is unreachable.
    getArenaCatalogue(),
    // Fail-closed too: no fact means no panel, never a broken homepage.
    loadNbaFactOfTheDay(factDate),
  ]);
  const courtBuilderEnabled = readinessResult;

  const flagship = MODE_COPY["run-the-table"];
  const peakSeason = MODE_COPY["peak-season"];
  const dailyGrid = MODE_COPY["daily-grid"];
  const peakDuel = MODE_COPY["peak-duel"];

  return (
    <div className="min-h-screen">
      {/* ---------------------------------------------------------------
          1. Hero — one promise, one headline, one primary action, and a
          live piece of the actual game.
          --------------------------------------------------------------- */}
      {/* `.pk-atmosphere` REPLACES `.home-hero-glow`, WHICH IS NOW DEAD.
          The two are the same effect — two radial floodlights over a court
          grid — but `.home-hero-glow` hardcodes its alphas as literal rgba,
          so Arena Day got Arena Night's lighting: a 10% gold wash and a 7%
          blue wash over cream, which is nothing at all. The `--pk-glow-*`
          tokens behind `.pk-atmosphere` are re-tuned per theme, so the hero
          is actually lit in both. The old rule still exists in globals.css
          (not this pass's file to edit) and now has no callers. */}
      <section
        className="home-hero pk-atmosphere px-4 pt-14 pb-12 sm:pt-20"
        aria-labelledby="hero-heading"
      >
        {/* When the API is unreachable the vignette renders nothing, so the
            hero collapses to one column rather than leaving a dead half. */}
        <div
          className="home-hero-grid mx-auto max-w-6xl"
          data-vignette={modelData.windows.length > 0 ? "true" : "false"}
        >
          {/* THE HERO ARRIVES IN READING ORDER, ONE BEAT APART.
              `.pk-reveal` is a rise-and-fade whose delay comes from an INDEX,
              not from a hand-written duration, so the rhythm is the design
              system's decision rather than this page's. Four steps at
              `--pk-stagger` (55ms) is about a fifth of a second end to end —
              enough that the eye is led down the column, far short of the
              "splash screen" this is explicitly not.

              Server-rendered: `.pk-reveal` is pure CSS, so none of this costs
              the homepage a byte of client JavaScript, and the reduced-motion
              block in globals.css zeroes the delays rather than leaving the
              last element invisible for a beat. */}
          <div className="min-w-0">
            <p
              className="home-eyebrow pk-reveal"
              style={{ color: "var(--peak-accent-text)", "--pk-reveal-index": 0 } as React.CSSProperties}
            >
              Flagship mode · Run the Table
            </p>
            <span className="home-eyebrow-rule" aria-hidden="true" />

            <p
              className="pk-reveal mt-5 text-sm leading-relaxed sm:text-base"
              style={{ color: "var(--text-secondary)", "--pk-reveal-index": 1 } as React.CSSProperties}
            >
              PEAK3 rates every NBA peak window since 1979-80 on five open components. This is
              the game you play against it.
            </p>

            {/* `tracking-tight` is gone from this class list on purpose: the
                hero's tracking AND its leading now come from `.home-hero-h1`,
                which reads `--pk-track-display` / `--pk-leading-display`. Two
                sources for one letter-spacing is how a display scale drifts
                back into per-element guesses. */}
            <h1
              id="hero-heading"
              className="home-hero-h1 font-display pk-reveal mt-3 text-3xl font-extrabold sm:text-4xl lg:text-5xl"
              style={{ "--pk-reveal-index": 2 } as React.CSSProperties}
            >
              Build a roster of peaks.
              <br />
              <span style={{ color: "var(--peak-accent-text)" }}>Run the table.</span>
            </h1>

            <p
              className="pk-reveal mt-4 max-w-xl text-sm leading-relaxed"
              style={{ color: "var(--text-secondary)", "--pk-reveal-index": 3 } as React.CSSProperties}
            >
              Draft exact 3-year peak windows across a branching run, spend scarce credits, and
              beat five escalating lineups — every battle decided by the five components, with a
              full receipt.
            </p>

            <HeroLauncher className="pk-reveal mt-7" revealIndex={4}>
              {/* The secondary control gets `.pk-lift` and `.pk-press` — the
                  same feedback as the primary one — but NOT `.pk-sheen`. The
                  sheen is the one primitive in the set that becomes noise the
                  moment more than a single control on a screen has it, and
                  the hero already has exactly one thing it wants pressed.

                  ITS SURFACE MOVED OUT OF THE `style` PROP AND INTO
                  `.home-secondary-cta`, and that is a correctness fix rather
                  than tidying: an inline `boxShadow` is a style-attribute
                  declaration, so it outranks EVERY stylesheet rule including
                  `.pk-lift:hover`'s. Given a resting shadow inline, the
                  button would have kept it at rest, on hover and on focus —
                  a lift that lifts nothing. */}
              <Link
                href="/rankings"
                className="home-secondary-cta pk-lift pk-press"
              >
                Explore Rankings
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </HeroLauncher>
          </div>

          <HeroVignette windows={modelData.windows} />
        </div>
      </section>

      {/* ---------------------------------------------------------------
          2. The launcher — every mode, grouped, in one compact block.

          MORE SEPARATION FROM THE HERO, QUIETER SURFACE TIER
          (PRODUCT_EXPERIENCE_CONTRACT.md §7): a top border on
          `--pk-surface-quiet-border` plus real vertical space is what
          keeps the hero reading as a complete moment before this catalog
          begins, rather than the page's second act at the hero's own
          visual weight. This section was NOT rebuilt — it is honest
          information architecture (every mode really does need a link) —
          only recessed a tier below the arena-styled hero above it.
          --------------------------------------------------------------- */}
      {/* BETWEEN THE HERO AND THE CATALOGUE, which is the placement the panel
          earns: it is a reason to come back tomorrow, so it belongs where a
          returning visitor's eye already lands, and it is one short paragraph,
          so it does not push the games below the fold. */}
      <NbaFactOfTheDay fact={nbaFact} />

      <section
        className="px-4 pt-14 pb-14 border-t"
        style={{ borderColor: "var(--pk-surface-quiet-border, var(--border-subtle))" }}
        aria-labelledby="modes-heading"
      >
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            {/* Section titles move from `text-xl` to `text-2xl` and pick up
                `.home-section-title` (`--pk-track-heading` /
                `--pk-leading-heading`). The page had a 48px hero and then
                four 20px headings, so everything below the fold read at one
                undifferentiated weight — the catalogue, the explanation and
                the leaderboards all looked like the same rank of thing. 24px
                is the middle step the scale was missing. */}
            <h2 id="modes-heading" className="home-section-title font-display text-2xl font-bold">
              Choose a game
            </h2>
            <Link
              href="/arena"
              data-testid="home-catalog-link"
              className="arena-inline-link"
              style={{ color: "var(--text-secondary)" }}
            >
              Browse the full catalog
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>

          {/* Flagship */}
          <h3 className={`mt-5 mb-2 ${GROUP_LABEL_CLASS}`} style={GROUP_LABEL_STYLE}>
            Flagship
          </h3>
          <GameCard
            testId="home-flagship-card"
            revealIndex={0}
            href={flagship.href}
            eyebrow={flagship.eyebrow}
            title={flagship.title}
            description={flagship.description}
            icon={<Swords size={18} />}
            meta={flagship.meta}
            featured
            cta={flagship.cta}
          />

          {/* Daily — the quick-play tier: one board a day, same for everyone. */}
          <div className="mt-8 mb-2 flex items-baseline justify-between gap-3">
            <h3 className={GROUP_LABEL_CLASS} style={GROUP_LABEL_STYLE}>
              Daily · quick play
            </h3>
            <Link
              href="/daily"
              data-testid="home-daily-hub-link"
              className="arena-inline-link"
              style={{ color: "var(--peak-accent-text)" }}
            >
              Daily hub
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <GameCard
              testId="home-daily-grid-card"
              revealIndex={0}
              href={dailyGrid.href}
              eyebrow={dailyGrid.eyebrow}
              title={dailyGrid.title}
              description={dailyGrid.description}
              icon={<Grid3x3 size={17} />}
              cta={dailyGrid.cta}
              tone="raised"
              compact
            />
            <GameCard
              testId="home-daily-duel-card"
              revealIndex={1}
              href={peakDuel.href}
              eyebrow={peakDuel.eyebrow}
              title={peakDuel.title}
              description={peakDuel.description}
              icon={<Swords size={17} />}
              cta={peakDuel.cta}
              tone="raised"
              compact
            />
          </div>

          {/* Full season. Fail-closed: no readiness, no card. */}
          {courtBuilderEnabled && (
            <>
              <h3
                className={`mt-8 mb-2 ${GROUP_LABEL_CLASS}`}
                style={GROUP_LABEL_STYLE}
              >
                Full season
              </h3>
              <GameCard
                testId="home-peak-season-card"
                revealIndex={0}
                href={peakSeason.href}
                eyebrow={peakSeason.eyebrow}
                title={peakSeason.title}
                description={peakSeason.description}
                icon={<Trophy size={17} />}
                meta={peakSeason.meta}
                cta={peakSeason.cta}
                compact
              />
            </>
          )}

          {/* Multiplayer. Rendered unconditionally: the band shows either two
              cards or a closed-alpha note, and a section that vanished
              entirely is how these two games came to be reachable only by
              typing a URL. */}
          <div className="mt-8 mb-2 flex items-baseline justify-between gap-3">
            <h3 id="home-multiplayer-heading" className={GROUP_LABEL_CLASS} style={GROUP_LABEL_STYLE}>
              Multiplayer · live games
            </h3>
            <MultiplayerLobbyLink testId="home-multiplayer-lobby-link" />
          </div>
          <MultiplayerSection
            catalogue={arenaCatalogue}
            testIdPrefix="home"
          />

          {/* Competitive — measure yourself against other players, or against
              the model's own board. */}
          <h3 className={`mt-8 mb-2 ${GROUP_LABEL_CLASS}`} style={GROUP_LABEL_STYLE}>
            Competitive
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <GameCard
              testId="home-leaderboard-card"
              revealIndex={0}
              href="/arena/court/leaderboard"
              eyebrow="Community"
              title="82-0 Leaderboard"
              description="The best submitted 82-0 PEAK Season runs — measure your roster against them."
              icon={<ListOrdered size={17} />}
              cta="View leaderboard"
              tone="quiet"
              compact
            />
            <GameCard
              testId="home-rankings-card"
              revealIndex={1}
              href="/rankings"
              eyebrow="Rankings"
              title="The PEAK Index"
              description="All-time peak windows and single seasons, with a full component breakdown and row-by-row receipts on every score."
              icon={<BarChart3 size={17} />}
              cta="See the rankings"
              tone="quiet"
              compact
            />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------
          3. Proof — the live model, its coverage, its size, its method.
          Rendered only from real API provenance; see ModelProofStrip.
          --------------------------------------------------------------- */}
      <ModelProofStrip proof={modelData.proof} />

      {/* ---------------------------------------------------------------
          4. How a run works, and what actually decides a battle.
          --------------------------------------------------------------- */}
      <section className="px-4 py-14" aria-labelledby="how-heading">
        <div className="mx-auto max-w-5xl">
          <h2 id="how-heading" className="home-section-title font-display text-2xl font-bold">
            How a run works
          </h2>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
            {HOW_IT_WORKS.map((step, i) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.title}
                  className="home-band pk-reveal p-5"
                  style={{ "--pk-reveal-index": i } as React.CSSProperties}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="home-step-index font-display text-sm font-bold"
                      aria-hidden="true"
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 items-center justify-center rounded-lg"
                      style={{
                        background: "var(--pk-surface-raised, var(--bg-surface))",
                        border: "1px solid var(--border-subtle)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <Icon size={15} />
                    </span>
                    <h3 className="font-display text-base font-bold">{step.title}</h3>
                  </div>
                  <p className="mt-2.5 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {step.body}
                  </p>
                </div>
              );
            })}
          </div>

          {/* `home-band-accent` swaps the band's neutral crown hairline for the
              gold one. This is the page's single statement of what the model
              IS — five weights, printed as the model's own numbers — so it is
              the one band that earns the accent edge; the three step cards
              above keep the neutral one. */}
          <div className="home-band home-band-accent mt-3 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              {/* NOT "what decides a battle".
                  A battle is first to 3 of five EQUALLY weighted lanes
                  (`battle.py`, LANES_TO_WIN) -- Team Result is worth exactly as
                  much as Statistical Impact when a lane is contested. These
                  percentages are the weights PEAK3 uses to build a player's
                  RATING, and in a battle they surface only in `roster_total`,
                  the second tie-breaker. Heading this strip "what decides a
                  battle" put the two systems under one title and contradicted
                  "Five lanes, one point each" 320px above it. */}
              <h3 className={GROUP_LABEL_CLASS} style={GROUP_LABEL_STYLE}>
                How a player is rated
              </h3>
              <Link
                href="/methodology"
                className="arena-inline-link"
                style={{ color: "var(--peak-accent-text)" }}
              >
                Explore the full methodology
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </div>

            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {COMPONENT_WEIGHTS.map((c, i) => (
                <li
                  key={c.label}
                  className="pk-reveal p-3"
                  style={
                    {
                      borderRadius: "var(--pk-r-md, 10px)",
                      background: "var(--pk-surface-inset, var(--bg-elevated))",
                      border: "1px solid var(--border-subtle)",
                      borderTop: `2px solid ${c.color}`,
                      "--pk-reveal-index": i,
                    } as React.CSSProperties
                  }
                >
                  <p
                    className="score-number text-lg font-bold"
                    style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}
                  >
                    {c.pct}
                  </p>
                  {/* PROMOTED AND ENLARGED, --text-muted -> --text-secondary
                      and 10px -> 11px. These are the NAMES OF THE FIVE
                      COMPONENTS — the entire subject of the panel they sit in,
                      and the label without which "38%" means nothing. They
                      were the smallest, faintest text on the homepage. The
                      colour identity still lives in the 2px top border, which
                      is where the frozen `--comp-*` fills belong. */}
                  <p
                    className="mt-1 text-[11px] leading-tight"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {c.label}
                  </p>
                </li>
              ))}
            </ul>
            {/* `c.color` (the frozen `--comp-*` identity hue) marks each
                component via the card's top-border accent above, not as
                text: the raw comp-* hexes measured 1.8-2.6:1 against
                Arena Day's light card surface — below even the 3:1 large-
                text floor for four of the five. `--text-primary` for the
                number keeps every card readable in both themes; the color
                identity is still fully legible in the border swatch,
                exactly what PRODUCT_EXPERIENCE_CONTRACT.md §9 asks for
                ("same hex, different deployment," never a re-invented
                value). */}

            <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Every card is rated by this five-component, open-weight formula applied to
              Basketball Reference statistics. No black boxes, no name-recognition bias, no
              hand-picked results.
            </p>
            {/* Says the quiet part out loud. Printing 38/21/20/18/3 next to a
                game about five lanes invites exactly the wrong inference.

                PROMOTED, --text-muted -> --text-secondary. This paragraph
                exists to stop a reader drawing a false conclusion from the
                five numbers directly above it. A correction nobody reads is
                not a correction, and setting it in the faintest ink available
                — one tier below the sentence it is correcting — was an
                instruction to skip it. */}
            <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              A battle works differently: the five lanes are worth one point each, so Team
              Result decides a lane just as often as Statistical Impact. First to three wins.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------
          5. Interactive component comparison (P3-H,
          SYNTHESIS_CONTRACT.md §7). Real methodology text and real
          weights, click one open, jump to the rankings sorted by it.
          Renders nothing if /api/v1/methodology could not be reached.
          --------------------------------------------------------------- */}
      <ComponentComparison methodology={modelData.methodology} />

      {/* ---------------------------------------------------------------
          6. Leaderboard preview (P3-H). Real 82-0 all-time top rows,
          today's daily status, and a signed-in visitor's own personal
          best — never a placeholder number for a signed-out visitor.
          --------------------------------------------------------------- */}
      <LeaderboardPreview />

      {/*
        Why an account — the last thing missing from this page.

        Every mode above is playable signed out and says so, which is the right
        default and stays true. But nothing on the page then explained what an
        account is FOR, so the only account affordance was a "Sign in" button in
        the header with no stated benefit — an ask with no offer.

        Each line below is a capability that genuinely requires a durable
        identity (a server-side owner_sub), not a marketing claim: saved 82-0
        runs and personal bests, streaks that survive a new device, and ranked.
        No counts, no testimonials, no invented social proof — there is no real
        usage data to quote and inventing some would be worse than saying
        nothing.
      */}
      <section className="border-t" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl">
              {/* PROMOTED AND ENLARGED. "Optional, always" is the promise this
                  entire section rests on — that nothing above is gated — and
                  it was 10px in the faintest ink on the page. */}
              <p className="home-eyebrow" style={{ color: "var(--text-secondary)" }}>
                Optional, always
              </p>
              <h2 className="home-section-title mt-2 font-display text-2xl font-bold sm:text-3xl">
                Play as a guest. Keep it with an account.
              </h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                Every mode above is fully playable without signing in — nothing is gated. An
                account is what makes a result outlive the browser tab it was played in.
              </p>
              <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2" style={{ color: "var(--text-secondary)" }}>
                {[
                  "Save 82-0 rosters and track personal bests",
                  "A run history that follows you across devices",
                  "Daily streaks that survive a cleared cache",
                  "Ranked duels against another player",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <span aria-hidden="true" style={{ color: "var(--peak-accent-text)" }}>
                      →
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              {/* PROMOTED, --text-muted -> --text-secondary. This is the line
                  that answers "do I lose what I already played?", which is the
                  first objection anyone has to the two buttons beside it. It
                  is an answer, not a footnote. */}
              <p className="mt-4 text-xs" style={{ color: "var(--text-secondary)" }}>
                Anything you played as a guest is carried over when you sign in.
              </p>
            </div>

            {/* Both account controls take `.pk-lift` and `.pk-press` — the same
                feedback every other pressable object on this page now has. No
                sheen: the hero's launcher is the page's primary action and
                keeps that treatment to itself. */}
            <div className="flex shrink-0 flex-col gap-2 sm:w-48">
              <Link
                href="/signup"
                className="pk-lift pk-press rounded-lg px-4 py-2.5 text-center text-sm font-semibold"
                style={{ background: "var(--peak-accent, #f5c842)", color: "var(--text-inverse)" }}
                data-testid="home-create-account"
              >
                Create an account
              </Link>
              <Link
                href="/signin"
                className="pk-lift pk-press rounded-lg border px-4 py-2.5 text-center text-sm font-semibold"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
                data-testid="home-signin"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
