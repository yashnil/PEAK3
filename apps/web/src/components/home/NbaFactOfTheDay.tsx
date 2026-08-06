import Link from "next/link";

/**
 * NBA Fact of the Day.
 *
 * GENERAL BASKETBALL TRIVIA, AND NOT A PEAK3 CLAIM. The heading says "NBA Fact
 * of the Day" and never "PEAK3 Fact of the Day", and no fact's text depends on
 * the model's weights, calibration or component scores. That is a product rule
 * with a practical edge: this panel sits above the game catalogue, so most of
 * the people who read it have not yet been told what PEAK3 is, and a line they
 * cannot evaluate is a line they skip.
 *
 * WHAT THE MANUAL REVIEW FOUND, AND WHAT CHANGED
 * ==============================================
 * Two findings, and they had one cause between them.
 *
 *   "NBA Fact of the Day is visually weak"
 *   "the generated fact is often too dull to deserve homepage prominence"
 *
 * The panel was a heading, two small tags, one paragraph of body text, and — as
 * its most prominent interaction — a `<details>` labelled **Show source rows**
 * that opened a four-column table of `(player, season, team, games)`. So the
 * card's design was: read one sentence, then optionally read a database. It had
 * no typographic hierarchy to speak of, nothing to look at, and its call to
 * action was an invitation to audit it.
 *
 * The card now leads with a FEATURED VALUE — the number, name or date the fact
 * turns on — set large beside a court-line motif, then the headline, then one
 * or two supporting sentences. The source rows are gone from the homepage
 * entirely. They still exist: they are carried in the payload and they are what
 * `tests/test_nba_facts.py` re-derives. They are simply not the thing a visitor
 * is offered first.
 *
 * A "Learn more" link survives, and only where it is genuinely useful: when the
 * fact is about a player this product actually has a profile for.
 *
 * STILL SERVER-RENDERED, STILL ZERO CLIENT JAVASCRIPT. The fact is chosen on
 * the server by calendar date and passed in as a prop. Removing the `<details>`
 * removed the last interactive element, so this panel now ships no behaviour at
 * all — which also retires the dead-click window the previous version's own
 * comment documented at length.
 *
 * THE GRAPHIC IS AN SVG WITH NO TEXT IN IT, and it is `aria-hidden`. Court
 * lines — a key circle and a three-point arc — drawn in `currentColor` at low
 * alpha, so it inherits the theme instead of carrying two hard-coded palettes.
 * No logo, no photograph, no likeness: the project ships none of those.
 */

export interface NbaFactView {
  fact_id: string;
  /** The compelling lead. */
  headline: string;
  /** One or two sentences that make the lead hold up. */
  body: string;
  /** The v1 single-string field, kept so an older payload still renders. */
  text?: string;
  category: string;
  era: string;
  geography?: string;
  /** The number, name or event the card sets large. */
  feature?: string | null;
  feature_label?: string | null;
  source_label: string;
  player_slug: string | null;
  team_code: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  nba_history: "NBA history",
  obscure_history: "Buried history",
  current_nba: "Right now",
  player_story: "Player story",
  connections: "Connections",
  records: "Records",
  playoffs_finals: "Playoffs & Finals",
  franchise: "Franchises",
  rules: "Rule changes",
  tactics: "How the game changed",
  draft: "Draft",
  global: "Global game",
  olympics_fiba: "Olympics & FIBA",
  womens: "Women's basketball",
  international_leagues: "International leagues",
  culture: "Culture",
  statistical_oddity: "Statistical oddity",
  streaks: "Streaks",
  role_players: "Role players",
  historic_games: "Historic games",
  // v1 categories, so an un-rebuilt bank still labels itself.
  franchise_tenure: "Franchises",
  age_season: "Longevity",
  role_player: "Role players",
  career_arc: "Career arc",
  streak: "Streaks",
  rare_threshold: "Rare thresholds",
  era_anomaly: "Era anomaly",
};

const GEOGRAPHY_LABELS: Record<string, string> = {
  international: "International",
  global: "Global",
};

export default function NbaFactOfTheDay({ fact }: { fact: NbaFactView | null }) {
  // A homepage that has not had its data built renders no panel rather than an
  // error card. `data/web/` is generated and gitignored, so an un-built
  // checkout is a normal state.
  if (!fact) return null;

  const label = CATEGORY_LABELS[fact.category] ?? "NBA history";
  const place = fact.geography ? GEOGRAPHY_LABELS[fact.geography] : undefined;
  // A v1 payload has `text` and no split; render it as the headline rather
  // than dropping it.
  const headline = fact.headline || fact.text || "";
  const body = fact.headline ? fact.body : "";

  return (
    <section
      className="fotd"
      data-testid="nba-fact-of-the-day"
      data-fact-id={fact.fact_id}
      data-category={fact.category}
      aria-labelledby="fotd-heading"
    >
      <div className="fotd-inner">
        <div className="fotd-head">
          <h2 id="fotd-heading" className="fotd-title">
            NBA Fact of the Day
          </h2>
          <p className="fotd-tags">
            <span className="fotd-tag" data-testid="fotd-category">
              {label}
            </span>
            {fact.era && (
              <span className="fotd-tag" data-testid="fotd-era">
                {fact.era}
              </span>
            )}
            {place && (
              <span className="fotd-tag" data-testid="fotd-geography">
                {place}
              </span>
            )}
          </p>
        </div>

        <div className="fotd-body">
          {fact.feature && (
            <div className="fotd-feature" data-testid="fotd-feature">
              <CourtMotif />
              <span className="fotd-feature-value">{fact.feature}</span>
              {fact.feature_label && (
                <span className="fotd-feature-label">{fact.feature_label}</span>
              )}
            </div>
          )}

          <div className="fotd-copy">
            <p className="fotd-headline" data-testid="fotd-text">
              {headline}
            </p>
            {body && (
              <p className="fotd-support" data-testid="fotd-support">
                {body}
              </p>
            )}
          </div>
        </div>

        {/* NO SOURCE-ROW TABLE, AND NO DISCLOSURE THAT OPENS ONE. The rows are
            still carried in the payload and still re-derived by the model tests;
            they are not what a visitor is offered first, or at all, here. */}
        {fact.player_slug && (
          <div className="fotd-actions">
            <Link
              href={`/players/${fact.player_slug}`}
              className="fotd-link"
              data-testid="fotd-player-link"
            >
              See their PEAK3 profile
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

/** Court lines, in `currentColor`, with no text and no branding.
 *
 *  `currentColor` rather than two hard-coded palettes: the motif then inherits
 *  whatever the card's text colour resolves to, so light and dark are one
 *  declaration instead of a media query that can be forgotten. */
function CourtMotif() {
  return (
    <svg
      className="fotd-motif"
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="60" cy="60" r="26" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 118 A 62 62 0 0 1 110 118"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line x1="10" y1="118" x2="110" y2="118" stroke="currentColor" strokeWidth="1.5" />
      <rect
        x="42"
        y="72"
        width="36"
        height="46"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
