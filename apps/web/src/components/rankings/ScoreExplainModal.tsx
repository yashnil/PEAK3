"use client";

/**
 * Phase 9C: the player-season encyclopedia entry.
 *
 * WHY THIS EXISTS. The rankings page publishes an ordering; without a mechanism
 * every close call reads as an arbitrary opinion. 41% of the weight vector
 * (recognition 20 + playoff rate impact 18 + team result 3) sits outside
 * regular-season play, so a regular-season deficit is routinely overturned --
 * Kobe 2007-08 over 2005-06, Embiid 2022-23 vs Howard 2008-09, Hakeem 1993-94 vs
 * Robinson 1994-95. This modal always shows the split, and it makes the
 * neighbours CLICKABLE so those exact comparisons can be walked without ever
 * closing the dialog.
 *
 * WHAT CHANGED FROM 9B. The audited complaint was "many cards show no specific
 * useful information": the old modal rendered a fixed set of sections and filled
 * the ones the board could not answer with repeated "Not available for this
 * view" blocks. The rule now is:
 *
 *   - A section whose data is absent is NOT RENDERED. No placeholder, no empty
 *     card, no repeated apology.
 *   - Exactly one compact line is allowed, for the component breakdown only,
 *     because a score explanation without it is genuinely incomplete.
 *   - Nothing is ever invented. Values come from the payload; every derived
 *     figure is arithmetic over payload values, never a plausible substitute.
 *
 * The official weights are NEVER hardcoded here. They arrive in the explain
 * payload; the methodology endpoint is the only fallback.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { getRankingExplain } from "@/lib/api";
import { componentColor, componentLabel } from "@/lib/utils";
import type {
  Methodology,
  RankingBoardId,
  RankingComparison,
  RankingComponentKey,
  RankingExplain,
  RankingExplainBlock,
  RankingRow,
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
      <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
        {title}
      </h3>
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
            ? "score-number text-2xl font-bold text-[var(--peak-accent)]"
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

/** 2–4 sentences, each one guarded by the presence of its own inputs. */
function buildWhy(
  explain: RankingExplain | null,
  subject: { player_name: string; label: string; rank: number; prime_score: number | null },
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
function buildEvidence(
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

// ---------------------------------------------------------------------------
// The modal
// ---------------------------------------------------------------------------

/** What the modal knows synchronously: either a full board row (initial open)
 *  or a comparison entry (after a pivot). */
interface ModalSubject {
  row_id: string;
  player_name: string;
  label: string;
  rank: number;
  prime_score: number | null;
  row: RankingRow | null;
}

function subjectFromRow(row: RankingRow): ModalSubject {
  return {
    row_id: row.row_id,
    player_name: row.player_name,
    label: row.label,
    rank: row.rank,
    prime_score: row.prime_score,
    row,
  };
}

function subjectFromComparison(entry: RankingComparison, fallbackName: string): ModalSubject {
  return {
    row_id: entry.row_id,
    player_name: entry.player_name ?? fallbackName,
    label: entry.label,
    rank: entry.rank,
    prime_score: entry.prime_score,
    row: null,
  };
}

export interface ScoreExplainModalProps {
  /** `null` closes the modal AND unmounts every child, so axe never scans
   *  hidden dialog markup on the rankings page. */
  row: RankingRow | null;
  board: RankingBoardId;
  /** Human name of the active board, e.g. "3Y Peak Windows". */
  boardLabel: string;
  /** Total rows on the board, for "rank N of M". */
  boardRowCount: number | null;
  /** What the percentile population is: "seasons" or "peak windows". */
  populationNoun: string;
  methodology: Methodology | null;
  onClose: () => void;
  /** Injectable for tests; production always uses the real endpoint. */
  fetchExplain?: (board: RankingBoardId, rowId: string) => Promise<RankingExplain>;
}

export default function ScoreExplainModal({
  row,
  board,
  boardLabel,
  boardRowCount,
  populationNoun,
  methodology,
  onClose,
  fetchExplain = getRankingExplain,
}: ScoreExplainModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  /** Pivot history. The last entry is what is on screen; earlier entries are
   *  what "Back" returns to, so a reader can walk Kobe 07-08 → 05-06 → back
   *  without ever losing the dialog. */
  const [stack, setStack] = useState<ModalSubject[]>([]);
  const [explain, setExplain] = useState<RankingExplain | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);

  const openId = row?.row_id ?? null;

  // A new row from the page resets the pivot history.
  useEffect(() => {
    setStack(row ? [subjectFromRow(row)] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const subject = stack.length ? stack[stack.length - 1] : row ? subjectFromRow(row) : null;
  const activeRowId = subject?.row_id ?? null;

  useEffect(() => {
    if (!activeRowId) {
      setExplain(null);
      setExplainError(null);
      return;
    }
    let cancelled = false;
    setExplainLoading(true);
    setExplainError(null);
    setExplain(null);
    fetchExplain(board, activeRowId)
      .then((result) => {
        if (!cancelled) setExplain(result);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setExplain(null);
          setExplainError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setExplainLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRowId, board]);

  // Focus moves into the dialog on open, is restored to the trigger on close,
  // and the page behind never scrolls or navigates.
  useEffect(() => {
    if (!openId) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => closeRef.current?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      restoreFocusTo.current?.focus?.();
    };
  }, [openId]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      // Focus trap: the dialog is modal, so Tab must never reach the page behind it.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  const pivot = useCallback(
    (entry: RankingComparison, fallbackName: string) => {
      setStack((current) => [...current, subjectFromComparison(entry, fallbackName)]);
      // Announce the swap: the dialog stays open, so focus goes to its heading.
      requestAnimationFrame(() => titleRef.current?.focus());
    },
    []
  );

  const goBack = useCallback(() => {
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
    requestAnimationFrame(() => titleRef.current?.focus());
  }, []);

  const components = explain?.components ?? subject?.row?.components ?? null;
  const percentiles = explain?.percentiles ?? subject?.row?.percentiles ?? null;
  const team = explain?.team ?? subject?.row?.team ?? null;
  const completeness = explain?.data_completeness ?? subject?.row?.data_completeness ?? null;
  const primeIndex = explain?.prime_index ?? subject?.row?.prime_index ?? null;
  const primeScore = explain?.prime_score ?? subject?.prime_score ?? null;
  const rank = explain?.rank ?? subject?.rank ?? null;
  const evidence = useMemo(() => buildEvidence(explain), [explain]);
  // Row-specific receipts and hold-backs. Memoized on the two inputs they read
  // so re-rendering the modal (hover, focus, comparison pivot) does not rebuild
  // the strings.
  const receipts = useMemo(
    () => buildComponentReceipts(explain, components ?? {}),
    [explain, components],
  );
  const heldBack = useMemo(() => buildHeldBack(explain, components ?? {}), [explain, components]);
  const why = useMemo(
    () => (subject ? buildWhy(explain, { ...subject, prime_score: primeScore }, boardLabel, populationNoun) : []),
    [explain, subject, primeScore, boardLabel, populationNoun]
  );

  const split = explain?.score_split ?? null;
  const splitCards = split
    ? (
        [
          ["Regular season", split.regular_season, undefined],
          ["Postseason", split.postseason, componentColor("postseason_individual_value")],
          ["Recognition", split.recognition, componentColor("individual_recognition")],
          ["Team achievement", split.team, componentColor("team_achievement")],
        ] as const
      ).filter(([, value]) => value !== null)
    : [];

  const comparisonSections = explain
    ? (
        [
          ["Other seasons from this player", explain.comparisons.same_player, "same-player"],
          ["Similar PEAK3 scores", explain.comparisons.similar_scores, "similar-scores"],
          ["Same-season peers", explain.comparisons.same_season_peers, "same-season-peers"],
        ] as const
      ).filter(([, entries]) => entries.length > 0)
    : [];

  return (
    <AnimatePresence>
      {row && subject && (
        <motion.div
          key="score-explain-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6"
        >
          {/* Click-outside target. Not focusable and hidden from AT, so the
              visible close button stays the single accessible dismiss control. */}
          <div className="absolute inset-0" aria-hidden="true" onClick={onClose} />

          <motion.div
            key="score-explain-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="score-explain-title"
            aria-describedby="score-explain-subtitle"
            onKeyDown={onKeyDown}
            initial={{ opacity: 0, y: 12, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            data-testid="score-explain-modal"
            className="card-elevated relative my-4 w-full max-w-2xl space-y-6 p-4 sm:p-6"
          >
            {/* Header */}
            <div className="space-y-3">
              {stack.length > 1 && (
                <button
                  type="button"
                  onClick={goBack}
                  data-testid="score-explain-back"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                >
                  <ArrowLeft size={13} aria-hidden="true" />
                  Back to {stack[stack.length - 2].player_name} {stack[stack.length - 2].label}
                </button>
              )}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2
                    id="score-explain-title"
                    ref={titleRef}
                    tabIndex={-1}
                    className="font-display break-words text-xl font-bold text-[var(--text-primary)] focus-visible:outline-none sm:text-2xl"
                  >
                    {subject.player_name}
                  </h2>
                  <p
                    id="score-explain-subtitle"
                    className="mt-1 break-words text-sm text-[var(--text-secondary)]"
                  >
                    {subject.label}
                    {team ? ` · ${team}` : ""}
                    {explain?.window_type ? ` · ${windowTypeLabel(explain.window_type)}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Chip>
                      #{rank ?? "—"} on {boardLabel}
                    </Chip>
                    {primeScore !== null && <Chip>Score {primeScore.toFixed(1)}</Chip>}
                    {completeness && (
                      <Chip color="var(--peak-accent)">Data: {completeness}</Chip>
                    )}
                  </div>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={onClose}
                  aria-label="Close score explanation"
                  data-testid="score-explain-close"
                  className="shrink-0 rounded-md p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            </div>

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
                  label={`All-time percentile`}
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

            {/* Interactive component breakdown -- the centrepiece */}
            <Section title="Component breakdown" testId="score-explain-components">
              {explainLoading && !components && (
                <p className="animate-pulse text-xs text-[var(--text-muted)]" role="status">
                  Loading breakdown…
                </p>
              )}
              {explainError && (
                <p className="text-xs text-[var(--incorrect)]" role="alert">
                  {explainError}
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
                !explainLoading &&
                !explainError && (
                  <p
                    className="text-xs text-[var(--text-muted)]"
                    data-testid="score-explain-components-unavailable"
                  >
                    Component contributions are not available for this board.
                  </p>
                )
              )}
            </Section>

            {/* Receipts: what actually drove each component FOR THIS ROW.
                Every line is built from this row's own fields and omitted when
                the row has none, so two different player-seasons never produce
                the same paragraph (see lib/rankings-receipts.ts). */}
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
                      <span aria-hidden="true" style={{ color: "var(--comp-po)" }}>
                        &middot;
                      </span>
                      {reason}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

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
                          <p className="text-[11px] text-[var(--text-muted)]">
                            {pct} percentile
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                {explain?.teammate_adjustment !== null &&
                  explain?.teammate_adjustment !== undefined && (
                    <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                      <span style={{ color: componentColor("teammate_adjustment") }}>
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
                    Recognition, Playoff Rate Impact and Team Result sit outside regular-season
                    play, which is why a row can lose the regular-season comparison and still rank
                    higher. Team Result is capped at 3 points, so it is almost always the smallest
                    number here — even for a champion.
                  </p>
                </div>
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

            {/* Comparisons -- clickable, and they pivot the modal in place */}
            {comparisonSections.length > 0 && (
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
                              onClick={() => pivot(entry, subject.player_name)}
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
                              <span className="score-number shrink-0 text-xs font-bold text-[var(--peak-accent)]">
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
                    Selecting any row above swaps this panel to that row without closing it. Use
                    Back to return.
                  </p>
                </div>
              </Section>
            )}

            {/* Why this score */}
            {why.length > 0 && (
              <Section title="Why this score?" testId="score-explain-summary">
                <div className="card-surface space-y-2 p-4">
                  {why.map((sentence) => (
                    <p
                      key={sentence}
                      className="text-sm leading-relaxed text-[var(--text-secondary)]"
                    >
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
              Sections the model does not publish for this row are omitted rather than estimated.
              PEAK3 rates {populationNoun} by this formula; it is not a claim of objective historical
              truth.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
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
