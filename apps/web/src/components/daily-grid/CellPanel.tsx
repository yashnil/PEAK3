"use client";

import { useEffect, useRef, useState } from "react";
import { DailyGridBoard, FilledCell, GridConstraint, PlayerSeasonSearchHit } from "@/types/daily-grid";
import { searchPlayerSeasons } from "@/lib/daily-grid-api";
import { RARITY_SHORT_LABEL, cellSpec, colConstraint, rowConstraint } from "@/lib/daily-grid-state";
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
  onRemove: () => void;
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

/**
 * The selected square's workbench: both constraints in full (label AND the
 * qualifying sentence -- the grid headers only have room for `short_label`),
 * then either the filled card with an explicit remove control, or the search.
 *
 * Search results are NEVER filtered or re-ordered here -- the server's order
 * is authoritative, and it is also the server that decides whether a hit gets
 * an `eligible` verdict at all. A broad query comes back entirely `null`
 * (rendered with no affordance, so the list cannot be used to harvest a cell's
 * answer set); a query narrow enough to name a player comes back flagged
 * true/false, which turns "which of THIS player's seasons is the one?" from
 * repeated blind submissions into a decision. See the `PlayerSeasonSearchHit`
 * doc comment in types/daily-grid.ts for the full rationale.
 *
 * An ineligible hit is de-emphasized but stays clickable and submits normally:
 * the server's `reason` sentence is still the teaching moment.
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
  onRemove,
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
  // The server withheld a verdict on every hit -- i.e. the query was too broad
  // to be about one player. Worth a line: otherwise the flags appearing later
  // looks arbitrary rather than like something the player controls.
  const allUnflagged = results.length > 0 && results.every((r) => r.eligible === null);

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
      searchPlayerSeasons({ q: trimmed, date: board.date, row, col, limit: 20, signal: controller.signal })
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
  }, [query, board.date, row, col]);

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
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {RARITY_SHORT_LABEL[spec.rarity_bucket]} square
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
              {filled.player_season.prime_score}
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {filled.cell_score.arena_points} arena points · {filled.cell_score.rarity_label} (
              {filled.cell_score.quality_points} quality + {filled.cell_score.rarity_bonus} rarity)
            </p>
          </div>
          <button
            type="button"
            data-testid="cell-panel-remove"
            onClick={onRemove}
            aria-label={`Remove ${filled.player_season.label} from this square`}
            title="Remove this answer"
            className="shrink-0 rounded-md px-2.5 py-1 text-sm font-bold leading-none"
            style={{
              border: "1px solid var(--border-default)",
              color: "var(--text-secondary)",
              background: "var(--bg-elevated)",
            }}
          >
            ×
          </button>
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
                Naming a specific player will show which of their seasons fit this square. A broad search
                will not — working out who qualifies is the puzzle.
              </p>
            )}
            {results.map((hit) => {
              const alreadyUsed = usedPlayerSlugs.includes(hit.player_slug);
              const fits = hit.eligible === true;
              const doesNotFit = hit.eligible === false;
              return (
                <button
                  key={hit.id}
                  type="button"
                  data-testid="cell-search-result"
                  data-answer-id={hit.id}
                  data-eligible={hit.eligible === null ? "unknown" : String(hit.eligible)}
                  disabled={submitting}
                  onClick={() => onSubmit(hit)}
                  aria-label={
                    fits
                      ? `${hit.label}, ${hit.team_name}. Fits this square. Submit.`
                      : doesNotFit
                        ? `${hit.label}, ${hit.team_name}. Does not fit this square. Submit anyway.`
                        : `${hit.label}, ${hit.team_name}. Submit.`
                  }
                  className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-50"
                  style={{
                    background: "var(--bg-surface)",
                    // Ineligible hits stay fully readable and fully clickable --
                    // only the border/label recede, never the information.
                    border: `1px solid ${
                      fits ? "color-mix(in srgb, var(--correct) 55%, transparent)" : "var(--border-default)"
                    }`,
                    opacity: doesNotFit ? 0.72 : 1,
                    color: "var(--text-primary)",
                  }}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">{hit.label}</span>
                    <span className="block text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      {hit.team_name}
                      {hit.position ? ` · ${hit.position}` : ""}
                      {alreadyUsed ? " · already on your board" : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {/* Never colour alone: the badge carries its own words, so
                        it survives a screen reader and a colour-blind user. */}
                    {fits && (
                      <span
                        data-testid="cell-search-result-fits"
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]"
                        style={{ background: "var(--correct-bg)", color: "var(--correct)" }}
                      >
                        <span aria-hidden="true">✓ </span>Fits
                      </span>
                    )}
                    {doesNotFit && (
                      <span
                        data-testid="cell-search-result-unfits"
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]"
                        style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
                      >
                        <span aria-hidden="true">× </span>No fit
                      </span>
                    )}
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                      style={{ background: "var(--peak-accent-bg)", color: "var(--peak-accent)" }}
                    >
                      {hit.prime_score}
                    </span>
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
