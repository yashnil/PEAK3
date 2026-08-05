"use client";
import { useState } from "react";
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
 * SERVER-RENDERED, WITH NO CLIENT FETCH. The fact is chosen by calendar date on
 * the server and passed in as a prop, so the panel costs the homepage one
 * additional element and no additional request. The only client state is
 * whether the evidence is expanded.
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
  const [showEvidence, setShowEvidence] = useState(false);

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

        <div className="fotd-actions">
          <button
            type="button"
            className="fotd-source"
            data-testid="fotd-evidence-toggle"
            aria-expanded={showEvidence}
            aria-controls="fotd-evidence"
            onClick={() => setShowEvidence((open) => !open)}
          >
            {showEvidence ? "Hide source rows" : "Show source rows"}
          </button>
          {fact.player_slug && (
            <Link
              href={`/players/${fact.player_slug}`}
              className="fotd-link"
              data-testid="fotd-player-link"
            >
              See their PEAK3 profile
            </Link>
          )}
        </div>

        <div id="fotd-evidence" hidden={!showEvidence}>
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
        </div>
      </div>
    </section>
  );
}
