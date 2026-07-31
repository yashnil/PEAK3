"use client";

import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import {
  DailyGridBoard,
  FilledCell,
  GridConstraint,
  PlayerSeasonSearchHit,
  SearchHitStatus,
} from "@/types/daily-grid";
import { searchPlayerSeasons } from "@/lib/daily-grid-api";
import {
  RARITY_POOL_HINT,
  RARITY_SHORT_LABEL,
  cellSpec,
  colConstraint,
  rowConstraint,
} from "@/lib/daily-grid-state";
import { CATEGORY_LABEL, categoryColor } from "./constraint-style";

interface Props {
  board: DailyGridBoard;
  row: number;
  col: number;
  filled: FilledCell | null;
  /** Identities already placed anywhere on the board (the unique-player rule). */
  usedPlayerSlugs: string[];
  /** The server's own rejection sentence for the last attempt on this square. */
  invalidMessage: string | null;
  submitting: boolean;
  onSubmit: (hit: PlayerSeasonSearchHit) => void;
  onClose: () => void;
}

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

function ConstraintBlock({ constraint, axis }: { constraint: GridConstraint | null; axis: "Row" | "Column" }) {
  if (!constraint) return null;
  const color = categoryColor(constraint.category);
  return (
    <div
      data-testid={`cell-panel-${axis.toLowerCase()}-constraint`}
      className="rounded-lg p-3"
      style={{ background: "var(--bg-surface)", borderLeft: `3px solid ${color}` }}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
        {axis} · {CATEGORY_LABEL[constraint.category]}
      </p>
      <p className="mt-1 text-sm font-bold" style={{ color: "var(--text-primary)" }}>
        {constraint.label}
      </p>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {constraint.description}
      </p>
    </div>
  );
}

/** How each search-result status is presented.
 *
 * Every badge carries its own words -- never colour alone -- so the list reads
 * correctly to a screen reader and to a colour-blind player. `unknown` has no
 * badge at all: the server withheld a verdict, and inventing a neutral chip
 * would imply it had said something.
 */
const STATUS_STYLE: Record<
  SearchHitStatus,
  { badge: string | null; testId?: string; note: string | null; announce: string }
> = {
  available: {
    badge: "Available",
    testId: "cell-search-result-available",
    note: null,
    announce: "Qualifies for this square. Submit.",
  },
  used: {
    badge: "Used",
    testId: "cell-search-result-used",
    note: "Already used on this board",
    announce: "Already used on this board. Not available.",
  },
  no_fit: {
    badge: "No fit",
    testId: "cell-search-result-no-fit",
    note: "Does not satisfy this square",
    announce: "Does not fit this square. Not available.",
  },
  unknown: {
    badge: null,
    note: null,
    announce: "Submit to check.",
  },
};

/**
 * The selected square's workbench: both constraints in full (label AND the
 * qualifying sentence -- the grid headers only have room for `short_label`),
 * then either the LOCKED card or the search.
 *
 * A locked square shows its answer, its revealed score and a "Locked" badge --
 * and no search box and no remove control, because a valid pick on the
 * competitive daily board is final. Search results carry no score either: the
 * mode's objective is to maximise total PEAK3 score, so a visible rating per
 * candidate would be the answer rather than a hint.
 *
 * PHASE 11C -- RESULTS SAY WHAT THEY ARE. Every hit renders its server-issued
 * `status`, and `used`/`no_fit` rows are genuinely DISABLED. The 11B list made
 * a player click a result to discover it was unplayable, and worse, kept
 * showing "Fits" on a player they had already spent. Both were the server
 * knowing something and the UI not saying it.
 *
 * Results are NEVER filtered or re-ordered here -- the server's order is
 * authoritative, and it is also the server that decides whether a hit earns an
 * eligibility verdict at all. A query that would give away too much of the
 * square's answer set comes back entirely `unknown`; anything narrower is
 * marked, which turns "which of THIS player's seasons is the one?" from
 * repeated blind submissions into a decision. See the `PlayerSeasonSearchHit`
 * doc comment in types/daily-grid.ts for the full rationale.
 */
export default function CellPanel({
  board,
  row,
  col,
  filled,
  usedPlayerSlugs,
  invalidMessage,
  submitting,
  onSubmit,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSeasonSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const rowC = rowConstraint(board, row);
  const colC = colConstraint(board, col);
  const spec = cellSpec(board, row, col);
  // The server withheld a verdict on every hit -- i.e. answering this query
  // would have named too many of the square's qualifying players. Worth a
  // line: otherwise the badges appearing on a narrower query looks arbitrary
  // rather than like something the player controls.
  const allUnflagged = results.length > 0 && results.every((r) => r.status === "unknown");
  // Joined into the query string, so a plain dependency on the array would
  // re-fire the search on every render.
  const usedKey = usedPlayerSlugs.join(",");

  useEffect(() => {
    if (!filled) inputRef.current?.focus();
  }, [filled]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      setSearched(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      searchPlayerSeasons({
        q: trimmed,
        date: board.date,
        row,
        col,
        limit: 20,
        used: usedKey ? usedKey.split(",") : [],
        signal: controller.signal,
      })
        .then((res) => {
          setResults(res.results ?? []);
          setSearchError(null);
          setSearched(true);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setSearchError(
            err instanceof Error && err.message ? err.message : "Search is unavailable right now.",
          );
          setSearched(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, board.date, row, col, usedKey]);

  return (
    <section
      data-testid="cell-panel"
      aria-label="Selected square"
      className="card-elevated p-4 sm:p-5"
      style={{ borderColor: "color-mix(in srgb, var(--peak-accent) 30%, var(--border-subtle))" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
            Selected square · Row {row + 1}, Column {col + 1}
          </p>
          <h2 data-testid="cell-panel-title" className="font-display mt-1 text-lg font-bold">
            {(rowC?.label ?? `Row ${row + 1}`) + " × " + (colC?.label ?? `Column ${col + 1}`)}
          </h2>
          {spec && (
            <p data-testid="cell-panel-pool" className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Answer pool: {RARITY_SHORT_LABEL[spec.rarity_bucket]} — {RARITY_POOL_HINT[spec.rarity_bucket]}{" "}
              {spec.rarity_bucket === "very_common" || spec.rarity_bucket === "common"
                ? "Easier to fill, worth less."
                : "Harder to fill, worth more."}
            </p>
          )}
        </div>
        <button
          type="button"
          data-testid="cell-panel-close"
          onClick={onClose}
          aria-label="Close selected square"
          className="rounded-md px-2 py-1 text-sm"
          style={{ border: "1px solid var(--border-default)", color: "var(--text-secondary)" }}
        >
          Close
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <ConstraintBlock constraint={rowC} axis="Row" />
        <ConstraintBlock constraint={colC} axis="Column" />
      </div>

      {filled ? (
        <div
          data-testid="cell-panel-filled"
          className="mt-4 flex items-start justify-between gap-3 rounded-lg p-3"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid color-mix(in srgb, var(--peak-accent) 40%, transparent)",
          }}
        >
          <div className="min-w-0">
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {filled.player_season.label}
            </p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
              {filled.player_season.team_name}
              {filled.player_season.position ? ` · ${filled.player_season.position}` : ""} · PEAK{" "}
              {filled.cell_score.quality_points}
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {filled.cell_score.arena_points} arena points · {filled.cell_score.rarity_label} (
              {filled.cell_score.quality_points} quality + {filled.cell_score.rarity_bonus} rarity)
            </p>
          </div>
          {/* Phase 11B: a locked square is FINAL. No remove control, and no
              search box below -- the competitive daily board does not offer
              "try again with a better player", because that would make the
              score, and the comparison against today's maximum, meaningless. */}
          <span
            data-testid="cell-panel-locked"
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-muted)",
            }}
          >
            <Lock size={9} aria-hidden="true" />
            Locked
          </span>
        </div>
      ) : (
        <div className="mt-4">
          <label
            htmlFor="daily-grid-search"
            className="text-[10px] font-bold uppercase tracking-[0.16em]"
            style={{ color: "var(--text-muted)" }}
          >
            Find a player-season
          </label>
          <input
            id="daily-grid-search"
            ref={inputRef}
            data-testid="cell-search-input"
            type="text"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a player, e.g. Olajuwon"
            className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          />

          {invalidMessage && (
            <p
              data-testid="cell-invalid-reason"
              role="alert"
              className="mt-2 rounded-lg px-3 py-2 text-xs leading-relaxed"
              style={{ background: "var(--incorrect-bg)", color: "var(--incorrect)" }}
            >
              {invalidMessage}
            </p>
          )}

          {searchError && (
            <p data-testid="cell-search-error" role="alert" className="mt-2 text-xs" style={{ color: "var(--incorrect)" }}>
              {searchError}
            </p>
          )}

          <div
            data-testid="cell-search-results"
            role="group"
            aria-label="Search results"
            aria-busy={searching}
            className="mt-2 flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1"
          >
            {allUnflagged && (
              <p data-testid="cell-search-broad-hint" className="pb-1 text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                Too many players match to show which ones qualify. Narrow the search and each result will
                say whether it fits — working out who qualifies is the puzzle.
              </p>
            )}
            {results.map((hit) => {
              const style = STATUS_STYLE[hit.status];
              // The server decides. The client does not second-guess it with
              // its own used-slug bookkeeping -- one source of truth means the
              // badge and the button state can never disagree.
              const playable = hit.selectable && !submitting;
              const available = hit.status === "available";
              return (
                <button
                  key={hit.id}
                  type="button"
                  data-testid="cell-search-result"
                  data-answer-id={hit.id}
                  data-status={hit.status}
                  data-eligible={hit.eligible === null ? "unknown" : String(hit.eligible)}
                  disabled={!playable}
                  onClick={() => onSubmit(hit)}
                  aria-label={`${hit.label}, ${hit.team_name}. ${style.announce}`}
                  className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors disabled:cursor-not-allowed"
                  style={{
                    background: "var(--bg-surface)",
                    border: `1px solid ${
                      available
                        ? "color-mix(in srgb, var(--correct) 55%, transparent)"
                        : "var(--border-default)"
                    }`,
                    // Unusable rows recede but stay legible -- they are still
                    // information ("Daugherty was a Cav, not a Knick"), just
                    // not a move.
                    opacity: hit.selectable ? 1 : 0.6,
                    color: "var(--text-primary)",
                  }}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">{hit.label}</span>
                    <span className="block text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      {hit.team_name}
                      {hit.position ? ` · ${hit.position}` : ""}
                      {style.note ? ` · ${style.note.toLowerCase()}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {style.badge && (
                      <span
                        data-testid={style.testId}
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]"
                        style={
                          available
                            ? { background: "var(--correct-bg)", color: "var(--correct)" }
                            : { background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }
                        }
                      >
                        {style.badge}
                      </span>
                    )}
                    {/* NO score pill here. The objective is to maximise total
                        PEAK3 score, so printing each candidate's rating would
                        hand over the answer -- the player would sort by eye and
                        click the biggest number without knowing any basketball.
                        The score is revealed when the pick is locked, and not
                        before. The search response does not even carry one (see
                        PlayerSeasonIdentity in types/daily-grid.ts). */}
                  </span>
                </button>
              );
            })}

            {searching && (
              <p className="py-2 text-xs" style={{ color: "var(--text-muted)" }} role="status">
                Searching…
              </p>
            )}
            {!searching && searched && results.length === 0 && !searchError && (
              <p className="py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                No player-seasons match that search.
              </p>
            )}
            {!searching && !searched && !searchError && (
              <p className="py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                Type at least {MIN_QUERY} letters. Answers are exact seasons — &ldquo;1999-00 Shaquille
                O&rsquo;Neal&rdquo;, not just the player.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
