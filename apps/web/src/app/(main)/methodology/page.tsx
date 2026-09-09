"use client";

import { useState, useEffect } from "react";
import { getMethodology } from "@/lib/api";
import type { Methodology, MethodologyComponent } from "@/types";

import { ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2ResultHeadline from "@/components/v2/PeakV2ResultHeadline";
import PeakV2Rule from "@/components/v2/PeakV2Rule";

const COMPONENT_ACCENT_COLORS: Record<string, string> = {
  statistical_impact: "var(--comp-si)",
  traditional_production: "var(--comp-tp)",
  individual_recognition: "var(--comp-rec)",
  postseason_individual_value: "var(--comp-po)",
  team_achievement: "var(--comp-team)",
};

// P6-b: the frozen `--comp-*` values above are correct for a background fill
// or a border (COMPONENT_ACCENT_COLORS' other two call sites), but fail WCAG
// AA used directly as text -- same class as `--peak-accent` vs
// `--peak-accent-text` (P5-F1). This is the text-safe sibling map.
const COMPONENT_ACCENT_TEXT_COLORS: Record<string, string> = {
  statistical_impact: "var(--comp-si-text)",
  traditional_production: "var(--comp-tp-text)",
  individual_recognition: "var(--comp-rec-text)",
  postseason_individual_value: "var(--comp-po-text)",
  team_achievement: "var(--comp-team-text)",
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
      <PeakV2Shell width="live">
        <div className="min-h-screen flex items-center justify-center">
          <p role="status" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-muted)" }}>
            Loading the methodology…
          </p>
        </div>
      </PeakV2Shell>
    );
  }

  if (error || !methodology) {
    return (
      <PeakV2Shell width="live">
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="max-w-md p-8 text-center space-y-4" style={{ border: "1px solid var(--v2-border)", borderRadius: "var(--v2-radius-modal)", background: "var(--v2-bg-plane)" }}>
            <p role="alert" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-color-negative)" }}>
              {error ?? "Could not load methodology."}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              style={{ fontFamily: "var(--v2-font-ui)", border: "1px solid var(--v2-border)", borderRadius: "var(--v2-radius-control)", color: "var(--v2-text-primary)" }}
            >
              Try again
            </button>
          </div>
        </div>
      </PeakV2Shell>
    );
  }

  const v2View = (
    <PeakV2Shell width="live">
      {/* QUIET ROOM — this page is a long read with a component table and an
          accordion; court geometry behind it would be noise. See
          `styles/v2/arena-room.css`. */}
      <div data-arena="quiet" className="py-6 space-y-10">
        <div>
          <PeakV2ResultHeadline as="h1" scale="moment">
            Formula Explorer
          </PeakV2ResultHeadline>
          <p className="mt-2 text-sm" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-secondary)" }}>
            The PEAK3 scoring formula, explained component by component.
            Click any component to expand its detail.
          </p>
          <p className="mt-2 text-xs" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-muted)" }}>
            Source:{" "}
            <a
              href="https://github.com"
              className="underline"
              style={{ color: "var(--v2-color-accent)" }}
              target="_blank"
              rel="noopener noreferrer"
            >
              METHODOLOGY.md
            </a>{" "}
            in the open repository.
          </p>
        </div>

        <PeakV2Rule spacing="sm" />

        {/* Formula overview -- the formula itself as a first-class visual
            object: instrumentation role (mono, tabular) for every weight and
            the equation line, since these are the exact numbers that drive
            real scores. */}
        <section aria-labelledby="v2-formula-overview">
          <h2 id="v2-formula-overview" className="text-xs font-bold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)", letterSpacing: "var(--v2-mono-track)" }}>
            Official formula
          </h2>
          <div className="p-5 space-y-3" style={{ border: "1px solid var(--v2-border)", borderRadius: "var(--v2-radius-modal)", background: "var(--v2-bg-plane)" }}>
            <p className="text-xs" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-muted)" }} data-testid="methodology-model-version">
              Default scoring model:{" "}
              <strong style={{ color: "var(--v2-text-primary)" }}>PEAK3 v1</strong>. A second
              model, <strong style={{ color: "var(--v2-text-secondary)" }}>PEAK3 v2</strong>,
              recalibrates the postseason component to a replacement-level baseline and is
              available as a labelled preview. Scores from the two are not comparable, so
              every board and modal states which model produced it.
            </p>
            <p className="text-sm leading-relaxed" style={{ fontFamily: "var(--v2-font-mono)", letterSpacing: "var(--v2-mono-track)", color: "var(--v2-text-secondary)" }}>
              prime_index = 0.38·<span style={{ color: "var(--comp-si-text)" }}>Statistical Impact</span>
              {" "}+ 0.21·<span style={{ color: "var(--comp-tp-text)" }}>Traditional Production</span>
              {" "}+ 0.20·<span style={{ color: "var(--comp-rec-text)" }}>Individual Recognition</span>
              {" "}+ 0.18·<span style={{ color: "var(--comp-po-text)" }}>Playoff Rate Impact</span>
              {" "}+ 0.03·<span style={{ color: "var(--comp-team-text)" }}>Team Result</span>
              {" "}± teammate_adj
            </p>
            <div style={{ borderTop: "1px solid var(--v2-border-subtle)", paddingTop: "0.75rem" }}>
              <p className="text-xs" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-muted)" }}>
                <strong style={{ color: "var(--v2-text-secondary)" }}>prime_score</strong> is a separate, monotonic
                remapping of prime_index into a 0–100 historical band. The calibration is applied
                once after multi-year window aggregation — never by averaging single-season scores.
              </p>
            </div>
          </div>
        </section>

        {/* Formula bar -- same weights, same click-to-open wiring as legacy,
            just the V2 control grammar (square instrument radius, mono %). */}
        <section aria-labelledby="v2-formula-bar" aria-label="Component weight visualization">
          <h2 id="v2-formula-bar" className="sr-only">Component weights</h2>
          <div
            className="flex h-8 overflow-hidden"
            role="group"
            style={{ borderRadius: "var(--v2-radius-instrument)" }}
            aria-label="Formula weight bars: 38% Statistical Impact, 21% Traditional Production, 20% Individual Recognition, 18% Playoff Rate Impact, 3% Team Result"
          >
            {methodology.components.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setOpenId(openId === c.id ? null : c.id)}
                aria-expanded={openId === c.id}
                aria-controls={`v2-component-${c.id}`}
                title={`${c.label}: ${c.weight_pct}%`}
                style={{
                  width: `${c.weight_pct}%`,
                  backgroundColor: COMPONENT_ACCENT_COLORS[c.id],
                  opacity: openId && openId !== c.id ? 0.4 : 1,
                  fontFamily: "var(--v2-font-mono)",
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
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: COMPONENT_ACCENT_COLORS[c.id] }} aria-hidden="true" />
                <span className="text-[10px]" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-muted)" }}>{c.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Components */}
        <section aria-labelledby="v2-components-heading">
          <h2 id="v2-components-heading" className="text-xs font-bold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)", letterSpacing: "var(--v2-mono-track)" }}>
            Components
          </h2>
          <div className="space-y-3">
            {methodology.components.map((component) => (
              <ComponentAccordionV2
                key={component.id}
                component={component}
                isOpen={openId === component.id}
                onToggle={() => setOpenId(openId === component.id ? null : component.id)}
                color={COMPONENT_ACCENT_COLORS[component.id]}
                textColor={COMPONENT_ACCENT_TEXT_COLORS[component.id]}
              />
            ))}
          </div>
        </section>

        {/* Teammate adjustment */}
        <section aria-labelledby="v2-tm-adj-heading">
          <h2 id="v2-tm-adj-heading" className="text-xs font-bold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)", letterSpacing: "var(--v2-mono-track)" }}>
            Teammate Adjustment
          </h2>
          <div className="p-5" style={{ border: "1px solid var(--v2-border-subtle)", borderRadius: "var(--v2-radius-control)" }}>
            <p className="text-sm leading-relaxed" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-secondary)" }}>
              {methodology.teammate_adjustment.description}
            </p>
            <p className="mt-2 text-xs" style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)" }}>
              Range: {methodology.teammate_adjustment.range[0]} to +{methodology.teammate_adjustment.range[1]}
            </p>
          </div>
        </section>

        {/* Calibration */}
        <section aria-labelledby="v2-calibration-heading">
          <h2 id="v2-calibration-heading" className="text-xs font-bold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)", letterSpacing: "var(--v2-mono-track)" }}>
            Calibration vs. Raw Index
          </h2>
          <div className="p-5" style={{ border: "1px solid var(--v2-border-subtle)", borderRadius: "var(--v2-radius-control)" }}>
            <p className="text-sm leading-relaxed" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-secondary)" }}>
              {methodology.calibration.description}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="p-3 text-center" style={{ border: "1px solid var(--v2-border)", borderRadius: "var(--v2-radius-control)" }}>
                <p className="font-bold" style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-primary)" }}>
                  {methodology.calibration.raw_label}
                </p>
                <p className="text-xs" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-muted)" }}>
                  Open scale · used for ordering
                </p>
              </div>
              <div className="p-3 text-center" style={{ border: "1px solid var(--v2-border)", borderRadius: "var(--v2-radius-control)" }}>
                <p className="font-bold" style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-color-accent)" }}>
                  {methodology.calibration.display_label}
                </p>
                <p className="text-xs" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-muted)" }}>
                  0–100 · displayed in-game
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Window aggregation */}
        <section aria-labelledby="v2-window-agg-heading">
          <h2 id="v2-window-agg-heading" className="text-xs font-bold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)", letterSpacing: "var(--v2-mono-track)" }}>
            Multi-Year Window Aggregation
          </h2>
          <div className="p-5 space-y-3" style={{ border: "1px solid var(--v2-border-subtle)", borderRadius: "var(--v2-radius-control)" }}>
            <p className="text-sm leading-relaxed" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-secondary)" }}>
              {methodology.window_aggregation.description}
            </p>
            <div className="space-y-2">
              {Object.entries(methodology.window_aggregation.weights).map(([dur, weights]) => (
                <div key={dur} className="flex items-center gap-3 text-xs">
                  <span className="w-8" style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)" }}>{dur}</span>
                  <div className="flex gap-1">
                    {(weights as number[]).map((w, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5"
                        style={{ fontFamily: "var(--v2-font-mono)", background: "var(--v2-bg-plane)", color: "var(--v2-text-secondary)", borderRadius: "var(--v2-radius-instrument)" }}
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
        <section aria-labelledby="v2-text-summary-heading">
          <h2 id="v2-text-summary-heading" className="text-xs font-bold uppercase tracking-widest mb-4" style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)", letterSpacing: "var(--v2-mono-track)" }}>
            Full text summary
          </h2>
          <div className="p-5 space-y-4" style={{ border: "1px solid var(--v2-border-subtle)", borderRadius: "var(--v2-radius-control)" }}>
            {methodology.components.map((c) => (
              <div key={c.id}>
                <h3 className="font-semibold text-sm mb-1" style={{ fontFamily: "var(--v2-font-ui)", color: COMPONENT_ACCENT_TEXT_COLORS[c.id] }}>
                  {c.label} ({c.weight_pct}%)
                </h3>
                <p className="text-sm leading-relaxed" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-secondary)" }}>
                  {c.long_description}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </PeakV2Shell>
  );

  return v2View;
}

function ComponentAccordionV2({
  component,
  isOpen,
  onToggle,
  color,
  textColor,
}: {
  component: MethodologyComponent;
  isOpen: boolean;
  onToggle: () => void;
  color: string;
  textColor: string;
}) {
  return (
    <div
      className="overflow-hidden"
      style={{ borderLeftColor: color, borderLeftWidth: "3px", border: "1px solid var(--v2-border-subtle)", borderRadius: "var(--v2-radius-control)" }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`v2-component-${component.id}`}
        className="w-full flex items-center justify-between p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold" style={{ fontFamily: "var(--v2-font-mono)", color: textColor }}>
            {component.weight_pct}%
          </span>
          <div>
            <p className="font-semibold" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-primary)" }}>{component.label}</p>
            <p className="text-xs" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-secondary)" }}>
              {component.short_description}
            </p>
          </div>
        </div>
        {isOpen ? (
          <ChevronUp size={16} style={{ color: "var(--v2-text-muted)" }} className="shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown size={16} style={{ color: "var(--v2-text-muted)" }} className="shrink-0" aria-hidden="true" />
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            id={`v2-component-${component.id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-4" style={{ borderTop: "1px solid var(--v2-border-subtle)" }}>
              <p className="text-sm leading-relaxed" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-secondary)" }}>
                {component.long_description}
              </p>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)" }}>
                  Key inputs
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {component.key_inputs.map((inp) => (
                    <span
                      key={inp}
                      className="px-2 py-0.5 text-xs"
                      style={{ fontFamily: "var(--v2-font-ui)", background: "var(--v2-bg-plane)", color: "var(--v2-text-secondary)", borderRadius: "var(--v2-radius-control)" }}
                    >
                      {inp}
                    </span>
                  ))}
                </div>
              </div>
              {component.common_misconceptions.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)" }}>
                    Common misconceptions
                  </p>
                  <ul className="space-y-1">
                    {component.common_misconceptions.map((m) => (
                      <li key={m} className="text-xs pl-3" style={{ fontFamily: "var(--v2-font-ui)", color: "var(--v2-text-muted)", borderLeft: "1px solid var(--v2-border-subtle)" }}>
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
