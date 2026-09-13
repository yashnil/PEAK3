"use client";

/**
 * The career rail: every PEAK3 season of one career, in order, with a bracket
 * spanning the selected window.
 *
 * NO DRAG REQUIRED. Three equivalent ways to place and move the bracket:
 *   * tap or click a season (it becomes the window's first season when it can
 *     start one; otherwise the latest legal window that contains it is used);
 *   * the Earlier / Later buttons;
 *   * the rail's own slider semantics: Arrow keys, Home/End, PageUp/PageDown.
 * The bracket only ever lands on a legal start, so an invalid-length or
 * missing-season window cannot be selected, let alone submitted.
 *
 * NEUTRAL BEFORE THE LOCK. Every season looks the same except for whether it is
 * inside your bracket. There is no height, colour ramp or ordering that could
 * encode a score -- this component is never given one.
 *
 * GAPS. A season the player did not qualify in is drawn as a break in the rail,
 * never as a selectable cell, so a window cannot silently span it.
 */

import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { usePrefersReducedMotion } from "@/lib/a11y";
import type { FindThePrimeSeason } from "@/types/find-the-prime";

export function teamShort(team: string): string {
  return team === "Multiple teams" ? "2+ tm" : team;
}

export function windowLabel(seasons: FindThePrimeSeason[], start: number, duration: number): string {
  const first = seasons.find((s) => s.season_end === start);
  const last = seasons.find((s) => s.season_end === start + duration - 1);
  return `${first?.season ?? start} to ${last?.season ?? start + duration - 1}`;
}

/** The legal start a tap on `seasonEnd` should place, or null. */
export function startForTap(seasonEnd: number, legalStarts: number[], duration: number): number | null {
  if (legalStarts.includes(seasonEnd)) return seasonEnd;
  const covering = legalStarts.filter((s) => s <= seasonEnd && seasonEnd <= s + duration - 1);
  return covering.length ? Math.max(...covering) : null;
}

export default function CareerRail({
  seasons,
  legalStarts,
  duration,
  selectedStart,
  locked,
  onSelect,
}: {
  seasons: FindThePrimeSeason[];
  legalStarts: number[];
  duration: number;
  selectedStart: number | null;
  locked: boolean;
  onSelect: (start: number) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const railRef = useRef<HTMLDivElement>(null);
  const starts = useMemo(() => [...legalStarts].sort((a, b) => a - b), [legalStarts]);
  const index = selectedStart === null ? -1 : starts.indexOf(selectedStart);

  const cells = useMemo(() => {
    const out: Array<{ kind: "season"; season: FindThePrimeSeason } | { kind: "gap"; from: number; to: number }> = [];
    seasons.forEach((season, i) => {
      const prev = seasons[i - 1];
      if (prev && season.season_end - prev.season_end > 1) {
        out.push({ kind: "gap", from: prev.season_end + 1, to: season.season_end - 1 });
      }
      out.push({ kind: "season", season });
    });
    return out;
  }, [seasons]);

  const move = useCallback(
    (delta: number) => {
      if (locked || starts.length === 0) return;
      const from = index === -1 ? (delta > 0 ? -1 : starts.length) : index;
      const next = Math.min(starts.length - 1, Math.max(0, from + delta));
      onSelect(starts[next]);
    },
    [locked, starts, index, onSelect],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(1),
      ArrowUp: () => move(1),
      ArrowLeft: () => move(-1),
      ArrowDown: () => move(-1),
      PageUp: () => move(3),
      PageDown: () => move(-3),
      Home: () => !locked && starts.length && onSelect(starts[0]),
      End: () => !locked && starts.length && onSelect(starts[starts.length - 1]),
    };
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  // Keep the bracket in view on a narrow rail.
  useEffect(() => {
    if (selectedStart === null) return;
    const cell = railRef.current?.querySelector<HTMLElement>(`[data-season-end="${selectedStart}"]`);
    // Not every environment implements it (jsdom does not); a missing scroll is
    // cosmetic, a thrown error is not.
    if (cell && typeof cell.scrollIntoView === "function") {
      cell.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
    }
  }, [selectedStart, reduced]);

  const valueText = selectedStart === null ? "No window placed" : windowLabel(seasons, selectedStart, duration);

  return (
    <div className="fprime-rail-wrap" data-testid="fprime-rail-wrap">
      <div className="fprime-rail-controls">
        <button
          type="button"
          className="fprime-step"
          onClick={() => move(-1)}
          disabled={locked || index === 0}
          data-testid="fprime-earlier"
          aria-label="Move window one season earlier"
        >
          <ChevronLeft size={18} aria-hidden="true" />
          <span>Earlier</span>
        </button>
        <div
          ref={railRef}
          className="fprime-rail"
          role="slider"
          tabIndex={locked ? -1 : 0}
          aria-label={`${duration}-year window`}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, starts.length - 1)}
          aria-valuenow={index === -1 ? 0 : index}
          aria-valuetext={valueText}
          aria-disabled={locked}
          onKeyDown={onKeyDown}
          data-testid="fprime-rail"
          data-locked={locked ? "true" : "false"}
        >
          <ol className="fprime-rail-cells">
            {cells.map((cell) => {
              if (cell.kind === "gap") {
                return (
                  <li key={`gap-${cell.from}`} className="fprime-gap" aria-label="Seasons with no PEAK3 rating">
                    <span aria-hidden="true">···</span>
                  </li>
                );
              }
              const season = cell.season;
              const inside = selectedStart !== null && season.season_end >= selectedStart && season.season_end <= selectedStart + duration - 1;
              const edge = inside ? (season.season_end === selectedStart ? "start" : season.season_end === (selectedStart ?? 0) + duration - 1 ? "end" : "mid") : "none";
              const target = startForTap(season.season_end, starts, duration);
              return (
                <li key={season.season_end} className="fprime-cell-item">
                  <button
                    type="button"
                    tabIndex={-1}
                    className="fprime-cell"
                    data-season-end={season.season_end}
                    data-inside={inside ? "true" : "false"}
                    data-edge={edge}
                    data-testid={`fprime-season-${season.season_end}`}
                    disabled={locked || target === null}
                    aria-pressed={inside}
                    aria-label={`${season.season}, ${season.team}${inside ? ", in your window" : ""}`}
                    onClick={() => target !== null && onSelect(target)}
                  >
                    <span className="fprime-cell-season pk-numeral">{season.season.slice(0, 4)}</span>
                    <span className="fprime-cell-team">{teamShort(season.team)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <button
          type="button"
          className="fprime-step"
          onClick={() => move(1)}
          disabled={locked || index === starts.length - 1}
          data-testid="fprime-later"
          aria-label="Move window one season later"
        >
          <span>Later</span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="fprime-rail-hint">Tap a season, or focus the timeline and use the arrow keys.</p>
    </div>
  );
}
