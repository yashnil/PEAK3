"use client";

/**
 * The hero's visual content: a slow-rotating deck of REAL top-ranked 3-year
 * peak windows, each with its real weighted component contributions.
 *
 * WHY REAL DATA. The brief asks the hero to show "exact peak cards and
 * component bars" instead of giant typography, and CLAUDE.md forbids
 * hand-picking players or fabricating values. So the deck is simply the top
 * `n` rows of the Peak Windows board in the model's own order, drawn from
 * `/api/v1/peaks` on the server (see `home-data.ts`). If the API is down the
 * homepage renders without this column rather than with invented placeholders.
 *
 * WHY IT IS NOT INTERACTIVE. It is decoration over data that is fully
 * available, sortable and explainable on /rankings. Making it clickable would
 * put a second, weaker ranking surface on the front page and compete with the
 * one primary action the hero is supposed to have. The rotating stack is
 * `aria-hidden` and the same information is given once, statically, in the
 * figure's caption — rotating content is hostile to a screen reader.
 *
 * MOTION. Rotation stops entirely under `prefers-reduced-motion` and pauses
 * while the tab is hidden. The stage's height is fixed in CSS so nothing
 * reflows as cards move (CLS).
 */

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";
import { componentColor, componentLabel } from "@/lib/utils";
import type { RankingComponentKey } from "@/types";
import type { VignetteWindow } from "./home-data";

/**
 * The ceiling of each component's weighted contribution, i.e. 100 × its
 * OFFICIAL weight. These are the frozen weights in `peak3.py`
 * (statistical_impact=0.38, traditional_production=0.21, recognition=0.20,
 * postseason=0.18, team_achievement=0.03) — the same five numbers the page
 * already prints below the fold. A bar is therefore "how much of this
 * component's maximum the window earned", not a re-scaled invention.
 */
const COMPONENT_MAX: Record<RankingComponentKey, number> = {
  statistical_impact: 38,
  traditional_production: 21,
  individual_recognition: 20,
  postseason_individual_value: 18,
  team_achievement: 3,
};

const COMPONENT_ORDER: RankingComponentKey[] = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
];

/** Slow enough to read a whole card before it moves. */
const ROTATE_MS = 4600;

export interface HeroVignetteProps {
  windows: VignetteWindow[];
}

function barWidth(key: RankingComponentKey, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "0%";
  const max = COMPONENT_MAX[key];
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `${pct.toFixed(1)}%`;
}

export default function HeroVignette({ windows }: HeroVignetteProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [front, setFront] = useState(0);

  const count = windows.length;

  useEffect(() => {
    if (reducedMotion || count < 2) return;
    if (typeof document === "undefined") return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => setFront((i) => (i + 1) % count), ROTATE_MS);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reducedMotion, count]);

  if (count === 0) return null;

  return (
    <figure className="home-vignette home-vignette-enter" data-testid="home-hero-vignette">
      <div className="home-vignette-stage" aria-hidden="true">
        {windows.map((w, i) => {
          const offset = (i - front + count) % count;
          const slot = offset <= 2 ? String(offset) : "hidden";
          return (
            <article key={w.rowId} className="home-vignette-card" data-slot={slot}>
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className="text-[10px] font-bold uppercase tracking-[0.16em]"
                    style={{ color: "var(--peak-accent-text)" }}
                  >
                    Peak window · Rank {w.rank}
                  </p>
                  <h3 className="home-vignette-name font-display mt-1 truncate text-xl font-bold sm:text-2xl">
                    {w.playerName}
                  </h3>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {w.label}
                    {w.team ? ` · ${w.team}` : ""}
                  </p>
                </div>
                {w.primeScore !== null && (
                  <div className="shrink-0 text-right">
                    <p
                      className="score-number text-2xl font-bold leading-none sm:text-3xl"
                      style={{ color: "var(--peak-accent-text)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {w.primeScore.toFixed(1)}
                    </p>
                    <p
                      className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      PEAK3
                    </p>
                  </div>
                )}
              </header>

              {w.components && (
                <div className="mt-1 flex flex-col" style={{ gap: "var(--pk-space-2, 8px)" }}>
                  {COMPONENT_ORDER.map((key) => {
                    const value = w.components?.[key] ?? null;
                    return (
                      <div key={key}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className="text-[10px] font-semibold uppercase tracking-[0.08em]"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {componentLabel(key)}
                          </span>
                          <span
                            className="text-[10px]"
                            style={{
                              color: "var(--text-muted)",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {value === null ? "—" : value.toFixed(1)}
                          </span>
                        </div>
                        <span className="home-vignette-bar-track mt-1 block">
                          <span
                            className="home-vignette-bar-fill"
                            style={{
                              width: barWidth(key, value),
                              background: componentColor(key),
                            }}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <figcaption className="sr-only">
        The top {count} three-year peak windows PEAK3 rates, with each window&apos;s weighted
        contribution from the five model components:{" "}
        {windows
          .map((w) =>
            w.primeScore === null
              ? `${w.playerName}, ${w.label}`
              : `${w.playerName}, ${w.label}, ${w.primeScore.toFixed(1)}`,
          )
          .join("; ")}
        . The full board is on the rankings page.
      </figcaption>
    </figure>
  );
}
