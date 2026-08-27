"use client";

/**
 * HomeV2LaneExplainer — "How PEAK3 works", made visual (Pass 6, product-
 * direction consistency pass). Replaces the homepage's five static
 * percentage labels with one interactive object: a single proportional bar
 * split into PEAK3's five real weighted components (the frozen source of
 * truth — CLAUDE.md's `OFFICIAL_WEIGHTS`, unchanged, just visualized
 * instead of printed as a grid of numbers).
 *
 * Default state renders all five lanes together as one coherent object —
 * "Five lanes. One point each," restated as a shape instead of a sentence.
 * Hovering, focusing (Tab) or clicking a lane emphasizes it and reveals its
 * real methodology copy (`short_description`, the exact string
 * `/methodology`'s own accordion renders — never re-authored). A lane with
 * no matching methodology entry (API unreachable) still shows its weight;
 * it never blocks on the description.
 *
 * Hover/focus previews; click PINS a lane (persists after the pointer
 * leaves, the natural behavior for a touch tap that never fires
 * `mouseleave`). Clicking the pinned lane again releases it back to the
 * "all five" resting state.
 */

import { useState } from "react";
import type { V2Tone } from "./v2-tone";
import { v2ToneVar } from "./v2-tone";

export interface HomeV2Lane {
  /** RankingComponentKey — also the methodology component id. */
  key: string;
  label: string;
  weightPct: number;
  tone: V2Tone;
}

export interface HomeV2LaneExplainerProps {
  lanes: HomeV2Lane[];
  /** Real methodology short-description text, keyed by component id.
   *  Empty object degrades gracefully — the weight alone still renders. */
  descriptions: Record<string, string>;
}

export default function HomeV2LaneExplainer({ lanes, descriptions }: HomeV2LaneExplainerProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const activeKey = hovered ?? pinned;
  const active = lanes.find((l) => l.key === activeKey) ?? null;

  const clear = (key: string) => setHovered((cur) => (cur === key ? null : cur));
  const toggle = (key: string) => setPinned((cur) => (cur === key ? null : key));

  return (
    <div className="v2-lanes">
      <div className="v2-lanes-bar" role="group" aria-label="PEAK3's five rating components, by weight">
        {lanes.map((lane) => (
          <button
            key={lane.key}
            type="button"
            className="v2-lanes-segment"
            data-dim={activeKey !== null && activeKey !== lane.key ? "true" : undefined}
            style={{ flexGrow: lane.weightPct, background: v2ToneVar(lane.tone) }}
            aria-pressed={pinned === lane.key}
            onMouseEnter={() => setHovered(lane.key)}
            onMouseLeave={() => clear(lane.key)}
            onFocus={() => setHovered(lane.key)}
            onBlur={() => clear(lane.key)}
            onClick={() => toggle(lane.key)}
          >
            <span className="v2-lanes-segment-pct">{lane.weightPct}%</span>
          </button>
        ))}
      </div>

      <div className="v2-lanes-legend">
        {lanes.map((lane) => (
          <button
            key={lane.key}
            type="button"
            className="v2-lanes-legend-item"
            data-active={activeKey === lane.key ? "true" : undefined}
            onMouseEnter={() => setHovered(lane.key)}
            onMouseLeave={() => clear(lane.key)}
            onFocus={() => setHovered(lane.key)}
            onBlur={() => clear(lane.key)}
            onClick={() => toggle(lane.key)}
          >
            <span aria-hidden="true" className="v2-lanes-legend-dot" style={{ background: v2ToneVar(lane.tone) }} />
            {lane.label}
          </button>
        ))}
      </div>

      <div className="v2-lanes-detail" aria-live="polite">
        {active ? (
          <>
            <p className="v2-lanes-detail-head">
              <span style={{ color: v2ToneVar(active.tone) }}>{active.label}</span>
              <span className="v2-lanes-detail-pct">{active.weightPct}% of the rating</span>
            </p>
            <p className="v2-lanes-detail-body">
              {descriptions[active.key] ?? "One of PEAK3's five open, fixed-weight rating components."}
            </p>
          </>
        ) : (
          <p className="v2-lanes-detail-body v2-lanes-detail-prompt">
            Every rating is these five components, combined at fixed weights — never a black box.
            Hover or select a lane to see what it measures.
          </p>
        )}
      </div>
    </div>
  );
}
