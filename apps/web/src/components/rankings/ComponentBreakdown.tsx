"use client";

/**
 * Phase 9C: the interactive component breakdown -- the centrepiece of the
 * explain modal.
 *
 * The interaction is modelled on the Formula Explorer's weight bar: a stacked
 * bar of real `<button>` segments, non-selected segments dimmed, and one detail
 * panel below with a left colour stripe. Clicking OR focusing a segment swaps
 * the panel, so a keyboard user tabbing across the bar gets the same reading
 * experience as a mouse user.
 *
 * HARD RULES obeyed here:
 *  - The official weights are NEVER written in TypeScript. They arrive in the
 *    explain payload (`weights`), with the methodology endpoint as a secondary
 *    API-sourced fallback. If neither published a weight, the panel omits the
 *    weight line rather than printing 38%.
 *  - Every sentence in "why this row" is derived from a value that is present.
 *    An absent percentile removes a clause; it never becomes a hedge.
 *  - The plain-English description of a component is the API's own methodology
 *    text, not prose written here.
 */

import { useEffect, useMemo, useState } from "react";
import type {
  Methodology,
  RankingComponentKey,
  RankingComponentValues,
  RankingPercentiles,
} from "@/types";
import { cn, componentColor, componentLabel } from "@/lib/utils";
import {
  COMPONENT_ABBR,
  RANKING_COMPONENT_KEYS,
  formatPercentile,
  formatScore2,
} from "./board-model";

export interface ComponentBreakdownProps {
  components: RankingComponentValues;
  percentiles: RankingPercentiles | null;
  /** From the explain payload. Empty object = nothing published. */
  weights: Partial<Record<RankingComponentKey, number>>;
  strongest: string[];
  weakest: string[];
  /** Fetched from /api/v1/methodology by the page; null when unavailable. */
  methodology: Methodology | null;
  /** One data-derived clause per component, composed by the caller from the
   *  explain payload (awards, playoff series, title, minutes…). */
  evidence?: Partial<Record<RankingComponentKey, string>>;
  /** "seasons" or "windows" -- what the percentile population is. */
  populationNoun: string;
}

function qualitative(percentile: number): string {
  if (percentile >= 95) return "an elite mark";
  if (percentile >= 85) return "a strong mark";
  if (percentile >= 60) return "an above-average mark";
  if (percentile >= 40) return "a mid-pack mark";
  return "a comparatively weak mark";
}

export default function ComponentBreakdown({
  components,
  percentiles,
  weights,
  strongest,
  weakest,
  methodology,
  evidence,
  populationNoun,
}: ComponentBreakdownProps) {
  const present = useMemo(
    () => RANKING_COMPONENT_KEYS.filter((key) => components[key] !== null),
    [components]
  );

  const positiveTotal = useMemo(
    () => present.reduce((total, key) => total + Math.max(components[key] ?? 0, 0), 0),
    [present, components]
  );

  // Opens on the biggest contributor: the panel is never empty, and the first
  // thing a reader sees is the component that actually decided this score.
  const defaultKey = useMemo(() => {
    if (!present.length) return null;
    return present.reduce(
      (best, key) => ((components[key] ?? 0) > (components[best] ?? 0) ? key : best),
      present[0]
    );
  }, [present, components]);

  const [selected, setSelected] = useState<RankingComponentKey | null>(defaultKey);
  useEffect(() => setSelected(defaultKey), [defaultKey]);

  const activeKey = selected ?? defaultKey;
  if (!activeKey || !present.length) return null;

  const value = components[activeKey];
  const weight = weights[activeKey] ?? methodology?.weights?.[activeKey] ?? null;
  const percentile = percentiles?.[activeKey] ?? null;
  const share = positiveTotal > 0 ? ((value ?? 0) / positiveTotal) * 100 : null;
  const color = componentColor(activeKey);
  const doc = methodology?.components?.find((component) => component.id === activeKey) ?? null;
  const isStrongest = strongest.includes(activeKey);
  const isWeakest = weakest.includes(activeKey);

  const heaviest =
    Object.entries(weights).length > 0
      ? (Object.entries(weights).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? null)
      : null;

  const whyClauses: string[] = [];
  const percentileText = formatPercentile(percentile);
  if (percentileText && percentile !== null) {
    whyClauses.push(
      `This row sits at the ${percentileText} percentile of all scored ${populationNoun} on ` +
        `${componentLabel(activeKey)} — ${qualitative(percentile)}.`
    );
  }
  if (value !== null && share !== null) {
    whyClauses.push(
      `It contributes ${formatScore2(value)} raw points, ${share.toFixed(0)}% of everything ` +
        `positive in this score.`
    );
  }
  if (evidence?.[activeKey]) whyClauses.push(evidence[activeKey] as string);
  if (isStrongest) whyClauses.push("The model lists this among the row's strongest components.");
  if (isWeakest) whyClauses.push("The model lists this among the row's weakest components.");

  const leverClauses: string[] = [];
  if (weight !== null) {
    leverClauses.push(
      `${componentLabel(activeKey)} carries ${(weight * 100).toFixed(0)}% of the formula` +
        (heaviest === activeKey
          ? ", the heaviest weight of the five, so a point gained here moves the ordering more than a point gained anywhere else."
          : ".")
    );
  }
  if (doc?.key_inputs?.length) {
    leverClauses.push(`It rises and falls with: ${doc.key_inputs.join(", ")}.`);
  }

  return (
    <div className="space-y-3" data-testid="component-breakdown">
      {/* Stacked bar of real buttons */}
      <div
        className="flex h-10 overflow-hidden rounded-lg"
        role="group"
        aria-label={`Component breakdown. Select a component to read its detail. ${present
          .map((key) => `${componentLabel(key)} ${formatScore2(components[key])}`)
          .join(", ")}`}
      >
        {present.map((key) => {
          const segmentValue = components[key] ?? 0;
          const width = positiveTotal > 0 ? (Math.max(segmentValue, 0) / positiveTotal) * 100 : 0;
          const isActive = key === activeKey;
          const pct = formatPercentile(percentiles?.[key] ?? null);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(key)}
              onFocus={() => setSelected(key)}
              aria-pressed={isActive}
              aria-controls="component-breakdown-detail"
              data-testid={`component-segment-${key}`}
              title={`${componentLabel(key)}: ${formatScore2(components[key])}`}
              aria-label={`${componentLabel(key)}: ${formatScore2(components[key])} points${
                pct ? `, ${pct} percentile` : ""
              }`}
              style={{
                width: `${Math.max(width, 4)}%`,
                backgroundColor: componentColor(key),
                opacity: isActive ? 1 : 0.42,
              }}
              className="flex min-w-0 items-center justify-center text-[10px] font-bold text-black/75 transition-opacity duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
            >
              <span aria-hidden="true" className="truncate px-0.5">
                {width >= 11 ? COMPONENT_ABBR[key] : ""}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-[var(--text-muted)]">
        Segment width is each component&rsquo;s share of this score. Select a segment — by click or
        by keyboard — to read what it measures and why this row scored the way it did.
      </p>

      {/* Detail panel */}
      <div
        id="component-breakdown-detail"
        aria-live="polite"
        data-testid="component-detail"
        className="card-surface p-4 space-y-3"
        style={{ borderLeftColor: color, borderLeftWidth: "3px" }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-sm font-bold text-[var(--text-primary)]">
            {componentLabel(activeKey)}{" "}
            <span className="text-[var(--text-muted)] font-medium">
              ({COMPONENT_ABBR[activeKey]})
            </span>
          </h4>
          <span className="score-number text-lg font-bold" style={{ color }}>
            {formatScore2(value)}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Contribution" value={formatScore2(value)} />
          <MiniStat
            label="Official weight"
            value={weight === null ? null : `${(weight * 100).toFixed(0)}%`}
            testId="component-detail-weight"
          />
          <MiniStat
            label="Percentile"
            value={percentileText}
            testId="component-detail-percentile"
          />
        </div>

        {doc?.long_description ? (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              What it measures
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              {doc.long_description}
            </p>
          </div>
        ) : null}

        {whyClauses.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Why this row scored here
            </p>
            <p
              className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]"
              data-testid="component-detail-why"
            >
              {whyClauses.join(" ")}
            </p>
          </div>
        )}

        {leverClauses.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              What raises or lowers it
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              {leverClauses.join(" ")}
            </p>
          </div>
        )}

        {doc?.common_misconceptions?.length ? (
          <ul className="space-y-1">
            {doc.common_misconceptions.map((note) => (
              <li
                key={note}
                className="border-l border-[var(--border-subtle)] pl-3 text-[11px] text-[var(--text-muted)]"
              >
                {note}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | null;
  testId?: string;
}) {
  return (
    <div className={cn("rounded-md bg-[var(--bg-elevated)] px-2 py-1.5")} data-testid={testId}>
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className="score-number text-sm font-semibold text-[var(--text-primary)]">
        {value ?? "—"}
      </p>
    </div>
  );
}
