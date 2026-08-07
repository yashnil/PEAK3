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
 * HOME-03 — WHAT THIS PASS CHANGED, AND WHY
 * =========================================
 * The card was already free of its old source-row table, but next to the
 * homepage hero it still read as a notice rather than as an editorial moment:
 * one accent colour whatever the fact was about, one court motif whatever the
 * fact was about, three tags in the same faint grey as each other, and — as its
 * only interactive element — a 11px underlined "See their PEAK3 profile" in
 * secondary text, shown for roughly three quarters of the bank whether or not
 * the profile had anything to do with the fact.
 *
 *   1. THE CARD IS TUNED TO ITS CATEGORY. Six accent groups (history, rules and
 *      tactics, records, playoffs, the global game, people) each drive one
 *      custom property, `--fotd-accent`, which colours the rule, the figure
 *      panel, the eyebrow and the wash behind the whole card. A rule-change
 *      fact and an Olympics fact no longer look like the same fact.
 *   2. THE MOTIF IS TIED TO THE CATEGORY TOO. Five line drawings — a court, a
 *      shot clock, a globe, a trophy, a bar chart — chosen from the same
 *      grouping. All `currentColor`, all stroke-only, none with any text in
 *      them, none `aria-` anything but hidden.
 *   3. THE FIGURE PANEL IS ALWAYS THERE. Facts that carry a `feature` set it
 *      large inside the panel; facts that do not get the motif as a standalone
 *      glyph, so every card has a focal point instead of collapsing to a
 *      paragraph on the days the bank has no number to lead with.
 *   4. THE DEFAULT PROFILE LINK IS GONE (HOME-03). A link survives only where
 *      the player IS the subject of the fact — the handful of player-story and
 *      career-arc categories — and when it survives it is a real bordered
 *      control with a resting affordance, not faint underlined body text
 *      (SHARED-04). Everywhere else the card ships no interactive element.
 *   5. THE TAGS ARE A HIERARCHY. Category in the accent ink, era and geography
 *      in secondary text, rather than three identical grey chips (SHARED-05).
 *
 * NO SOURCE ROWS, STILL. They remain in the payload and remain what
 * `tests/test_nba_facts.py` re-derives; they are simply not what a visitor is
 * offered, here or anywhere on the homepage.
 *
 * STILL SERVER-RENDERED, STILL ZERO CLIENT JAVASCRIPT. The fact is chosen on
 * the server by calendar date and passed in as a prop.
 *
 * DEGRADES ON PURPOSE. Every field below the headline is optional in practice:
 * the fact bank is being re-tiered in parallel and a card that hard-requires
 * `feature`, `geography`, `era` or `player_slug` would break the homepage the
 * day one of them stops being emitted. Only a headline is load-bearing.
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

/**
 * Which size band the figure's hook belongs in.
 *
 * Three bands rather than a continuous scale: a continuous one would need a
 * measurement pass and a re-render, and the useful distinction here is only
 * "a number", "a short phrase" and "a date or a sentence fragment". The
 * thresholds are set from the real featured tier, whose longest hook is
 * "31 October 1950" at fifteen characters.
 */
export function featureLengthBand(feature: string | null | undefined): "short" | "medium" | "long" {
  const length = (feature ?? "").trim().length;
  if (length <= 4) return "short";
  if (length <= 9) return "medium";
  return "long";
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

/** Which accent group a category belongs to. The value is written to
 *  `data-accent` and every colour in the card is derived from it in CSS, so
 *  adding a category is a one-line change here and nothing in the stylesheet.
 *
 *  An unmapped category falls through to `history`, which is the brand gold —
 *  i.e. exactly what the card looked like before this pass. A category the
 *  fact-bank rebuild invents therefore renders correctly rather than colourless.
 */
const ACCENT_GROUPS: Record<string, string> = {
  rules: "rules",
  tactics: "rules",
  records: "records",
  statistical_oddity: "records",
  streaks: "records",
  streak: "records",
  rare_threshold: "records",
  age_season: "records",
  playoffs_finals: "playoffs",
  historic_games: "playoffs",
  global: "global",
  olympics_fiba: "global",
  international_leagues: "global",
  womens: "global",
  player_story: "people",
  role_players: "people",
  role_player: "people",
  career_arc: "people",
  culture: "people",
  connections: "people",
  current_nba: "people",
};

type MotifKind = "court" | "clock" | "globe" | "trophy" | "chart";

/** One drawing per accent group. Deliberately not one per category: six
 *  recognisable marks that a returning visitor learns are better than twenty
 *  they cannot tell apart. */
const GROUP_MOTIF: Record<string, MotifKind> = {
  history: "court",
  rules: "clock",
  records: "chart",
  playoffs: "trophy",
  global: "globe",
  people: "court",
};

/** The only categories where a link to the player's profile is genuinely
 *  useful: the ones where the player IS the subject of the fact, rather than
 *  merely named in it. A rule-change fact that happens to mention Wilt does not
 *  get a profile link — that was the "default requirement" HOME-03 removed. */
const PLAYER_SUBJECT_CATEGORIES = new Set([
  "player_story",
  "career_arc",
  "role_players",
  "role_player",
]);

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
  const accent = ACCENT_GROUPS[fact.category] ?? "history";
  const motif = GROUP_MOTIF[accent] ?? "court";
  const showProfileLink =
    Boolean(fact.player_slug) && PLAYER_SUBJECT_CATEGORIES.has(fact.category);

  return (
    <section
      className="fotd"
      data-testid="nba-fact-of-the-day"
      data-fact-id={fact.fact_id}
      data-category={fact.category}
      data-accent={accent}
      aria-labelledby="fotd-heading"
    >
      <div className="fotd-inner">
        {/* THE FIGURE. Always rendered, so the composition does not collapse to
            a paragraph on a fact with no number to lead with — the motif then
            stands in as the mark. */}
        <div className="fotd-figure" data-testid="fotd-figure">
          {fact.feature ? (
            <>
              {/* The motif is a watermark BEHIND the number here: the number is
                  the focal point and the drawing is the frame it stands in. */}
              <Motif kind={motif} />
              {/* THE HOOK IS NOT ALWAYS A NUMERAL.
                  `feature` is whatever the generator put there, and across the
                  featured tier that ranges from "3" to "31 October 1950" and
                  "Every barangay" -- fifteen characters. Sized for a short
                  number, a long one overflowed the figure panel and
                  `overflow: hidden` clipped it mid-word: the Jordan-shoes fact
                  rendered as "anne". The length band is measured here, where
                  the string is, and CSS picks a size from it -- there is no
                  CSS-only way to ask how long a text node is. */}
              <span
                className="fotd-feature"
                data-testid="fotd-feature"
                data-length={featureLengthBand(fact.feature)}
              >
                <span className="fotd-feature-value pk-numeral">{fact.feature}</span>
                {fact.feature_label && (
                  <span className="fotd-feature-label">{fact.feature_label}</span>
                )}
              </span>
            </>
          ) : (
            /* No number to lead with, so the drawing becomes the mark itself
               rather than a watermark behind nothing. */
            <span className="fotd-glyph" aria-hidden="true">
              <Motif kind={motif} glyph />
            </span>
          )}
        </div>

        <div className="fotd-main">
          <div className="fotd-eyebrow">
            <h2 id="fotd-heading" className="fotd-title">
              NBA Fact of the Day
            </h2>
            <span className="fotd-rule" aria-hidden="true" />
            <span className="fotd-tag fotd-tag-category" data-testid="fotd-category">
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
          </div>

          <p className="fotd-headline" data-testid="fotd-text">
            {headline}
          </p>
          {body && (
            <p className="fotd-support" data-testid="fotd-support">
              {body}
            </p>
          )}

          {/* NO SOURCE-ROW TABLE, AND NO DISCLOSURE THAT OPENS ONE. The rows are
              still carried in the payload and still re-derived by the model
              tests; they are not what a visitor is offered first, or at all,
              here. */}
          {showProfileLink && (
            <div className="fotd-actions">
              <Link
                href={`/players/${fact.player_slug}`}
                className="fotd-cta"
                data-testid="fotd-player-link"
              >
                See the full PEAK3 profile
                <span aria-hidden="true" className="fotd-cta-arrow">
                  →
                </span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* WHY THE LINK DOES NOT NAME THE PLAYER. The obvious label is "Learn more
   about <name>", and the obvious way to get that name is to title-case the
   slug — which is wrong for a large fraction of the league. `javale-mcgee`
   title-cases to "Javale Mcgee" beside a headline that reads "JaVale McGee",
   and the payload carries no display name to use instead. A control sitting
   directly under a headline that has just named the player does not need to
   name them again; misspelling them there would be worse than not. */

/** Category-tied line drawings, in `currentColor`, with no text and no
 *  branding.
 *
 *  `currentColor` rather than two hard-coded palettes: each motif then inherits
 *  whatever the card's accent ink resolves to, so light and dark are one
 *  declaration instead of a media query that can be forgotten. Stroke-only, so
 *  a fill can never come out as a solid block on the wrong theme.
 *
 *  `glyph` draws the same mark at the same coordinates; only the CSS class
 *  around it differs, so the standalone version of a motif and the watermark
 *  version can never drift apart. */
function Motif({ kind, glyph }: { kind: MotifKind; glyph?: boolean }) {
  return (
    <svg
      className={glyph ? "fotd-motif fotd-motif-glyph" : "fotd-motif"}
      data-motif={kind}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "court" && (
        <>
          <circle cx="60" cy="60" r="26" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 118 A 62 62 0 0 1 110 118" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="10" y1="118" x2="110" y2="118" stroke="currentColor" strokeWidth="1.5" />
          <rect x="42" y="72" width="36" height="46" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </>
      )}

      {kind === "clock" && (
        <>
          <circle cx="60" cy="64" r="38" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="60" cy="64" r="30" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="60" y1="64" x2="60" y2="40" stroke="currentColor" strokeWidth="1.5" />
          <line x1="60" y1="64" x2="80" y2="74" stroke="currentColor" strokeWidth="1.5" />
          <line x1="52" y1="20" x2="68" y2="20" stroke="currentColor" strokeWidth="1.5" />
          <line x1="60" y1="20" x2="60" y2="26" stroke="currentColor" strokeWidth="1.5" />
        </>
      )}

      {kind === "globe" && (
        <>
          <circle cx="60" cy="60" r="40" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <ellipse cx="60" cy="60" rx="18" ry="40" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="20" y1="60" x2="100" y2="60" stroke="currentColor" strokeWidth="1.5" />
          <path d="M27 38 A 46 46 0 0 0 93 38" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M27 82 A 46 46 0 0 1 93 82" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </>
      )}

      {kind === "trophy" && (
        <>
          <path
            d="M38 20 H82 V48 A22 22 0 0 1 38 48 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M38 26 H24 V38 A14 14 0 0 0 38 52" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M82 26 H96 V38 A14 14 0 0 1 82 52" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="60" y1="70" x2="60" y2="88" stroke="currentColor" strokeWidth="1.5" />
          <line x1="40" y1="100" x2="80" y2="100" stroke="currentColor" strokeWidth="1.5" />
          <rect x="46" y="88" width="28" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </>
      )}

      {kind === "chart" && (
        <>
          <line x1="18" y1="102" x2="104" y2="102" stroke="currentColor" strokeWidth="1.5" />
          <line x1="18" y1="102" x2="18" y2="18" stroke="currentColor" strokeWidth="1.5" />
          <rect x="30" y="72" width="16" height="30" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="54" y="52" width="16" height="50" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="78" y="30" width="16" height="72" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
}
