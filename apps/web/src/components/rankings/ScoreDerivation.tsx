"use client";

/**
 * The score derivation, as SECTIONS rather than as a dialog.
 *
 * WHERE THIS CAME FROM. Every block below used to live inside
 * `ScoreExplainModal`, a second dialog opened from a one-character `ƒ` cell in
 * the ranking row. That split one question across two interactions: the drawer
 * answered "how good was this peak", the modal answered "where did that number
 * come from", and a reader who wanted both had to close one to open the other.
 * The modal is gone; these are its contents, rendered inside the player
 * analysis behind three disclosures.
 *
 * WHAT IS PRESERVED VERBATIM, and deliberately so:
 *
 *  - A section whose data is absent is NOT RENDERED. No placeholder, no empty
 *    card, no repeated apology.
 *  - Nothing is ever invented. Values come from the explain payload; every
 *    derived figure is arithmetic over payload values, never a plausible
 *    substitute.
 *  - The official weights are NEVER hardcoded here. They arrive in the payload;
 *    the methodology endpoint is the only fallback, and a component with
 *    neither omits its weight rather than printing 38%.
 *
 * WHAT IS NEW: `<Arithmetic>`. The old modal showed contributions, weights and
 * percentiles in three separate places and never once wrote the sum down, so
 * "how the total was built" was left as an exercise. It is now a single table
 * that ends in the published `prime_index`, with the calibration named as the
 * separate, non-arithmetic step it is.
 */

import { useMemo } from "react";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { componentColor, componentTextColor, componentLabel } from "@/lib/utils";
import type {
  Methodology,
  RankingBoardId,
  RankingComparison,
  RankingComponentKey,
  RankingExplain,
  RankingExplainBlock,
} from "@/types";
import ComponentBreakdown from "./ComponentBreakdown";
import { buildComponentReceipts, buildHeldBack } from "@/lib/rankings-receipts";
import {
  COMPONENT_ABBR,
  RANKING_COMPONENT_KEYS,
  formatPercentile,
  formatScore1,
  formatScore2,
} from "./board-model";

// ---------------------------------------------------------------------------
// Generic context-block rendering.
//
// The season-stats / recognition / postseason / team-context / role blocks are
// rendered by iterating whatever keys the payload actually carried. That is what
// lets a section be omitted rather than padded: no key, no field, and no fields
// at all means no section. Labels come from a map with a humanising fallback, so
// a field the API adds tomorrow still renders with a readable name instead of
// being silently dropped.
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  games: "Games",
  games_played: "Games",
  mpg: "MPG",
  minutes: "Minutes",
  minutes_per_game: "MPG",
  minutes_total: "Total minutes",
  ppg: "PPG",
  rpg: "RPG",
  apg: "APG",
  spg: "SPG",
  bpg: "BPG",
  ts_pct: "True shooting",
  per: "PER",
  bpm: "BPM",
  obpm: "OBPM",
  dbpm: "DBPM",
  vorp: "VORP",
  ws: "Win shares",
  ws48: "WS/48",
  usg_pct: "Usage",
  awards: "Awards",
  mvp_vote_share: "MVP vote share",
  mvp_rank: "MVP finish",
  dpoy_vote_share: "DPOY vote share",
  all_nba: "All-NBA",
  all_defense: "All-Defense",
  all_star: "All-Star",
  finals_mvp: "Finals MVP",
  statistical_titles: "Statistical titles",
  series_count: "Playoff series",
  rounds_won: "Rounds won",
  availability: "Availability",
  championship: "Champion",
  finals_appearance: "Reached the Finals",
  made_playoffs: "Made the playoffs",
  n_teams: "Teams",
  team_wins: "Team wins",
  team_losses: "Team losses",
  srs: "Team SRS",
  seed: "Seed",
  playoff_result: "Playoff result",
  role: "Role",
  season_complete: "Season complete",
  season_progress_pct: "Season progress",
  team_scoring_share: "Team scoring share",
  team_assist_share: "Team assist share",
};

const FLAG_KEYS = new Set([
  "championship",
  "finals_appearance",
  "made_playoffs",
  "all_star",
  "finals_mvp",
  "season_complete",
  "is_multi_team_season",
]);

/** Keys the API publishes as a 0–1 share (or an already-scaled percentage). */
function isShareKey(key: string): boolean {
  return key.endsWith("_share") || key.endsWith("_pct") || key === "ts_pct";
}

function humanizeKey(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatBlockValue(key: string, value: string | number | boolean | string[]): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "—";
  if (FLAG_KEYS.has(key)) return value > 0 ? "Yes" : "No";
  if (isShareKey(key)) {
    const scaled = Math.abs(value) <= 1.5 ? value * 100 : value;
    return `${scaled.toFixed(1)}%`;
  }
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(Math.abs(value) < 10 ? 2 : 1);
}

interface BlockField {
  key: string;
  label: string;
  value: string;
}

/** Ordered so the well-known keys lead and unknown extras follow. */
function blockFields(block: RankingExplainBlock | null, skip: string[] = []): BlockField[] {
  if (!block) return [];
  const entries = Object.entries(block).filter(
    ([key, value]) =>
      !skip.includes(key) && value !== null && value !== undefined && value !== "" &&
      !(Array.isArray(value) && value.length === 0)
  );
  const known = Object.keys(FIELD_LABELS);
  entries.sort((a, b) => {
    const ai = known.indexOf(a[0]);
    const bi = known.indexOf(b[0]);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  return entries.map(([key, value]) => ({
    key,
    label: humanizeKey(key),
    value: formatBlockValue(key, value as string | number | boolean | string[]),
  }));
}

// ---------------------------------------------------------------------------
// Small presentational pieces (methodology-page design language)
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId}>
      <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
        {title}
      </h4>
      {children}
    </section>
  );
}

function Chip({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md bg-[var(--bg-surface)] px-2 py-0.5 text-xs text-[var(--text-secondary)]"
      style={color ? { borderLeft: `2px solid ${color}` } : undefined}
    >
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  accent,
  testId,
}: {
  label: string;
  value: string;
  accent?: boolean;
  testId?: string;
}) {
  return (
    <div className="card-surface p-3" data-testid={testId}>
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p
        className={
          accent
            ? "score-number text-2xl font-bold text-[var(--peak-accent-text)]"
            : "score-number text-xl font-bold text-[var(--text-primary)]"
        }
      >
        {value}
      </p>
    </div>
  );
}

function FieldGrid({ fields }: { fields: BlockField[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
      {fields.map((field) => (
        <div key={field.key} className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            {field.label}
          </p>
          <p className="score-number break-words text-sm text-[var(--text-secondary)]">
            {field.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Rendered only when `fields` is non-empty -- that is the whole
 *  no-empty-blocks rule, in one place. */
function BlockSection({
  title,
  block,
  testId,
  skip,
  extra,
}: {
  title: string;
  block: RankingExplainBlock | null;
  testId: string;
  skip?: string[];
  extra?: ReactNode;
}) {
  const fields = blockFields(block, skip);
  if (!fields.length && !extra) return null;
  return (
    <Section title={title} testId={testId}>
      <div className="space-y-2">
        {extra}
        {fields.length > 0 && <FieldGrid fields={fields} />}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Prose composed from the payload
// ---------------------------------------------------------------------------

function signed(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
}

export interface DerivationSubject {
  player_name: string;
  label: string;
  rank: number;
  prime_score: number | null;
}

/** 2–4 sentences, each one guarded by the presence of its own inputs. */
export function buildWhy(
  explain: RankingExplain | null,
  subject: DerivationSubject,
  boardLabel: string,
  populationNoun: string
): string[] {
  const out: string[] = [];
  const totalPercentile = formatPercentile(explain?.percentiles?.total ?? null);

  out.push(
    subject.prime_score === null
      ? `PEAK3 ranks ${subject.player_name} ${subject.label} #${subject.rank} on the ${boardLabel} board.`
      : `PEAK3 rates ${subject.player_name} ${subject.label} at ${subject.prime_score.toFixed(1)} ` +
        `on the calibrated 0–100 scale — #${subject.rank} on the ${boardLabel} board` +
        (totalPercentile ? `, the ${totalPercentile} percentile of all scored ${populationNoun}.` : ".")
  );

  const split = explain?.score_split;
  if (split && split.regular_season !== null) {
    const rest = [split.postseason, split.recognition, split.team].filter(
      (value): value is number => value !== null
    );
    if (rest.length) {
      const restTotal = rest.reduce((total, value) => total + value, 0);
      const denominator = split.regular_season + restTotal;
      const sharePart =
        denominator !== 0 ? ` — ${((restTotal / denominator) * 100).toFixed(0)}% of this score is decided outside the regular season` : "";
      out.push(
        `${split.regular_season.toFixed(2)} raw points come from regular-season play and ` +
          `${restTotal.toFixed(2)} from playoff rate impact, recognition and team result${sharePart}.`
      );
    }
  }

  const strongest = explain?.strongest_components?.[0];
  const weakest = explain?.weakest_components?.[0];
  if (strongest) {
    const pct = formatPercentile(
      explain?.percentiles?.[strongest as RankingComponentKey] ?? null
    );
    out.push(
      `Its strongest component is ${componentLabel(strongest)}${pct ? ` (${pct} percentile)` : ""}` +
        (weakest && weakest !== strongest ? `; its weakest is ${componentLabel(weakest)}.` : ".")
    );
  }

  const teammate = explain?.teammate_adjustment ?? null;
  if (teammate !== null && Math.abs(teammate) >= 0.001 && out.length < 4) {
    out.push(
      `A teammate adjustment of ${signed(teammate, 3)} is applied as a descriptive modifier on top of the weighted components.`
    );
  }

  return out.slice(0, 4);
}

/** One data-derived clause per component, handed to the breakdown panel so the
 *  "why this row" paragraph can cite the row's OWN evidence rather than generic
 *  copy. Every clause is dropped unless its inputs are present. */
export function buildEvidence(
  explain: RankingExplain | null
): Partial<Record<RankingComponentKey, string>> {
  if (!explain) return {};
  const out: Partial<Record<RankingComponentKey, string>> = {};

  const awards = explain.recognition?.awards;
  if (awards) {
    const list = Array.isArray(awards) ? awards.join(", ") : String(awards);
    out.individual_recognition = `Recognition on record for this row: ${list}.`;
  }

  const games = explain.postseason?.games;
  const series = explain.postseason?.series_count;
  if (typeof games === "number" || typeof series === "number") {
    const parts: string[] = [];
    if (typeof games === "number") parts.push(`${games} playoff games`);
    if (typeof series === "number") parts.push(`${series} series`);
    out.postseason_individual_value = `Postseason sample: ${parts.join(", ")}.`;
  }

  const championship = explain.team_context?.championship;
  const finals = explain.team_context?.finals_appearance;
  if (typeof championship === "number" || typeof finals === "number") {
    out.team_achievement =
      Number(championship) > 0
        ? "This row's team won the title, and Team Result is capped at 3 points, which is why it is still the smallest number here."
        : Number(finals) > 0
          ? "This row's team reached the Finals without winning it."
          : "This row's team did not reach the Finals.";
  }

  const mpg = explain.season_stats?.mpg ?? explain.mpg;
  const gp = explain.season_stats?.games;
  if (typeof mpg === "number") {
    out.statistical_impact =
      `Impact metrics here are measured over ${typeof gp === "number" ? `${gp} games at ` : ""}` +
      `${mpg.toFixed(1)} minutes per game.`;
  }

  return out;
}

function windowTypeLabel(windowType: string): string {
  if (windowType === "single_season") return "Single season";
  if (/^\d+Y$/i.test(windowType)) return `${windowType.replace(/y/i, "")}-year peak window`;
  return windowType;
}

function awardChips(awards: string | number | boolean | string[]): string[] {
  const raw = Array.isArray(awards) ? awards : String(awards).split(",");
  return raw.map((award) => String(award).trim()).filter(Boolean);
}

/** Uses the published delta when there is one, otherwise subtracts two real
 *  scores. Never invented: returns null if either side is missing. */
function comparisonDelta(entry: RankingComparison, current: number | null): number | null {
  if (typeof entry.delta === "number" && Number.isFinite(entry.delta)) return entry.delta;
  if (entry.prime_score === null || current === null) return null;
  return entry.prime_score - current;
}

// ---------------------------------------------------------------------------
// Shared props
// ---------------------------------------------------------------------------

export interface DerivationProps {
  explain: RankingExplain | null;
  subject: DerivationSubject;
  boardLabel: string;
  boardRowCount: number | null;
  populationNoun: string;
  methodology: Methodology | null;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// 1. Score breakdown
// ---------------------------------------------------------------------------

export function ScoreBreakdownSection({
  explain,
  subject,
  boardLabel,
  boardRowCount,
  populationNoun,
  methodology,
  loading,
  error,
}: DerivationProps) {
  const components = explain?.components ?? null;
  const percentiles = explain?.percentiles ?? null;
  const primeIndex = explain?.prime_index ?? null;
  const primeScore = explain?.prime_score ?? subject.prime_score;
  const rank = explain?.rank ?? subject.rank;
  const evidence = useMemo(() => buildEvidence(explain), [explain]);

  const split = explain?.score_split ?? null;
  const splitCards = split
    ? (
        [
          ["Regular season", split.regular_season, undefined],
          ["Postseason", split.postseason, componentTextColor("postseason_individual_value")],
          ["Recognition", split.recognition, componentTextColor("individual_recognition")],
          ["Team achievement", split.team, componentTextColor("team_achievement")],
        ] as const
      ).filter(([, value]) => value !== null)
    : [];

  return (
    <div className="space-y-5" data-testid="rk-score-breakdown">
      {/* Score summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Final score"
          value={formatScore1(primeScore)}
          accent
          testId="score-explain-prime-score"
        />
        {primeIndex !== null && (
          <StatCard label="Raw ordering index" value={formatScore2(primeIndex)} />
        )}
        {percentiles?.total !== null && percentiles?.total !== undefined && (
          <StatCard
            label="All-time percentile"
            value={formatPercentile(percentiles.total) ?? "—"}
            testId="score-explain-total-percentile"
          />
        )}
        <StatCard
          label="Rank on this board"
          value={
            rank === null
              ? "—"
              : boardRowCount
                ? `${rank} / ${boardRowCount.toLocaleString()}`
                : `#${rank}`
          }
        />
      </div>

      {/* Interactive component breakdown -- the centrepiece */}
      <Section title="Component breakdown" testId="score-explain-components">
        {loading && !components && (
          <p className="animate-pulse text-xs text-[var(--text-muted)]" role="status">
            Loading breakdown…
          </p>
        )}
        {error && (
          <p className="text-xs text-[var(--incorrect)]" role="alert">
            {error}
          </p>
        )}
        {components ? (
          <ComponentBreakdown
            components={components}
            percentiles={percentiles}
            weights={explain?.weights ?? {}}
            strongest={explain?.strongest_components ?? []}
            weakest={explain?.weakest_components ?? []}
            methodology={methodology}
            evidence={evidence}
            populationNoun={populationNoun}
          />
        ) : (
          !loading &&
          !error && (
            <p
              className="text-xs text-[var(--text-muted)]"
              data-testid="score-explain-components-unavailable"
            >
              Component contributions are not available for this board.
            </p>
          )
        )}
      </Section>

      {/* Per-component cards: value + percentile, all five at a glance */}
      {components && (
        <Section title="Every component" testId="score-explain-component-cards">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {RANKING_COMPONENT_KEYS.filter((key) => components[key] !== null).map((key) => {
              const pct = formatPercentile(percentiles?.[key] ?? null);
              return (
                <div
                  key={key}
                  className="card-surface p-2.5"
                  style={{
                    borderLeftColor: componentColor(key),
                    borderLeftWidth: "3px",
                  }}
                  data-testid={`score-explain-component-${key}`}
                >
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <span className="font-bold">{COMPONENT_ABBR[key]}</span>{" "}
                    {componentLabel(key)}
                  </p>
                  <p className="score-number text-base font-bold text-[var(--text-primary)]">
                    {formatScore2(components[key])}
                  </p>
                  {pct && (
                    <p className="text-[11px] text-[var(--text-muted)]">{pct} percentile</p>
                  )}
                </div>
              );
            })}
          </div>
          {explain?.teammate_adjustment !== null &&
            explain?.teammate_adjustment !== undefined && (
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                <span style={{ color: componentTextColor("teammate_adjustment") }}>
                  {componentLabel("teammate_adjustment")}
                </span>
                : <span className="score-number">{signed(explain.teammate_adjustment, 3)}</span>{" "}
                — a descriptive modifier, not a sixth component.
              </p>
            )}
        </Section>
      )}

      {/* Regular season vs. the rest -- the mechanism behind every close call */}
      {splitCards.length > 0 && (
        <Section title="Regular season vs. the rest" testId="score-explain-split">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {splitCards.map(([label, value, color]) => (
                <div key={label} className="card-surface p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    {label}
                  </p>
                  <p
                    className="score-number text-lg font-bold"
                    style={{ color: color ?? "var(--text-primary)" }}
                  >
                    {formatScore2(value)}
                  </p>
                </div>
              ))}
            </div>
            <p className="border-l border-[var(--border-subtle)] pl-3 text-xs text-[var(--text-muted)]">
              Recognition, Playoff Rate Impact and Team Result sit outside regular-season play,
              which is why a row can lose the regular-season comparison and still rank higher.
              Team Result is capped at 3 points, so it is almost always the smallest number here
              — even for a champion.
            </p>
          </div>
        </Section>
      )}

      <p className="sr-only">
        {subject.player_name} {subject.label} on the {boardLabel} board.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. How this score was calculated
// ---------------------------------------------------------------------------

interface ArithmeticRow {
  key: RankingComponentKey;
  percentile: number | null;
  /** The component's own score before the weight is applied, recovered exactly
   *  as `contribution / weight` — the same multiplication peak3.py performs. */
  componentScore: number | null;
  weight: number | null;
  contribution: number;
}

/** The published contributions, the weights that produced them, and the sum
 *  those two facts imply. Nothing here is a model re-implementation: the
 *  contributions ARE the model's output, and the only arithmetic is addition
 *  plus one division to undo a multiplication the model already published. */
export function buildArithmetic(
  explain: RankingExplain | null,
  methodology: Methodology | null,
): { rows: ArithmeticRow[]; sum: number } | null {
  const components = explain?.components;
  if (!components) return null;
  const rows: ArithmeticRow[] = [];
  for (const key of RANKING_COMPONENT_KEYS) {
    const contribution = components[key];
    if (contribution === null || contribution === undefined) continue;
    const weight = explain?.weights?.[key] ?? methodology?.weights?.[key] ?? null;
    rows.push({
      key,
      percentile: explain?.percentiles?.[key] ?? null,
      componentScore: weight !== null && weight !== 0 ? contribution / weight : null,
      weight,
      contribution,
    });
  }
  if (!rows.length) return null;
  const sum = rows.reduce((total, row) => total + row.contribution, 0);
  return { rows, sum };
}

export function ScoreCalculationSection({
  explain,
  subject,
  boardLabel,
  populationNoun,
  methodology,
  loading,
  error,
}: DerivationProps) {
  const components = explain?.components ?? null;
  const primeScore = explain?.prime_score ?? subject.prime_score;
  const arithmetic = useMemo(
    () => buildArithmetic(explain, methodology),
    [explain, methodology],
  );
  const receipts = useMemo(
    () => buildComponentReceipts(explain, components ?? {}),
    [explain, components],
  );
  const heldBack = useMemo(() => buildHeldBack(explain, components ?? {}), [explain, components]);
  const why = useMemo(
    () => buildWhy(explain, { ...subject, prime_score: primeScore }, boardLabel, populationNoun),
    [explain, subject, primeScore, boardLabel, populationNoun],
  );

  const teammate = explain?.teammate_adjustment ?? null;
  const primeIndex = explain?.prime_index ?? null;

  return (
    <div className="space-y-5" data-testid="rk-score-calculation">
      {loading && !explain && (
        <p className="animate-pulse text-xs text-[var(--text-muted)]" role="status">
          Loading the derivation…
        </p>
      )}
      {error && (
        <p className="text-xs text-[var(--incorrect)]" role="alert">
          {error}
        </p>
      )}

      {/* THE ARITHMETIC. Percentile is what the row scored against the board;
          the component score is what went into the formula; the weight is the
          official multiplier; the contribution is their product, as published.
          The last three rows are the sum, the teammate modifier and the raw
          index the model actually orders by. */}
      {arithmetic && (
        <Section title="The arithmetic" testId="score-explain-arithmetic">
          <div className="overflow-x-auto">
            <table className="rk-formula-table" data-testid="rk-formula-table">
              <caption>
                How {subject.player_name} {subject.label} reaches its PEAK3 total. Every
                contribution is the model&rsquo;s own published figure; the component score is that
                contribution divided by its official weight.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Component</th>
                  <th scope="col">Percentile</th>
                  <th scope="col">Component score</th>
                  <th scope="col">Weight</th>
                  <th scope="col">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {arithmetic.rows.map((row) => (
                  <tr key={row.key} data-testid={`rk-formula-row-${row.key}`}>
                    <th scope="row">
                      <span
                        className="rk-formula-swatch"
                        style={{ background: componentColor(row.key) }}
                        aria-hidden="true"
                      />
                      {componentLabel(row.key)}
                    </th>
                    <td>{row.percentile === null ? "—" : Math.round(row.percentile)}</td>
                    <td>{row.componentScore === null ? "—" : row.componentScore.toFixed(2)}</td>
                    <td>{row.weight === null ? "—" : `× ${(row.weight * 100).toFixed(0)}%`}</td>
                    <td className="rk-formula-strong">{row.contribution.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr data-testid="rk-formula-sum">
                  <th scope="row" colSpan={4}>
                    Sum of the weighted contributions
                  </th>
                  <td className="rk-formula-strong">{arithmetic.sum.toFixed(2)}</td>
                </tr>
                {teammate !== null && (
                  <tr data-testid="rk-formula-teammate">
                    <th scope="row" colSpan={4}>
                      Teammate adjustment
                    </th>
                    <td className="rk-formula-strong">{signed(teammate, 3)}</td>
                  </tr>
                )}
                {primeIndex !== null && (
                  <tr data-testid="rk-formula-index">
                    <th scope="row" colSpan={4}>
                      Raw PEAK3 index
                    </th>
                    <td className="rk-formula-strong">{formatScore2(primeIndex)}</td>
                  </tr>
                )}
                {primeScore !== null && (
                  <tr data-testid="rk-formula-total">
                    <th scope="row" colSpan={4}>
                      Calibrated PEAK3 score
                    </th>
                    <td className="rk-formula-total">{formatScore2(primeScore)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
          <p className="mt-2 border-l border-[var(--border-subtle)] pl-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
            The raw index is the sum above. The published score is{" "}
            <strong className="text-[var(--text-secondary)]">not</strong> that sum rescaled by any
            arithmetic shown here: it is <code>calibrate_score()</code>, a monotonic remap of the
            raw index onto interpretable 0–100 historical bands. Monotonic means it never changes
            the ordering — only the spacing.
          </p>
        </Section>
      )}

      {/* Receipts: what actually drove each component FOR THIS ROW. */}
      {receipts.some((r) => r.evidence || r.note) && (
        <Section title="Receipts" testId="score-explain-receipts">
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">
            The numbers behind each component for this exact row.
          </p>
          <div className="space-y-2">
            {receipts
              .filter((r) => r.evidence || r.note)
              .map((receipt) => (
                <div
                  key={receipt.key}
                  className="card-surface p-3"
                  style={{
                    borderLeftColor: componentColor(receipt.key),
                    borderLeftWidth: "3px",
                  }}
                  data-testid={`score-explain-receipt-${receipt.key}`}
                >
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <span className="font-bold">{COMPONENT_ABBR[receipt.key]}</span>{" "}
                    {componentLabel(receipt.key)}
                    {components?.[receipt.key] !== null &&
                      components?.[receipt.key] !== undefined && (
                        <span className="score-number ml-1 text-[var(--text-secondary)]">
                          {formatScore2(components[receipt.key])}
                        </span>
                      )}
                  </p>
                  {receipt.evidence && (
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-primary)]">
                      {receipt.evidence}
                    </p>
                  )}
                  {receipt.note && (
                    <p
                      className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]"
                      data-testid={`score-explain-receipt-note-${receipt.key}`}
                    >
                      {receipt.note}
                    </p>
                  )}
                </div>
              ))}
          </div>
        </Section>
      )}

      {/* What held this row back: concrete, not "component X was low". */}
      {heldBack.length > 0 && (
        <Section title="What held this row back" testId="score-explain-held-back">
          <ul className="space-y-1.5">
            {heldBack.map((reason) => (
              <li
                key={reason}
                data-testid="score-explain-held-back-item"
                className="flex gap-2 text-xs leading-relaxed text-[var(--text-secondary)]"
              >
                <span aria-hidden="true" style={{ color: "var(--comp-po-text)" }}>
                  &middot;
                </span>
                {reason}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Why this score */}
      {why.length > 0 && (
        <Section title="Why this score?" testId="score-explain-summary">
          <div className="card-surface space-y-2 p-4">
            {why.map((sentence) => (
              <p key={sentence} className="text-sm leading-relaxed text-[var(--text-secondary)]">
                {sentence}
              </p>
            ))}
          </div>
        </Section>
      )}

      {/* Caveats */}
      {explain && explain.caveats.length > 0 && (
        <Section title="Caveats" testId="score-explain-caveats">
          <ul className="space-y-1">
            {explain.caveats.map((caveat) => (
              <li
                key={caveat}
                className="border-l border-[var(--border-subtle)] pl-3 text-xs text-[var(--text-muted)]"
              >
                {caveat}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="border-t border-[var(--border-subtle)] pt-3 text-[11px] text-[var(--text-muted)]">
        Every figure here is read from PEAK3 model output — including the component weights.
        Sections the model does not publish for this row are omitted rather than estimated. PEAK3
        rates {populationNoun} by this formula; it is not a claim of objective historical truth.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Source window
// ---------------------------------------------------------------------------

export function SourceWindowSection({
  explain,
  subject,
  board,
  loading,
  error,
  onPivot,
}: DerivationProps & {
  board: RankingBoardId;
  /** Swap the whole analysis to another row without leaving the drawer. */
  onPivot?: (entry: RankingComparison) => void;
}) {
  const primeScore = explain?.prime_score ?? subject.prime_score;

  /**
   * "Best seasons in 1990-91", not "Same-season peers".
   *
   * The rail lists the strongest OTHER performances from the same NBA season
   * (see build_top_seasons.py::_comparison_rails). On the peak-windows board a
   * row spans several seasons, so there is no single season to name and the
   * generic heading is still the honest one.
   */
  const seasonPeersHeading =
    board === "seasons" && subject.label
      ? `Best seasons in ${subject.label}`
      : "Same-season peers";

  const comparisonSections = explain
    ? (
        [
          ["Other seasons from this player", explain.comparisons.same_player, "same-player"],
          ["Similar PEAK3 scores", explain.comparisons.similar_scores, "similar-scores"],
          [seasonPeersHeading, explain.comparisons.same_season_peers, "same-season-peers"],
        ] as const
      ).filter(([, entries]) => entries.length > 0)
    : [];

  return (
    <div className="space-y-5" data-testid="rk-source-window">
      {loading && !explain && (
        <p className="animate-pulse text-xs text-[var(--text-muted)]" role="status">
          Loading the source window…
        </p>
      )}
      {error && (
        <p className="text-xs text-[var(--incorrect)]" role="alert">
          {error}
        </p>
      )}

      {explain && (
        <div className="flex flex-wrap gap-1.5" data-testid="rk-source-identity">
          {explain.window_type && <Chip>{windowTypeLabel(explain.window_type)}</Chip>}
          {explain.team && <Chip>{explain.team}</Chip>}
          {explain.data_completeness && (
            <Chip color="var(--peak-accent)">Data: {explain.data_completeness}</Chip>
          )}
          {explain.model_version && <Chip>Model {explain.model_version}</Chip>}
        </div>
      )}

      {/* Seasons inside a multi-season window */}
      {explain && explain.seasons_in_window.length > 1 && (
        <Section title="Seasons in this window" testId="score-explain-seasons-in-window">
          <div className="flex flex-wrap gap-1.5">
            {explain.seasons_in_window.map((season) => (
              <Chip key={season}>{season}</Chip>
            ))}
          </div>
        </Section>
      )}

      {/* Why THIS season? The 1Y board publishes each player's highest-scoring
          single season, and for several players that is not the season the
          public remembers. This states the rule and shows what it narrowly
          beat, rather than changing the rule. */}
      {explain?.anchor_selection &&
        explain.anchor_selection.nearby_iconic_seasons.length > 0 && (
          <Section title="Why this season?" testId="score-explain-anchor-selection">
            <p className="mb-2 text-xs text-[var(--text-secondary)]">
              This board shows each player&rsquo;s{" "}
              <strong className="text-[var(--text-primary)]">
                {explain.anchor_selection.basis ?? "highest-scoring single season"}
              </strong>
              . These came close:
            </p>
            <ul className="space-y-1.5">
              {explain.anchor_selection.nearby_iconic_seasons.map((season) => (
                <li
                  key={season.season}
                  data-testid={`score-explain-nearby-${season.season}`}
                  className="flex flex-wrap items-baseline gap-x-2 text-xs"
                >
                  <span className="font-semibold text-[var(--text-primary)]">{season.season}</span>
                  {season.prime_score !== null && (
                    <span className="score-number text-[var(--text-secondary)]">
                      {formatScore1(season.prime_score)}
                    </span>
                  )}
                  {season.margin !== null && (
                    <span className="text-[var(--text-muted)]">
                      &minus;{season.margin.toFixed(2)} behind
                    </span>
                  )}
                  {season.markers.length > 0 && (
                    <span className="text-[var(--peak-accent-text)]">
                      {season.markers.join(" · ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

      {/* Context blocks -- each omitted entirely when its data is absent */}
      <BlockSection
        title="Season statistics"
        block={explain?.season_stats as RankingExplainBlock | null}
        testId="score-explain-season-stats"
      />
      <BlockSection
        title="Awards & recognition"
        block={explain?.recognition ?? null}
        testId="score-explain-recognition"
        skip={["awards"]}
        extra={
          explain?.recognition?.awards ? (
            <div className="flex flex-wrap gap-1.5">
              {awardChips(explain.recognition.awards).map((award) => (
                <Chip key={award} color={componentColor("individual_recognition")}>
                  {award}
                </Chip>
              ))}
            </div>
          ) : undefined
        }
      />
      <BlockSection
        title="Postseason"
        block={explain?.postseason ?? null}
        testId="score-explain-postseason"
      />
      <BlockSection
        title="Team context"
        block={explain?.team_context ?? null}
        testId="score-explain-team-context"
      />
      <BlockSection
        title="Role, minutes & sample"
        block={explain?.role_and_sample ?? null}
        testId="score-explain-role"
      />

      {/* Comparisons -- clickable, and they pivot the analysis in place */}
      {comparisonSections.length > 0 && onPivot && (
        <Section title="Explore from here" testId="score-explain-comparisons">
          <div className="space-y-4">
            {comparisonSections.map(([title, entries, testId]) => (
              <div key={testId} data-testid={`score-explain-comparison-${testId}`}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  {title}
                </p>
                <ul className="space-y-1.5">
                  {entries.map((entry) => (
                    <li key={`${testId}-${entry.row_id}`}>
                      <button
                        type="button"
                        onClick={() => onPivot(entry)}
                        className="card-surface flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:border-[var(--peak-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                      >
                        <span className="min-w-0 text-xs text-[var(--text-secondary)]">
                          <span className="score-number text-[var(--text-muted)]">
                            #{entry.rank}
                          </span>{" "}
                          <span className="font-medium text-[var(--text-primary)]">
                            {entry.player_name && entry.player_name !== subject.player_name
                              ? entry.player_name
                              : ""}
                          </span>{" "}
                          {entry.label}
                        </span>
                        <span className="score-number shrink-0 text-xs font-bold text-[var(--peak-accent-text)]">
                          {formatScore1(entry.prime_score)}
                          {comparisonDelta(entry, primeScore) !== null && (
                            <span className="ml-1.5 font-normal text-[var(--text-muted)]">
                              {signed(comparisonDelta(entry, primeScore) as number, 1)}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="border-l border-[var(--border-subtle)] pl-3 text-[11px] text-[var(--text-muted)]">
              Selecting any row above swaps this analysis to that row without closing it. Use Back
              to return.
            </p>
          </div>
        </Section>
      )}
    </div>
  );
}

/** The "Back to <player>" control the pivot stack needs. Exported so the drawer
 *  can place it in its own header rather than inside a disclosure the reader
 *  may have scrolled past. */
export function PivotBackButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="rankings-analysis-back"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
    >
      <ArrowLeft size={13} aria-hidden="true" />
      Back to {label}
    </button>
  );
}
