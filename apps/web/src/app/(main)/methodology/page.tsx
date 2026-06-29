"use client";

import { useState, useEffect } from "react";
import { getMethodology } from "@/lib/api";
import type { Methodology, MethodologyComponent } from "@/types";
import { componentColor, cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const COMPONENT_ACCENT_COLORS: Record<string, string> = {
  statistical_impact: "var(--comp-si)",
  traditional_production: "var(--comp-tp)",
  individual_recognition: "var(--comp-rec)",
  postseason_individual_value: "var(--comp-po)",
  team_achievement: "var(--comp-team)",
};

export default function MethodologyPage() {
  const [methodology, setMethodology] = useState<Methodology | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    getMethodology()
      .then(setMethodology)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--text-muted)] animate-pulse" role="status">
          Loading…
        </p>
      </div>
    );
  }

  if (error || !methodology) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card-elevated max-w-md p-8 text-center space-y-4">
          <p className="text-[var(--incorrect)]" role="alert">
            {error ?? "Could not load methodology."}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-10">
        {/* Header */}
        <div>
          <h1 className="font-display text-3xl font-bold">Formula Explorer</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            The PEAK3 scoring formula, explained component by component.
            Click any component to expand its detail.
          </p>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Source:{" "}
            <a
              href="https://github.com"
              className="text-[var(--peak-accent)] hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              METHODOLOGY.md
            </a>{" "}
            in the open repository.
          </p>
        </div>

        {/* Formula overview */}
        <section aria-labelledby="formula-overview">
          <h2 id="formula-overview" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4">
            Official formula
          </h2>
          <div className="card-elevated p-5 space-y-3">
            <p className="font-mono text-sm text-[var(--text-secondary)] leading-relaxed">
              prime_index = 0.38·<span style={{ color: "var(--comp-si)" }}>Statistical Impact</span>
              {" "}+ 0.21·<span style={{ color: "var(--comp-tp)" }}>Traditional Production</span>
              {" "}+ 0.20·<span style={{ color: "var(--comp-rec)" }}>Individual Recognition</span>
              {" "}+ 0.18·<span style={{ color: "var(--comp-po)" }}>Postseason Value</span>
              {" "}+ 0.03·<span style={{ color: "var(--comp-team)" }}>Team Achievement</span>
              {" "}± teammate_adj
            </p>
            <div className="border-t border-[var(--border-subtle)] pt-3">
              <p className="text-xs text-[var(--text-muted)]">
                <strong className="text-[var(--text-secondary)]">prime_score</strong> is a separate, monotonic
                remapping of prime_index into a 0–100 historical band. The calibration is applied
                once after multi-year window aggregation — never by averaging single-season scores.
              </p>
            </div>
          </div>
        </section>

        {/* Formula bar */}
        <section aria-labelledby="formula-bar" aria-label="Component weight visualization">
          <h2 id="formula-bar" className="sr-only">Component weights</h2>
          <div className="flex h-8 rounded-lg overflow-hidden" role="img" aria-label="Formula weight bars: 38% Statistical Impact, 21% Traditional Production, 20% Individual Recognition, 18% Postseason Value, 3% Team Achievement">
            {methodology.components.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setOpenId(openId === c.id ? null : c.id)}
                aria-expanded={openId === c.id}
                aria-controls={`component-${c.id}`}
                title={`${c.label}: ${c.weight_pct}%`}
                style={{
                  width: `${c.weight_pct}%`,
                  backgroundColor: COMPONENT_ACCENT_COLORS[c.id],
                  opacity: openId && openId !== c.id ? 0.4 : 1,
                }}
                className="transition-opacity duration-200 flex items-center justify-center text-[10px] font-bold text-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {c.weight_pct}%
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-4 flex-wrap">
            {methodology.components.map((c) => (
              <div key={c.id} className="flex items-center gap-1.5">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: COMPONENT_ACCENT_COLORS[c.id] }}
                  aria-hidden="true"
                />
                <span className="text-[10px] text-[var(--text-muted)]">{c.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Components */}
        <section aria-labelledby="components-heading">
          <h2 id="components-heading" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4">
            Components
          </h2>
          <div className="space-y-3">
            {methodology.components.map((component) => (
              <ComponentAccordion
                key={component.id}
                component={component}
                isOpen={openId === component.id}
                onToggle={() => setOpenId(openId === component.id ? null : component.id)}
                color={COMPONENT_ACCENT_COLORS[component.id]}
              />
            ))}
          </div>
        </section>

        {/* Teammate adjustment */}
        <section aria-labelledby="tm-adj-heading">
          <h2 id="tm-adj-heading" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4">
            Teammate Adjustment
          </h2>
          <div className="card-surface p-5">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {methodology.teammate_adjustment.description}
            </p>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Range: {methodology.teammate_adjustment.range[0]} to +{methodology.teammate_adjustment.range[1]}
            </p>
          </div>
        </section>

        {/* Calibration */}
        <section aria-labelledby="calibration-heading">
          <h2 id="calibration-heading" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4">
            Calibration vs. Raw Index
          </h2>
          <div className="card-surface p-5">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {methodology.calibration.description}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="card-elevated p-3 text-center">
                <p className="font-bold text-[var(--text-primary)]">
                  {methodology.calibration.raw_label}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Open scale · used for ordering
                </p>
              </div>
              <div className="card-elevated p-3 text-center">
                <p className="font-bold text-[var(--peak-accent)]">
                  {methodology.calibration.display_label}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  0–100 · displayed in-game
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Window aggregation */}
        <section aria-labelledby="window-agg-heading">
          <h2 id="window-agg-heading" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4">
            Multi-Year Window Aggregation
          </h2>
          <div className="card-surface p-5 space-y-3">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {methodology.window_aggregation.description}
            </p>
            <div className="space-y-2">
              {Object.entries(methodology.window_aggregation.weights).map(([dur, weights]) => (
                <div key={dur} className="flex items-center gap-3 text-xs">
                  <span className="w-8 text-[var(--text-muted)] font-mono">{dur}</span>
                  <div className="flex gap-1">
                    {(weights as number[]).map((w, i) => (
                      <span
                        key={i}
                        className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[var(--text-secondary)]"
                      >
                        {(w * 100).toFixed(0)}%
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Text-only accessible version */}
        <section aria-labelledby="text-summary-heading">
          <h2 id="text-summary-heading" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4">
            Full text summary
          </h2>
          <div className="card-surface p-5 space-y-4">
            {methodology.components.map((c) => (
              <div key={c.id}>
                <h3
                  className="font-semibold text-sm mb-1"
                  style={{ color: COMPONENT_ACCENT_COLORS[c.id] }}
                >
                  {c.label} ({c.weight_pct}%)
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {c.long_description}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ComponentAccordion({
  component,
  isOpen,
  onToggle,
  color,
}: {
  component: MethodologyComponent;
  isOpen: boolean;
  onToggle: () => void;
  color: string;
}) {
  return (
    <div className="card-elevated overflow-hidden" style={{ borderLeftColor: color, borderLeftWidth: "3px" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`component-${component.id}`}
        className="w-full flex items-center justify-between p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] hover:bg-[var(--bg-surface)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span
            className="text-2xl font-bold score-number"
            style={{ color }}
          >
            {component.weight_pct}%
          </span>
          <div>
            <p className="font-semibold text-[var(--text-primary)]">{component.label}</p>
            <p className="text-xs text-[var(--text-secondary)]">
              {component.short_description}
            </p>
          </div>
        </div>
        {isOpen ? (
          <ChevronUp size={16} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown size={16} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            id={`component-${component.id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-[var(--border-subtle)] p-4 space-y-4">
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                {component.long_description}
              </p>
              <div>
                <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                  Key inputs
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {component.key_inputs.map((inp) => (
                    <span
                      key={inp}
                      className="rounded-md bg-[var(--bg-surface)] px-2 py-0.5 text-xs text-[var(--text-secondary)]"
                    >
                      {inp}
                    </span>
                  ))}
                </div>
              </div>
              {component.common_misconceptions.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Common misconceptions
                  </p>
                  <ul className="space-y-1">
                    {component.common_misconceptions.map((m) => (
                      <li key={m} className="text-xs text-[var(--text-muted)] pl-3 border-l border-[var(--border-subtle)]">
                        {m}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
