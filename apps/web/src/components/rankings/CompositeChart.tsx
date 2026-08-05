"use client";
import { useId, useState } from "react";
import type { RankingComponentKey, RankingPercentiles } from "@/types";
import { componentColor, componentLabel } from "@/lib/utils";
import { RANKING_COMPONENT_KEYS } from "./board-model";

/**
 * The LARGE composite radar for one selected ranking row.
 *
 * A DIRECT EXPANSION OF `draft/DNARadar`, not a new chart and not a library.
 * The geometry is the house's -- polar spokes, four ring guides, a filled
 * polygon -- and this version adds what a full-size, primary chart needs and a
 * 120px thumbnail did not: axis labels outside the ring, a focusable point per
 * axis carrying its exact value, and a scale the ring guides are named against.
 * Nothing is rescaled here; the values arrive already normalised.
 *
 * WHY PERCENTILES AND NOT RAW CONTRIBUTIONS. The five components live on wildly
 * different scales -- statistical impact spans roughly 6.8 to 38.9 while team
 * achievement spans 0 to 3 -- so a radar of raw values would be a picture of
 * the weights, identical in shape for every player. Percentiles are the axis
 * the board already publishes for exactly this comparison, and the ring labels
 * say so.
 *
 * THE SIXTH AXIS IS DATA COMPLETENESS, pinned to 100 for a complete row rather
 * than left to render as zero. A spike collapsing to the origin would read as
 * "this player scored nothing here" rather than "this axis does not apply" --
 * the same decision `ComponentSilhouette` records for the same reason.
 *
 * THE CHART IS NEVER THE ONLY WAY TO READ THE DATA. `RankingsDetail` renders an
 * accessible table of the identical values beside it, always present and never
 * behind a disclosure that a screen reader has to find. This SVG is therefore
 * `role="img"` with a summary label rather than an interactive graphic that
 * would have to reimplement a table's semantics.
 */

export interface CompositeAxis {
  key: string;
  label: string;
  /** 0-100. What the polygon is drawn from. */
  value: number;
  /** The underlying figure, when the board publishes one. */
  raw: number | null;
  color: string;
}

/** The six axes for one row, in a fixed order so the shape is comparable
 * between players. Returns null when the board publishes no percentiles at
 * all -- a radar of absent values would be a drawing of zeros. */
export function compositeAxes(
  percentiles: RankingPercentiles | null,
  components: Partial<Record<RankingComponentKey, number | null>> | null,
  dataComplete: boolean,
): CompositeAxis[] | null {
  if (!percentiles) return null;
  const axes: CompositeAxis[] = RANKING_COMPONENT_KEYS.map((key) => ({
    key,
    label: componentLabel(key),
    value: clamp(percentiles[key] ?? 0),
    raw: components?.[key] ?? null,
    color: componentColor(key),
  }));
  axes.push({
    key: "data_completeness",
    label: "Data completeness",
    value: dataComplete ? 100 : 60,
    raw: null,
    color: "var(--comp-tm)",
  });
  return axes;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export default function CompositeChart({
  axes,
  size = 320,
  playerName,
}: {
  axes: CompositeAxis[];
  size?: number;
  playerName: string;
}) {
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);

  const count = axes.length;
  // Generous padding: the labels sit OUTSIDE the ring, and a label that
  // overflowed the viewBox is the clipping this chart exists to avoid at 200%
  // zoom. The viewBox scales with the container rather than the font.
  const pad = 58;
  const box = size + pad * 2;
  const cx = box / 2;
  const cy = box / 2;
  const radius = size * 0.42;

  function point(index: number, distance: number) {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    return {
      x: cx + distance * Math.cos(angle),
      y: cy + distance * Math.sin(angle),
    };
  }

  const polygon = axes
    .map((axis, index) => {
      const p = point(index, radius * (axis.value / 100));
      return `${p.x},${p.y}`;
    })
    .join(" ");

  const rings = [0.25, 0.5, 0.75, 1].map((fraction) =>
    axes
      .map((_, index) => {
        const p = point(index, radius * fraction);
        return `${p.x},${p.y}`;
      })
      .join(" "),
  );

  return (
    <div className="rk-chart" data-testid="rankings-composite-chart">
      <svg
        viewBox={`0 0 ${box} ${box}`}
        className="rk-chart-svg"
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>
          {`${playerName}: ${axes
            .map((axis) => `${axis.label} ${Math.round(axis.value)}`)
            .join(", ")} out of 100`}
        </title>

        {rings.map((points, index) => (
          <polygon
            key={index}
            points={points}
            fill="none"
            stroke="var(--border-subtle)"
            strokeWidth={index === rings.length - 1 ? 1 : 0.6}
          />
        ))}

        {axes.map((axis, index) => {
          const end = point(index, radius);
          return (
            <line
              key={axis.key}
              x1={cx}
              y1={cy}
              x2={end.x}
              y2={end.y}
              stroke="var(--border-subtle)"
              strokeWidth={0.6}
            />
          );
        })}

        <polygon
          points={polygon}
          fill="var(--peak-accent)"
          fillOpacity={0.18}
          stroke="var(--peak-accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          data-testid="rk-chart-polygon"
        />

        {axes.map((axis, index) => {
          const p = point(index, radius * (axis.value / 100));
          return (
            <circle
              key={axis.key}
              cx={p.x}
              cy={p.y}
              r={active === index ? 6 : 4}
              fill={axis.color}
              stroke="var(--bg-elevated)"
              strokeWidth={1.5}
              data-testid={`rk-chart-point-${axis.key}`}
            />
          );
        })}

        {/* Labels outside the ring, anchored by quadrant so a left-hand label
            grows leftwards and cannot run back over the chart. */}
        {axes.map((axis, index) => {
          const p = point(index, radius + 24);
          const anchor =
            Math.abs(p.x - cx) < 4 ? "middle" : p.x > cx ? "start" : "end";
          return (
            <g key={axis.key}>
              <text
                x={p.x}
                y={p.y}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="rk-chart-label"
                data-testid={`rk-chart-label-${axis.key}`}
              >
                {axis.label}
              </text>
              <text
                x={p.x}
                y={p.y + 13}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="rk-chart-value"
                data-active={active === index ? "true" : "false"}
              >
                {Math.round(axis.value)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Focusable proxies for the points. Buttons rather than SVG handlers so
          the exact value is reachable by keyboard and by touch, on a surface a
          screen reader already understands. */}
      <ul className="rk-chart-keys" aria-label="Axis values">
        {axes.map((axis, index) => (
          <li key={axis.key}>
            <button
              type="button"
              className="rk-chart-key"
              data-testid={`rk-chart-key-${axis.key}`}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
            >
              <span
                className="rk-chart-swatch"
                style={{ background: axis.color }}
                aria-hidden="true"
              />
              <span className="rk-chart-key-label">{axis.label}</span>
              <span className="rk-chart-key-value">
                {Math.round(axis.value)}
                <span className="sr-only"> out of 100</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="rk-chart-scale">
        Rings mark the 25th, 50th, 75th and 100th percentile against every row on
        this board.
      </p>
    </div>
  );
}
