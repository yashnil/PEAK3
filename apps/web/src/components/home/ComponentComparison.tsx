"use client";

/**
 * The homepage's interactive PEAK3 comparison (SYNTHESIS_CONTRACT.md §7):
 * "real rows, five components, click a component for its explanation,
 * links into the exact rankings entries."
 *
 * Every row is `methodology.components[i]` from `/api/v1/methodology`
 * (`home-data.ts`) — the SAME payload `/methodology`'s own accordion
 * renders (`app/(main)/methodology/page.tsx`), not a second, re-authored
 * copy of the explanation that could drift from it. Weights are the
 * frozen `OFFICIAL_WEIGHTS` (CLAUDE.md); nothing here computes a score.
 *
 * "Links into the exact rankings entries": each row's "See in rankings"
 * link is `/rankings?sort=<component id>`, which `/rankings` (owned by
 * `platform`, see that page's `readSortFromLocation`) reads once on mount
 * and applies as the initial sort — a real deep link, not a decorative
 * href to the same generic page every row would otherwise share.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { componentColor, componentTextColor } from "@/lib/utils";
import type { Methodology, MethodologyComponent } from "@/types";

export interface ComponentComparisonProps {
  methodology: Methodology | null;
}

export default function ComponentComparison({ methodology }: ComponentComparisonProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  // Degrades to nothing rather than inventing weights or explanations —
  // the same rule `HeroVignette` and `ModelProofStrip` already follow.
  if (!methodology || methodology.components.length === 0) return null;

  return (
    <section className="px-4 py-14" aria-labelledby="comparison-heading">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2
            id="comparison-heading"
            className="home-section-title font-display text-2xl font-bold"
          >
            Compare the five components
          </h2>
          <Link
            href="/methodology"
            className="arena-inline-link"
            style={{ color: "var(--text-secondary)" }}
          >
            Full methodology
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Every PEAK3 rating is these five components, weighted and combined — never a black box.
          Open one to see what it actually measures, then jump to the rankings sorted by it.
        </p>

        <ul role="list" className="mt-5 flex flex-col gap-2">
          {methodology.components.map((component) => (
            <ComponentRow
              key={component.id}
              component={component}
              open={openId === component.id}
              onToggle={() => setOpenId((current) => (current === component.id ? null : component.id))}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function ComponentRow({
  component,
  open,
  onToggle,
}: {
  component: MethodologyComponent;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `home-comparison-${component.id}`;
  // `color` (the frozen --comp-* hue) for the swatch dot and the open
  // border -- decorative, exactly where the frozen value belongs.
  // `textColor` for anything actually rendered as text (P3-G2: the raw
  // --comp-* hues measured 1.8-2.6:1 against Arena Day's card surface).
  const color = componentColor(component.id);
  const textColor = componentTextColor(component.id);

  return (
    /* THE ROW IS A SURFACE NOW, NOT A FILL. `--pk-grad-raised` plus
       `--pk-rim` is the same two-declaration treatment every card on the
       homepage takes; without it five identical `--bg-elevated` rectangles on
       an `--bg-page` section were, in Arena Day, five hairlines.

       The shadow is stated inline rather than through `.pk-lift` on purpose:
       this row is an accordion header, not a link, and a row that rises off
       the page when pointed at would promise navigation it does not perform.
       Its feedback is the open/closed state and the border taking the
       component's own colour. */
    <li
      className="overflow-hidden rounded-xl border"
      style={{
        borderColor: open ? color : "var(--border-subtle)",
        background: "var(--pk-grad-raised)",
        boxShadow: "var(--pk-rim), var(--pk-elev-1)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid={`home-comparison-toggle-${component.id}`}
        className="flex w-full items-center gap-3 px-4 text-left transition-colors"
        style={{ minHeight: "var(--pk-tap-min, 44px)" }}
      >
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {component.label}
            </span>
            <span
              className="score-number text-xs font-semibold"
              style={{ color: textColor, fontVariantNumeric: "tabular-nums" }}
            >
              {component.weight_pct.toFixed(0)}%
            </span>
          </span>
          <span className="mt-0.5 block text-xs" style={{ color: "var(--text-secondary)" }}>
            {component.short_description}
          </span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={open ? "pk-rotated" : undefined}
          style={{ color: "var(--text-muted)", flexShrink: 0 }}
        />
      </button>

      {open && (
        <div id={panelId} className="border-t px-4 py-3" style={{ borderColor: "var(--border-subtle)" }}>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {component.long_description}
          </p>
          {component.key_inputs.length > 0 && (
            <div className="mt-3">
              {/* PROMOTED AND ENLARGED, --text-muted -> --text-secondary and
                  10px -> 11px. It labels the list of the actual statistics a
                  component is computed from — the most concrete claim on the
                  homepage — and it was set as a footnote. */}
              <p className="home-eyebrow" style={{ color: "var(--text-secondary)" }}>
                Key inputs
              </p>
              <ul role="list" className="mt-1.5 flex flex-wrap gap-1.5">
                {component.key_inputs.map((input) => (
                  <li
                    key={input}
                    className="rounded-full px-2.5 py-1 text-[11px]"
                    style={{
                      background: "var(--pk-surface-raised, var(--bg-surface))",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {input}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link
            href={`/rankings?sort=${component.id}`}
            data-testid={`home-comparison-see-rankings-${component.id}`}
            className="arena-inline-link mt-3 inline-flex"
            style={{ color: textColor, minHeight: "var(--pk-tap-min, 44px)", alignItems: "center" }}
          >
            See rankings sorted by {component.label}
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
      )}
    </li>
  );
}
