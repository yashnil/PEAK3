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
 * NOTHING IS GENERATED HERE OR AT REQUEST TIME. The facts come from a versioned
 * bank built offline by `scripts/build_nba_facts.py` from committed per-season
 * data, each carrying the exact rows it was computed from. This component
 * renders one, and the evidence is a disclosure rather than a footnote --
 * generated trivia with no way back to its source is indistinguishable from
 * invented trivia, and the disclosure is what makes the difference checkable.
 *
 * SERVER-RENDERED, AND SHIPS NO CLIENT JAVASCRIPT AT ALL. The fact is chosen by
 * calendar date on the server and passed in as a prop, so the panel costs the
 * homepage one additional element and no additional request.
 *
 * THE DISCLOSURE IS NATIVE `<details>`, AND THAT IS A CORRECTNESS FIX RATHER
 * THAN A SIMPLIFICATION. It was a `<button>` driving a `useState`, and CI
 * caught the consequence: the trace shows the click landing 0.6s after
 * `domcontentloaded` while `main-app.js`, `layout.js` and `page.js` were all
 * still in flight. The button was server-rendered, so it was visible, stable,
 * enabled and receiving events -- it passed every actionability check there is
 * -- and React had not yet attached its `onClick`. The event dispatched into a
 * live DOM node and did nothing.
 *
 * That is not only a test defect. Anyone who lands on the homepage and reaches
 * for "Show source rows" inside the first second gets the same dead click, and
 * on a slow connection that window is much longer than a second.
 *
 * A `<details>` element has no such window. The browser owns the open/closed
 * state, so it works before hydration and with JavaScript disabled entirely; it
 * is keyboard-operable (Enter and Space) with no handler of ours; and it
 * exposes its state to assistive technology natively, which is why there is no
 * hand-written `aria-expanded` or `aria-controls` here -- adding them would
 * duplicate, and eventually contradict, what the element already reports.
 *
 * The label still changes with the state. That is done in CSS
 * (`.fotd-details[open]`), because the one thing native disclosure cannot do is
 * rewrite its own summary -- and doing it with a hook would put the dead-click
 * window straight back.
 */

export interface NbaFactView {
  fact_id: string;
  text: string;
  category: string;
  era: string;
  source_label: string;
  player_slug: string | null;
  team_code: string | null;
  evidence: Array<{
    player: string;
    team: string;
    season: string;
    games_played: number | null;
  }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  franchise_tenure: "Franchise tenure",
  age_season: "Longevity",
  role_player: "Role players",
  career_arc: "Career arc",
  streak: "Streaks",
  rare_threshold: "Rare thresholds",
  era_anomaly: "Era anomaly",
};

export default function NbaFactOfTheDay({ fact }: { fact: NbaFactView | null }) {
  // A homepage that has not had its data built renders no panel rather than an
  // error card. `data/web/` is generated and gitignored, so an un-built
  // checkout is a normal state.
  if (!fact) return null;

  const label = CATEGORY_LABELS[fact.category] ?? "NBA history";

  return (
    <section
      className="fotd"
      data-testid="nba-fact-of-the-day"
      data-fact-id={fact.fact_id}
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
          </p>
        </div>

        <p className="fotd-text" data-testid="fotd-text">
          {fact.text}
        </p>

        <details className="fotd-details" data-testid="fotd-details">
          <summary className="fotd-source" data-testid="fotd-evidence-toggle">
            {/* Only one of these is in the DOM's accessibility tree at a time:
                `display: none` removes the other, so the summary's accessible
                name is "Show source rows" closed and "Hide source rows" open,
                exactly as the button's label used to be. */}
            <span className="fotd-source-closed">Show source rows</span>
            <span className="fotd-source-open">Hide source rows</span>
          </summary>

          <table className="fotd-evidence" data-testid="fotd-evidence">
            <caption>The seasons this fact was computed from.</caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Season</th>
                <th scope="col">Team</th>
                <th scope="col">Games</th>
              </tr>
            </thead>
            <tbody>
              {fact.evidence.map((row, index) => (
                <tr key={`${row.season}-${row.team}-${index}`}>
                  <td>{row.player}</td>
                  <td>{row.season}</td>
                  <td>{row.team}</td>
                  <td>{row.games_played ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fotd-provenance">{fact.source_label}</p>
        </details>

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
