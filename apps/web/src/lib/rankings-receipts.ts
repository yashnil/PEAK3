/**
 * Row-specific "receipts" for the rankings explanation modal (Phase 12A).
 *
 * THE PROBLEM THIS SOLVES. The modal explained the FORMULA well and the ROW
 * badly: two different player-seasons produced nearly the same paragraph, so a
 * user looking at a number that surprised them ("why is Jimmy Butler's
 * Postseason Value low after that Finals run?") got a definition instead of an
 * answer.
 *
 * Every function here is pure, takes the served explain block, and returns text
 * built ONLY from fields that row actually has. There is no fallback prose: a
 * receipt with no inputs returns `null` and the UI omits the card rather than
 * printing something generic. Nothing here recomputes a score, and nothing
 * infers a fact the artifact does not carry — in particular, playoff RATE
 * statistics are not in the served block, so the postseason receipt describes
 * the sample and the sign of the value rather than claiming to know how the
 * player performed per possession.
 *
 * The postseason and team receipts carry the most explanatory weight, because
 * they are the two components whose behaviour surprised reviewers. See
 * docs/model/POSTSEASON_TEAM_AUDIT.md for what they actually measure.
 */
import type { RankingComponentKey, RankingExplain, RankingExplainBlock } from "@/types";

export interface ComponentReceipt {
  key: RankingComponentKey;
  /** Row-specific evidence: the numbers behind this component for THIS row. */
  evidence: string | null;
  /** Present only when the value needs explaining — a zero, a negative, a
   *  shrunk sample, a capped ceiling. This is the line that answers "why does
   *  that number look wrong?". */
  note: string | null;
}

// ---------------------------------------------------------------------------
// Field access
// ---------------------------------------------------------------------------

function num(block: RankingExplainBlock | null | undefined, key: string): number | null {
  const raw = block?.[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  // The served blocks stringify some values (e.g. postseason availability).
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function statNum(explain: RankingExplain | null, key: string): number | null {
  return num(explain?.season_stats as RankingExplainBlock | null, key);
}

/** Joins clauses into one sentence, dropping the empties. Returns null when
 *  nothing survived, so the caller can omit the card entirely. */
function sentence(parts: (string | null)[]): string | null {
  const kept = parts.filter((p): p is string => !!p);
  return kept.length ? `${kept.join(", ")}.` : null;
}

// ---------------------------------------------------------------------------
// Per-component receipts
// ---------------------------------------------------------------------------

/** Statistical Impact — the rate/impact metrics, over the sample they were
 *  measured on. */
function statisticalImpact(explain: RankingExplain | null): ComponentReceipt {
  const bpm = statNum(explain, "bpm");
  const vorp = statNum(explain, "vorp");
  const ws48 = statNum(explain, "ws_per_48");
  const per = statNum(explain, "per");
  const games = statNum(explain, "games");
  const mpg = statNum(explain, "mpg");

  const metrics = sentence([
    bpm !== null ? `${bpm.toFixed(1)} BPM` : null,
    vorp !== null ? `${vorp.toFixed(1)} VORP` : null,
    ws48 !== null ? `${ws48.toFixed(3)} WS/48` : null,
    per !== null ? `${per.toFixed(1)} PER` : null,
  ]);
  const over =
    games !== null && mpg !== null
      ? ` Measured over ${games} games at ${mpg.toFixed(1)} minutes per game.`
      : "";

  return {
    key: "statistical_impact",
    evidence: metrics ? `${metrics.slice(0, -1)}.${over}` : null,
    note: null,
  };
}

/** Traditional Production — the box-score line and its efficiency. */
function traditionalProduction(explain: RankingExplain | null): ComponentReceipt {
  const pts75 = statNum(explain, "pts_per_75");
  const ast75 = statNum(explain, "ast_per_75");
  const trb100 = statNum(explain, "trb_per_100");
  const ppg = statNum(explain, "ppg");
  const ts = statNum(explain, "ts_pct");
  const tsPlus = statNum(explain, "ts_plus");
  const usg = statNum(explain, "usg_pct");

  const volume = sentence([
    pts75 !== null ? `${pts75.toFixed(1)} pts/75` : ppg !== null ? `${ppg.toFixed(1)} ppg` : null,
    trb100 !== null ? `${trb100.toFixed(1)} reb/100` : null,
    ast75 !== null ? `${ast75.toFixed(1)} ast/75` : null,
  ]);
  const efficiency = sentence([
    ts !== null ? `${(ts * 100).toFixed(1)}% true shooting` : null,
    tsPlus !== null ? `${tsPlus.toFixed(0)} TS+` : null,
    usg !== null ? `${usg.toFixed(1)}% usage` : null,
  ]);

  const evidence = [volume, efficiency].filter(Boolean).join(" ") || null;
  return { key: "traditional_production", evidence, note: null };
}

/** The generated block encodes awards compactly ("MVP-1", "NBA1", "AS"), which
 *  is fine as data and unreadable as a sentence. This maps the shipped tokens
 *  (all 12 of them) to what a reader would call them. A token with no mapping
 *  is passed through verbatim rather than dropped — an unfamiliar award is
 *  still information, and inventing a name for it would be worse. */
const AWARD_TOKEN_LABELS: Record<string, string> = {
  MVP: "MVP",
  DPOY: "Defensive Player of the Year",
  ROY: "Rookie of the Year",
  MIP: "Most Improved Player",
  CPOY: "Comeback Player of the Year",
  "6MOY": "Sixth Man of the Year",
  AS: "All-Star",
  NBA1: "All-NBA First Team",
  NBA2: "All-NBA Second Team",
  NBA3: "All-NBA Third Team",
  DEF1: "All-Defensive First Team",
  DEF2: "All-Defensive Second Team",
};

function ordinal(n: number): string {
  const suffix =
    n % 10 === 1 && n % 100 !== 11
      ? "st"
      : n % 10 === 2 && n % 100 !== 12
        ? "nd"
        : n % 10 === 3 && n % 100 !== 13
          ? "rd"
          : "th";
  return `${n}${suffix}`;
}

/**
 * "MVP-1" -> "MVP"; "DPOY-7" -> "Defensive Player of the Year (7th in voting)";
 * "NBA1" -> "All-NBA First Team".
 *
 * The rank suffix is matched with an anchored `-<digits>` pattern rather than a
 * plain split, because an already-readable value like "All-NBA First Team"
 * contains hyphens of its own and splitting on the first one truncates it to
 * "All". The same field arrives in both forms depending on the row.
 */
function humanizeAward(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";
  const match = /^(.+?)-(\d+)$/.exec(trimmed);
  const base = match ? match[1] : trimmed;
  const label = AWARD_TOKEN_LABELS[base] ?? base;
  if (!match) return label;
  // A voting rank of 1 is "won it"; anything else is a finishing position.
  const rank = Number(match[2]);
  if (rank === 1 || !Number.isFinite(rank)) return label;
  return `${label} (${ordinal(rank)} in voting)`;
}

/** Individual Recognition — the awards actually on record for this row. */
function individualRecognition(explain: RankingExplain | null): ComponentReceipt {
  const awards = explain?.recognition?.awards;
  const raw = Array.isArray(awards)
    ? awards.filter(Boolean).map(String)
    : typeof awards === "string" && awards.trim()
      ? awards.split(",")
      : [];
  const list = raw.map(humanizeAward).filter(Boolean);

  if (list.length) {
    return {
      key: "individual_recognition",
      evidence: `On record: ${list.join(", ")}.`,
      note: null,
    };
  }
  return {
    key: "individual_recognition",
    evidence: "No awards or voting shares on record for this season.",
    note: null,
  };
}

/**
 * Postseason Value — the component reviewers most often read as broken.
 *
 * The served block carries the SAMPLE (games, minutes, series) but not the
 * playoff rate statistics, so this describes what is knowable and then explains
 * the sign. The three explanations map exactly onto the three structural
 * properties documented in the audit: 0 means did-not-play, a negative means
 * played below the replacement baseline, and a short run is shrunk.
 */
function postseasonValue(
  explain: RankingExplain | null,
  contribution: number | null,
): ComponentReceipt {
  const games = num(explain?.postseason, "games");
  const minutes = num(explain?.postseason, "minutes");
  const series = num(explain?.postseason, "series_count");
  const madePlayoffs = num(explain?.team_context, "made_playoffs");

  const evidence = sentence([
    games !== null ? `${games} playoff games` : null,
    minutes !== null ? `${Math.round(minutes)} playoff minutes` : null,
    series !== null ? `${series} ${series === 1 ? "series" : "series"} played` : null,
  ]);

  let note: string | null = null;
  if (madePlayoffs === 0 || (games === null && contribution === 0)) {
    note =
      "This team did not reach the playoffs, so PEAK3 scores postseason value at exactly zero — " +
      "no evidence either way, not a penalty.";
  } else if (contribution !== null && contribution < 0) {
    note =
      "Negative: this playoff run graded below PEAK3's replacement-level playoff baseline. " +
      "The downside is bounded, so one poor series cannot erase a season — and winning the title " +
      "does not by itself add postseason value, because this component measures individual play.";
  } else if (games !== null && games <= 8) {
    note =
      `Only ${games} playoff games. PEAK3 shrinks postseason value on short runs, so even strong ` +
      "play over a handful of games contributes little — a first-round exit is not much evidence.";
  } else if (contribution !== null && contribution > 0) {
    note =
      "This component rewards individual playoff performance, not winning. Rounds reached and " +
      "titles are scored separately under Team Achievement.";
  }

  return { key: "postseason_individual_value", evidence, note };
}

/** Team Achievement — how far the team went, and the 3% ceiling. */
function teamAchievement(explain: RankingExplain | null): ComponentReceipt {
  const championship = num(explain?.team_context, "championship");
  const finals = num(explain?.team_context, "finals_appearance");
  const madePlayoffs = num(explain?.team_context, "made_playoffs");

  let evidence: string | null = null;
  let note: string | null = null;

  if (championship === 1) {
    evidence = "This team won the title.";
    note =
      "Team Achievement is weighted at 3% — a maximum of 3.0 points — so a championship cannot " +
      "close a meaningful individual gap.";
  } else if (finals === 1) {
    evidence = "This team reached the Finals without winning it.";
  } else if (madePlayoffs === 1) {
    evidence = "This team made the playoffs but did not reach the Finals.";
    note =
      "A first-round exit scores exactly zero here: Team Achievement only rewards winning a " +
      "series or better.";
  } else if (madePlayoffs === 0) {
    evidence = "This team did not reach the playoffs.";
    note = "No playoffs means zero Team Achievement by definition.";
  }

  return { key: "team_achievement", evidence, note };
}

/**
 * All five receipts, in the order the modal renders them.
 *
 * `contributions` supplies each component's own weighted value, which the
 * postseason receipt needs to tell a zero from a negative from a positive.
 */
export function buildComponentReceipts(
  explain: RankingExplain | null,
  contributions: Partial<Record<RankingComponentKey, number | null>> = {},
): ComponentReceipt[] {
  return [
    statisticalImpact(explain),
    traditionalProduction(explain),
    individualRecognition(explain),
    postseasonValue(explain, contributions.postseason_individual_value ?? null),
    teamAchievement(explain),
  ];
}

// ---------------------------------------------------------------------------
// What held this row back
// ---------------------------------------------------------------------------

/**
 * The specific reasons this row is not higher, newest-evidence first.
 *
 * Deliberately concrete: "did not reach the playoffs" rather than "postseason
 * value was low". Returns an empty array for a row with nothing to report,
 * which the UI treats as "omit the card" — an empty "what held it back" panel
 * on a #1 row would be worse than no panel.
 */
export function buildHeldBack(
  explain: RankingExplain | null,
  contributions: Partial<Record<RankingComponentKey, number | null>> = {},
): string[] {
  if (!explain) return [];
  const out: string[] = [];

  const po = contributions.postseason_individual_value ?? null;
  const madePlayoffs = num(explain.team_context, "made_playoffs");
  const games = num(explain.postseason, "games");

  if (madePlayoffs === 0) {
    out.push("No postseason: 18% of the formula scored zero for this row.");
  } else if (po !== null && po < 0) {
    out.push("Postseason value is negative — this playoff run graded below replacement level.");
  } else if (games !== null && games <= 8) {
    out.push(
      `Short playoff sample (${games} games), which PEAK3 shrinks rather than extrapolating from.`,
    );
  }

  const championship = num(explain.team_context, "championship");
  const finals = num(explain.team_context, "finals_appearance");
  if (madePlayoffs === 1 && championship !== 1 && finals !== 1) {
    const team = contributions.team_achievement ?? null;
    if (team === null || team < 1.5) {
      out.push("Team Achievement is low: this team did not reach the Finals.");
    }
  }

  // The generated block's own flags — availability, provisional data, and so on.
  for (const caveat of explain.caveats ?? []) {
    if (caveat) out.push(caveat);
  }

  const weakest = explain.weakest_components?.[0];
  if (weakest && out.length < 4) {
    const percentile = explain.percentiles?.[weakest as RankingComponentKey] ?? null;
    if (typeof percentile === "number" && percentile < 60) {
      out.push(
        `Weakest component is ${weakest.replace(/_/g, " ")}, at the ${Math.round(percentile)}th percentile of this board.`,
      );
    }
  }

  return out.slice(0, 4);
}
