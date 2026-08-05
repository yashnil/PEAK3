"use client";

import Link from "next/link";
import type { RankingBoardMeta } from "@/types";

/**
 * Board provenance: which model produced these numbers, over what data, and
 * what was left out.
 *
 * WHY THIS REPLACED A ROW OF 10 px GREY TEXT
 * ------------------------------------------
 * Everything here was already on the page. It was rendered as an undifferentiated
 * `text-[10px]` muted strip below the "show more" button, which had two
 * consequences worth fixing:
 *
 * 1. The serving-gate note was invisible in practice. The served boards apply a
 *    25.0 MPG floor on the anchor season that the canonical 250-pool CSVs do
 *    NOT, excluding 722 / 375 / 173 windows at 1Y / 3Y / 5Y. Real, committed
 *    players fall through it — Isaiah Hartenstein is canonical 1Y rank 185,
 *    Tony Allen 245, Andrew Bogut 3Y rank 205 — and none of them appear on this
 *    board. A board that filters rows without saying so legibly is presenting an
 *    edited list as a complete one. So the gate is now a first-class note, in
 *    body-text size and `--text-secondary`, not a grey fragment.
 *
 * 2. Six facts of different kinds ran together as one comma-less line, so the
 *    model version — the one fact that determines whether two scores are even
 *    comparable — read as no more important than the row count.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY. There is no "generated on" date. The
 * generator (scripts/build_top_peaks.py) does not write one into the artifact,
 * and the only other candidates were a file mtime or the git HEAD at request
 * time. Both are checkout artifacts — an mtime skew is precisely what produced
 * the false "the rankings are stale" report this pass began with — so inventing
 * a release date here would be fabricating provenance in the name of fixing it.
 * The API now passes `generated_at` through (peaks.py / seasons.py) so the line
 * appears by itself the day the generator emits one. Until then the honest
 * release identifier is `dataset_version`, which is shown.
 *
 * TESTIDS. `rankings-provenance` and `rankings-model-version` already existed
 * and are asserted by rankings.spec.ts (`/PEAK3 v1/`, contains
 * "peak3_official_weights_v1", never the non-default label). They are enhanced
 * in place, never replaced.
 */

export interface RankingsProvenanceProps {
  meta: RankingBoardMeta;
  /** Rows currently in the board, used only when the API omits a total. */
  fallbackRowCount: number;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rankings-provenance-fact">
      <dt className="rankings-provenance-label">{label}</dt>
      <dd className="rankings-provenance-value">{value}</dd>
    </div>
  );
}

export default function RankingsProvenance({ meta, fallbackRowCount }: RankingsProvenanceProps) {
  const rowsServed = meta.total_available ?? fallbackRowCount;
  const coverage =
    meta.supported_start_season && meta.supported_end_season
      ? `${meta.supported_start_season} to ${meta.supported_end_season}`
      : null;

  return (
    <section className="rankings-provenance" data-testid="rankings-provenance" aria-label="Data provenance">
      <dl className="rankings-provenance-facts">
        {meta.model_label && (
          <div className="rankings-provenance-fact">
            <dt className="rankings-provenance-label">Scoring model</dt>
            <dd
              className="rankings-provenance-value"
              data-testid="rankings-model-version"
              // A non-default model is called out in the accent colour rather
              // than buried: two model versions are not comparable, so a reader
              // needs to know which one is on screen before anything else here
              // means much.
              data-default-model={meta.is_default_model ? "true" : "false"}
              style={
                meta.is_default_model
                  ? undefined
                  : { color: "var(--peak-accent-text)", fontWeight: 600 }
              }
            >
              {meta.model_label}
            </dd>
          </div>
        )}
        {coverage && <Fact label="Data through" value={meta.supported_end_season ?? ""} />}
        {coverage && <Fact label="Seasons covered" value={coverage} />}
        {meta.dataset_version && <Fact label="Data release" value={meta.dataset_version} />}
        {/*
         * The SHA-256 of the artifact the API process actually loaded, first 12
         * chars. Unlike a date this is not a checkout artifact and cannot drift:
         * it is computed from the bytes being served, so it changes if and only
         * if the served data changes.
         *
         * That makes it the one fact on this panel that can catch the API's
         * process-lifetime `_CACHE` (peaks.py) still holding a previous artifact
         * after a regeneration — the failure mode a file mtime is blind to, and
         * the reason this pass began with a false "the rankings are stale"
         * report. Truncated because a reader compares it, they do not read it.
         */}
        {meta.artifact_digest && (
          <Fact label="Artifact fingerprint" value={meta.artifact_digest.slice(0, 12)} />
        )}
        {rowsServed != null && <Fact label="Rows on this board" value={rowsServed.toLocaleString()} />}
      </dl>

      {/* The gate, promoted. This is the sentence that keeps the board honest. */}
      {meta.serving_gate_note && (
        <p className="rankings-provenance-gate" data-testid="rankings-serving-gate">
          <strong>What this board leaves out:</strong> {meta.serving_gate_note}
        </p>
      )}

      <p className="rankings-provenance-links">
        <Link href="/methodology" className="rankings-provenance-link">
          How the score is built
        </Link>
        {meta.formula_version && (
          // The full weights string, verbatim from the model. It is the
          // machine-checkable identity of the formula, so it is rendered as
          // code rather than prose.
          <code className="rankings-provenance-formula">{meta.formula_version}</code>
        )}
      </p>
    </section>
  );
}
